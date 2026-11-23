import type {
  CaseDetail,
  CaseSummary,
  Folder,
  HistoryEntry,
  PositionMap,
  PracticeStats,
  SearchAnalysis,
  User,
} from "./types";
import { getSessionId } from "./telemetry";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
/**
 * Заголовок с токеном. По умолчанию Authorization (как ждёт backend); демо-стенд закрыт
 * общим паролем (HTTP Basic в Caddy), который сам занимает Authorization, — там токен
 * передаётся в X-Auth-Token (NEXT_PUBLIC_AUTH_HEADER при сборке, см. deploy/deploy.sh).
 */
const AUTH_HEADER = process.env.NEXT_PUBLIC_AUTH_HEADER || "Authorization";
export const authHeader = (token: string | null): Record<string, string> =>
  token ? { [AUTH_HEADER]: `Bearer ${token}` } : {};
const TOKEN_KEY = "legalsearch-token";
/** sessionStorage: текущая выдача (см. search-context). Версия в ключе — при смене формата старые данные игнорируются. */
export const SEARCH_CACHE_KEY = "legalsearch-current-search-v1";
/** Событие window: backend ответил 401 — сессия истекла, нужно войти заново. */
export const UNAUTHORIZED_EVENT = "legalsearch:unauthorized";

export class ApiError extends Error {
  status: number;
  /** Исходный текст ошибки от сервера — для отладки, пользователю показываем message */
  detail: string;
  constructor(status: number, message: string, detail = message) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // приватный режим / запрет хранилища — сессия просто не переживёт перезагрузку
  }
}

/** Выход: удаляет токен и всё, что осталось от сессии пользователя в этой вкладке. */
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // см. setToken
  }
  try {
    sessionStorage.removeItem(SEARCH_CACHE_KEY);
  } catch {
    // хранилище недоступно — нечего чистить
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return {
    "X-Session-Id": getSessionId(),
    ...authHeader(token),
  };
}

// ---- ошибки ----

const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

function friendlyMessage(status: number, detail: string) {
  if (status === 401) return "Сессия истекла. Войдите снова.";
  if (status === 403) return "Недостаточно прав для этого действия.";
  if (status === 404) return "Не найдено.";
  if (status === 429) return "Слишком много запросов. Подождите немного и повторите.";
  if (status >= 500) return "Сервис временно недоступен. Попробуйте позже.";
  return hasCyrillic(detail) ? detail : "Не удалось выполнить запрос.";
}

async function errorFrom(res: Response, path: string): Promise<ApiError> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    // тело не JSON — оставляем statusText
  }
  // 401 на любом запросе, кроме самого входа, — токен протух: выходим везде разом.
  if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
    clearSession();
    if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return new ApiError(res.status, friendlyMessage(res.status, detail), detail);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Нет соединения с сервером. Проверьте подключение и повторите.", String(e));
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);

  const res = await send(path, { ...options, headers });
  if (!res.ok) throw await errorFrom(res, path);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ApiError(res.status, "Сервер вернул некорректный ответ.", String(e));
  }
}

// ---- нормализация ответов ----
// Backend реализует контракт по частям — недостающие поля заполняем пустыми
// значениями здесь, на границе, чтобы экраны не падали на `undefined.map`.

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function normalizeCase(raw: unknown): CaseDetail | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id) || str(raw.document_id);
  if (!id) return null;
  const title = str(raw.title) || "Без названия";
  return {
    id,
    title,
    long_title: str(raw.long_title) || title,
    subtitle: str(raw.subtitle),
    court: str(raw.court),
    date: str(raw.date),
    score: Math.max(0, Math.min(100, Math.round(num(raw.score)))),
    short_ref: str(raw.short_ref) || title,
    relation_type: str(raw.relation_type),
    facts: strs(raw.facts),
    position: str(raw.position),
    outcome: str(raw.outcome),
    supports_position: typeof raw.supports_position === "boolean" ? raw.supports_position : null,
    matches: strs(raw.matches),
    diffs: strs(raw.diffs),
    why: str(raw.why),
    quote: str(raw.quote),
    full_text: typeof raw.full_text === "string" ? raw.full_text : null,
  };
}

export function normalizeCases(raw: unknown): CaseDetail[] {
  return Array.isArray(raw) ? raw.map(normalizeCase).filter((c): c is CaseDetail => !!c) : [];
}

