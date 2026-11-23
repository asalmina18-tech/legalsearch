"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { SearchForm } from "@/components/SearchForm";
import { formatLongDate } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import { useSearch } from "@/lib/search-context";
import { usePageTitle } from "@/lib/ui";

const EXAMPLES: [IconName, string][] = [
  ["doc", "Можно ли взыскать убытки с контрагента за односторонний отказ от договора подряда?"],
  ["scale", "Как подтвердить размер убытков при расторжении договора?"],
  ["history", "Можно ли взыскать неустойку за просрочку выполнения работ?"],
  ["position", "В каких случаях суд снижает договорную неустойку?"],
];

export default function HomePage() {
  usePageTitle("Поиск");
  const { runSearch } = useSearch();
  const { history, loaded } = useLibrary();

  return (
    <div className="content home">
      <section className="home">
        <div className="home-title">
          <h1>С чего начнем исследование?</h1>
        </div>
        <SearchForm variant="home" />

        <div className="examples">
          <h3>Например, можно спросить</h3>
          <div className="example-grid">
            {EXAMPLES.map(([icon, q]) => (
              <button key={q} type="button" className="example" onClick={() => runSearch(q)}>
                <Icon name={icon} />
                <span>{q}</span>
                <Icon name="arrow" className="arrow" />
              </button>
            ))}
          </div>
        </div>

        <div className="recent">
          <div className="section-head">
            <h3>Последние запросы</h3>
            <Link href="/history" className="small">
              Вся история <Icon name="arrow" />
            </Link>
          </div>
          {!loaded ? null : history.length ? (
            history.slice(0, 3).map((h) => (
              <button key={h.id} type="button" className="recent-item" onClick={() => runSearch(h.text)}>
                <span>{h.text}</span>
                <time dateTime={h.created_at}>{formatLongDate(h.created_at)}</time>
              </button>
            ))
          ) : (
            <button type="button" className="recent-item" onClick={() => runSearch(EXAMPLES[0][1])}>
              <span>{EXAMPLES[0][1]}</span>
              <time>Пример запроса</time>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
