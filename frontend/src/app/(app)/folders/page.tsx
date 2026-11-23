"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadError, PageHeading } from "@/components/common";
import { FolderDialog } from "@/components/dialogs";
import { Icon } from "@/components/Icon";
import { folderUpdated, pluralDocs } from "@/lib/format";
import { useLibrary } from "@/lib/library-context";
import type { Folder } from "@/lib/types";
import { usePageTitle } from "@/lib/ui";

export default function FoldersPage() {
  usePageTitle("Папки");
  const router = useRouter();
  const { folders, loaded, errors, reload } = useLibrary();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Folder | "new" | null>(null);

  const visible = folders.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));
  const open = (f: Folder) => router.push(`/folders/${encodeURIComponent(f.id)}`);

  return (
    <div className="content">
      <section>
        <PageHeading
          title="Папки"
          actions={
            <button type="button" className="btn primary" onClick={() => setEditing("new")}>
              <Icon name="plus" />
              Создать папку
            </button>
          }
        />
        {errors.folders && <LoadError what="папки" onRetry={reload} />}
        <div className="section-head" style={{ marginTop: 0 }}>
          <span className="muted small">{loaded && !errors.folders ? `Всего папок: ${folders.length}` : ""}</span>
          <div className="search-field collection-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Найти папку"
              aria-label="Найти папку"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="folder-grid">
          {visible.map((f) => (
            <article
              key={f.id}
              className="card folder-card"
              tabIndex={0}
              role="link"
              aria-label={`Открыть папку ${f.name}`}
              onClick={() => open(f)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) open(f);
              }}
            >
              <div className="folder-top">
                <div className="folder-icon">
                  <Icon name="folder" />
                </div>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Настроить папку ${f.name}`}
                  title="Настройки папки"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(f);
                  }}
                >
                  <Icon name="more" />
                </button>
              </div>
              <h3>{f.name}</h3>
              <p>{f.description || "Подборка сохраненных документов"}</p>
              <div className="folder-meta">
                <span>
                  {f.items.length} {pluralDocs(f.items.length)}
                </span>
                <span>{folderUpdated(f)}</span>
              </div>
            </article>
          ))}
          {query && !visible.length && <p className="muted">Папки не найдены</p>}
          {!query && loaded && !errors.folders && (
            <button type="button" className="folder-create" onClick={() => setEditing("new")}>
              <Icon name="plus" />
              <span>Новая папка</span>
            </button>
          )}
        </div>
      </section>
      {editing && <FolderDialog folder={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
