"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/common";
import { FullTextDialog, SaveToFolderDialog } from "@/components/dialogs";
import { Icon, type IconName } from "@/components/Icon";
import { ApiError, getCase } from "@/lib/api";
import { formatShortDate, relevanceLabel, toSummary } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import { useSearch } from "@/lib/search-context";
import type { CaseDetail } from "@/lib/types";
import { usePageTitle } from "@/lib/ui";

function backLabel(route: string) {
  if (route.startsWith("/folders")) return "К папке";
  if (route === "/favorites") return "К избранному";
  return "К результатам поиска";
}

export default function DocumentPage() {
  usePageTitle("Карточка документа");
  const { id: rawId } = useParams<{ id: string }>();
  const id = decodeURIComponent(rawId);
  const { result, status, returnRoute, inCompare, toggleCompare } = useSearch();
  const { isFavorite, toggleFavorite } = useLibrary();

  const fromResults = result?.cases.find((c) => c.id === id) ?? null;
  const [fetched, setFetched] = useState<{ id: string; doc: CaseDetail | null; error: string | null } | null>(null);
  const [dialog, setDialog] = useState<"folder" | "text" | "quote" | null>(null);

  useEffect(() => {
    if (fromResults) return;
    let cancelled = false;
    // Документа нет в текущей выдаче (открыт из избранного/папки) — анализ
    // относительно чужого запроса был бы неверным, поэтому query_id не передаём.
    getCase(id)
      .then((doc) => !cancelled && setFetched({ id, doc, error: null }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setFetched({
            id,
            doc: null,
            error: e instanceof ApiError && e.status === 404 ? "Документ не найден" : "Не удалось загрузить документ",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [id, fromResults]);

  const doc = fromResults ?? (fetched?.id === id ? fetched.doc : null);
  const error = !fromResults && fetched?.id === id ? fetched.error : null;
  const hasInsight = !!doc && (doc.matches.length > 0 || doc.diffs.length > 0 || !!doc.why);
  // документ из текущей выдачи, анализ ещё идёт — заглушки вместо пустых блоков
  const analysing = !!fromResults && !hasInsight && (status === "loading" || status === "streaming");

  const back = (
    <Link className="back" style={{ margin: 0 }} href={returnRoute}>
      <Icon name="back" />
      {backLabel(returnRoute)}
    </Link>
  );

  if (!doc) {
    return (
      <section>
        <div className="page-heading" style={{ marginBottom: 12 }}>
          {back}
        </div>
        {error ? (
          <EmptyState title={error} text="Возможно, документ был удалён или ссылка устарела." />
        ) : (
          <div aria-busy="true" aria-label="Загрузка документа">
            <span className="skeleton w60" style={{ height: 22 }} />
            <span className="skeleton w40" />
            <span className="skeleton w80" style={{ marginTop: 30 }} />
          </div>
        )}
      </section>
    );
  }

  const fav = isFavorite(doc.id);

  return (
    <section>
      <div className="page-heading" style={{ marginBottom: 12 }}>
        {back}
        <div className="page-tools">
          <button
            type="button"
            className={`iconbtn${fav ? " selected" : ""}`}
            aria-label={fav ? "Удалить из избранного" : "В избранное"}
            title={fav ? "Удалить из избранного" : "В избранное"}
            onClick={() => toggleFavorite(doc)}
          >
            <Icon name="bookmark" />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Сохранить в папку"
            title="Сохранить в папку"
            onClick={() => setDialog("folder")}
          >
            <Icon name="folder" />
          </button>
        </div>
      </div>

      <div className="document-head">
        <Icon name="doc" />
        <div className="document-title">
          <h1>{doc.long_title}</h1>
          <div className="tags">
            <span className="tag">Судебная практика</span>
            {doc.court && <span className="tag">{doc.court}</span>}
            {doc.date && <span className="tag">{formatShortDate(doc.date)}</span>}
          </div>
        </div>
        <div className="document-actions">
          {/* вне выдачи (из избранного или папки) релевантность запросу неизвестна */}
          {doc.score > 0 && (
            <div className="score-box">
              <span>Релевантность</span>
              <strong>{doc.score}%</strong>
              <b>{relevanceLabel(doc.score, true)}</b>
            </div>
          )}
          {fromResults && (
            <button
              type="button"
              className={`btn ${inCompare(doc.id) ? "soft" : "primary"}`}
              aria-pressed={inCompare(doc.id)}
              onClick={() => toggleCompare(doc.id)}
            >
              <Icon name="columns" />
              {inCompare(doc.id) ? "В сравнении" : "В сравнение"}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setDialog("text")}>
            <Icon name="doc" />
            Полный текст
          </button>
        </div>
      </div>

      {/* Блоки анализа показываем, только если backend их прислал */}
      <div className="detail-grid">
        {analysing && (
          <>
            {[
              ["green", "checkcircle", "Совпадает с моим делом"],
              ["red", "x", "Отличается от моего дела"],
              ["", "bulb", "Почему релевантен"],
            ].map(([color, icon, title]) => (
              <div key={title} className={`detail-card ${color}`.trim()} aria-busy="true">
                <Icon name={icon as IconName} />
                <div>
                  <h3>{title}</h3>
                  <p className="muted small">Анализируем…</p>
                  <span className="skeleton w80" />
                  <span className="skeleton w60" />
                </div>
              </div>
            ))}
          </>
        )}
        {!analysing && !hasInsight && (doc.position || doc.outcome) && (
          // анализа под запрос нет (документ открыт из избранного или модель его не разобрала) —
          // показываем то, что известно о самом деле
          <div className="detail-card">
            <Icon name="scale" />
            <div>
              <h3>Позиция суда</h3>
              {doc.position && <p>{doc.position}</p>}
              {doc.outcome && (
                <p>
                  <b>Итог:</b> {doc.outcome}
                </p>
              )}
            </div>
          </div>
        )}
        {doc.matches.length > 0 && (
          <div className="detail-card green">
            <Icon name="checkcircle" />
            <div>
              <h3>Совпадает с моим делом</h3>
              <ul>
                {doc.matches.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {doc.diffs.length > 0 && (
          <div className="detail-card red">
            <Icon name="x" />
            <div>
              <h3>Отличается от моего дела</h3>
              <ul>
                {doc.diffs.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {doc.why && (
          <div className="detail-card">
            <Icon name="bulb" />
            <div>
              <h3>Почему релевантен</h3>
              <p>{doc.why}</p>
            </div>
          </div>
        )}
        {doc.quote && (
          <div className="detail-card white">
            <Icon name="quote" />
            <div>
              <h3>Ключевой фрагмент</h3>
              <blockquote>
                <button
                  type="button"
                  className="quote-link"
                  title="Открыть фрагмент в полном тексте документа"
                  onClick={() => setDialog("quote")}
                >
                  «{doc.quote}»
                </button>
              </blockquote>
              <div className="quote-foot">
                <span className="muted small">{doc.title}</span>
                <button type="button" className="text-link" onClick={() => setDialog("quote")}>
                  Открыть в полном тексте <Icon name="arrow" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {dialog === "folder" && <SaveToFolderDialog doc={toSummary(doc)} onClose={() => setDialog(null)} />}
      {(dialog === "text" || dialog === "quote") && (
        <FullTextDialog
          doc={doc}
          demo={!!result?.demo}
          highlightQuote={dialog === "quote"}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
