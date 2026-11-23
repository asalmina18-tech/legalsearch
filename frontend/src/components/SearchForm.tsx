"use client";

import { useRef } from "react";
import Link from "next/link";
import { useSearch, type ResultsTab } from "@/lib/search-context";
import { Icon } from "./Icon";

export function SearchForm({ variant }: { variant: "home" | "header" }) {
  const { result, runSearch } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const home = variant === "home";
  const id = `query-${variant}`;

  return (
    <form
      className={home ? "home-form" : "search-form"}
      onSubmit={(e) => {
        e.preventDefault();
        runSearch(inputRef.current?.value ?? "");
      }}
    >
      <div className="search-field">
        <Icon name="search" />
        {/* подпись — только для экранных дикторов (aria-label), в тексте страницы её нет */}
        <input
          aria-label="Поисковый запрос"
          // key — чтобы поле обновлялось, когда запрос меняется извне (история, примеры)
          key={home ? "home" : result?.query ?? ""}
          ref={inputRef}
          id={id}
          name="query"
          autoComplete="off"
          placeholder="Опишите правовой вопрос или обстоятельства дела"
          defaultValue={home ? "" : result?.query ?? ""}
          required
          maxLength={1000}
        />
        {!home && (
          <button
            className="clear"
            type="button"
            aria-label="Очистить запрос"
            onClick={() => {
              if (!inputRef.current) return;
              inputRef.current.value = "";
              inputRef.current.focus();
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <button className="btn primary" type="submit">
        Найти
        {home && <Icon name="arrow" />}
      </button>
    </form>
  );
}

// «Поисковая выдача» — краткая сводка с документами и схема вывода (открывается
// стрелкой у вывода); «Сравнительная таблица» — дела, отобранные юристом.
const TABS: [ResultsTab, string][] = [
  ["summary", "Поисковая выдача"],
  ["compare", "Сравнительная таблица"],
];

/** active — подсвеченная вкладка; current — она же и есть текущая страница (не карточка документа). */
export function Topbar({ active, current }: { active: ResultsTab; current: boolean }) {
  const { selected } = useSearch();
  return (
    <header className="topbar">
      <SearchForm variant="header" />
      <nav className="tabs" aria-label="Результаты поиска">
        {TABS.map(([tab, label]) => (
          <Link
            key={tab}
            href={`/${tab}`}
            className={active === tab ? "active" : ""}
            aria-current={current && active === tab ? "page" : undefined}
          >
            {label}
            {tab === "compare" && selected.length > 0 && (
              <span className="count" aria-label={`дел в таблице: ${selected.length}`}>
                {selected.length}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </header>
  );
}
