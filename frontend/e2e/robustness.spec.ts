// Поведение при сбоях и неполном backend. Ответы API подменяются через
// page.route — mock-сервер при этом продолжает обслуживать остальные запросы.
import type { Page, Route } from "@playwright/test";
import { API_URL, expect, QUERY, searchFromHome, test } from "./fixtures";

const CORS = { "Access-Control-Allow-Origin": "http://localhost:3010", "Access-Control-Allow-Credentials": "true" };

function sse(events: [string, unknown][]) {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

function fulfillSse(route: Route, body: string) {
  return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/event-stream" }, body });
}

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** POST /search/ отвечает заданным потоком; остальные методы — дальше, на mock. */
async function routeSearch(page: Page, body: string) {
  await page.route(`${API_URL}/search/`, (route) =>
    route.request().method() === "POST" ? fulfillSse(route, body) : route.continue(),
  );
}

/** Добавить в сравнительную таблицу все дела выдачи (подпись кнопки меняется после нажатия). */
async function addAllToCompare(page: Page) {
  const add = page.getByRole("button", { name: "Добавить в сравнение" });
  while ((await add.count()) > 0) await add.first().click();
}

async function search(page: Page, query = QUERY) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Поисковый запрос" }).fill(query);
  await page.getByRole("button", { name: "Найти" }).click();
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe("Проверка сессии", () => {
  test.use({ expectedConsoleErrors: [/status of 503/] });

  test("сбой /auth/me не разлогинивает, а предлагает повторить", async ({ authed: page }) => {
    let fail = true;
    await page.route(`${API_URL}/auth/me`, (route) =>
      fail ? fulfillJson(route, 503, { detail: "Service Unavailable" }) : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Не удалось связаться с сервером" })).toBeVisible();
    await expect(page.getByText("Сервис временно недоступен")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("legalsearch-token"))).toBe("mock-token");
    fail = false;
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.getByRole("heading", { name: "С чего начнем исследование?" })).toBeVisible();
  });
});

test.describe("Истёкшая сессия", () => {
  test.use({ expectedConsoleErrors: [/status of 401/] });

  test("401 посреди работы — выход на страницу входа", async ({ authed: page }) => {
    await page.route(`${API_URL}/search/`, (route) =>
      route.request().method() === "POST" ? fulfillJson(route, 401, { detail: "Could not validate credentials" }) : route.continue(),
    );
    await page.goto("/");
    await page.getByRole("textbox", { name: "Поисковый запрос" }).fill(QUERY);
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("legalsearch-token"))).toBeNull();
  });
});

