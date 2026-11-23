"use client";

import { Fragment } from "react";
import Link from "next/link";
import type { CaseSummary } from "@/lib/types";

/**
 * Ответ LLM ссылается на документы выдачи как [1], [2]… — превращаем такие
 * метки в ссылки на карточки документов (номер = позиция в выдаче).
 */
export function WithCitations({
  text,
  docs,
  onOpen,
}: {
  text: string;
  docs: CaseSummary[];
  onOpen?: () => void;
}) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[(\d{1,2})\]$/.exec(part);
        const doc = m ? docs[Number(m[1]) - 1] : undefined;
        if (!doc) return <Fragment key={i}>{part}</Fragment>;
        return (
          <Link
            key={i}
            className="cite"
            href={`/documents/${encodeURIComponent(doc.id)}`}
            title={doc.title}
            onClick={onOpen}
          >
            {part}
          </Link>
        );
      })}
    </>
  );
}
