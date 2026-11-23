"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { normalizeAnalysis, normalizeCases, SEARCH_CACHE_KEY, streamSearch } from "./api";
import { useLibrary } from "./library-context";
import { track } from "./telemetry";
import type { CaseDetail, SearchResult } from "./types";
import { useToast } from "./ui";

/** Вкладки выдачи: «Поисковая выдача» (сводка, документы, схема вывода) и «Сравнительная таблица». */
export type ResultsTab = "summary" | "compare";
export type SearchStatus = "idle" | "loading" | "streaming" | "done" | "error";

const TABS: ResultsTab[] = ["summary", "compare"];
const INTERRUPTED = "Поиск был прерван. Повторите запрос.";

type Persisted = {
  result: SearchResult | null;
  status: SearchStatus;
  error: string | null;
  selected: string[];
  lastTab: ResultsTab;
  returnRoute: string;
};

const EMPTY: Persisted = { result: null, status: "idle", error: null, selected: [], lastTab: "summary", returnRoute: "/summary" };

/** Читает выдачу из sessionStorage, проверяя форму: битые/старые данные не должны ронять страницы. */
function readPersisted(): Persisted {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SEARCH_CACHE_KEY) ?? "null");
    const r = raw?.result;
    if (!r || typeof r.query !== "string" || !r.query) return EMPTY;
    const result: SearchResult = {
      query_id: typeof r.query_id === "string" ? r.query_id : null,
      query: r.query,
      summary: typeof r.summary === "string" ? r.summary : "",
      cases: normalizeCases(r.cases),
      analysis: normalizeAnalysis(r.analysis),
      demo: r.demo === true,
    };
    // Перезагрузка посреди поиска: поток оборвался — честно говорим об этом.
    const interrupted = raw.status === "loading" || raw.status === "streaming";
    const status: SearchStatus = interrupted || raw.status === "error" ? "error" : "done";
    return {
      result,
      status,
      error: interrupted ? INTERRUPTED : status === "error" ? String(raw.error ?? INTERRUPTED) : null,
      selected: Array.isArray(raw.selected) ? raw.selected.filter((x: unknown) => typeof x === "string") : [],
      lastTab: TABS.includes(raw.lastTab) ? raw.lastTab : "summary",
      returnRoute: typeof raw.returnRoute === "string" && raw.returnRoute.startsWith("/") ? raw.returnRoute : "/summary",
    };
  } catch {
    return EMPTY;
  }
}

type SearchState = {
  result: SearchResult | null;
  status: SearchStatus;
  error: string | null;
  queuePosition: number | null;
  runSearch: (query: string) => void;
  retry: () => void;

  // Отображение выдачи (общие для «Краткой сводки» и «Всех документов», как в эталоне)
  sort: "relevance" | "date";
  setSort: (s: "relevance" | "date") => void;
  filtersOpen: boolean;
  toggleFilters: () => void;
  court: string;
  setCourt: (c: string) => void;
  year: string;
  setYear: (y: string) => void;
  resetFilters: () => void;
  visibleCases: CaseDetail[];

  // Сравнительная таблица: дела, которые юрист сам добавил из выдачи
  selected: string[];
  setSelected: (ids: string[]) => void;
  inCompare: (id: string) => boolean;
  toggleCompare: (id: string) => void;

  // Навигация: какая вкладка выдачи была последней и куда вести «назад» из карточки
  lastTab: ResultsTab;
  setLastTab: (t: ResultsTab) => void;
  returnRoute: string;
  setReturnRoute: (r: string) => void;
};

