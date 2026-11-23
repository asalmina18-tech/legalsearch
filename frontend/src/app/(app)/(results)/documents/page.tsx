import { redirect, RedirectType } from "next/navigation";

// Отдельного экрана «Все документы» больше нет: выдача документов — под
// кратким выводом (см. логику продукта в README). Старые ссылки ведут туда.
export default function DocumentsPage() {
  redirect("/summary#documents", RedirectType.replace);
}
