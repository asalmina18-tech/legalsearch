"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState, NoSearchYet, PageHeading } from "@/components/common";
import { Icon, type IconName } from "@/components/Icon";
import { useSearch } from "@/lib/search-context";
import { usePageTitle } from "@/lib/ui";

function Node({
  kind,
  icon,
  title,
  body,
  href,
}: {
  kind: string;
  icon: IconName;
  title: string;
  body: string | string[];
  href?: string;
}) {
  const inner: ReactNode = (
    <>
      <Icon name={icon} />
      <div>
        <h3>{title}</h3>
        {Array.isArray(body) ? (
          <ul>
            {body.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p>{body}</p>
        )}
      </div>
    </>
  );
  // Полный текст блока — во всплывающей подсказке: длинный ответ модели обрезается по высоте блока.
  const fullText = `${title}: ${Array.isArray(body) ? body.join("; ") : body}`;
  return href ? (
    <Link href={href} className={`node ${kind}`} title={fullText}>
      {inner}
    </Link>
  ) : (
    <div className={`node ${kind}`} title={fullText}>
      {inner}
    </div>
  );
}

export default function MapPage() {
  usePageTitle("Схема вывода");
  const { result, status } = useSearch();

  if (!result) return <NoSearchYet title="Схема вывода" />;
  const map = result.analysis?.map;
  const busy = status === "loading" || status === "streaming";

  return (
    <section>
      <Link className="back" href="/summary">
        <Icon name="back" />К выдаче
      </Link>
      <PageHeading title="Схема вывода" />

      {result.summary && (
        <div className="folder-info">
          <b>Краткий вывод:</b> {result.summary}
        </div>
      )}

      {!map ? (
        <EmptyState
          title={busy ? "Строим схему вывода…" : "Схема вывода недоступна"}
          text={
            busy
              ? "Схема появится, когда анализ практики будет готов."
              : "Для этого запроса не удалось построить логику вывода."
          }
        />
      ) : (
        <div className="graph-wrap">
          <div className="graph">
            <svg className="graph-lines" viewBox="0 0 1000 550" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 8 4 0 8" fill="#95a7c2" />
                </marker>
              </defs>
              <g fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#arrowhead)">
                <path d="M500 137V180" />
                <path d="M280 255H330" />
                <path d="M720 255H670" />
                <path d="M485 330V355Q485 365 475 365H150Q140 365 140 375V383" />
                <path d="M500 330V383" />
                <path d="M515 330V355Q515 365 525 365H850Q860 365 860 375V383" />
              </g>
            </svg>
            <Node kind="facts" icon="doc" title="Факты дела" body={map.facts} />
            <Node kind="norm" icon="doc" title="Норма" body={map.norms} />
            <Node kind="question" icon="question" title="Ключевой вопрос" body={map.question} />
            <Node kind="practice" icon="gavel" title="Судебная практика" body={map.practice} href="/summary#documents" />
            <Node kind="argument" icon="chat" title="Аргумент" body={map.arguments} />
            <Node kind="risk" icon="risk" title="Риск" body={map.risks} />
            <Node kind="conclusion" icon="checkcircle" title="Вывод" body={map.conclusion} />
          </div>
        </div>
      )}
    </section>
  );
}
