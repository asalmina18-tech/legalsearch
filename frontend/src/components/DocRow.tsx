"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { relevanceLabel, scoreClass } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import { useSearch } from "@/lib/search-context";
import type { CaseSummary } from "@/lib/types";
import { EmptyState } from "./common";
import { SaveToFolderDialog } from "./dialogs";
import { Icon } from "./Icon";

export function DocRow({
  doc,
  onRemove,
  removeLabel = "Убрать из папки",
}: {
  doc: CaseSummary;
  /** Вместо кнопки «в папку» — кнопка «убрать» (экран папки) */
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const pathname = usePathname();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { result, inCompare, toggleCompare, setReturnRoute } = useSearch();
  const [saving, setSaving] = useState(false);
  const fav = isFavorite(doc.id);
  const cmp = inCompare(doc.id);
  // Сравнивать можно только дела текущей выдачи — анализ построен относительно этого запроса.
  const comparable = !!result?.cases.some((c) => c.id === doc.id);
  const favLabel = fav ? "Удалить из избранного" : "В избранное";
  const cmpLabel = cmp ? "Убрать из сравнения" : "Добавить в сравнение";

  return (
    <article className="doc-row">
      <Icon name="doc" className="doc-icon" />
      <Link className="doc-body" href={`/documents/${encodeURIComponent(doc.id)}`} onClick={() => setReturnRoute(pathname)}>
        <span className="doc-title">{doc.title}</span>
        <div className="doc-sub">{doc.subtitle}</div>
      </Link>
      <span className={scoreClass(doc.score)} title="Релевантность запросу">
        {doc.score}%
      </span>
      <span className="relevance">{relevanceLabel(doc.score)} релевантность</span>
      <span className="doc-actions">
        {comparable && (
          <button
            type="button"
            className={`iconbtn${cmp ? " selected" : ""}`}
            title={cmpLabel}
            aria-label={cmpLabel}
            onClick={() => toggleCompare(doc.id)}
          >
            <Icon name="columns" />
          </button>
        )}
        <button
          type="button"
          className={`iconbtn${fav ? " selected" : ""}`}
          title={favLabel}
          aria-label={favLabel}
          onClick={() => toggleFavorite(doc)}
        >
          <Icon name="bookmark" />
        </button>
        {onRemove ? (
          <button type="button" className="iconbtn" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
            <Icon name="close" />
          </button>
        ) : (
          <button
            type="button"
            className="iconbtn"
            title="Сохранить в папку"
            aria-label="Сохранить в папку"
            onClick={() => setSaving(true)}
          >
            <Icon name="folder" />
          </button>
        )}
      </span>
      {saving && <SaveToFolderDialog doc={doc} onClose={() => setSaving(false)} />}
    </article>
  );
}

/** Полоса под выдачей: сколько дел в сравнительной таблице и переход к ней. */
export function CompareBar() {
  const { selected } = useSearch();
  return (
    <div className="selection-bar">
      <span>
        В сравнительной таблице: {selected.length}
        {selected.length === 0 && " — добавляйте дела кнопкой «Добавить в сравнение» у документа"}
      </span>
      <Link href="/compare" className="btn primary tiny">
        Открыть таблицу
      </Link>
    </div>
  );
}

export function DocTools() {
  const { sort, setSort, filtersOpen, toggleFilters } = useSearch();
  return (
    <div className="doctools">
      <label className="sr-only" htmlFor="sort">
        Сортировка
      </label>
      <select
        className="select"
        id="sort"
        value={sort}
        onChange={(e) => setSort(e.target.value as "relevance" | "date")}
      >
        <option value="relevance">Сортировка: по релевантности</option>
        <option value="date">Сортировка: по дате</option>
      </select>
      <button type="button" className={`btn tiny${filtersOpen ? " soft" : ""}`} onClick={toggleFilters} aria-expanded={filtersOpen}>
        <Icon name="filter" />
        Фильтры
      </button>
    </div>
  );
}

export function FilteredEmpty({
  title = "По этим фильтрам ничего не найдено",
  text = "Измените суд или период поиска.",
}: {
  title?: string;
  text?: string;
}) {
  const { resetFilters } = useSearch();
  return (
    <EmptyState
      title={title}
      text={text}
      action={
        <button type="button" className="btn primary" onClick={resetFilters}>
          Сбросить фильтры
        </button>
      }
    />
  );
}

export function FilterPanel() {
  const { filtersOpen, result, court, setCourt, year, setYear, resetFilters } = useSearch();
  if (!filtersOpen) return null;
  const cases = result?.cases ?? [];
  const courts = [...new Set(cases.map((c) => c.court).filter(Boolean))];
  const years = [...new Set(cases.map((c) => c.date.slice(0, 4)).filter(Boolean))].sort().reverse();

  return (
    <div className="filters">
      <label>
        Суд
        <select className="select" value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="all">Все суды</option>
          {courts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Год
        <select className="select" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">Все годы</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn ghost tiny" onClick={resetFilters}>
        Сбросить
      </button>
    </div>
  );
}
