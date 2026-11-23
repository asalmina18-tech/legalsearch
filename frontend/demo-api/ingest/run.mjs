// Сборка демо-корпуса из PDF судебных актов.
//
//   node --env-file=../.env.demo ingest/run.mjs        # все шаги
//   node ingest/run.mjs --no-llm                        # без GigaChat (только шапка акта)
//
// data/pdf/*.pdf → data/texts/*.json (pdftotext) → data/annotations/*.json (GigaChat)
// → data/corpus/{docs.json, chunks.json, vectors.f32} (e5-эмбеддинги).
//
// - Текст и шапка (суд, дата, номер) пересчитываются при каждом запуске — это дёшево,
//   и правки правил очистки сразу попадают в корпус.
// - id акта — хеш исходного текста PDF: от правил очистки не зависит, поэтому разбор
//   GigaChat (платный по квоте) переиспользуется. --force — разобрать GigaChat заново.
// - Тексты PDF, которых больше нет в data/pdf, из корпуса удаляются.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { complete, gigachatConfigured, MODEL } from "../lib/gigachat.mjs";
import { embedPassages, EMBED_MODEL } from "../lib/embed.mjs";
import { RELATION_TYPES } from "../lib/vocab.mjs";
import { chunkSpans, cleanCaseNumber, cleanText, closestPassage, courtCase, courtGenitive, ddmmyyyy, headerMeta, normalizeDate, reflowText, shortCourt, verbatimQuote } from "../lib/text.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DATA_DIR ?? path.join(ROOT, "data");
const DIRS = {
  pdf: path.join(DATA, "pdf"),
  texts: path.join(DATA, "texts"),
  ann: path.join(DATA, "annotations"),
  corpus: path.join(DATA, "corpus"),
};
const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const NO_LLM = args.has("--no-llm") || !gigachatConfigured();
const MIN_TEXT = Number(process.env.MIN_TEXT ?? 1500); // короче — скорее всего скан без текстового слоя или пустой файл

for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));

// ---------------------------------------------------------------- 1. PDF → текст

function extract() {
  const pdfs = fs.readdirSync(DIRS.pdf).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  console.log(`\n1/3 Текст из PDF: ${pdfs.length} файлов`);
  const sha1 = (s) => createHash("sha1").update(s).digest("hex");
  // прежние тексты: файл → id — чтобы перенести уже сделанный разбор, если id сменился
  const previous = new Map();
  for (const f of fs.readdirSync(DIRS.texts).filter((x) => x.endsWith(".json"))) {
    try {
      const j = readJson(path.join(DIRS.texts, f));
      previous.set(j.file, j.id);
    } catch {
      // битый файл — будет удалён ниже как лишний
    }
  }
  const seen = new Map(); // хеш очищенного текста → файл (дубликаты одного акта)
  const keep = new Set();
  let ok = 0, skipped = 0, moved = 0;
  for (const file of pdfs) {
    const raw = execFileSync("pdftotext", ["-enc", "UTF-8", "-q", path.join(DIRS.pdf, file), "-"], { maxBuffer: 64 << 20 }).toString("utf8");
    const text = cleanText(raw);
    if (text.length < MIN_TEXT) {
      console.log(`   пропуск ${file}: нет текстового слоя (${text.length} симв.)`);
      skipped++;
      continue;
    }
    const hash = sha1(text);
    if (seen.has(hash)) {
      console.log(`   пропуск ${file}: дубликат ${seen.get(hash)}`);
      skipped++;
      continue;
    }
    seen.set(hash, file);
    const id = sha1(raw).slice(0, 12);
    keep.add(`${id}.json`);
    const oldId = previous.get(file);
    const annNew = path.join(DIRS.ann, `${id}.json`);
    const annOld = oldId && path.join(DIRS.ann, `${oldId}.json`);
    if (oldId && oldId !== id && !fs.existsSync(annNew) && fs.existsSync(annOld)) {
      fs.renameSync(annOld, annNew);
      moved++;
    }
    writeJson(path.join(DIRS.texts, `${id}.json`), { id, file, text, meta: headerMeta(text) });
    ok++;
  }
  let removed = 0;
  for (const f of fs.readdirSync(DIRS.texts)) {
    if (f.endsWith(".json") && !keep.has(f)) {
      fs.unlinkSync(path.join(DIRS.texts, f));
      removed++;
    }
  }
  console.log(`   готово: ${ok}, пропущено: ${skipped}${removed ? `, удалено устаревших: ${removed}` : ""}${moved ? `, перенесено разборов: ${moved}` : ""}`);
}

// ---------------------------------------------------------------- 2. GigaChat: разбор акта


