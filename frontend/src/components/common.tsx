import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

/** Пустое состояние вкладок выдачи, когда поиск ещё не выполнялся. */
export function NoSearchYet({ title }: { title: string }) {
  return (
    <section>
      <PageHeading title={title} />
      <EmptyState
        title="Здесь появятся результаты поиска"
        text="Опишите правовой вопрос или обстоятельства дела в строке поиска выше."
        action={
          <Link href="/" className="btn primary">
            Начать поиск
          </Link>
        }
      />
    </section>
  );
}

/** Список не загрузился — не выдаём это за «пусто». */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>Не удалось загрузить {what}. Проверьте соединение и повторите.</span>
      <button type="button" className="btn tiny" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function DocListPlaceholder({ rows = 3 }: { rows?: number }) {
  return (
    <div className="doc-list" aria-busy="true" aria-label="Загрузка документов">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="doc-row placeholder">
          <div style={{ flex: 1 }}>
            <span className="skeleton w60" />
            <span className="skeleton w40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-tools">{actions}</div>
    </div>
  );
}

export function DemoLabel() {
  return (
    <span className="demo-label">
      <i className="demo-dot" />
      Демонстрационная выдача
    </span>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name="folder" />
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