test.describe("Неполный ответ backend", () => {
  // у такого backend нет карточек /cases/:id — окно полного текста получает 404 и честно пишет «недоступен»
  test.use({ expectedConsoleErrors: [/status of 404/] });

  test("текущий формат backend (sources + token) — документы и вывод видны, анализ «нет данных»", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["sources", { sources: [
          { document_id: "gk-1064", title: "ГК РФ, статья 1064", relevance: 4.2, fragment: "Вред, причиненный имуществу, подлежит возмещению." },
          { document_id: "gk-15", title: "ГК РФ, статья 15", relevance: -0.5, fragment: "Лицо, право которого нарушено, может требовать возмещения убытков." },
        ] }],
        ["token", { text: "Вред возмещается в полном объёме [1].\n\nСм. также убытки [2]." }],
        ["done", { query_id: "q-1" }],
      ]),
    );
    await search(page);
    await expect(page.locator(".doc-row")).toHaveCount(2);
    await expect(page.locator(".doc-row .score").first()).toHaveText("99%"); // sigmoid(4.2)
    await expect(page.locator(".stat").first()).toContainText("Нет данных");
    await expect(page.getByText("Анализируем практику")).toHaveCount(0);
    // сноски [1], [2] — ссылки на документы выдачи
    await expect(page.locator(".summary .cite")).toHaveCount(2);
    await page.locator(".summary .cite").first().click();
    await expect(page).toHaveURL(/\/documents\/gk-1064$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ГК РФ, статья 1064");
    await expect(page.getByText("Совпадает с моим делом")).toHaveCount(0);
    await expect(page.locator("blockquote")).toContainText("Вред, причиненный имуществу");

    await page.locator(".quote-link").click();
    await expect(page.getByRole("dialog")).toContainText("Полный текст судебного акта пока недоступен");
    await page.keyboard.press("Escape");

    await page.goto("/map");
    await expect(page.getByText("Схема вывода недоступна")).toBeVisible();
    await page.goto("/summary");
    await addAllToCompare(page);
    await page.goto("/compare");
    await expect(page.locator("thead th")).toHaveCount(4);
    await expect(page.locator("td.good, td.bad")).toHaveCount(0);
  });

  test("дела без полей анализа не роняют сравнение и карточку", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [{ id: "x1", title: "Решение 1" }, { id: "x2", title: "Решение 2", facts: "не массив" }, { title: "без id" }] }],
        ["analysis", { stats: { for_count: 1, against_count: 1, total: 2 }, map: null }],
        ["done", { query_id: "q-2" }],
      ]),
    );
    await search(page);
    await expect(page.locator(".doc-row")).toHaveCount(2);
    await expect(page.locator(".stat").first()).toContainText("50%");
    await addAllToCompare(page);
    await page.goto("/compare");
    await expect(page.locator("tbody")).toContainText("—");
    await page.reload(); // сохранённая выдача тоже не должна ронять страницу
    await expect(page.locator("thead th")).toHaveCount(4);
    await page.goto("/documents/x1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Решение 1");
  });

  test("сортировка по дате", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [
          { id: "old", title: "Старое дело", score: 95, date: "2021-05-01" },
          { id: "new", title: "Новое дело", score: 70, date: "2025-02-01" },
        ] }],
        ["done", { query_id: "q-3" }],
      ]),
    );
    await search(page);
    await expect(page.locator(".doc-row .doc-title").first()).toHaveText("Старое дело");
    await page.locator("#sort").selectOption("date");
    await expect(page.locator(".doc-row .doc-title").first()).toHaveText("Новое дело");
  });
});

test.describe("Ошибки поиска", () => {
  test("событие error — понятное сообщение и повтор", async ({ authed: page }) => {
    await routeSearch(page, sse([["error", { detail: "CUDA out of memory" }]]));
    await search(page);
    await expect(page.locator(".error-box")).toContainText("Не удалось выполнить поиск. Повторите запрос.");
    await expect(page.getByText("CUDA")).toHaveCount(0);
    await expect(page.locator(".stat").first()).toContainText("Нет данных");
    await page.unroute(`${API_URL}/search/`);
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.getByText("Да, взыскание убытков возможно")).toBeVisible();
  });

  test("битый поток — без технического текста", async ({ authed: page }) => {
    await routeSearch(page, "event: cases\ndata: {not json\n\n");
    await search(page);
    await expect(page.locator(".error-box")).toContainText("Сервер вернул некорректный ответ");
    await expect(page.getByText("JSON")).toHaveCount(0);
  });

  test("пока идёт поиск — заглушки, а не пустые состояния; перезагрузка — «поиск прерван»", async ({ authed: page }) => {
    // Запрос «висит» — сервер ещё не ответил.
    await page.route(`${API_URL}/search/`, (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.continue()));
    await search(page);
    await expect(page.getByLabel("Готовим вывод")).toBeVisible();
    await expect(page.locator(".stat").first()).toContainText("Анализируем практику…");
    await page.locator(".tabs").getByRole("link", { name: /Сравнительная таблица/ }).click();
    await expect(page.getByText("Добавьте дела для сравнения")).toHaveCount(0);
    await expect(page.locator(".doc-row.placeholder").first()).toBeVisible();
    await page.locator(".tabs").getByRole("link", { name: "Поисковая выдача" }).click();
    await page.getByRole("link", { name: "Развернуть логику" }).click();
    await expect(page.getByText("Строим схему вывода…")).toBeVisible();

    await page.goto("/summary");
    await expect(page.locator(".error-box")).toContainText("Поиск был прерван");
    await page.unroute(`${API_URL}/search/`);
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.getByText("Да, взыскание убытков возможно")).toBeVisible();
  });
});