const ANNOTATION_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", description: "Вид акта: Постановление, Решение или Определение" },
    court: { type: "string", description: "Полное наименование суда, вынесшего акт" },
    date: { type: "string", description: "Дата акта (изготовления в полном объёме) в формате ГГГГ-ММ-ДД" },
    case_number: { type: "string", description: "Номер дела, например А40-12345/2024" },
    subtitle: { type: "string", description: "Суть спора одной строкой, до 100 символов" },
    relation_type: { type: "string", enum: RELATION_TYPES, description: "Тип правоотношений — одно значение из списка" },
    claim: { type: "string", description: "Что требовал истец, одним предложением" },
    facts: { type: "array", items: { type: "string" }, description: "3–5 ключевых обстоятельств дела, каждое 2–7 слов" },
    position: { type: "string", description: "Правовая позиция суда по существу спора, 1–2 предложения" },
    outcome: {
      type: "string",
      description:
        "Итог одной фразой: «Иск удовлетворен», «Иск удовлетворен частично», «В иске отказано», «Акты отменены, дело направлено на новое рассмотрение», «Акты оставлены без изменения» и т. п.",
    },
    norms: { type: "array", items: { type: "string" }, description: "Применённые нормы, например «ст. 715 ГК РФ»" },
    quote: {
      type: "string",
      description: "ДОСЛОВНАЯ цитата из мотивировочной части (одно–два предложения) с ключевой правовой позицией суда — без изменений",
    },
    summary: { type: "string", description: "Краткое изложение дела и вывода суда, 3–4 предложения" },
  },
  required: ["doc_type", "court", "date", "case_number", "subtitle", "relation_type", "claim", "facts", "position", "outcome", "norms", "quote", "summary"],
};

const ANNOTATION_SYSTEM =
  "Ты — помощник юриста. Тебе дан текст судебного акта арбитражного суда. Извлеки сведения строго из текста, ничего не придумывай. " +
  "Пиши кратко, юридическим языком, на русском. Цитату приводи дословно, как в тексте.";

// Правила и пример — модель плохо держит ограничения длины из описаний схемы,
// поэтому показываем, как должен выглядеть ответ.
const ANNOTATION_RULES = `Правила заполнения:
- subtitle — суть спора одной строкой (до 100 символов), не название коллегии и не стороны.
- facts — 3–5 коротких тезисов по 2–6 слов, без названий сторон, НЕ целые предложения.
- position — 1–2 предложения: к какому выводу пришёл суд и почему.
- outcome — итог для истца одной короткой фразой.
- norms — только номера статей с кодексом.
- quote — 1–2 предложения, скопированные из текста без единого изменения.

Пример (для другого дела):
{"doc_type":"Постановление","court":"Арбитражный суд Уральского округа","date":"2024-05-20","case_number":"А60-1234/2023",
"subtitle":"Взыскание неустойки за просрочку выполнения работ по договору подряда","relation_type":"Договор подряда",
"claim":"Заказчик требовал взыскать неустойку за нарушение срока выполнения работ.",
"facts":["Просрочка выполнения работ","Заявлена неустойка","Ходатайство о снижении по ст. 333 ГК РФ"],
"position":"Суд признал неустойку явно несоразмерной последствиям нарушения и снизил её до двукратной ставки рефинансирования.",
"outcome":"Иск удовлетворен частично","norms":["ст. 330 ГК РФ","ст. 333 ГК РФ"],
"quote":"…дословная цитата из текста…","summary":"…"}`;


/** Длинные акты: начало (обстоятельства) + конец (выводы и резолютивная часть). */
function excerpt(text, head = 42000, tail = 14000) {
  return text.length <= head + tail ? text : `${text.slice(0, head)}\n\n[…]\n\n${text.slice(-tail)}`;
}

