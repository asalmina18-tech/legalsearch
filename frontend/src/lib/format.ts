import type { CaseDetail, CaseSummary, Folder, FolderItem } from "./types";

/** Дата последнего изменения папки: updated_at, если backend его отдаёт, иначе последнее добавление. */
export function folderUpdated(f: Folder) {
  const dates = [f.updated_at, f.created_at, ...f.items.map((i) => i.added_at)].filter(Boolean) as string[];
  const latest = dates.sort().at(-1);
  return latest ? formatLongDate(latest) : "";
}

/** 1 документ, 2 документа, 5 документов */
export function pluralDocs(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "документ";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "документа";
  return "документов";
}

/** Подпись под процентом релевантности (как в эталоне) */
export function relevanceLabel(score: number, detailed = false) {
  if (detailed && score >= 90) return "Очень высокая";
  return score < 80 ? "Средняя" : "Высокая";
}

export function scoreClass(score: number) {
  return score < 80 ? "score medium" : "score";
}

/** 2024-03-14 → 14.03.2024 */
export function formatShortDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** → «22 октября 2026» (без «г.») */
export function formatLongDate(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .replace(/\s*г\.?$/, "");
}

export function toSummary(c: CaseDetail | CaseSummary): CaseSummary {
  return { id: c.id, title: c.title, subtitle: c.subtitle, court: c.court, date: c.date, score: c.score };
}

export function folderItemToSummary(item: FolderItem): CaseSummary {
  return {
    id: item.document_id,
    title: item.title ?? "Без названия",
    subtitle: item.fragment ?? "",
    court: item.court ?? "",
    date: item.date ?? "",
    score: Math.round(item.relevance ?? 0),
  };
}

export function initials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || "LS";
}
