import { test as base, expect, type Page } from "@playwright/test";

export const API_URL = "http://127.0.0.1:8010";
export const QUERY = "Можно ли взыскать убытки с контрагента за односторонний отказ от договора подряда?";

type Fixtures = {
  /** Страница с уже выполненным входом (токен в localStorage). */
  authed: Page;
  /** Ожидаемые тестом сообщения об ошибках в консоли (например, 404 на несуществующий документ). */
  expectedConsoleErrors: RegExp[];
};

export const test = base.extend<Fixtures>({
  expectedConsoleErrors: [[], { option: true }],
  page: async ({ page, request, expectedConsoleErrors }, provide) => {
    // Каждый тест начинает с исходных демонстрационных данных.
    await request.post(`${API_URL}/__reset`);

    // Любая необработанная ошибка JS на странице — провал теста.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !expectedConsoleErrors.some((re) => re.test(m.text()))) errors.push(m.text());
    });

    await provide(page);
    expect(errors, "ошибки в консоли браузера").toEqual([]);
  },
  authed: async ({ page }, provide) => {
    await page.addInitScript(() => localStorage.setItem("legalsearch-token", "mock-token"));
    await provide(page);
  },
});

export { expect };

/** Выполнить поиск с главной и дождаться полной выдачи. */
export async function searchFromHome(page: Page, query = QUERY) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Поисковый запрос" }).fill(query);
  await page.getByRole("button", { name: "Найти" }).click();
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByText("Да, взыскание убытков возможно")).toBeVisible();
  await expect(page.getByText("72%")).toBeVisible();
}
