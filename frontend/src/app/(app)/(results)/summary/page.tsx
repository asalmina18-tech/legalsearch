"use client";

import Link from "next/link";
import { DemoLabel, DocListPlaceholder, EmptyState, NoSearchYet, PageHeading } from "@/components/common";
import { WithCitations } from "@/components/Citations";
import { CompareBar, DocRow, DocTools, FilteredEmpty, FilterPanel } from "@/components/DocRow";
import { Icon, type IconName } from "@/components/Icon";
import { useSearch } from "@/lib/search-context";
import type { PracticeStats } from "@/lib/types";
import { usePageTitle } from "@/lib/ui";

function Stat({
  title,
  value,
  sub,
  icon,
  color,
  bar,
  loading,
}: {
  title: string;
  value: string;
  sub: string;
  icon: IconName;
  color: "" | "red" | "blue";
  bar?: number;
  loading: boolean;
}) {
  return (
    <div className={`card stat${loading ? " loading" : ""}`}>
      <div className={`round-icon ${color}`.trim()}>
        <Icon name={icon} />
      </div>
      <div className="stat-body">
        <h3>{title}</h3>
        <strong>{value}</strong>
        {bar === undefined ? (
          <div className="caption">{sub}</div>
        ) : (
          <>
            <small>{sub}</small>
            <div className={`bar ${color}`.trim()}>
              <i style={{ width: `${bar}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stats({ stats, busy }: { stats: PracticeStats | null; busy: boolean }) {
  // доля от числа найденных дел; ограничиваем 0–100 на случай несогласованных данных анализа
  const pct = (n: number) => (stats && stats.total ? Math.min(100, Math.max(0, Math.round((n / stats.total) * 100))) : 0);
  const forPct = stats ? pct(stats.for_count) : 0;
  const againstPct = stats ? pct(stats.against_count) : 0;
  // Пока идёт поиск — «анализируем»; если анализ так и не пришёл — честно «нет данных».
  const pending = busy ? "Анализируем практику…" : "Нет данных";
  const loading = !stats && busy;
  return (
    <div className="stats">
      <Stat
        title="Практика за"
        value={stats ? `${forPct}%` : "—"}
        sub={stats ? `${stats.for_count} из ${stats.total} дел` : pending}
        icon="check"
        color=""
        bar={forPct}
        loading={loading}
      />
      <Stat
        title="Практика против"
        value={stats ? `${againstPct}%` : "—"}
        sub={stats ? `${stats.against_count} из ${stats.total} дел` : pending}
        icon="x"
        color="red"
        bar={againstPct}
        loading={loading}
      />
      <Stat
        title="Прямые аналоги"
        value={stats ? String(stats.direct_analogs) : "—"}
        sub={stats || busy ? "наиболее близких дел" : "Нет данных"}
        icon="doc"
        color="blue"
        loading={loading}
      />
    </div>
  );
}

export default function SummaryPage() {
  usePageTitle("Краткая сводка");
  const { result, status, error, queuePosition, retry, visibleCases, setReturnRoute } = useSearch();
  if (!result) return <NoSearchYet title="Краткая сводка" />;

  const busy = status === "loading" || status === "streaming";
  const waitingCases = status === "loading";

  return (
    <section>
      <PageHeading
        title="Краткая сводка"
        actions={result.demo && <DemoLabel />}
      />

      {status === "error" && (
        <div className="error-box" role="alert" style={{ marginBottom: 20 }}>
          <span>{error ?? "Не удалось выполнить поиск"}</span>
          <button type="button" className="btn tiny" onClick={retry}>
            Повторить
          </button>
        </div>
      )}

      <div className="summary">
        <div className="tile-icon">
          <Icon name="position" />
        </div>
        <div className="body">
          <h3>Краткий вывод</h3>
          {result.summary ? (
            <p className={busy ? "typing" : undefined} style={{ whiteSpace: "pre-line" }}>
              <WithCitations text={result.summary} docs={result.cases} onOpen={() => setReturnRoute("/summary")} />
            </p>
          ) : busy ? (
            <div aria-busy="true" aria-label="Готовим вывод">
              {queuePosition ? (
                <p className="muted small">Запрос в очереди: перед вами {queuePosition}</p>
              ) : (
                <>
                  <span className="skeleton w80" />
                  <span className="skeleton" />
                  <span className="skeleton w60" />
                </>
              )}
            </div>
          ) : (
            <p className="muted">Вывод не сформирован.</p>
          )}
          <span className="sr-only" aria-live="polite">
            {status === "done" ? "Ответ готов" : ""}
          </span>
        </div>
        <Link href="/map" className="btn soft">
          Развернуть логику <Icon name="arrow" />
        </Link>
      </div>

      <Stats stats={result.analysis?.stats ?? null} busy={busy} />

      <div className="section-head" id="documents">
        <h2>
          Релевантные документы
          {!waitingCases && result.cases.length > 0 && <span className="muted small heading-count">{visibleCases.length}</span>}
        </h2>
        <DocTools />
      </div>
      <FilterPanel />
      {waitingCases ? (
        <DocListPlaceholder />
      ) : (
        <div className="doc-list">
          {visibleCases.length ? (
            visibleCases.map((d) => <DocRow key={d.id} doc={d} />)
          ) : result.cases.length ? (
            <FilteredEmpty />
          ) : (
            status !== "error" && (
              <EmptyState title="Документы не найдены" text="Попробуйте описать ситуацию подробнее или другими словами." />
            )
          )}
        </div>
      )}

      {result.cases.length > 0 && <CompareBar />}
    </section>
  );
}
