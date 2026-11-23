import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return (
    <div className="auth">
      <div className="brand">
        <Icon name="scale" />
        <span>Legal Search</span>
      </div>
      <div className="card auth-card">
        <h1>Страница не найдена</h1>
        <p>Возможно, ссылка устарела или была набрана с ошибкой.</p>
        <Link href="/" className="btn primary">
          На главную
        </Link>
      </div>
    </div>
  );
}