test.describe("Библиотека", () => {
  test.use({ expectedConsoleErrors: [/status of 500/] });

  test("не загрузились папки и избранное — ошибка с повтором, а не «пусто»", async ({ authed: page }) => {
    let fail = true;
    for (const path of ["/collections/", "/favorites/"]) {
      await page.route(`${API_URL}${path}`, (route) =>
        fail && route.request().method() === "GET" ? fulfillJson(route, 500, { detail: "boom" }) : route.continue(),
      );
    }
    await page.goto("/folders");
    await expect(page.locator(".error-box")).toContainText("Не удалось загрузить папки");
    await expect(page.getByText("Всего папок: 0")).toHaveCount(0);
    await expect(page.locator(".folder-create")).toHaveCount(0);
    await page.goto("/favorites");
    await expect(page.locator(".error-box")).toContainText("Не удалось загрузить избранное");
    await expect(page.getByText("Пока ничего не сохранено")).toHaveCount(0);
    await page.goto("/folders/contract");
    await expect(page.getByText("Папка не найдена")).toHaveCount(0);

    fail = false;
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.locator(".breadcrumbs")).toContainText("Договорные споры");
  });

  test("откат неудачного «в избранное» не затирает другое успешное", async ({ authed: page, request }) => {
    await page.route(`${API_URL}/favorites/vs-305-es23-9876`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await new Promise((r) => setTimeout(r, 600));
      await fulfillJson(route, 500, { detail: "boom" });
    });
    await searchFromHome(page);
    const row = (id: string) => page.locator(".doc-row", { has: page.locator(`a[href="/documents/${id}"]`) });
    await row("vs-305-es23-9876").getByRole("button", { name: "В избранное" }).click();
    await row("ac-po-f06-5678-2023").getByRole("button", { name: "В избранное" }).click();
    await expect(page.locator(".toast.show")).toContainText("Сервис временно недоступен");
    await expect(row("vs-305-es23-9876").getByRole("button", { name: "В избранное" })).toBeVisible();
    await expect(row("ac-po-f06-5678-2023").getByRole("button", { name: "Удалить из избранного" })).toBeVisible();
    const saved = await (await request.get(`${API_URL}/favorites/`)).json();
    expect(saved.map((d: { id: string }) => d.id)).toContain("ac-po-f06-5678-2023");
  });
});

test.describe("Клавиатура и навигация", () => {
  test("модальное окно: фокус внутри, Escape закрывает и возвращает фокус", async ({ authed: page }) => {
    await page.goto("/folders");
    const trigger = page.getByRole("button", { name: "Создать папку" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Название")).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("меню профиля закрывается при уходе фокуса и по Escape", async ({ authed: page }) => {
    await page.goto("/");
    const profile = page.locator("button.profile");
    await profile.click();
    await expect(profile).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#profile-menu")).toHaveCount(0);
    await profile.click();
    await page.getByRole("textbox", { name: "Поисковый запрос" }).focus();
    await expect(page.locator("#profile-menu")).toHaveCount(0);
  });

});

test.describe("Страница 404", () => {
  test.use({ expectedConsoleErrors: [/status of 404/] });

  test("несуществующий адрес — страница 404 в стиле приложения", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    await page.getByRole("link", { name: "На главную" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("Целостность ответа", () => {
  test("поток оборвался без done — сообщение и повтор, а не «готово»", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [{ id: "x1", title: "Решение 1", score: 80 }] }],
        ["token", { text: "Суд пришёл к выводу, что" }],
      ]),
    );
    await search(page);
    await expect(page.locator(".error-box")).toContainText("Ответ сервера оборвался");
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  test("несогласованный анализ — доли практики не больше 100%", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [{ id: "x1", title: "Решение 1" }, { id: "x2", title: "Решение 2" }] }],
        ["token", { text: "Вывод." }],
        ["analysis", { stats: { for_count: 5, against_count: 3, total: 2 }, map: null }],
        ["done", { query_id: "q-3" }],
      ]),
    );
    await search(page);
    await expect(page.locator(".stat strong").first()).toHaveText("100%");
    await expect(page.locator(".stat .bar i").first()).toHaveAttribute("style", /width: 100%/);
  });
});

