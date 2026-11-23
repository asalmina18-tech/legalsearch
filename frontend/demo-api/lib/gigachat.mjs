// Клиент GigaChat API (Сбер) для демо-стенда.
//
// - Токен доступа живёт 30 минут: получаем по Authorization Key и обновляем заранее.
// - Сертификат НУЦ Минцифры (certs/russian_trusted_root_ca.pem) доверяем ТОЛЬКО
//   в запросах к GigaChat — через собственный https.Agent, а не глобально.
// - Физлицам доступен один поток: все запросы идут строго по очереди (queue()).
//   Очередь ограничена; задание клиента, который ушёл, не выполняется; у каждого
//   вызова общий дедлайн, чтобы один зависший ответ не держал всех.
// - Документация: https://developers.sber.ru/docs/ru/gigachat/api/overview

import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL ?? "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_URL = process.env.GIGACHAT_API_URL ?? "https://api.giga.chat/v1";
export const MODEL = process.env.GIGACHAT_MODEL ?? "GigaChat-3-Ultra"; // бесплатна физлицам (freemium)
const SCOPE = process.env.GIGACHAT_SCOPE ?? "GIGACHAT_API_PERS";

/** Дедлайн одного вызова (с повторами), с момента, когда подошла очередь. */
const CALL_TIMEOUT_MS = Number(process.env.GIGACHAT_TIMEOUT_MS ?? 45_000);
/** Сколько заданий может ждать в очереди; дальше — «сервис занят». */
const MAX_QUEUE = Number(process.env.GIGACHAT_MAX_QUEUE ?? 6);
const MAX_RETRY_WAIT_MS = 5_000;

const RU_CA = fs.readFileSync(new URL("../certs/russian_trusted_root_ca.pem", import.meta.url), "utf8");
const EXTRA_CA = process.env.GIGACHAT_EXTRA_CA ? fs.readFileSync(process.env.GIGACHAT_EXTRA_CA, "utf8") : null; // для тестов
// timeout — простой сокета, в том числе свободного keep-alive: «протухшие» соединения закрываем сами
const agent = new https.Agent({ ca: [...tls.rootCertificates, RU_CA, ...(EXTRA_CA ? [EXTRA_CA] : [])], keepAlive: true, timeout: 40_000 });

