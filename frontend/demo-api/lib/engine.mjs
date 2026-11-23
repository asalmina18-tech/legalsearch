// Поисковый движок демо-стенда.
//
// 1. Поиск: номер дела в запросе → это дело; иначе e5-эмбеддинг запроса → косинус со всеми
//    фрагментами корпуса → по каждому акту лучший фрагмент → порог по косинусу и лексическая
//    проверка (значимые слова запроса должны встречаться в акте) → релевантность в %.
// 2. Анализ (GigaChat, строго по очереди — у физлица один поток):
//    а) «Краткий вывод» со ссылками [n] на найденные акты;
//    б) JSON по схеме — «моё дело», схема вывода, по каждому акту:
//       совпадения, отличия, почему релевантен, в пользу ли позиции.
// 3. Одинаковые запросы, пришедшие одновременно, выполняются один раз (общий «прогон»),
//    готовый ответ кешируется: повторный запрос (демо!) — мгновенно и бесплатно.

import fs from "node:fs";
import path from "node:path";
import { complete, gigachatConfigured, stream } from "./gigachat.mjs";
import { embedQuery, warmUp, EMBED_MODEL } from "./embed.mjs";
import { RELATION_TYPES } from "./vocab.mjs";
import { cleanCaseNumber, contentStems, findCaseNumber } from "./text.mjs";

// Калибровка на корпусе из 56 постановлений (см. README):
// - косинус e5 сжат: по теме лучший акт ≈ 0.86–0.92, но и вопрос не по теме корпуса
//   («ипотека», «штраф ГИБДД») доходит до 0.85–0.87 — одного порога по косинусу мало;
// - поэтому акт показываем, только если в нём встречается большая часть значимых слов
//   запроса (с весом по редкости слова в корпусе): «ипотеки», «супругов», «ГИБДД» в корпусе
//   договорных споров нет — такие запросы честно получают «ничего не найдено».
const MIN_COSINE = Number(process.env.MIN_COSINE ?? 0.85);
const MIN_COVERAGE = Number(process.env.MIN_COVERAGE ?? 0.5);
const NO_TERMS_MIN_COSINE = 0.88; // запрос без значимых слов («суд») — только очень близкие акты
const TOP_K = Number(process.env.TOP_K ?? 8);
const CACHE_MAX = Number(process.env.CACHE_MAX ?? 500);
const ANSWER_VERSION = 2; // 2 — разбор каждого найденного акта (раньше модель пропускала часть)
const toPercent = (cos) => Math.max(35, Math.min(98, Math.round(50 + ((cos - 0.8) / 0.12) * 47)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeQuery = (q) => q.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const strList = (v, max = 6) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, max) : []);
const str = (v) => (typeof v === "string" ? v : "");

const MESSAGES = {
  notFound: "По этому запросу в демо-корпусе не нашлось подходящих судебных актов. Попробуйте описать ситуацию иначе.",
  busy: "Сервис анализа сейчас занят — слишком много запросов одновременно. Документы найдены; повторите запрос через минуту.",
  timeout: "Сервис анализа не ответил вовремя. Документы найдены; повторите запрос через минуту.",
  filtered: "Сервис анализа не стал отвечать на этот запрос. Попробуйте сформулировать вопрос иначе.",
  failed: "Документы найдены, но вывод сейчас не сформирован: сервис анализа не ответил. Повторите запрос через минуту.",
  internal: "Поиск временно недоступен. Повторите запрос.",
};