/**
 * Текущий backend отдаёт событие `sources` — фрагменты нормативных актов со
 * «сырым» score cross-encoder'а (логит). Показываем их как документы выдачи;
 * релевантность — sigmoid(логит) в процентах, т.е. оценка самой модели
 * реранкера, что фрагмент отвечает на запрос.
 */
function sourceToCase(raw: unknown): CaseDetail | null {
  if (!isObj(raw)) return null;
  const fragment = str(raw.fragment).trim();
  return normalizeCase({
    id: raw.document_id,
    title: raw.title,
    subtitle: fragment.length > 220 ? `${fragment.slice(0, 220)}…` : fragment,
    quote: fragment,
    score: 100 / (1 + Math.exp(-num(raw.relevance))),
  });
}

export function normalizeAnalysis(raw: unknown): SearchAnalysis | null {
  if (!isObj(raw)) return null;
  const s = isObj(raw.stats) ? raw.stats : null;
  const m = isObj(raw.map) ? raw.map : null;
  const mine = isObj(raw.my_case) ? raw.my_case : null;
  const stats: PracticeStats | null = s
    ? {
        for_count: num(s.for_count),
        against_count: num(s.against_count),
        total: num(s.total),
        direct_analogs: num(s.direct_analogs),
      }
    : null;
  const map: PositionMap | null = m
    ? {
        facts: strs(m.facts),
        norms: strs(m.norms),
        question: str(m.question),
        practice: strs(m.practice),
        arguments: strs(m.arguments),
        risks: strs(m.risks),
        conclusion: str(m.conclusion),
      }
    : null;
  const cases = (Array.isArray(raw.cases) ? raw.cases : []).filter(isObj).flatMap((c) =>
    str(c.id)
      ? [
          {
            id: str(c.id),
            supports_position: typeof c.supports_position === "boolean" ? c.supports_position : null,
            matches: strs(c.matches),
            diffs: strs(c.diffs),
            why: str(c.why),
          },
        ]
      : [],
  );
  return {
    stats,
    map,
    my_case: { relation_type: str(mine?.relation_type), circumstances: strs(mine?.circumstances) },
    cases,
  };
}

function normalizeSummary(raw: unknown): CaseSummary | null {
  const c = normalizeCase(raw);
  return c && { id: c.id, title: c.title, subtitle: c.subtitle, court: c.court, date: c.date, score: c.score };
}

function normalizeFolder(raw: unknown): Folder | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  return {
    id: str(raw.id),
    name: str(raw.name) || "Без названия",
    description: typeof raw.description === "string" ? raw.description : null,
    created_at: str(raw.created_at),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    items: (Array.isArray(raw.items) ? raw.items : []).filter(isObj).map((i) => ({
      id: str(i.id),
      document_id: str(i.document_id),
      title: typeof i.title === "string" ? i.title : null,
      fragment: typeof i.fragment === "string" ? i.fragment : null,
      relevance: typeof i.relevance === "number" ? i.relevance : null,
      court: typeof i.court === "string" ? i.court : null,
      date: typeof i.date === "string" ? i.date : null,
      added_at: str(i.added_at),
    })),
  };
}

// ---- auth ----

export async function register(email: string, password: string, companyName: string) {
  const data = await request<{ access_token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, company_name: companyName }),
  });
  setToken(data.access_token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await request<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.access_token);
  return data;
}

export function me() {
  return request<User>("/auth/me");
}

// ---- поиск (SSE-стрим) ----

export type SearchStreamHandlers = {
  /** Найденные дела — приходят первыми, одним событием */
  onCases: (cases: CaseDetail[], demo: boolean) => void;
  /** Очередной кусок текста «Краткого вывода» */
  onToken: (text: string) => void;
  /** Статистика практики, карта позиции, обстоятельства «моего дела» */
  onAnalysis: (analysis: SearchAnalysis) => void;
  /** Позиция в очереди на LLM (если сервер занят) */
  onQueue?: (position: number) => void;
  onDone: (queryId: string) => void;
};

/**
 * POST /search/ отвечает потоком Server-Sent Events:
 *   cases    {cases: CaseDetail[], demo: boolean}   — один раз
 *   token    {text: string}                         — по мере генерации вывода
 *   analysis {stats, map, my_case}                  — один раз, после вывода
 *   queue    {position: number}                     — необязательно
 *   error    {detail: string}                       — необязательно, прерывает поиск
 *   done     {query_id: string}
 * Для совместимости с текущим backend понимает и событие `sources`.
 * Разбираем поток вручную через fetch (EventSource не умеет POST и заголовки).
 */