test.describe("API демо-стенда", () => {
  const login = async (request: import("@playwright/test").APIRequestContext, email: string) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: "x" } });
    return { "X-Auth-Token": `Bearer ${(await res.json()).access_token}` };
  };

  test("история, папки и избранное у каждого пользователя свои", async ({ request }) => {
    const a = await login(request, `a-${Date.now()}@example.com`);
    const b = await login(request, `b-${Date.now()}@example.com`);
    const search = await request.post(`${API_URL}/search/`, { headers: a, data: { query: "секретный вопрос клиента А" } });
    expect(await search.text()).toContain("event: done");
    expect(JSON.stringify(await (await request.get(`${API_URL}/history/`, { headers: a })).json())).toContain("секретный вопрос");
    expect(JSON.stringify(await (await request.get(`${API_URL}/history/`, { headers: b })).json())).not.toContain("секретный вопрос");
    await request.post(`${API_URL}/collections/`, { headers: a, data: { name: "Папка А" } });
    expect(JSON.stringify(await (await request.get(`${API_URL}/collections/`, { headers: b })).json())).not.toContain("Папка А");
  });

  test("лимиты: длинный запрос, большое тело, не-строка", async ({ request }) => {
    const h = await login(request, `limits-${Date.now()}@example.com`);
    const long = await request.post(`${API_URL}/search/`, { headers: h, data: { query: "а".repeat(1001) } });
    expect(long.status()).toBe(400);
    expect((await long.json()).detail).toContain("до 1000 символов");
    const big = await request.post(`${API_URL}/telemetry/events`, { headers: h, data: { x: "а".repeat(100_000) } });
    expect(big.status()).toBe(413);
    const obj = await request.post(`${API_URL}/search/`, { headers: h, data: { query: { x: 1 } } });
    expect(obj.status()).toBe(400);
    const history = await (await request.get(`${API_URL}/history/`, { headers: h })).json();
    expect(history).toEqual([]);
    const name = await request.post(`${API_URL}/collections/`, { headers: h, data: { name: "я".repeat(5000) } });
    expect((await name.json()).name.length).toBeLessThanOrEqual(120);
  });

  test("CORS — только для локальной разработки", async ({ request }) => {
    const evil = await request.get(`${API_URL}/health`, { headers: { Origin: "https://evil.example" } });
    expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
    const local = await request.get(`${API_URL}/health`, { headers: { Origin: "http://localhost:3010" } });
    expect(local.headers()["access-control-allow-origin"]).toBe("http://localhost:3010");
  });
});

test.describe("Полный текст", () => {
  test("в выдаче текста нет — догружается при открытии, цитата подсвечена", async ({ authed: page }) => {
    const quote =
      "Размер подлежащих возмещению убытков определяется судом с разумной степенью достоверности с учетом всех обстоятельств дела, принципов справедливости и соразмерности ответственности допущенному нарушению.";
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [{ id: "vs-305-es23-9876", title: "Определение ВС РФ", score: 90, quote }] }],
        ["token", { text: "Вывод." }],
        ["done", { query_id: "q-ft" }],
      ]),
    );
    await search(page);
    await page.locator(".doc-row .doc-body").first().click();
    await page.locator(".quote-link").click();
    await expect(page.locator("#quote-in-text")).toContainText("с разумной степенью достоверности");
    await expect(page.getByRole("dialog")).toContainText("ВЕРХОВНЫЙ СУД РОССИЙСКОЙ ФЕДЕРАЦИИ");
  });
});

test.describe("Карточка без анализа", () => {
  test("модель не разобрала дело — вместо пустоты позиция суда и итог", async ({ authed: page }) => {
    await routeSearch(
      page,
      sse([
        ["cases", { cases: [{ id: "x9", title: "Постановление 9", position: "Суд взыскал аванс и проценты.", outcome: "Иск удовлетворен" }] }],
        ["token", { text: "Вывод." }],
        ["analysis", { stats: { for_count: 0, against_count: 0, total: 1 }, map: null, cases: [] }],
        ["done", { query_id: "q-9" }],
      ]),
    );
    await search(page);
    await page.locator(".doc-row .doc-body").first().click();
    await expect(page.locator(".detail-card")).toContainText("Позиция суда");
    await expect(page.locator(".detail-card")).toContainText("Суд взыскал аванс и проценты.");
    await expect(page.locator(".detail-card")).toContainText("Иск удовлетворен");
    await expect(page.getByText("Почему релевантен")).toHaveCount(0);
  });
});