export async function createEngine({ corpusDir, cacheFile }) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(corpusDir, f), "utf8"));
  const docs = read("docs.json");
  const chunks = read("chunks.json");
  const meta = read("meta.json");
  const buf = fs.readFileSync(path.join(corpusDir, "vectors.f32"));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const dims = meta.dims;
  // битый или чужой корпус — лучше не стартовать (деплой откатится), чем искать мусор
  if (vectors.length !== chunks.length * dims) throw new Error(`корпус повреждён: ${vectors.length} чисел вместо ${chunks.length}×${dims}`);
  if (meta.model && meta.model !== EMBED_MODEL) throw new Error(`корпус собран моделью ${meta.model}, а запросы — ${EMBED_MODEL}`);
  if (chunks.some((c) => !docs[c.doc])) throw new Error("корпус повреждён: фрагмент ссылается на несуществующий акт");
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Лексический индекс: основы значимых слов каждого акта и их документная частота.
  // Основа — 5 букв; совпадение только первых 4 («снижает» ↔ «снижение») засчитываем наполовину.
  const docStems = docs.map((d) =>
    contentStems([d.full_text, d.title, d.subtitle, d.claim, d.position, d.outcome, ...(d.facts ?? [])].join(" ")),
  );
  const docRoots = docStems.map((set) => new Set([...set].map((s) => s.slice(0, 4))));
  const df = new Map();
  for (const set of docStems) for (const s of set) df.set(s, (df.get(s) ?? 0) + 1);
  const rootDf = new Map();
  for (const set of docRoots) for (const r of set) rootDf.set(r, (rootDf.get(r) ?? 0) + 1);
  // редкость слова: по основе, а если такой основы в корпусе нет — по корню
  const idf = (s) => Math.log(1 + docs.length / ((df.get(s) ?? rootDf.get(s.slice(0, 4)) ?? 0) + 0.5));

  // ---- кеш ответов: LRU, только текущая сборка корпуса, запись атомарно и не на каждый чих ----
  // ANSWER_VERSION повышаем при изменении логики вывода/анализа — старые ответы не используются.
  const buildPrefix = `${meta.built_at}|v${ANSWER_VERSION}|`;
  const cache = new Map();
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(cacheFile, "utf8")))) {
        if (k.startsWith(buildPrefix) && Array.isArray(v?.ids) && v.summary) cache.set(k, v);
      }
    }
  } catch (e) {
    console.error("[engine] кеш не прочитан, начинаем с пустого:", e.message);
  }
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  const cacheKey = (q) => buildPrefix + normalizeQuery(q);
  let saveTimer = null;
  const scheduleSave = () => {
    if (!cacheFile || saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const tmp = `${cacheFile}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.promises.writeFile(tmp, JSON.stringify(Object.fromEntries(cache)));
        await fs.promises.rename(tmp, cacheFile);
      } catch (e) {
        console.error("[engine] cache write failed:", e.message);
      }
    }, 1000);
    saveTimer.unref?.();
  };
  const cacheGet = (key) => {
    const v = cache.get(key);
    if (v) {
      cache.delete(key); // LRU: недавно использованный — в конец
      cache.set(key, v);
    }
    return v;
  };
  const cacheSet = (key, v) => {
    cache.delete(key);
    cache.set(key, v);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    scheduleSave();
  };

  await warmUp();
  console.log(`[engine] корпус: ${docs.length} актов, ${chunks.length} фрагментов; кеш: ${cache.size}; GigaChat: ${gigachatConfigured() ? "подключен" : "нет ключа — без анализа"}`);

  /** Карточка акта для интерфейса. Полный текст — только в карточке (/cases/:id), не в выдаче. */
  function caseView(doc, score = null, { withText = false } = {}) {
    return {
      id: doc.id,
      title: doc.title,
      long_title: doc.long_title,
      subtitle: doc.subtitle,
      court: doc.court,
      date: doc.date,
      score: score ?? 0,
      short_ref: doc.short_ref,
      relation_type: doc.relation_type,
      facts: doc.facts,
      position: doc.position,
      outcome: doc.outcome,
      supports_position: null,
      matches: [],
      diffs: [],
      why: "",
      quote: doc.quote,
      ...(withText ? { full_text: doc.full_text } : {}),
    };
  }

  /** Доля «веса» значимых слов запроса, встречающихся в акте (0…1); null — значимых слов нет. */
  function coverage(queryStems, d) {
    let total = 0;
    let hit = 0;
    for (const s of queryStems) {
      const w = idf(s);
      total += w;
      if (docStems[d].has(s)) hit += w;
      else if (docRoots[d].has(s.slice(0, 4))) hit += w / 2;
    }
    return total ? hit / total : null;
  }

  /**
   * → { hits: [{doc, score, chunk, textChunk}], exactCase?, missingCase? }
   */
  async function retrieve(query) {
    // номер дела в запросе — показываем само дело, без семантического поиска
    const rawCaseNo = findCaseNumber(query);
    if (rawCaseNo) {
      const caseNo = cleanCaseNumber(rawCaseNo);
      const exact = docs.filter((d) => d.case_number === caseNo);
      if (exact.length) return { hits: exact.map((doc) => ({ doc, score: 1, chunk: -1, textChunk: null })), exactCase: caseNo };
      const rest = contentStems(query.replace(rawCaseNo, " ").replace(/(?<!\p{L})(дел[оау]|номер)(?!\p{L})/giu, " "));
      if (!rest.size) return { hits: [], missingCase: caseNo };
    }

    const q = await embedQuery(query);
    // по каждому акту: лучший фрагмент вообще (для ранжирования) и лучший фрагмент
    // текста (для контекста LLM — карточка-резюме не годится как цитата)
    const best = new Map(); // doc → { score, chunk, textScore, textChunk }
    for (let c = 0; c < chunks.length; c++) {
      let dot = 0;
      const off = c * dims;
      for (let i = 0; i < dims; i++) dot += q[i] * vectors[off + i];
      const d = chunks[c].doc;
      const cur = best.get(d) ?? { score: -1, chunk: -1, textScore: -1, textChunk: null };
      if (dot > cur.score) {
        cur.score = dot;
        cur.chunk = c;
      }
      if (chunks[c].kind === "text" && dot > cur.textScore) {
        cur.textScore = dot;
        cur.textChunk = c;
      }
      best.set(d, cur);
    }
    const queryStems = contentStems(query);
    const hits = [...best.entries()]
      .map(([d, v]) => ({ doc: docs[d], d, ...v }))
      .filter((h) => {
        const cov = coverage(queryStems, h.d);
        return cov === null ? h.score >= NO_TERMS_MIN_COSINE : h.score >= MIN_COSINE && cov >= MIN_COVERAGE;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
    return { hits };
  }

  function excerptOf(hit) {
    const c = chunks[hit.textChunk ?? hit.chunk];
    if (!c || c.kind !== "text") return hit.doc.summary || "";
    return hit.doc.full_text.slice(c.start, c.end).replace(/\s+/g, " ").slice(0, 750);
  }

  function context(hits) {
    return hits
      .map((h, i) => {
        const d = h.doc;
        return [
          `[${i + 1}] ${d.title}`,
          d.subtitle && `Суть: ${d.subtitle}`,
          d.claim && `Требование: ${d.claim}`,
          d.facts?.length && `Обстоятельства: ${d.facts.join("; ")}`,
          d.position && `Позиция суда: ${d.position}`,
          d.outcome && `Итог: ${d.outcome}`,
          `Фрагмент: «${excerptOf(h)}»`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }

  const SYSTEM =
    "Ты — юридический ассистент по судебной практике арбитражных судов РФ. Опирайся только на приведённые судебные акты, ничего не придумывай. Пиши по-русски, ясно и кратко.";

  async function summarize(query, hits, signal, onQueued) {
    const { text, truncated } = await stream({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            `Вопрос юриста: ${query}\n\nНайденные судебные акты:\n\n${context(hits)}\n\n` +
            "Дай краткий вывод (3–5 предложений): что следует из этой практики по вопросу, при каких условиях. " +
            "Ссылайся на акты в формате [1], [2]. Если акты не отвечают на вопрос прямо — так и скажи. Без вступлений и заголовков.",
        },
      ],
      maxTokens: 450,
      signal,
      onQueued,
    });
    if (!truncated) return { text: text.trim(), complete: true };
    // упёрлись в лимит — показываем до последнего законченного предложения, но не кешируем
    const end = Math.max(text.lastIndexOf(". "), text.lastIndexOf(".\n"), text.endsWith(".") ? text.length - 1 : -1);
    return { text: (end > 0 ? text.slice(0, end + 1) : text).trim(), complete: false };
  }

  const ANALYSIS_SCHEMA = {
    type: "object",
    properties: {
      my_case: {
        type: "object",
        properties: {
          relation_type: { type: "string", enum: RELATION_TYPES, description: "Тип правоотношений в ситуации юриста — одно значение из списка" },
          circumstances: { type: "array", items: { type: "string" }, description: "2–4 ключевых обстоятельства ситуации юриста из его вопроса, по 2–6 слов" },
        },
        required: ["relation_type", "circumstances"],
      },
      map: {
        type: "object",
        description: "Схема вывода: из чего сложился вывод и что из него следует",
        properties: {
          facts: { type: "array", items: { type: "string" }, description: "2–3 факта ситуации" },
          norms: { type: "array", items: { type: "string" }, description: "2–3 применимые нормы с кратким пояснением, например «Ст. 717 ГК РФ (отказ заказчика)»" },
          question: { type: "string", description: "Ключевой правовой вопрос одним предложением" },
          practice: { type: "array", items: { type: "string" }, description: "2–3 тезиса судебной практики из найденных актов" },
          arguments: { type: "array", items: { type: "string" }, description: "2–3 аргумента в пользу позиции юриста" },
          risks: { type: "array", items: { type: "string" }, description: "2–3 риска" },
          conclusion: { type: "string", description: "Вывод одним предложением" },
        },
        required: ["facts", "norms", "question", "practice", "arguments", "risks", "conclusion"],
      },
      cases: {
        type: "array",
        description: "По одному элементу на каждый найденный акт, в том же порядке",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "Номер акта из списка" },
            supports_position: { type: "boolean", description: "Итог дела в пользу позиции юриста (true) или против (false)" },
            matches: { type: "array", items: { type: "string" }, description: "2–4 обстоятельства, совпадающие с ситуацией юриста" },
            diffs: { type: "array", items: { type: "string" }, description: "1–3 отличия от ситуации юриста" },
            why: { type: "string", description: "Почему акт релевантен вопросу, 1–2 предложения" },
          },
          required: ["n", "supports_position", "matches", "diffs", "why"],
        },
      },
    },
    required: ["my_case", "map", "cases"],
  };

  // Модель плохо держит длину из описаний схемы — правила и пример в самом запросе.
  // Тексты идут в блоки схемы фиксированного размера, поэтому — коротко.
  const ANALYSIS_RULES = `Правила:
- Все пункты — короткие тезисы по 3–7 слов, без вводных слов и без номеров актов.
- map.question — до 12 слов; map.conclusion — одно предложение до 20 слов.
- В каждом списке 2–3 пункта; matches — 2–3, diffs — 1–2, why — одно предложение до 20 слов.
- Ссылки вида [1] пиши только в map.practice.

Пример формы (для другой ситуации, в ней 2 акта):
{"my_case":{"relation_type":"Договор поставки","circumstances":["Поставлен некачественный товар","Покупатель требует вернуть оплату"]},
"map":{"facts":["Товар с существенными недостатками","Претензия поставщику"],"norms":["Ст. 475 ГК РФ (качество товара)","Ст. 518 ГК РФ"],
"question":"Можно ли вернуть оплату за некачественный товар?","practice":["[1] Возврат при существенных недостатках","[2] Нужна экспертиза качества"],
"arguments":["Недостатки неустранимы","Претензионный порядок соблюдён"],"risks":["Нет экспертизы","Пропуск срока приёмки"],
"conclusion":"Вернуть оплату можно при доказанности существенных недостатков товара."},
"cases":[{"n":1,"supports_position":true,"matches":["Некачественный товар","Требование возврата оплаты"],"diffs":["Другая категория товара"],"why":"Суд вернул оплату при аналогичных недостатках товара."},
{"n":2,"supports_position":false,"matches":["Спор о качестве товара"],"diffs":["Недостатки не доказаны","Нет экспертизы"],"why":"Показывает, почему без экспертизы во взыскании отказывают."}]}`;

  // По одному элементу на каждый акт — модель склонна разбирать 2–3 акта и пропускать
  // остальные, поэтому число задаём и в схеме, и словами в запросе.
  const casesSchema = (k) => ({ ...ANALYSIS_SCHEMA.properties.cases, minItems: k, maxItems: k });
  const casesRule = (k) =>
    `В "cases" — ровно ${k} элементов: n = 1…${k}, по одному на КАЖДЫЙ акт из списка, ни один не пропускай. ` +
    "Если акт подходит слабо — всё равно заполни, а в why так и напиши.";

  /** Разбор по актам из ответа модели → [{id, supports_position, matches, diffs, why}]. */
  function insightsFrom(rawCases, hits) {
    const raw = Array.isArray(rawCases) ? rawCases.filter((c) => c && typeof c === "object") : [];
    // Нумерация модели: если n — ровно 1…k без повторов, верим n; иначе — порядку элементов.
    const ns = raw.map((c) => Number(c.n));
    const byN = ns.every((n) => Number.isInteger(n) && n >= 1 && n <= hits.length) && new Set(ns).size === ns.length;
    const insights = [];
    const seen = new Set();
    raw.forEach((c, i) => {
      const hit = hits[byN ? Number(c.n) - 1 : i];
      if (!hit || seen.has(hit.doc.id)) return;
      const insight = {
        id: hit.doc.id,
        supports_position: typeof c.supports_position === "boolean" ? c.supports_position : null,
        matches: strList(c.matches, 4),
        diffs: strList(c.diffs, 3),
        why: str(c.why),
      };
      if (!insight.matches.length && !insight.diffs.length && !insight.why) return; // пустой — как не было
      seen.add(hit.doc.id);
      insights.push(insight);
    });
    return insights;
  }

  function statsFor(insights, hits) {
    const known = insights.filter((i) => i.supports_position !== null);
    const forCount = known.filter((i) => i.supports_position).length;
    return {
      for_count: forCount,
      against_count: known.length - forCount,
      total: hits.length,
      direct_analogs: hits.filter((h) => toPercent(h.score) >= 80).length,
    };
  }

  /** Ответ модели → анализ для интерфейса; всё, что не по форме, отбрасываем, а не роняем. */
  function normalizeAnalysis(json, hits) {
    const insights = insightsFrom(json?.cases, hits);

    // «Мое дело»: если модель выбрала тип отношений, которого нет ни у одного
    // найденного акта, — берём самый частый тип среди найденных (модель тут ошибается).
    const mc = json?.my_case && typeof json.my_case === "object" ? json.my_case : {};
    const myCase = { relation_type: str(mc.relation_type), circumstances: strList(mc.circumstances, 4) };
    const hitTypes = hits.map((h) => h.doc.relation_type).filter(Boolean);
    if (hitTypes.length && !hitTypes.includes(myCase.relation_type)) {
      const counts = new Map();
      for (const t of hitTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
      myCase.relation_type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    const m = json?.map && typeof json.map === "object" ? json.map : null;
    const map = m
      ? {
          facts: strList(m.facts),
          norms: strList(m.norms),
          question: str(m.question),
          practice: strList(m.practice),
          arguments: strList(m.arguments),
          risks: strList(m.risks),
          conclusion: str(m.conclusion),
        }
      : null;

    return { stats: statsFor(insights, hits), map, my_case: myCase, cases: insights };
  }

  async function analyze(query, hits, signal) {
    const { json } = await complete({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            `Вопрос юриста (это его ситуация и желаемый результат): ${query}\n\nНайденные судебные акты:\n\n${context(hits)}\n\n` +
            "Сопоставь ситуацию юриста с каждым актом и построй схему вывода. Позиция юриста — результат, которого он добивается по вопросу.\n\n" +
            `${casesRule(hits.length)}\n\n${ANALYSIS_RULES}`,
        },
      ],
      schema: { ...ANALYSIS_SCHEMA, properties: { ...ANALYSIS_SCHEMA.properties, cases: casesSchema(hits.length) } },
      maxTokens: 3000,
      temperature: 0.1,
      signal,
    });
    return normalizeAnalysis(json, hits);
  }

  /** Дозапрос: разбор только тех актов, которые модель пропустила в общем анализе. */
  async function analyzeMissing(query, missing, signal) {
    const { json } = await complete({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            `Вопрос юриста (это его ситуация и желаемый результат): ${query}\n\nСудебные акты:\n\n${context(missing)}\n\n` +
            "Сопоставь ситуацию юриста с каждым актом: что совпадает, чем отличается, почему акт релевантен, в пользу ли позиции юриста итог.\n\n" +
            `${casesRule(missing.length)}\nПункты — короткие тезисы по 3–7 слов; matches — 2–3, diffs — 1–2, why — одно предложение до 20 слов.`,
        },
      ],
      schema: { type: "object", properties: { cases: casesSchema(missing.length) }, required: ["cases"] },
      maxTokens: 300 * missing.length + 200,
      temperature: 0.1,
      signal,
    });
    return insightsFrom(json?.cases, missing);
  }

  /** Выдаёт готовый текст по словам — эффект «печатает» (GigaChat отдаёт ответ одним куском). */
  async function typeOut(text, emit, isAborted, delay = 18) {
    for (const token of text.match(/\S+\s*/g) ?? []) {
      if (isAborted()) return;
      emit("token", { text: token });
      await sleep(delay);
    }
  }

  // ---- «прогон» запроса: один на все одинаковые запросы, пришедшие одновременно ----

  const inflight = new Map(); // ключ кеша → прогон

  function startRun(key, query) {
    const controller = new AbortController();
    const run = { events: [], subs: new Set(), done: false, lastQueue: null, finishers: new Set() };
    // события запоминаются, чтобы подключившийся позже получил всё с начала
    const emit = (event, data) => {
      if (event === "queue") {
        run.lastQueue = data;
        for (const s of run.subs) s(event, data);
        return;
      }
      if (event === "token") run.lastQueue = null;
      run.events.push([event, data]);
      for (const s of run.subs) s(event, data);
    };
    run.attach = (send, signal) =>
      new Promise((resolve) => {
        for (const [e, d] of run.events) send(e, d);
        if (run.lastQueue) send("queue", run.lastQueue);
        if (run.done) return resolve();
        const finish = () => {
          run.subs.delete(send);
          run.finishers.delete(finish);
          signal?.removeEventListener("abort", onLeave);
          resolve();
        };
        // ушли все, кто ждал ответа, — прогон отменяем: очередь GigaChat и квота не тратятся впустую
        const onLeave = () => {
          finish();
          if (!run.subs.size && !run.done) controller.abort();
        };
        run.subs.add(send);
        run.finishers.add(finish);
        if (signal?.aborted) return onLeave();
        signal?.addEventListener("abort", onLeave, { once: true });
      });

    inflight.set(key, run);
    produce(key, query, emit, controller.signal)
      .catch((e) => {
        if (controller.signal.aborted) return;
        console.error("[engine] поиск:", e);
        emit("error", { detail: MESSAGES.internal });
      })
      .finally(() => {
        run.done = true;
        inflight.delete(key);
        for (const f of [...run.finishers]) f();
      });
    return run;
  }

  async function produce(key, query, emit, signal) {
    const isAborted = () => signal.aborted;
    const { hits, exactCase, missingCase } = await retrieve(query);
    const cases = hits.map((h) => caseView(h.doc, toPercent(h.score)));
    emit("cases", { cases, demo: false });
    if (missingCase) return emit("token", { text: `Дела № ${missingCase} в демо-корпусе нет. В корпусе — ${docs.length} постановлений арбитражных судов по гражданско-правовым спорам.` });
    if (!hits.length) return emit("token", { text: MESSAGES.notFound });
    if (exactCase) {
      return emit("token", { text: `Найден судебный акт по делу № ${exactCase}. Откройте карточку: обстоятельства, позиция суда, ключевая цитата и полный текст.` });
    }
    if (!gigachatConfigured()) return;

    let summary = null;
    try {
      summary = await summarize(query, hits, signal, (position) => emit("queue", { position }));
      if (isAborted()) return;
      // анализ запрашиваем сразу, а вывод тем временем «печатаем» клиенту
      const analysisPromise = analyze(query, hits, signal);
      analysisPromise.catch(() => {}); // ошибка обработается ниже, после печати
      await typeOut(summary.text, emit, isAborted);
      let analysis = await analysisPromise;
      if (isAborted()) return;
      emit("analysis", analysis);
      // модель пропустила часть актов — один дозапрос только по ним; карточки обновятся
      const missing = hits.filter((h) => !analysis.cases.some((c) => c.id === h.doc.id));
      if (missing.length) {
        try {
          const extra = await analyzeMissing(query, missing, signal);
          if (isAborted()) return;
          if (extra.length) {
            const cases = [...analysis.cases, ...extra];
            analysis = { ...analysis, cases, stats: statsFor(cases, hits) };
            emit("analysis", analysis);
          }
          console.log(`[engine] дозапрос анализа: ${extra.length} из ${missing.length} пропущенных актов`);
        } catch (e) {
          if (isAborted()) return;
          console.error(`[engine] дозапрос анализа (${e.kind ?? "?"}):`, e.message); // остаётся то, что есть
        }
      }
      // в кеш — только полный ответ: обрезанный вывод или анализ с ошибкой не «замораживаем»
      if (summary.complete) {
        cacheSet(key, { ids: hits.map((h) => [h.doc.id, toPercent(h.score)]), summary: summary.text, analysis, at: new Date().toISOString() });
      }
    } catch (e) {
      if (isAborted()) return;
      console.error(`[engine] GigaChat (${e.kind ?? "?"}):`, e.message);
      if (!summary) emit("error", { detail: MESSAGES[e.kind] ?? MESSAGES.failed });
      // если вывод уже есть — просто без анализа (интерфейс покажет «нет данных»)
    }
  }

  async function replayCached(entry, send, signal) {
    const cases = entry.ids.map(([id, pct]) => byId.get(id) && caseView(byId.get(id), pct)).filter(Boolean);
    send("cases", { cases, demo: false });
    await typeOut(entry.summary, send, () => !!signal?.aborted, 12);
    if (entry.analysis && !signal?.aborted) send("analysis", entry.analysis);
  }

  /**
   * Поток событий поиска в формате контракта /search/ (cases → token… → analysis).
   * send(event, data); signal — клиент закрыл соединение. Завершается, когда ответ
   * выдан целиком или клиент ушёл.
   */
  async function searchStream(query, send, signal) {
    const key = cacheKey(query);
    const cached = cacheGet(key);
    if (cached) return replayCached(cached, send, signal);
    const run = inflight.get(key) ?? startRun(key, query);
    return run.attach(send, signal);
  }

  return {
    size: docs.length,
    meta,
    searchStream,
    retrieve, // для калибровки порогов (scripts), не для HTTP
    getCase: (id) => {
      const d = byId.get(id);
      return d ? caseView(d, null, { withText: true }) : null;
    },
  };
}
