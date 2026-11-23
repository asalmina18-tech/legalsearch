"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, clearSession, getToken, me, UNAUTHORIZED_EVENT } from "./api";
import type { User } from "./types";

type AuthState = {
  user: User | null;
  loading: boolean;
  /** Не удалось проверить сессию (сеть, 5xx) — токен при этом НЕ удаляется */
  error: string | null;
  retry: () => void;
  setUser: (u: User | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Токен читаем из localStorage — доступно только на клиенте, поэтому не
    // можем вычислить это в initial state (SSR).
    if (!getToken()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Выходим только если сервер явно отверг токен. Сбой сети или
        // перезапуск backend не должен разлогинивать всех пользователей.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) clearSession();
        else setError(e instanceof Error ? e.message : "Не удалось связаться с сервером");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 401 посреди работы (токен истёк) — api.ts уже удалил токен, здесь сбрасываем пользователя.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, retry, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
