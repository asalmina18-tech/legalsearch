"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, login, me, register } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePageTitle } from "@/lib/ui";
import { Icon } from "./Icon";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  usePageTitle(isLogin ? "Вход" : "Регистрация");
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Уже вошли — сразу в приложение.
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, companyName);
      setUser(await me());
      router.replace("/");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      // Неверные данные — понятный текст; сбой сети/сервера — честно о сбое.
      if (isLogin && (status === 401 || status === 400)) setError("Неверный email или пароль");
      else if (!isLogin && (status === 400 || status === 409)) setError("Не удалось зарегистрироваться — возможно, такой email уже используется");
      else setError(e instanceof ApiError ? e.message : "Не удалось выполнить запрос. Повторите.");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="brand">
        <Icon name="scale" />
        <span>Legal Search</span>
      </div>
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>{isLogin ? "Вход" : "Регистрация"}</h1>
        <p>{isLogin ? "Войдите, чтобы продолжить исследование практики." : "Создайте пространство для вашей команды."}</p>

        {!isLogin && (
          <label>
            Компания
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="ООО «Ромашка»"
              autoComplete="organization"
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.ru"
            autoComplete="email"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            required
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
        </label>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? (isLogin ? "Входим…" : "Создаём…") : isLogin ? "Войти" : "Зарегистрироваться"}
        </button>

        <div className="auth-foot">
          {isLogin ? (
            <>
              Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
            </>
          ) : (
            <>
              Уже есть аккаунт? <Link href="/login">Войти</Link>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
