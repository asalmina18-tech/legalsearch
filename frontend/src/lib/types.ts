// Типы данных интерфейса. Это и есть контракт с backend — см. раздел
// «API» в frontend/README.md. Эндпоинты, которых пока нет в backend/,
// отдаёт mock-сервер (frontend/mock/server.mjs).

export type User = {
  id: string;
  email: string;
  role: string;
  company_id: string | null;
};

/** Краткие сведения о судебном акте — то, что нужно для строки в списке. */
export type CaseSummary = {
  id: string;
  /** Реквизиты: «Постановление АС Московского округа от 14.03.2024 № Ф05-1234/2024» */
  title: string;
  /** Одна строка о сути спора */
  subtitle: string;
  court: string;
  /** ISO-дата, YYYY-MM-DD */
  date: string;
  /** Релевантность запросу, 0–100 */
  score: number;
};

/** Полная карточка дела — с анализом относительно запроса пользователя. */
export type CaseDetail = CaseSummary & {
  /** Полное наименование акта (заголовок карточки) */
  long_title: string;
  /** Короткая ссылка для заголовка столбца сравнения: «АС МО, 14.03.2024» */
  short_ref: string;
  /** Тип отношений: «Договор подряда» */
  relation_type: string;
  /** Ключевые обстоятельства дела (строка «Ключевые обстоятельства» в сравнении) */
  facts: string[];
  /** Позиция суда */
  position: string;
  /** Итог дела */
  outcome: string;
  /** Поддерживает ли дело позицию пользователя (зелёная/красная ячейка в сравнении); null — неизвестно */
  supports_position: boolean | null;
  /** «Совпадает с моим делом» */
  matches: string[];
  /** «Отличается от моего дела» */
  diffs: string[];
  /** «Почему релевантен» */
  why: string;
  /** «Ключевой фрагмент» — цитата из акта */
  quote: string;
  /** Полный текст, если доступен */
  full_text?: string | null;
};

export type PracticeStats = {
  /** Решения в пользу позиции */
  for_count: number;
  /** Решения против позиции */
  against_count: number;
  /** Всего проанализировано дел */
  total: number;
  /** Количество прямых аналогов */
  direct_analogs: number;
};

/** Схема вывода (в эталоне — «карта позиции»): из чего сложился вывод и что из него следует, 7 блоков. */
export type PositionMap = {
  facts: string[];
  norms: string[];
  question: string;
  practice: string[];
  arguments: string[];
  risks: string[];
  conclusion: string;
};

/** Обстоятельства дела пользователя, как их понял анализ (столбец «Мое дело»). */
export type MyCase = {
  relation_type: string;
  circumstances: string[];
};

/** Анализ конкретного дела относительно запроса — приходит вместе с анализом, после выдачи. */
export type CaseInsight = {
  id: string;
  supports_position: boolean | null;
  matches: string[];
  diffs: string[];
  why: string;
};

/** Любая часть анализа может отсутствовать, если backend её не построил. */
export type SearchAnalysis = {
  stats: PracticeStats | null;
  map: PositionMap | null;
  my_case: MyCase;
  /** Дополнения к уже показанным делам (совпадения, отличия, «почему релевантен») */
  cases: CaseInsight[];
};

export type SearchResult = {
  query_id: string | null;
  query: string;
  /** «Краткий вывод» — приходит потоково */
  summary: string;
  cases: CaseDetail[];
  analysis: SearchAnalysis | null;
  /** true — выдача демонстрационная (mock), а не настоящий поиск */
  demo: boolean;
};

export type HistoryEntry = {
  id: string;
  text: string;
  created_at: string;
};

export type FolderItem = {
  id: string;
  document_id: string;
  title: string | null;
  fragment: string | null;
  relevance: number | null;
  court?: string | null;
  date?: string | null;
  added_at: string;
};

export type Folder = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at?: string | null;
  items: FolderItem[];
};