const SearchContext = createContext<SearchState | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const { refreshHistory } = useLibrary();
  // Провайдер монтируется только на клиенте (после проверки авторизации),
  // поэтому sessionStorage можно читать в инициализаторе.
  const [initial] = useState(readPersisted);
  const [result, setResult] = useState<SearchResult | null>(initial.result);
  const [status, setStatus] = useState<SearchStatus>(initial.status);
  const [error, setError] = useState<string | null>(initial.error);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [lastTab, setLastTab] = useState<ResultsTab>(initial.lastTab);
  const [returnRoute, setReturnRoute] = useState(initial.returnRoute);
  const [sort, setSort] = useState<"relevance" | "date">("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [court, setCourt] = useState("all");
  const [year, setYear] = useState("all");
  const abortRef = useRef<AbortController | null>(null);

  // Выдача живёт в sessionStorage вкладки — переживает перезагрузку страницы.
  // Пишем и во время стрима, чтобы после перезагрузки было видно, что поиск прервался.
  useEffect(() => {
    try {
      if (!result) sessionStorage.removeItem(SEARCH_CACHE_KEY);
      else
        sessionStorage.setItem(
          SEARCH_CACHE_KEY,
          JSON.stringify({ result, status, error, selected, lastTab, returnRoute }),
        );
    } catch {
      // хранилище недоступно — выдача просто не переживёт перезагрузку
    }
  }, [result, status, error, selected, lastTab, returnRoute]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if (!query) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Колбэки устаревшего (прерванного) поиска ничего не должны менять.
      const live = () => abortRef.current === controller;

      setResult({ query_id: null, query, summary: "", cases: [], analysis: null, demo: false });
      setStatus("loading");
      setError(null);
      setQueuePosition(null);
      setSelected([]);
      setCourt("all");
      setYear("all");
      setLastTab("summary");
      setReturnRoute("/summary");
      router.push("/summary");
      track("search_request_sent", { query });

      const patch = (fn: (r: SearchResult) => SearchResult) => {
        if (live()) setResult((prev) => (prev ? fn(prev) : prev));
      };

      streamSearch(
        query,
        {
          onCases: (cases, demo) => {
            if (!live()) return;
            setStatus("streaming");
            setQueuePosition(null);
            patch((r) => ({ ...r, cases, demo }));
            if (demo) toast("Открыта демонстрационная выдача");
            track("search_cases_shown", { count: cases.length });
          },
          onToken: (text) => patch((r) => ({ ...r, summary: r.summary + text })),
          onAnalysis: (analysis) =>
            patch((r) => ({
              ...r,
              analysis,
              // совпадения/отличия/«почему релевантен» по каждому делу приходят вместе с анализом
              cases: r.cases.map((c) => {
                const insight = analysis.cases.find((i) => i.id === c.id);
                return insight ? { ...c, ...insight, id: c.id } : c;
              }),
            })),
          onQueue: (position) => live() && setQueuePosition(position),
          onDone: (queryId) => {
            if (!live()) return;
            patch((r) => ({ ...r, query_id: queryId || null }));
            setStatus("done");
            track("search_answer_rendered", { query_id: queryId });
            refreshHistory();
          },
        },
        controller.signal,
      )
        .then(() => {
          // Поток без done streamSearch считает оборванным (бросает ошибку); сюда попадаем
          // после done — статус уже «готово», это лишь страховка.
          if (live()) setStatus((s) => (s === "loading" || s === "streaming" ? "done" : s));
        })
        .catch((err: unknown) => {
          if (!live() || (err instanceof DOMException && err.name === "AbortError")) return;
          setStatus("error");
          setError(err instanceof Error ? err.message : "Не удалось выполнить поиск");
        });
    },
    [router, refreshHistory, toast],
  );

  const retry = useCallback(() => {
    if (result?.query) runSearch(result.query);
  }, [result, runSearch]);

  const visibleCases = useMemo(() => {
    const cases = (result?.cases ?? []).filter(
      (c) => (court === "all" || c.court === court) && (year === "all" || c.date.startsWith(year)),
    );
    return [...cases].sort(sort === "date" ? (a, b) => b.date.localeCompare(a.date) : (a, b) => b.score - a.score);
  }, [result, court, year, sort]);

  const value: SearchState = {
    result,
    status,
    error,
    queuePosition,
    runSearch,
    retry,
    sort,
    setSort,
    filtersOpen,
    toggleFilters: () => setFiltersOpen((v) => !v),
    court,
    setCourt,
    year,
    setYear,
    resetFilters: () => {
      setCourt("all");
      setYear("all");
    },
    visibleCases,
    selected,
    setSelected,
    inCompare: (id) => selected.includes(id),
    toggleCompare: (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    lastTab,
    setLastTab,
    returnRoute,
    setReturnRoute,
  };

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch должен использоваться внутри SearchProvider");
  return ctx;
}
