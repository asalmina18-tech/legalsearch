// Mock-backend LegalSearch для разработки интерфейса без настоящего поиска.
// Реализует контракт из frontend/src/lib/api.ts (см. README, раздел «API»)
// на демонстрационных данных эталонного прототипа. Состояние — в памяти.
//
//   node mock/server.mjs              → http://127.0.0.1:8000
//   PORT=8010 MOCK_DELAY_MS=0 MOCK_ALLOW_RESET=1 node mock/server.mjs   (для тестов)
//   HOST=0.0.0.0 — слушать все интерфейсы (внутри контейнера демо-стенда)
//   CORPUS_DIR=…/data/corpus — настоящий поиск по корпусу решений (demo-api/), а не
//     фиксированная выдача; анализ — GigaChat при заданном GIGACHAT_AUTH_KEY.

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "127.0.0.1";
// POST /__reset (сброс данных) — только для тестов, на демо-стенде выключен.
const ALLOW_RESET = process.env.MOCK_ALLOW_RESET === "1";
const DELAY = Number(process.env.MOCK_DELAY_MS ?? 35); // задержка между токенами «стрима»

// ---------------------------------------------------------------- данные

const CASES = [
  {
    id: "ac-mo-f05-1234-2024",
    title: "Постановление АС Московского округа от 14.03.2024 № Ф05-1234/2024",
    long_title: "Постановление Арбитражного суда Московского округа от 14.03.2024 № Ф05-1234/2024",
    subtitle: "Взыскание убытков при одностороннем отказе от договора подряда",
    court: "АС Московского округа",
    date: "2024-03-14",
    score: 95,
    short_ref: "АС МО, 14.03.2024",
    relation_type: "Договор подряда",
    facts: ["Односторонний отказ", "Работы не приняты", "Взысканы убытки"],
    position: "Взыскать убытки, отказ признан неправомерным",
    outcome: "Иск удовлетворен",
    supports_position: true,
    matches: [
      "Односторонний отказ от договора подряда",
      "Заявлены убытки",
      "Наличие выполненных работ",
      "Суд признал отказ неправомерным",
    ],
    diffs: [
      "В деле работы не были приняты заказчиком",
      "Иной порядок расчета убытков",
      "Дополнительные обстоятельства (наличие переписки о согласовании)",
    ],
    why: "Дело содержит прямую правовую позицию о возможности взыскания убытков при неправомерном одностороннем отказе от договора подряда и аналогичные ключевые обстоятельства.",
    quote:
      "Односторонний отказ заказчика от договора подряда, не основанный на существенном нарушении подрядчиком своих обязательств, является неправомерным и влечет обязанность возместить причиненные убытки в полном объеме…",
    full_text: "АРБИТРАЖНЫЙ СУД МОСКОВСКОГО ОКРУГА\nПОСТАНОВЛЕНИЕ от 14 марта 2024 г. № Ф05-1234/2024\n\nОбщество с ограниченной ответственностью «Альфа» (подрядчик) обратилось в арбитражный суд с иском к обществу с ограниченной ответственностью «Бета» (заказчик) о взыскании убытков, причиненных односторонним отказом от исполнения договора подряда.\n\nКак установлено судами, между сторонами заключен договор подряда на выполнение отделочных работ. В ходе исполнения договора заказчик направил подрядчику уведомление об одностороннем отказе от договора, сославшись на нарушение сроков выполнения работ. Подрядчик к этому моменту выполнил значительную часть работ, однако заказчик от их приемки уклонился.\n\nСуды первой и апелляционной инстанций пришли к выводу, что заявленное заказчиком нарушение сроков вызвано несвоевременной передачей ему строительной площадки и проектной документации, то есть обстоятельствами, за которые отвечает сам заказчик. Существенного нарушения условий договора со стороны подрядчика не установлено.\n\nОдносторонний отказ заказчика от договора подряда, не основанный на существенном нарушении подрядчиком своих обязательств, является неправомерным и влечет обязанность возместить причиненные убытки в полном объеме, включая стоимость выполненных работ и упущенную выгоду (статьи 15, 393, 715, 717 Гражданского кодекса Российской Федерации).\n\nРасчет убытков, представленный истцом, проверен судами и признан обоснованным; ответчик контррасчет не представил. Доводы кассационной жалобы направлены на переоценку доказательств, что не входит в полномочия суда кассационной инстанции.\n\nРуководствуясь статьями 284–289 Арбитражного процессуального кодекса Российской Федерации, суд постановил: решение и постановление апелляционного суда оставить без изменения, кассационную жалобу — без удовлетворения.",
  },
  {
    id: "vs-305-es23-9876",
    title: "Определение ВС РФ от 28.11.2023 № 305-ЭС23-9876",
    long_title: "Определение Верховного Суда РФ от 28.11.2023 № 305-ЭС23-9876",
    subtitle: "О пределах взыскания убытков при расторжении договора",
    court: "ВС РФ",
    date: "2023-11-28",
    score: 88,
    short_ref: "ВС РФ, 28.11.2023",
    relation_type: "Договор подряда",
    facts: ["Расторжение договора", "Спор о размере убытков", "Частично отказано"],
    position: "Частичный отказ, уменьшен размер убытков",
    outcome: "Частично удовлетворен",
    supports_position: false,
    matches: ["Договор подряда", "Требование о возмещении убытков", "Расторжение договора"],
    diffs: ["Спор касался размера убытков", "Требования удовлетворены частично"],
    why: "В примере рассмотрен вопрос о пределах возмещения убытков после расторжения договора. Обстоятельства частично совпадают с описанной ситуацией.",
    quote: "Размер подлежащих возмещению убытков определяется судом с разумной степенью достоверности с учетом всех обстоятельств дела, принципов справедливости и соразмерности ответственности допущенному нарушению.",
    full_text: "ВЕРХОВНЫЙ СУД РОССИЙСКОЙ ФЕДЕРАЦИИ\nОПРЕДЕЛЕНИЕ от 28 ноября 2023 г. № 305-ЭС23-9876\n\nСудебная коллегия по экономическим спорам рассмотрела кассационную жалобу общества с ограниченной ответственностью «Гамма» на судебные акты по делу о взыскании убытков, причиненных расторжением договора подряда.\n\nКак следует из материалов дела, договор подряда был расторгнут по инициативе заказчика. Подрядчик потребовал возмещения убытков, включая стоимость приобретенных материалов, расходы на привлечение субподрядчиков и упущенную выгоду в размере всей предполагаемой прибыли по договору.\n\nСуды нижестоящих инстанций удовлетворили требования в полном объеме, не проверив, были ли материалы фактически использованы или могут быть реализованы, и не оценив разумность заявленной упущенной выгоды.\n\nРазмер подлежащих возмещению убытков определяется судом с разумной степенью достоверности с учетом всех обстоятельств дела, принципов справедливости и соразмерности ответственности допущенному нарушению. При этом упущенная выгода подлежит взысканию лишь в той части, в которой кредитор доказал реальную возможность ее получения.\n\nС учетом изложенного судебная коллегия определила: судебные акты изменить, требования о взыскании убытков удовлетворить частично, в остальной части в иске отказать.",
  },
  {
    id: "ac-po-f06-5678-2023",
    title: "Постановление АС Поволжского округа от 20.07.2023 № Ф06-5678/2023",
    long_title: "Постановление Арбитражного суда Поволжского округа от 20.07.2023 № Ф06-5678/2023",
    subtitle: "Критерии доказанности убытков",
    court: "АС Поволжского округа",
    date: "2023-07-20",
    score: 76,
    short_ref: "АС ПО, 20.07.2023",
    relation_type: "Договор подряда",
    facts: ["Односторонний отказ", "Выполнены работы", "Взысканы убытки"],
    position: "Взыскать убытки, подтверждена причинная связь",
    outcome: "Иск удовлетворен",
    supports_position: true,
    matches: ["Односторонний отказ", "Наличие выполненных работ", "Взыскание убытков"],
    diffs: ["Иной состав доказательств", "Различия в обстоятельствах исполнения договора"],
    why: "Пример иллюстрирует оценку причинной связи и доказательств убытков. Для сопоставления необходимо учитывать отличия в обстоятельствах.",
    quote: "Истцом доказаны факт нарушения ответчиком договорного обязательства, размер понесенных убытков и наличие причинно-следственной связи между отказом от исполнения договора и возникшими убытками.",
    full_text: "АРБИТРАЖНЫЙ СУД ПОВОЛЖСКОГО ОКРУГА\nПОСТАНОВЛЕНИЕ от 20 июля 2023 г. № Ф06-5678/2023\n\nОбщество с ограниченной ответственностью «Дельта» обратилось с иском к обществу с ограниченной ответственностью «Эпсилон» о взыскании убытков, возникших в связи с односторонним отказом ответчика от исполнения договора подряда.\n\nСудами установлено, что подрядчик выполнил работы по первому этапу, результат которых был передан заказчику. После этого заказчик отказался от договора без указания на допущенные подрядчиком нарушения.\n\nИстцом доказаны факт нарушения ответчиком договорного обязательства, размер понесенных убытков и наличие причинно-следственной связи между отказом от исполнения договора и возникшими убытками. В подтверждение размера убытков представлены первичные документы о закупке материалов и договоры с работниками, заключенные для исполнения спорного договора.\n\nДоводы ответчика о том, что отказ от договора допускается законом в любое время, отклонены: право заказчика на отказ по статье 717 Гражданского кодекса Российской Федерации не освобождает его от обязанности возместить подрядчику причиненные этим убытки.\n\nСуд постановил: решение суда первой инстанции и постановление апелляционного суда оставить без изменения.",
  },
];