async function annotate() {
  const files = fs.readdirSync(DIRS.texts).filter((f) => f.endsWith(".json")).sort();
  if (NO_LLM) {
    console.log(`\n2/3 Разбор GigaChat: пропущен (${gigachatConfigured() ? "--no-llm" : "нет GIGACHAT_AUTH_KEY"})`);
    return;
  }
  console.log(`\n2/3 Разбор GigaChat (${MODEL}): ${files.length} актов, по одному — у физлица один поток`);
  let done = 0, tokens = 0;
  for (const f of files) {
    const out = path.join(DIRS.ann, f);
    if (!FORCE && fs.existsSync(out)) {
      done++;
      continue;
    }
    const { id, text } = readJson(path.join(DIRS.texts, f));
    const t0 = Date.now();
    try {
      const { json, usage } = await complete({
        messages: [
          { role: "system", content: ANNOTATION_SYSTEM },
          { role: "user", content: `${ANNOTATION_RULES}\n\nТекст судебного акта:\n\n${excerpt(text)}` },
        ],
        schema: ANNOTATION_SCHEMA,
        maxTokens: 1500,
        temperature: 0.1,
      });
      writeJson(out, { id, model: MODEL, ...json });
      tokens += usage?.total_tokens ?? 0;
      done++;
      console.log(`   [${done}/${files.length}] ${json.case_number || id} — ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    } catch (e) {
      console.log(`   ошибка на ${id}: ${e.message}`);
    }
  }
  console.log(`   готово: ${done}/${files.length}, токенов: ${tokens}`);
}

// ---------------------------------------------------------------- 3. Корпус и эмбеддинги

function slug(caseNumber, fallback) {
  const s = (caseNumber || "")
    .toLowerCase()
    .replace(/а/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s ? `${s}-${fallback.slice(0, 4)}` : fallback;
}

function buildDoc({ id, file, text: raw, meta }, ann) {
  const pick = (a, b) => (a && String(a).trim()) || b || "";
  // текст для чтения и нарезки: строки PDF → абзацы (метаданные шапки уже извлечены)
  const text = reflowText(raw);
  // вид акта и суд — из шапки (надёжнее модели), модель — запасной вариант
  const docType = pick(meta.doc_type, (ann?.doc_type ?? "").split(/\s/)[0]) || "Судебный акт";
  const court = pick(meta.court, ann?.court ? courtCase(ann.court) : "");
  // дата из шапки надёжнее; модель иногда отдаёт «14.03.2024» вместо ГГГГ-ММ-ДД
  const date = normalizeDate(meta.date) || normalizeDate(ann?.date);
  const caseNumber = cleanCaseNumber(pick(meta.case_number, ann?.case_number));
  const d = ddmmyyyy(date);
  const ref = [docType, shortCourt(court), d && `от ${d}`, caseNumber && `по делу № ${caseNumber}`].filter(Boolean).join(" ");
  // дословная цитата; если модель пересказала — ближайший отрывок, который реально есть в тексте
  const quote = verbatimQuote(text, ann?.quote) || closestPassage(text, ann?.quote);
  return {
    id: slug(caseNumber, id),
    file,
    title: ref,
    long_title: [docType, courtGenitive(court), d && `от ${d}`, caseNumber && `по делу № ${caseNumber}`].filter(Boolean).join(" "),
    subtitle: pick(ann?.subtitle, text.slice(0, 120).replace(/\s+/g, " ")),
    court,
    date,
    case_number: caseNumber,
    short_ref: [shortCourt(court), d].filter(Boolean).join(", "),
    relation_type: pick(ann?.relation_type),
    claim: pick(ann?.claim),
    facts: Array.isArray(ann?.facts) ? ann.facts.slice(0, 6) : [],
    position: pick(ann?.position),
    outcome: pick(ann?.outcome),
    norms: Array.isArray(ann?.norms) ? ann.norms.slice(0, 8) : [],
    quote,
    summary: pick(ann?.summary),
    full_text: text,
  };
}

/** Текст «карточки» документа — отдельный вектор, чтобы документ находился по сути спора. */
function cardText(doc) {
  return [doc.title, doc.subtitle, doc.relation_type, doc.claim, doc.facts.join("; "), doc.position, doc.summary]
    .filter(Boolean)
    .join(". ");
}

async function build() {
  const files = fs.readdirSync(DIRS.texts).filter((f) => f.endsWith(".json")).sort();
  console.log(`\n3/3 Корпус и эмбеддинги (${EMBED_MODEL})`);
  const docs = [];
  const ids = new Set();
  for (const f of files) {
    const src = readJson(path.join(DIRS.texts, f));
    const annPath = path.join(DIRS.ann, f);
    const doc = buildDoc(src, fs.existsSync(annPath) ? readJson(annPath) : null);
    if (ids.has(doc.id)) doc.id = `${doc.id}-${src.id.slice(4, 8)}`;
    ids.add(doc.id);
    docs.push(doc);
  }
  const chunks = [];
  const passages = [];
  docs.forEach((doc, di) => {
    chunks.push({ doc: di, kind: "card" });
    passages.push(cardText(doc));
    for (const s of chunkSpans(doc.full_text)) {
      chunks.push({ doc: di, kind: "text", start: s.start, end: s.end });
      passages.push(doc.full_text.slice(s.start, s.end));
    }
  });
  const t0 = Date.now();
  const vectors = await embedPassages(passages, 16, (n, total) => {
    if (n % 160 === 0 || n === total) process.stdout.write(`   эмбеддинги: ${n}/${total}\r`);
  });
  const dims = vectors[0]?.length ?? 0;
  const flat = new Float32Array(vectors.length * dims);
  vectors.forEach((v, i) => flat.set(v, i * dims));
  fs.writeFileSync(path.join(DIRS.corpus, "vectors.f32"), Buffer.from(flat.buffer));
  writeJson(path.join(DIRS.corpus, "chunks.json"), chunks);
  writeJson(path.join(DIRS.corpus, "docs.json"), docs);
  writeJson(path.join(DIRS.corpus, "meta.json"), {
    model: EMBED_MODEL,
    dims,
    docs: docs.length,
    chunks: chunks.length,
    annotated: docs.filter((d) => d.position).length,
    built_at: new Date().toISOString(),
  });
  console.log(`\n   документов: ${docs.length}, фрагментов: ${chunks.length}, размерность: ${dims}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  const noQuote = docs.filter((d) => d.position && !d.quote).length;
  if (noQuote) console.log(`   у ${noQuote} актов цитата модели не найдена в тексте даже приблизительно — блок цитаты будет скрыт`);
}

extract();
await annotate();
await build();
console.log(`\nКорпус: ${DIRS.corpus}`);
