"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState, LoadError, PageHeading } from "@/components/common";
import { ConfirmDialog } from "@/components/dialogs";
import { Icon } from "@/components/Icon";
import { formatLongDate } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import { useSearch } from "@/lib/search-context";
import { usePageTitle, useToast } from "@/lib/ui";

export default function HistoryPage() {
  usePageTitle("История");
  const { history, clearHistory, loaded, errors, reload } = useLibrary();
  const { runSearch } = useSearch();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="content">
      <section>
        <PageHeading
          title="История"
          actions={
            history.length > 0 && (
              <button type="button" className="btn tiny" onClick={() => setConfirming(true)}>
                <Icon name="trash" />
                Очистить историю
              </button>
            )
          }
        />
        <div className="simple-list">
          {errors.history && <LoadError what="историю" onRetry={reload} />}
          {history.length
            ? history.map((h) => (
                <article key={h.id} className="card saved-query">
                  <div className="tile-icon">
                    <Icon name="history" />
                  </div>
                  <div className="body">
                    <a
                      href="/summary"
                      onClick={(e) => {
                        e.preventDefault();
                        runSearch(h.text);
                      }}
                    >
                      <h3>{h.text}</h3>
                    </a>
                    <p>{formatLongDate(h.created_at)}</p>
                  </div>
                  <button type="button" className="iconbtn" aria-label="Повторить поиск" onClick={() => runSearch(h.text)}>
                    <Icon name="arrow" />
                  </button>
                </article>
              ))
            : loaded && !errors.history && (
                <EmptyState
                  title="Здесь появятся ваши запросы"
                  text="Начните поиск, чтобы вернуться к результатам позже."
                  action={
                    <Link href="/" className="btn primary">
                      Начать поиск
                    </Link>
                  }
                />
              )}
        </div>
      </section>
      {confirming && (
        <ConfirmDialog
          title="Очистить историю?"
          text="Сохраненные папки и избранное останутся на месте."
          confirmLabel="Очистить"
          onConfirm={async () => {
            try {
              await clearHistory();
              toast("История очищена");
            } catch (e) {
              toast("Не удалось очистить историю");
              throw e;
            }
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