const SUMMARY =
  "Да, взыскание убытков возможно, если односторонний отказ от договора подряда был неправомерным и привел к реальному ущербу. Суды исходят из необходимости доказать факт нарушения, размер убытков и причинно-следственную связь.";

const ANALYSIS = {
  stats: { for_count: 48, against_count: 12, total: 67, direct_analogs: 6 },
  map: {
    facts: ["Договор подряда", "Односторонний отказ контрагента", "Наличие убытков"],
    norms: ["Ст. 715 ГК РФ (односторонний отказ)", "Ст. 15 ГК РФ (возмещение убытков)"],
    question: "Является ли односторонний отказ неправомерным и можно ли взыскать убытки?",
    practice: ["Позиция ВС РФ", "Практика округов", "Аналогичные дела"],
    arguments: ["Отказ нарушает договор", "Причинен реальный ущерб", "Есть причинно-следственная связь"],
    risks: ["Недостаточность доказательств", "Спор о размере убытков", "Возможность признания отказа правомерным"],
    conclusion: "Взыскание убытков возможно при доказывании неправомерности отказа, размера убытков и причинной связи.",
  },
  my_case: {
    relation_type: "Договор подряда",
    circumstances: ["Односторонний отказ", "Выполнена часть работ", "Заявлены убытки"],
  },
};