export class GigaChatError extends Error {
  /** kind: "http" | "busy" | "timeout" | "aborted" | "filtered" | "empty" | "network" | "format" */
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function gigachatConfigured() {
  return !!process.env.GIGACHAT_AUTH_KEY;
}

const NETWORK_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ERR_SOCKET_CONNECTION_TIMEOUT"]);

/** Ошибка отмены: по дедлайну — timeout, иначе клиент ушёл — aborted. */
function abortReason(signal) {
  const r = signal?.reason;
  if (r instanceof GigaChatError) return r;
  if (r?.name === "TimeoutError") return new GigaChatError("timeout", "GigaChat: не ответил вовремя");
  return new GigaChatError("aborted", "GigaChat: запрос отменён");
}

/** Низкоуровневый HTTPS-запрос; возвращает ответ-поток. */
function httpsRequest(url, { method = "POST", headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    // timeout на сам запрос обязателен: повторно используемый keep-alive сокет иначе
    // сохраняет таймаут простоя из подсказки сервера (Keep-Alive: timeout=5 → 4 с) и
    // обрывает долгий, но живой ответ. Общий срок вызова задаёт дедлайн в queue().
    const req = https.request(url, { method, headers, agent, signal, timeout: 60_000 }, resolve);
    req.on("timeout", () => req.destroy(new GigaChatError("timeout", "GigaChat: таймаут соединения")));
    req.on("error", (e) => {
      if (signal?.aborted) return reject(abortReason(signal));
      if (e instanceof GigaChatError) return reject(e);
      reject(new GigaChatError(NETWORK_CODES.has(e.code) || /socket hang up/i.test(e.message) ? "network" : "http", `GigaChat: ${e.code ?? e.message}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function readAll(res, signal) {
  const chunks = [];
  try {
    for await (const c of res) chunks.push(c);
  } catch (e) {
    if (signal?.aborted) throw abortReason(signal);
    throw new GigaChatError("network", `GigaChat: обрыв ответа (${e.code ?? e.message})`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// ---- токен ----

let cachedToken = null; // { value, expiresAt }

async function getToken(signal) {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.value;
  const key = process.env.GIGACHAT_AUTH_KEY;
  if (!key) throw new GigaChatError("http", "GIGACHAT_AUTH_KEY не задан");
  const res = await httpsRequest(OAUTH_URL, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      RqUID: randomUUID(),
      Authorization: `Basic ${key}`,
    },
    body: `scope=${encodeURIComponent(SCOPE)}`,
    signal,
  });
  const text = await readAll(res, signal);
  if (res.statusCode !== 200) throw new GigaChatError("http", `GigaChat OAuth ${res.statusCode}: ${text.slice(0, 300)}`, res.statusCode);
  const data = JSON.parse(text);
  // expires_at — Unix-время в миллисекундах (токен действует 30 минут)
  cachedToken = { value: data.access_token, expiresAt: Number(data.expires_at) || Date.now() + 25 * 60_000 };
  return cachedToken.value;
}

// ---- очередь: у физлица один поток ----

const waitingJobs = []; // { start, signal, onPosition, reject }
let running = false;

/** Сколько заданий сейчас впереди у нового (выполняемое + ожидающие). */
export function queueLength() {
  return waitingJobs.length + (running ? 1 : 0);
}

/** Каждому ожидающему — сколько заданий перед ним (если число изменилось). */
function notifyPositions() {
  waitingJobs.forEach((job, i) => {
    const ahead = i + (running ? 1 : 0);
    if (ahead !== job.lastAhead) {
      job.lastAhead = ahead;
      job.onPosition?.(ahead);
    }
  });
}

function pump() {
  while (!running && waitingJobs.length) {
    const job = waitingJobs.shift();
    if (job.signal?.aborted) {
      job.reject(abortReason(job.signal));
      continue;
    }
    running = true;
    job.start().finally(() => {
      running = false;
      pump();
    });
  }
  notifyPositions();
}

/**
 * Поставить вызов в очередь. fn(signal) получает сигнал, который сработает при уходе
 * клиента или по дедлайну. onPosition(n) — сколько заданий впереди (обновляется).
 */
function queue(fn, { signal, onPosition } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    if (waitingJobs.length >= MAX_QUEUE) return reject(new GigaChatError("busy", "GigaChat: очередь заполнена"));
    const job = {
      signal,
      onPosition,
      reject,
      start: async () => {
        signal?.removeEventListener("abort", onAbortWhileWaiting);
        // Дедлайн — свой таймер, а не AbortSignal.any(…, AbortSignal.timeout()): сигнал-таймаут
        // внутри any() может быть собран сборщиком мусора и так и не сработать.
        const call = new AbortController();
        const timer = setTimeout(() => call.abort(new GigaChatError("timeout", "GigaChat: не ответил вовремя")), CALL_TIMEOUT_MS);
        const onClientAbort = () => call.abort(abortReason(signal));
        if (signal?.aborted) onClientAbort();
        else signal?.addEventListener("abort", onClientAbort, { once: true });
        try {
          resolve(await fn(call.signal));
        } catch (e) {
          reject(call.signal.aborted && !(e instanceof GigaChatError && e.kind === "filtered") ? abortReason(call.signal) : e);
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onClientAbort);
        }
      },
    };
    // ушёл, не дождавшись очереди, — убираем задание сразу, а не когда до него дойдёт
    const onAbortWhileWaiting = () => {
      const i = waitingJobs.indexOf(job);
      if (i >= 0) {
        waitingJobs.splice(i, 1);
        reject(abortReason(signal));
        notifyPositions();
      }
    };
    signal?.addEventListener("abort", onAbortWhileWaiting, { once: true });
    waitingJobs.push(job);
    pump();
  });
}

// ---- запрос с повторами ----

async function post(path, payload, signal, attempt = 0) {
  let res;
  try {
    const token = await getToken(signal);
    res = await httpsRequest(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        Accept: payload.stream ? "text/event-stream" : "application/json",
        Authorization: `Bearer ${token}`,
        "X-Request-ID": randomUUID(),
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    // разорванное соединение (часто — «протухший» keep-alive сокет) — один повтор
    if (e instanceof GigaChatError && e.kind === "network" && attempt < 1) return post(path, payload, signal, attempt + 1);
    throw e;
  }
  if (res.statusCode === 200) return res;
  const text = await readAll(res, signal);
  const retryable = res.statusCode === 401 || res.statusCode === 429 || res.statusCode >= 500;
  if (retryable && attempt < 2) {
    if (res.statusCode === 401) cachedToken = null;
    const retryAfter = Number(res.headers["retry-after"]) * 1000;
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1500 * (attempt + 1);
    await sleep(Math.min(wait, MAX_RETRY_WAIT_MS), signal);
    return post(path, payload, signal, attempt + 1);
  }
  throw new GigaChatError(res.statusCode === 429 ? "busy" : "http", `GigaChat ${res.statusCode}: ${text.slice(0, 300)}`, res.statusCode);
}

/** Ответ модели, который нельзя показывать и кешировать. */
function checkFinish(finishReason, text) {
  if (finishReason === "blacklist") throw new GigaChatError("filtered", "GigaChat: ответ заблокирован фильтром");
  if (!String(text ?? "").trim()) throw new GigaChatError("empty", "GigaChat: пустой ответ");
}

/**
 * Ответ целиком. С `schema` — структурированный вывод (JSON по схеме),
 * функция вернёт уже разобранный объект.
 */
export function complete({ messages, schema, maxTokens = 2000, temperature = 0.2, signal, onQueued }) {
  return queue(
    async (callSignal) => {
      const payload = {
        model: MODEL,
        messages,
        stream: false,
        max_tokens: maxTokens,
        temperature,
        ...(schema ? { response_format: { type: "json_schema", schema, strict: true } } : {}),
      };
      const res = await post("/chat/completions", payload, callSignal);
      let data;
      try {
        data = JSON.parse(await readAll(res, callSignal));
      } catch (e) {
        if (e instanceof GigaChatError) throw e;
        throw new GigaChatError("format", "GigaChat вернул не JSON");
      }
      const choice = data?.choices?.[0];
      const content = choice?.message?.content ?? "";
      const finishReason = choice?.finish_reason ?? null;
      checkFinish(finishReason, content);
      const usage = data?.usage ?? {};
      if (!schema) return { content, usage, finishReason };
      // обрезанный по лимиту JSON не разберётся — parseJsonLoose бросит ошибку
      return { json: parseJsonLoose(content), usage, finishReason };
    },
    { signal, onPosition: onQueued },
  );
}

/**
 * Потоковый ответ: onToken вызывается на каждый фрагмент текста.
 * Возвращает { text, finishReason, truncated }. Позиция в очереди — через onQueued.
 */
export function stream({ messages, maxTokens = 800, temperature = 0.2, onToken, onQueued, signal }) {
  return queue(
    async (callSignal) => {
      const res = await post(
        "/chat/completions",
        { model: MODEL, messages, stream: true, max_tokens: maxTokens, temperature, update_interval: 0 },
        callSignal,
      );
      let buffer = "";
      let full = "";
      let finishReason = null;
      let inbandError = null;
      try {
        for await (const chunk of res) {
          buffer += chunk.toString("utf8");
          let sep;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let parsed;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              // ошибка внутри потока при статусе 200
              if (parsed?.error || parsed?.status >= 400 || (parsed && !parsed.choices && parsed.message)) {
                inbandError = String(parsed.error?.message ?? parsed.message ?? parsed.error ?? "ошибка");
                continue;
              }
              const choice = parsed?.choices?.[0];
              if (choice?.finish_reason) finishReason = choice.finish_reason;
              const text = choice?.delta?.content ?? "";
              if (text) {
                full += text;
                onToken?.(text);
              }
            }
          }
        }
      } catch (e) {
        if (callSignal.aborted) throw abortReason(callSignal);
        throw new GigaChatError("network", `GigaChat: обрыв потока (${e.code ?? e.message})`);
      }
      if (inbandError && !full) throw new GigaChatError("http", `GigaChat: ${inbandError.slice(0, 300)}`);
      checkFinish(finishReason, full);
      return { text: full, finishReason, truncated: finishReason === "length" };
    },
    { signal, onPosition: onQueued },
  );
}

/** JSON из ответа модели: на случай обёртки в ```json … ``` или текста вокруг. */
export function parseJsonLoose(text) {
  const s = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        // ниже — общая ошибка
      }
    }
    throw new GigaChatError("format", "GigaChat вернул не JSON");
  }
}
