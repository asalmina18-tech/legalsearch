"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/common";
import { SEARCH_CACHE_KEY } from "@/lib/api";

// Непредвиденная ошибка на любой странице приложения: сайдбар остаётся,
// вместо пустого экрана Next.js — понятное сообщение и выход из ситуации.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="content">
      <EmptyState
        title="Не удалось показать страницу"
        text="Произошла непредвиденная ошибка. Попробуйте ещё раз или начните новый поиск."
        action={
          <div className="row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn" onClick={retry}>
              Повторить
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                // Если сломалась сохранённая выдача — сбрасываем её и начинаем с чистого листа.
                try {
                  sessionStorage.removeItem(SEARCH_CACHE_KEY);
                } catch {}
                // Именно полная перезагрузка: router.push не пересоздаст SearchProvider,
                // и сломанная выдача осталась бы в памяти.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign("/");
              }}
            >
              Новый поиск
            </button>
          </div>
        }
      />
    </div>
  );
}
