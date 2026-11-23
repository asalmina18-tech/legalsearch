"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, LoadError, PageHeading } from "@/components/common";
import { FolderDialog } from "@/components/dialogs";
import { DocRow } from "@/components/DocRow";
import { Icon } from "@/components/Icon";
import { folderItemToSummary, folderUpdated, pluralDocs } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import { usePageTitle, useToast } from "@/lib/ui";

export default function FolderPage() {
  usePageTitle("Папка");
  const { id: rawId } = useParams<{ id: string }>();
  const id = decodeURIComponent(rawId);
  const { folders, loaded, errors, reload, removeFromFolder } = useLibrary();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const folder = folders.find((f) => f.id === id);

  if (!folder) {
    return (
      <div className="content">
        {loaded && errors.folders && <LoadError what="папку" onRetry={reload} />}
        {loaded && !errors.folders && (
          <section>
            <EmptyState
              title="Папка не найдена"
              text="Возможно, она была удалена."
              action={
                <Link href="/folders" className="btn primary">
                  Вернуться к папкам
                </Link>
              }
            />
          </section>
        )}
      </div>
    );
  }

  const count = folder.items.length;

  return (
    <div className="content">
      <section>
        <div className="breadcrumbs">
          <Link href="/folders">Папки</Link>
          <Icon name="chevron" />
          <span>{folder.name}</span>
        </div>
        <PageHeading
          title={folder.name}
          subtitle={folder.description || "Подборка сохраненных документов"}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" />
                Настройки
              </button>
              <Link href="/summary" className="btn primary">
                <Icon name="plus" />
                Добавить документы
              </Link>
            </>
          }
        />
        <div className="folder-info">
          {count} {pluralDocs(count)}
          <span style={{ float: "right" }}>Обновлено: {folderUpdated(folder)}</span>
        </div>
        <div className="doc-list">
          {count ? (
            folder.items.map((item) => (
              <DocRow
                key={item.id}
                doc={folderItemToSummary(item)}
                onRemove={() =>
                  removeFromFolder(folder.id, item.document_id)
                    .then(() => toast("Документ убран из папки"))
                    .catch(() => toast("Не удалось убрать документ"))
                }
              />
            ))
          ) : (
            <EmptyState
              title="В папке пока нет документов"
              text="Откройте выдачу и сохраните нужные решения в эту папку."
              action={
                <Link href="/summary" className="btn primary">
                  К выдаче
                </Link>
              }
            />
          )}
        </div>
      </section>
      {editing && <FolderDialog folder={folder} onClose={() => setEditing(false)} />}
    </div>
  );
}
