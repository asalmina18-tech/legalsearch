"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { initials } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

const RESULT_ROUTES = ["/summary", "/map", "/compare", "/documents"];

const NAV: { href: string; icon: IconName; label: string; match: (p: string) => boolean }[] = [
  { href: "/", icon: "search", label: "Поиск", match: (p) => p === "/" || RESULT_ROUTES.some((r) => p.startsWith(r)) },
  { href: "/favorites", icon: "star", label: "Избранное", match: (p) => p.startsWith("/favorites") },
  { href: "/history", icon: "history", label: "История", match: (p) => p.startsWith("/history") },
  { href: "/folders", icon: "folder", label: "Папки", match: (p) => p.startsWith("/folders") },
];

/**
 * Что за backend: mock с фиксированной выдачей ({mock: true}) или демо-поиск
 * по корпусу решений ({corpus: N}) — показываем это в футере.
 */
function useBackendInfo() {
  const [info, setInfo] = useState<{ demo: boolean; corpus: number | null }>({ demo: false, corpus: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d) => !cancelled && setInfo({ demo: d?.mock === true, corpus: typeof d?.corpus === "number" ? d.corpus : null }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

function corpusLabel(n: number) {
  const word = n % 10 === 1 && n % 100 !== 11 ? "решение" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "решения" : "решений";
  return `Демо-корпус: ${n} ${word} арбитражных судов`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  // Мобильное меню открыто «для конкретной страницы»: любой переход (в т.ч.
  // «назад» в браузере) закрывает его автоматически, как в эталоне.
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  const menuOpen = menuOpenAt === pathname;
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const backend = useBackendInfo();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setProfileOpen(false);
      setMenuOpenAt((open) => {
        if (open !== null) burgerRef.current?.focus();
        return null;
      });
    }
    function onPointer(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, []);

  // Открыли мобильное меню — фокус на первый пункт.
  useEffect(() => {
    if (menuOpen) sidebarRef.current?.querySelector<HTMLElement>(".nav a")?.focus();
  }, [menuOpen]);

  return (
    <div className="app">
      <aside id="sidebar" ref={sidebarRef} className={`sidebar${menuOpen ? " open" : ""}`} aria-label="Главное меню">
        <Link className="brand" href="/">
          <Icon name="scale" />
          <span>Legal Search</span>
        </Link>
        <nav className="nav">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setMenuOpenAt(null)}
              >
                <Icon name={item.icon} />
                <span className="label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div
          className="sidebar-bottom"
          ref={profileRef}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setProfileOpen(false);
          }}
        >
          {profileOpen && (
            <div className="profile-menu" id="profile-menu">
              <div className="profile-menu-email">{user?.email}</div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
              >
                <Icon name="logout" />
                Выйти
              </button>
            </div>
          )}
          <button
            type="button"
            className="profile"
            aria-expanded={profileOpen}
            aria-controls="profile-menu"
            title={user?.email}
            onClick={() => setProfileOpen((v) => !v)}
          >
            <div className="avatar">{user ? initials(user.email) : "LS"}</div>
            <div className="profile-text">
              <b>Мое пространство</b>
              <small>Личный кабинет</small>
            </div>
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="mobile-bar">
          <button
            ref={burgerRef}
            className="iconbtn"
            type="button"
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpenAt(menuOpen ? null : pathname)}
          >
            <Icon name="menu" />
          </button>
          <span>Legal Search</span>
          <span style={{ width: 35 }} />
        </div>
        {children}
        <footer className="footer">
          <span>Legal Search · Поиск судебной практики</span>
          <span>
            {backend.demo
              ? "Демонстрационные данные · Поиск не подключен"
              : backend.corpus !== null
                ? corpusLabel(backend.corpus)
                : "Судебная практика РФ"}
          </span>
        </footer>
      </main>
    </div>
  );
}
