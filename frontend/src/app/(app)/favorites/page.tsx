"use client";

import Link from "next/link";
import { EmptyState, LoadError, PageHeading } from "@/components/common";
import { DocRow } from "@/components/DocRow";
import { useLibrary } from "@/lib/library-context";
import { usePageTitle } from "@/lib/ui";

export default function FavoritesPage() {
  usePageTitle("Избранное");
  const { favorites, loaded, errors, reload } = useLibrary();

  return (
    <div className="content">
      <section>
        <PageHeading title="Избранное" />
        <div className="doc-list">
          {errors.favorites && <LoadError what="избранное" onRetry={reload} />}
          {favorites.length
            ? favorites.map((d) => <DocRow key={d.id} doc={d} />)
            : loaded && !errors.favorites && (
                <EmptyState
                  title="Пока ничего не сохранено"
                  text="Нажмите на закладку рядом с документом."
                  action={
                    <Link href="/summary" className="btn primary">
                      Открыть выдачу
                    </Link>
                  }
                />
              )}
        </div>
      </section>
    </div>
  );
}