const summaryOf = (c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, court: c.court, date: c.date, score: c.score });
const itemOf = (c, addedAt) => ({
  id: randomUUID(),
  document_id: c.id,
  title: c.title,
  fragment: c.subtitle,
  relevance: c.score,
  court: c.court,
  date: c.date,
  added_at: addedAt,
});

// Вход принимает любые email/пароль. Email зашит в токен: у каждого адреса своё
// пространство (история, папки, избранное), чужие запросы не видны. Доступ к самому
// демо-стенду закрыт общим паролем на уровне Caddy (basic auth), поэтому токен приходит
// в X-Auth-Token — заголовок Authorization занят паролем стенда.
const DEMO_EMAIL = "demo@legalsearch.local";
const COMPANY_ID = randomUUID();
const tokenFor = (email) => `mock.${Buffer.from(email, "utf8").toString("base64url")}`;
function userFrom(req) {
  const header = req.headers["x-auth-token"] ?? req.headers.authorization ?? "";
  const m = /^Bearer mock\.([A-Za-z0-9_-]{1,400})$/.exec(header);
  const email = (m ? Buffer.from(m[1], "base64url").toString("utf8") : DEMO_EMAIL).slice(0, 200);
  return { id: email, email: email || DEMO_EMAIL, role: "admin", company_id: COMPANY_ID };
}
const [c1, c2, c3] = CASES;

