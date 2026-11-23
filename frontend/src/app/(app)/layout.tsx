"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth-context";
import { LibraryProvider } from "@/lib/library-context";
import { SearchProvider } from "@/lib/search-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, error, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !error) router.replace("/login");
  }, [loading, user, error, router]);

  if (error && !user) {
    return (
      <div className="auth">
        <div className="brand">
          <Icon name="scale" />
          <span>Legal Search</span>
        </div>
        <div className="card auth-card" role="alert">
          <h1>Не удалось связаться с сервером</h1>
          <p>{error}</p>
          <button type="button" className="btn primary" onClick={retry}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (loading || !user) return <div className="loading-screen">Загрузка…</div>;

  return (
    <LibraryProvider>
      <SearchProvider>
        <AppShell>{children}</AppShell>
      </SearchProvider>
    </LibraryProvider>
  );
}
