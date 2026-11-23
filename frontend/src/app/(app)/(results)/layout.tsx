"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/SearchForm";
import { useSearch, type ResultsTab } from "@/lib/search-context";

// Какая вкладка подсвечена на каждой странице выдачи (схема вывода — часть «Поисковой выдачи»).
const TAB_OF: Record<string, ResultsTab> = { "/summary": "summary", "/map": "summary", "/compare": "compare" };

/** Общая шапка выдачи: строка поиска + вкладки. Карточка документа подсвечивает вкладку, с которой её открыли. */
export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { lastTab, setLastTab } = useSearch();
  const tab = TAB_OF[pathname];

  useEffect(() => {
    if (tab) setLastTab(tab);
  }, [tab, setLastTab]);

  return (
    <>
      <Topbar active={tab ?? lastTab} current={!!tab && pathname === `/${tab}`} />
      <div className="content">{children}</div>
    </>
  );
}