// Режим настоящего поиска: движок и его зависимости грузятся только здесь,
// поэтому для тестов и `npm run mock` они не нужны.
const engine = process.env.CORPUS_DIR
  ? await (await import("../demo-api/lib/engine.mjs")).createEngine({
      corpusDir: process.env.CORPUS_DIR,
      cacheFile: process.env.CACHE_FILE,
    })
  : null;

const emptyFolder = (id, name, description) => ({ id, name, description, created_at: "2026-11-01T09:00:00Z", updated_at: "2026-11-01T09:00:00Z", items: [] });

const initialState = () => engine ? {
  // с настоящим корпусом демо-дела из фикстур не существуют — папки пустые
  folders: [
    emptyFolder("contract", "Договорные споры", "Практика по подряду и поставке"),
    emptyFolder("review", "Для изучения", "Материалы, к которым нужно вернуться"),
  ],
  favorites: [],
  history: [],
} : ({
  folders: [
    { id: "contract", name: "Договорные споры", description: "Практика по подряду и исполнению обязательств", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-22T09:00:00Z", items: [c1, c2, c3].map((c) => itemOf(c, "2026-10-22T09:00:00Z")) },
    { id: "losses", name: "Взыскание убытков", description: "Подборка решений и правовых позиций", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-21T09:00:00Z", items: [c1, c3].map((c) => itemOf(c, "2026-10-21T09:00:00Z")) },
    { id: "review", name: "Для изучения", description: "Материалы, к которым нужно вернуться", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-20T09:00:00Z", items: [itemOf(c2, "2026-10-20T09:00:00Z")] },
  ],
  favorites: [summaryOf(c1)],
  history: [],
});
// Данные — в памяти, у каждого пользователя свои; число пространств ограничено.
const MAX_USERS = 500;
const states = new Map(); // email → { folders, favorites, history }
function stateOf(req) {
  const { email } = userFrom(req);
  let s = states.get(email);
  if (!s) {
    s = initialState();
    states.set(email, s);
    if (states.size > MAX_USERS) states.delete(states.keys().next().value);
  }
  return s;
}

// ---------------------------------------------------------------- лимиты

const LIMITS = {
  body: 64 * 1024, // байт в теле запроса
  query: 1000, // символов в поисковом запросе (как в интерфейсе)
  folders: 50,
  items: 200, // в одной папке
  favorites: 200,
  history: 30,
  name: 120,
  description: 500,
  field: 500, // заголовок, фрагмент и т. п. сохранённого документа
};

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Сохранённый документ — только известные поля, обрезанные до разумной длины. */
const docFields = (body) => ({
  title: text(body.title, LIMITS.field),
  subtitle: text(body.subtitle, LIMITS.field),
  court: text(body.court, LIMITS.field),
  date: text(body.date, 40),
  score: finite(body.score),
});

function addHistory(state, query) {
  const id = randomUUID();
  state.history = [{ id, text: query, created_at: now() }, ...state.history.filter((h) => h.text !== query)].slice(0, LIMITS.history);
  return id;
}

// ---------------------------------------------------------------- http

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// CORS нужен только для разработки (интерфейс на :3000, API на :8000). На демо-стенде
// интерфейс и API на одном домене — чужие сайты не должны дергать API из браузера.
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.includes(origin) || (process.env.CORS_LOCAL !== "0" && LOCAL_ORIGIN.test(origin)))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Auth-Token,X-Session-Id");
}

function json(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

async function readBody(req) {
  if (Number(req.headers["content-length"]) > LIMITS.body) throw new HttpError(413, "Слишком большой запрос.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.body) throw new HttpError(413, "Слишком большой запрос.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const body = raw ? JSON.parse(raw) : {};
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function searchQuery(body) {
  if (typeof body.query !== "string") throw new HttpError(400, "Введите поисковый запрос.");
  const q = body.query.trim();
  if (!q) throw new HttpError(400, "Введите поисковый запрос.");
  if (q.length > LIMITS.query) throw new HttpError(400, `Запрос слишком длинный — до ${LIMITS.query} символов.`);
  return q;
}

async function search(req, res, state, query) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    Connection: "close",
  });
  const controller = new AbortController();
  let closed = false;
  res.on("close", () => {
    closed = true;
    controller.abort();
  });
  const send = (event, data) => !closed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // комментарий-«пинг»: пока запрос ждёт очереди к LLM, прокси не должны счесть соединение мёртвым
  const ping = setInterval(() => !closed && res.write(": ping\n\n"), 15_000);
  const queryId = addHistory(state, query);

  try {
    if (engine) {
      try {
        await engine.searchStream(query, send, controller.signal);
      } catch (e) {
        console.error("[search]", e);
        send("error", { detail: "Поиск временно недоступен. Повторите запрос." });
      }
    } else {
      await sleep(DELAY * 20); // «поиск + rerank»
      send("cases", { cases: CASES, demo: true });
      for (const token of SUMMARY.match(/\S+\s*/g)) {
        if (closed) return;
        await sleep(DELAY);
        send("token", { text: token });
      }
      await sleep(DELAY * 5);
      send("analysis", ANALYSIS);
    }
    send("done", { query_id: queryId });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

process.on("unhandledRejection", (e) => console.error("[mock] unhandled rejection:", e));

const server = http.createServer(async (req, res) => {
  try {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const m = (re) => re.exec(path);
    let match;
    if (path !== "/health") console.log(`[mock] ${req.method} ${path}`);

    if (path === "/health") return json(res, 200, { status: "ok", mock: !engine, corpus: engine?.size ?? null });
    // только для тестов: вернуть демонстрационные данные в исходное состояние
    if (ALLOW_RESET && req.method === "POST" && path === "/__reset") {
      states.clear();
      return json(res, 200, { status: "ok" });
    }

    // auth
    if (req.method === "POST" && (path === "/auth/login" || path === "/auth/register")) {
      const body = await readBody(req);
      const email = text(body.email, 200) || DEMO_EMAIL;
      return json(res, 200, { access_token: tokenFor(email), token_type: "bearer" });
    }
    if (req.method === "GET" && path === "/auth/me") return json(res, 200, userFrom(req));
    if (req.method === "POST" && path === "/telemetry/events") {
      await readBody(req); // демо-стенд телеметрию не хранит
      return json(res, 200, { status: "ok" });
    }

    const state = stateOf(req);

    // поиск и карточки
    if (req.method === "POST" && path === "/search/") return await search(req, res, state, searchQuery(await readBody(req)));
    if (req.method === "GET" && (match = m(/^\/cases\/([^/]+)$/))) {
      const id = decodeURIComponent(match[1]);
      const c = engine ? engine.getCase(id) : CASES.find((x) => x.id === id);
      return c ? json(res, 200, c) : json(res, 404, { detail: "Документ не найден" });
    }

    // история
    if (path === "/history/") {
      if (req.method === "GET") return json(res, 200, state.history);
      if (req.method === "DELETE") {
        state.history = [];
        return json(res, 200, { status: "ok" });
      }
    }

    // папки (collections)
    if (path === "/collections/") {
      if (req.method === "GET") return json(res, 200, state.folders);
      if (req.method === "POST") {
        const body = await readBody(req);
        if (state.folders.length >= LIMITS.folders) throw new HttpError(400, `Можно создать не больше ${LIMITS.folders} папок.`);
        const f = {
          id: randomUUID(),
          name: text(body.name, LIMITS.name) || "Без названия",
          description: text(body.description, LIMITS.description) || null,
          created_at: now(),
          updated_at: now(),
          items: [],
        };
        state.folders.push(f);
        return json(res, 200, f);
      }
    }
    if ((match = m(/^\/collections\/([^/]+)$/))) {
      const f = state.folders.find((x) => x.id === match[1]);
      if (!f) return json(res, 404, { detail: "Подборка не найдена" });
      if (req.method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.name === "string") f.name = text(body.name, LIMITS.name) || f.name;
        if (typeof body.description === "string") f.description = text(body.description, LIMITS.description) || null;
        f.updated_at = now();
        return json(res, 200, f);
      }
      if (req.method === "DELETE") {
        state.folders = state.folders.filter((x) => x !== f);
        return json(res, 200, { status: "ok" });
      }
    }
    if (req.method === "POST" && (match = m(/^\/collections\/([^/]+)\/items$/))) {
      const f = state.folders.find((x) => x.id === match[1]);
      if (!f) return json(res, 404, { detail: "Подборка не найдена" });
      const body = await readBody(req);
      const documentId = text(body.document_id, 200);
      if (!documentId) throw new HttpError(400, "Не указан документ.");
      if (!f.items.some((i) => i.document_id === documentId)) {
        if (f.items.length >= LIMITS.items) throw new HttpError(400, `В папке может быть не больше ${LIMITS.items} документов.`);
        const d = docFields({ ...body, subtitle: body.fragment, score: body.relevance });
        f.items.push({ id: randomUUID(), document_id: documentId, title: d.title, fragment: d.subtitle, relevance: d.score, court: d.court, date: d.date, added_at: now() });
        f.updated_at = now();
      }
      return json(res, 200, { status: "ok" });
    }
    if (req.method === "DELETE" && (match = m(/^\/collections\/([^/]+)\/items\/([^/]+)$/))) {
      const f = state.folders.find((x) => x.id === match[1]);
      if (!f) return json(res, 404, { detail: "Подборка не найдена" });
      f.items = f.items.filter((i) => i.id !== match[2]);
      f.updated_at = now();
      return json(res, 200, { status: "ok" });
    }

    // избранное
    if ((match = m(/^\/favorites\/(?:([^/]+))?$/))) {
      const id = match[1] && text(decodeURIComponent(match[1]), 200);
      if (req.method === "GET" && !id) return json(res, 200, state.favorites);
      if (req.method === "PUT" && id) {
        const doc = { id, ...docFields(await readBody(req)) };
        if (!state.favorites.some((d) => d.id === id)) {
          if (state.favorites.length >= LIMITS.favorites) throw new HttpError(400, `В избранном может быть не больше ${LIMITS.favorites} документов.`);
          state.favorites.push(doc);
        }
        return json(res, 200, doc);
      }
      if (req.method === "DELETE" && id) {
        state.favorites = state.favorites.filter((d) => d.id !== id);
        return json(res, 200, { status: "ok" });
      }
    }

    return json(res, 404, { detail: "Not found (mock)" });
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent) return json(res, err.status, { detail: err.message });
      return res.end();
    }
    const badUrl = err instanceof URIError || err?.code === "ERR_INVALID_URL";
    if (!badUrl) console.error(err);
    if (!res.headersSent) json(res, badUrl ? 400 : 500, { detail: badUrl ? "Некорректный адрес." : "Mock server error" });
    else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Mock LegalSearch API: http://${HOST}:${PORT}`));
