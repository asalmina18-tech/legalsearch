"use client";

import { useState } from "react";
import Link from "next/link";
import { DocListPlaceholder, EmptyState, NoSearchYet, PageHeading } from "@/components/common";
import { ChooseCasesDialog } from "@/components/dialogs";
import { Icon } from "@/components/Icon";
import { relevanceLabel, scoreClass } from "@/lib/format";
import { useSearch } from "@/lib/search-context";
import type { CaseDetail } from "@/lib/types";
import { usePageTitle } from "@/lib/ui";

const TITLE = "Сравнительная таблица";

/**
 * Сравнительная таблица: дела, которые юрист сам отобрал в выдаче кнопкой
 * «Добавить в сравнение», против обстоятельств его дела.
 */
export default function ComparePage() {
  usePageTitle(TITLE);
  const { result, status, selected, toggleCompare, setReturnRoute } = useSearch();
  const [choosing, setChoosing] = useState(false);

  if (!result) return <NoSearchYet title={TITLE} />;

  const docs = selected
    .map((id) => result.cases.find((c) => c.id === id))
    .filter((c): c is CaseDetail => !!c);
  const mine = result.analysis?.my_case;
  const dialog = choosing && <ChooseCasesDialog onClose={() => setChoosing(false)} />;

  if (status === "loading") {
    return (
      <section>
        <PageHeading title={TITLE} />
        <DocListPlaceholder />
      </section>
    );
  }

  if (!docs.length) {
    return (
      <section>
        <PageHeading title={TITLE} />
        <EmptyState
          title="Добавьте дела для сравнения"
          text="В выдаче нажмите «Добавить в сравнение» у нужных документов — они появятся в этой таблице."
          action={
            <div className="row" style={{ justifyContent: "center" }}>
              <Link href="/summary#documents" className="btn primary">
                К выдаче
              </Link>
              {result.cases.length > 0 && (
                <button type="button" className="btn" onClick={() => setChoosing(true)}>
                  Выбрать из списка
                </button>
              )}
            </div>
          }
        />
        {dialog}
      </section>
    );
  }

  return (
    <section>
      <PageHeading
        title={TITLE}
        actions={
          <button type="button" className="btn tiny" onClick={() => setChoosing(true)}>
            <Icon name="plus" />
            Изменить набор ({docs.length})
          </button>
        }
      />
      <div className="table-wrap">
        {/* Каждый столбец не уже ~210px — при многих делах таблица прокручивается вбок */}
        <table style={{ minWidth: 180 + 210 * (docs.length + 1) }}>
          <thead>
            <tr>
              <th>Критерий</th>
              <th className="mine">Мое дело</th>
              {docs.map((d, i) => (
                <th key={d.id}>
                  <span className="compare-head">
                    Дело {i + 1}
                    <button
                      type="button"
                      className="text-link"
                      aria-label={`Убрать из сравнения: ${d.title}`}
                      title="Убрать из сравнения"
                      onClick={() => toggleCompare(d.id)}
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                  <small>
                    <Link href={`/documents/${encodeURIComponent(d.id)}`} onClick={() => setReturnRoute("/compare")}>
                      {d.short_ref}
                    </Link>
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Тип отношений</th>
              <td className="mine">{mine?.relation_type || "—"}</td>
              {docs.map((d) => (
                <td key={d.id}>{d.relation_type || "—"}</td>
              ))}
            </tr>
            <tr>
              <th>Ключевые обстоятельства</th>
              <td className="mine">
                {mine?.circumstances.length ? (
                  <ul>
                    {mine.circumstances.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  "—"
                )}
              </td>
              {docs.map((d) => (
                <td
                  key={d.id}
                  className={d.supports_position === null ? undefined : d.supports_position ? "good" : "bad"}
                >
                  {d.facts.length ? (
                    <ul>
                      {d.facts.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th>Позиция суда</th>
              <td className="mine">—</td>
              {docs.map((d) => (
                <td key={d.id}>{d.position || "—"}</td>
              ))}
            </tr>
            <tr>
              <th>Релевантность</th>
              <td className="mine">—</td>
              {docs.map((d) => (
                <td key={d.id}>
                  <span className={scoreClass(d.score)}>{d.score}%</span>
                  <div className="muted small" style={{ marginTop: 7 }}>
                    {relevanceLabel(d.score, true)}
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <th>Итог дела</th>
              <td className="mine">—</td>
              {docs.map((d) => (
                <td key={d.id}>{d.outcome || "—"}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="comp-note">
        <Icon name="doc" />
        Нажмите на реквизиты дела, чтобы открыть карточку документа.
      </div>
      {dialog}
    </section>
  );
}