export async function streamSearch(
  query: string,
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send("/search/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ query, filters: null }),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res, "/search/");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false; // пришло событие done

  const dispatch = (rawEvent: string) => {
    let event = "message";
    let data = "";
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: Raw;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      throw new ApiError(0, "Сервер вернул некорректный ответ. Повторите поиск.", String(e));
    }
    if (!isObj(parsed)) return;
    switch (event) {
      case "cases":
        handlers.onCases(normalizeCases(parsed.cases), parsed.demo === true);
        break;
      case "sources":
        handlers.onCases(
          (Array.isArray(parsed.sources) ? parsed.sources : []).map(sourceToCase).filter((c): c is CaseDetail => !!c),
          false,
        );
        break;
      case "token":
        handlers.onToken(str(parsed.text));
        break;
      case "analysis": {
        const analysis = normalizeAnalysis(parsed);
        if (analysis) handlers.onAnalysis(analysis);
        break;
      }
      case "queue":
        handlers.onQueue?.(num(parsed.position));
        break;
      case "error": {
        const detail = str(parsed.detail);
        throw new ApiError(500, hasCyrillic(detail) ? detail : "Не удалось выполнить поиск. Повторите запрос.", detail);
      }
      case "done":
        finished = true;
        handlers.onDone(str(parsed.query_id));
        break;
    }
  };

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        // обрыв посреди ответа (перезапуск сервера, сеть) — понятное сообщение, а не «network error»
        throw new ApiError(0, "Соединение с сервером прервалось. Повторите поиск.", String(e));
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(raw);
      }
    }
    if (buffer.trim()) dispatch(buffer);
    // поток закрылся без done — ответ мог оборваться на полуслове; не выдаём его за полный
    if (!finished) throw new ApiError(0, "Ответ сервера оборвался. Повторите поиск.");
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Карточка дела. С query_id — вместе с анализом относительно этого запроса. */
export async function getCase(id: string, queryId?: string | null) {
  const qs = queryId ? `?query_id=${encodeURIComponent(queryId)}` : "";
  const c = normalizeCase(await request<unknown>(`/cases/${encodeURIComponent(id)}${qs}`));
  if (!c) throw new ApiError(0, "Сервер вернул некорректный ответ.");
  return c;
}

// ---- история ----

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await request<unknown>("/history/");
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  // Backend отдаёт от новых к старым; повторы запроса показываем один раз — последним.
  for (const h of Array.isArray(raw) ? raw.filter(isObj) : []) {
    const text = str(h.text).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ id: str(h.id) || text, text, created_at: str(h.created_at) });
  }
  return out;
}

export function clearHistory() {
  return request<{ status: string }>("/history/", { method: "DELETE" });
}

// ---- папки (в backend — collections) ----

export async function getFolders(): Promise<Folder[]> {
  const raw = await request<unknown>("/collections/");
  return (Array.isArray(raw) ? raw : []).map(normalizeFolder).filter((f): f is Folder => !!f);
}

export async function createFolder(name: string, description: string) {
  return normalizeFolder(
    await request<unknown>("/collections/", { method: "POST", body: JSON.stringify({ name, description }) }),
  );
}

export async function updateFolder(id: string, name: string, description: string) {
  return normalizeFolder(
    await request<unknown>(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ name, description }) }),
  );
}

export function deleteFolder(id: string) {
  return request<{ status: string }>(`/collections/${id}`, { method: "DELETE" });
}

export function addFolderItem(folderId: string, doc: CaseSummary) {
  return request<{ status: string }>(`/collections/${folderId}/items`, {
    method: "POST",
    body: JSON.stringify({
      document_id: doc.id,
      title: doc.title,
      fragment: doc.subtitle,
      relevance: doc.score,
      court: doc.court,
      date: doc.date,
    }),
  });
}

export function deleteFolderItem(folderId: string, itemId: string) {
  return request<{ status: string }>(`/collections/${folderId}/items/${itemId}`, {
    method: "DELETE",
  });
}

// ---- избранное ----

export async function getFavorites(): Promise<CaseSummary[]> {
  const raw = await request<unknown>("/favorites/");
  return (Array.isArray(raw) ? raw : []).map(normalizeSummary).filter((c): c is CaseSummary => !!c);
}

export function addFavorite(doc: CaseSummary) {
  return request<unknown>(`/favorites/${encodeURIComponent(doc.id)}`, {
    method: "PUT",
    body: JSON.stringify(doc),
  });
}

export function removeFavorite(id: string) {
  return request<{ status: string }>(`/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
}
