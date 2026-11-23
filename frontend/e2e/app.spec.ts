import { expect, QUERY, searchFromHome, test } from "./fixtures";

const DOC1 = "Постановление АС Московского округа от 14.03.2024 № Ф05-1234/2024";
const DOC2 = "Определение ВС РФ от 28.11.2023 № 305-ЭС23-9876";
const DOC3 = "Постановление АС Поволжского округа от 20.07.2023 № Ф06-5678/2023";

test.describe("Авторизация", () => {
  test("без входа — редирект на /login, после входа — главная", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill("lawyer@firm.ru");
    await page.getByLabel("Пароль").fill("secret");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "С чего начнем исследование?" })).toBeVisible();
    await expect(page.locator("button.profile")).toHaveAttribute("title", "lawyer@firm.ru");
  });

  test("выход очищает сессию: следующий пользователь не видит чужую выдачу", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("first@firm.ru");
    await page.getByLabel("Пароль").fill("secret");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("heading", { name: "С чего начнем исследование?" })).toBeVisible();
    await searchFromHome(page);

    await page.locator("button.profile").click();
    await expect(page.locator("#profile-menu")).toContainText("first@firm.ru");
    await page.locator("#profile-menu").getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("legalsearch-token"))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("legalsearch-current-search-v1"))).toBeNull();

    await page.getByLabel("Email").fill("second@firm.ru");
    await page.getByLabel("Пароль").fill("secret");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("heading", { name: "С чего начнем исследование?" })).toBeVisible();
    await page.goto("/summary");
    await expect(page.getByText("Здесь появятся результаты поиска")).toBeVisible();
  });
});

test.describe("Главная", () => {
  test("структура как в эталоне", async ({ authed: page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Поиск — Legal Search");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("С чего начнем исследование?");
    // по замечаниям: без надзаголовка, подзаголовка и подписей под строкой поиска
    for (const gone of ["Поиск по судебной практике", "Опишите ситуацию", "Можно задать вопрос обычным языком", "Поисковый запрос"]) {
      await expect(page.locator("main")).not.toContainText(gone);
    }
    await expect(page.getByRole("textbox", { name: "Поисковый запрос" })).toBeVisible();
    await expect(page.locator(".example")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Поиск", exact: true })).toHaveAttribute("aria-current", "page");
    // разделы меню: «Мои позиции» убраны
    await expect(page.locator(".nav a")).toHaveText(["Поиск", "Избранное", "История", "Папки"]);
    await expect(page.locator(".footer")).toContainText("Демонстрационные данные");
  });

  test("пример запроса запускает поиск", async ({ authed: page }) => {
    await page.goto("/");
    await page.locator(".example").nth(1).click();
    await expect(page).toHaveURL(/\/summary$/);
    await expect(page.getByRole("textbox", { name: "Поисковый запрос" })).toHaveValue(
      "Как подтвердить размер убытков при расторжении договора?",
    );
  });
});

test.describe("Выдача", () => {
  test("краткая сводка: вывод, статистика, документы", async ({ authed: page }) => {
    await searchFromHome(page);
    await expect(page.getByRole("heading", { name: "Краткая сводка" })).toBeVisible();
    await expect(page.locator(".demo-label")).toBeVisible();
    const stats = page.locator(".stat");
    await expect(stats.nth(0)).toContainText("72%");
    await expect(stats.nth(0)).toContainText("48 из 67 дел");
    await expect(stats.nth(1)).toContainText("18%");
    await expect(stats.nth(2).locator("strong")).toHaveText("6");
    await expect(page.locator(".toast.show")).toHaveText("Открыта демонстрационная выдача");
    await expect(page.locator(".doc-row")).toHaveCount(3);
    await expect(page.locator(".doc-row .score").first()).toHaveText("95%");
    await expect(page.locator(".doc-row .score.medium")).toHaveText("76%");
    await expect(page.locator(".tabs a.active")).toHaveText("Поисковая выдача");
    await expect(page.locator(".page-heading p")).toHaveCount(0); // без поясняющих подзаголовков
    await expect(page.locator(".doc-row").first().getByRole("button")).toHaveCount(3); // сравнение, избранное, папка
    await expect(page.getByRole("button", { name: "Добавить в позицию" })).toHaveCount(0);
  });

  test("фильтры и сброс", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.getByRole("button", { name: "Фильтры" }).click();
    await page.locator(".filters select").first().selectOption("ВС РФ");
    await expect(page.locator(".doc-row")).toHaveCount(1);
    await expect(page.locator(".doc-row")).toContainText(DOC2);
    await page.locator(".filters select").nth(1).selectOption("2024");
    await expect(page.getByText("По этим фильтрам ничего не найдено")).toBeVisible();
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page.locator(".doc-row")).toHaveCount(3);
  });

  test("стрелка у вывода открывает схему вывода; с неё — обратно к выдаче", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.getByRole("link", { name: "Развернуть логику" }).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByRole("heading", { name: "Схема вывода" })).toBeVisible();
    await expect(page.locator(".folder-info")).toContainText("Да, взыскание убытков возможно");
    await expect(page.locator(".node")).toHaveCount(7);
    await expect(page.locator(".node.norm")).toContainText("Ст. 715 ГК РФ");
    // схема — часть «Поисковой выдачи»: своей вкладки и лишних кнопок нет
    await expect(page.locator(".tabs a")).toHaveText(["Поисковая выдача", "Сравнительная таблица"]);
    await expect(page.locator(".tabs a.active")).toHaveText("Поисковая выдача");
    for (const name of ["Скачать", "По размеру", "Увеличить", "Уменьшить"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(page.locator(".page-heading p")).toHaveCount(0);
    await page.getByRole("link", { name: "К выдаче" }).click();
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByRole("link", { name: "Развернуть логику" }).click();
    // «Судебная практика» ведёт к документам выдачи
    await page.locator(".node.practice").click();
    await expect(page).toHaveURL(/\/summary#documents$/);
  });

  test("в выдаче все документы под выводом; «В сравнение» собирает сравнительную таблицу", async ({ authed: page }) => {
    await searchFromHome(page);
    await expect(page.locator("#documents")).toContainText("3");
    const compareTab = page.locator(".tabs").getByRole("link", { name: /Сравнительная таблица/ });
    await expect(compareTab.locator(".count")).toHaveCount(0); // ничего не выбрано заранее
    await expect(page.locator(".selection-bar")).toContainText("В сравнительной таблице: 0");

    const row = (title: string) => page.locator(".doc-row", { hasText: title });
    await row(DOC1).getByRole("button", { name: "Добавить в сравнение" }).click();
    await row(DOC2).getByRole("button", { name: "Добавить в сравнение" }).click();
    await expect(row(DOC2).getByRole("button", { name: "Убрать из сравнения" })).toBeVisible();
    await expect(compareTab.locator(".count")).toHaveText("2");
    await expect(page.locator(".selection-bar")).toContainText("В сравнительной таблице: 2");

    await page.getByRole("link", { name: "Открыть таблицу" }).click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.locator("thead th")).toHaveCount(4); // критерий + мое дело + 2 дела
    await expect(page.locator("td.bad")).toHaveCount(1); // дело ВС РФ против позиции
    await expect(page.locator("td.mine").first()).toHaveText("Договор подряда");

    await page.getByRole("button", { name: `Убрать из сравнения: ${DOC2}` }).click();
    await expect(page.locator("thead th")).toHaveCount(3);
    await expect(compareTab.locator(".count")).toHaveText("1");

    // новый поиск — новая таблица (анализ дел строится относительно запроса)
    await page.getByRole("textbox", { name: "Поисковый запрос" }).fill("Другой запрос");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText("72%")).toBeVisible();
    await expect(compareTab.locator(".count")).toHaveCount(0);
  });

  test("пустая сравнительная таблица объясняет, как добавить дела; выбор из списка", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.locator(".tabs").getByRole("link", { name: /Сравнительная таблица/ }).click();
    await expect(page.getByRole("heading", { name: "Добавьте дела для сравнения" })).toBeVisible();
    await page.getByRole("button", { name: "Выбрать из списка" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: DOC3 }).check();
    await dialog.getByRole("checkbox", { name: DOC1 }).check();
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toBeHidden();
    // порядок столбцов — как в выдаче
    await expect(page.locator("thead th").nth(2)).toContainText("АС МО, 14.03.2024");
    await expect(page.locator("thead th").nth(3)).toContainText("АС ПО, 20.07.2023");
  });

  test("старый адрес «Все документы» ведёт к выдаче", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/summary#documents$/);
    await expect(page.locator(".doc-row")).toHaveCount(3);
  });

  test("выдача переживает перезагрузку страницы", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.reload();
    await expect(page.getByText("Да, взыскание убытков возможно")).toBeVisible();
    await expect(page.locator(".doc-row")).toHaveCount(3);
  });

  test("вкладки выдачи без поиска показывают пустое состояние", async ({ authed: page }) => {
    for (const path of ["/summary", "/map", "/compare", "/documents"]) {
      await page.goto(path);
      await expect(page.getByText("Здесь появятся результаты поиска")).toBeVisible();
    }
  });
});

test.describe("Карточка документа", () => {
  test("открытие из выдачи, сравнение, цитата в полном тексте, возврат", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.getByRole("link", { name: DOC1 }).click();
    await expect(page).toHaveURL(/\/documents\/ac-mo-f05-1234-2024$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Постановление Арбитражного суда Московского округа от 14.03.2024 № Ф05-1234/2024",
    );
    await expect(page.locator(".score-box")).toContainText("Очень высокая");
    await expect(page.locator(".detail-card")).toHaveCount(4);
    await expect(page.locator(".tabs a.active")).toHaveText("Поисковая выдача");
    await expect(page.getByRole("button", { name: /позици/ })).toHaveCount(0);

    await page.getByRole("button", { name: "В сравнение" }).click();
    await expect(page.getByRole("button", { name: "В сравнении" })).toBeVisible();
    await expect(page.locator(".tabs .count")).toHaveText("1");

    await page.getByRole("button", { name: "Полный текст" }).click();
    await expect(page.getByRole("dialog")).toContainText("АРБИТРАЖНЫЙ СУД МОСКОВСКОГО ОКРУГА");
    await expect(page.locator("#quote-in-text")).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).last().click();

    // клик по цитате — полный текст, открытый на этой цитате, с подсветкой
    await page.locator(".quote-link").click();
    const mark = page.locator("#quote-in-text");
    await expect(mark).toContainText("Односторонний отказ заказчика от договора подряда");
    await expect(mark).toBeInViewport();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Открыть в полном тексте" }).click();
    await expect(page.locator("#quote-in-text")).toBeInViewport();
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "К результатам поиска" }).click();
    await expect(page).toHaveURL(/\/summary$/);
  });

  test("прямая ссылка на карточку загружает документ с сервера", async ({ authed: page }) => {
    await page.goto("/documents/vs-305-es23-9876");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Определение Верховного Суда РФ от 28.11.2023 № 305-ЭС23-9876",
    );
  });

  test.describe(() => {
    test.use({ expectedConsoleErrors: [/status of 404/] });
    test("несуществующий документ — понятное сообщение", async ({ authed: page }) => {
      await page.goto("/documents/nope");
      await expect(page.getByText("Документ не найден")).toBeVisible();
    });
  });
});

test.describe("Избранное и история", () => {
  test("закладка добавляет документ в избранное", async ({ authed: page }) => {
    await searchFromHome(page);
    const row = page.locator(".doc-row", { hasText: DOC2 });
    await row.getByRole("button", { name: "В избранное" }).click();
    await expect(row.getByRole("button", { name: "Удалить из избранного" })).toBeVisible();
    await page.locator(".nav").getByRole("link", { name: "Избранное" }).click();
    // DOC1 в избранном изначально (демо-данные) + DOC2
    await expect(page.locator(".doc-row")).toHaveCount(2);
    await page.locator(".doc-row", { hasText: DOC1 }).getByRole("button", { name: "Удалить из избранного" }).click();
    await expect(page.locator(".doc-row")).toHaveCount(1);
  });

  test("история: запрос сохраняется, повтор и очистка", async ({ authed: page }) => {
    await searchFromHome(page);
    await page.locator(".nav").getByRole("link", { name: "История" }).click();
    await expect(page.locator(".saved-query")).toHaveCount(1);
    await expect(page.locator(".saved-query h3")).toHaveText(QUERY);
    const searchRequest = page.waitForRequest((r) => r.url().endsWith("/search/") && r.method() === "POST");
    await page.getByRole("button", { name: "Повторить поиск" }).click();
    expect((await searchRequest).postDataJSON().query).toBe(QUERY);
    await expect(page).toHaveURL(/\/summary$/);
    await page.goto("/history");
    await page.getByRole("button", { name: "Очистить историю" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Очистить" }).click();
    await expect(page.getByText("Здесь появятся ваши запросы")).toBeVisible();
  });
});

test.describe("Папки", () => {
  test("список папок, поиск по названию", async ({ authed: page }) => {
    await page.goto("/folders");
    await expect(page.locator(".folder-card")).toHaveCount(3);
    await expect(page.locator(".folder-card").first()).toContainText("3 документа");
    await page.getByRole("searchbox", { name: "Найти папку" }).fill("убыт");
    await expect(page.locator(".folder-card")).toHaveCount(1);
    await expect(page.locator(".folder-create")).toHaveCount(0);
  });

  test("создание с проверками, сохранение документа, переименование, удаление", async ({ authed: page }) => {
    await page.goto("/folders");
    await page.getByRole("button", { name: "Создать папку" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Создать папку" }).click();
    await expect(dialog.getByText("Введите название папки")).toBeVisible();
    await dialog.getByLabel("Название").fill("договорные споры");
    await dialog.getByRole("button", { name: "Создать папку" }).click();
    await expect(dialog.getByText("Папка с таким названием уже существует")).toBeVisible();
    await dialog.getByLabel("Название").fill("Спор с подрядчиком");
    await dialog.getByLabel("Описание").fill("Дело клиента");
    await dialog.getByRole("button", { name: "Создать папку" }).click();
    await expect(page.locator(".folder-card")).toHaveCount(4);

    // сохранить документ в новую папку из выдачи
    await searchFromHome(page);
    await page.locator(".doc-row", { hasText: DOC3 }).getByRole("button", { name: "Сохранить в папку" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Спор с подрядчиком" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator(".toast.show")).toHaveText("Документ сохранен");

    await page.goto("/folders");
    await page.locator(".folder-card", { hasText: "Спор с подрядчиком" }).click();
    await expect(page.locator(".breadcrumbs")).toContainText("Спор с подрядчиком");
    await expect(page.locator(".folder-info")).toContainText("1 документ");
    await expect(page.locator(".doc-row")).toContainText(DOC3);

    // карточка из папки → «К папке»
    await page.getByRole("link", { name: DOC3 }).click();
    await expect(page.getByRole("link", { name: "К папке" })).toBeVisible();
    await page.getByRole("link", { name: "К папке" }).click();

    await page.getByRole("button", { name: "Убрать из папки" }).click();
    await expect(page.getByText("В папке пока нет документов")).toBeVisible();

    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("dialog").getByLabel("Название").fill("Спор с субподрядчиком");
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Спор с субподрядчиком");

    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить папку" }).click();
    await expect(page).toHaveURL(/\/folders$/);
    await expect(page.locator(".folder-card")).toHaveCount(3);
  });
});

test.describe("Адаптивность", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("на телефоне меню скрыто и открывается кнопкой", async ({ authed: page }) => {
    await page.goto("/");
    const sidebar = page.locator(".sidebar");
    const burger = page.getByRole("button", { name: "Открыть меню" });
    await expect(page.locator(".mobile-bar")).toBeVisible();
    await expect(sidebar).not.toBeInViewport();
    // скрытое меню недоступно с клавиатуры
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sidebar"))).toBe(false);

    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await burger.click();
    await expect(sidebar).toHaveClass(/open/);
    await expect(sidebar.getByRole("link", { name: "Поиск" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sidebar).not.toHaveClass(/open/);
    await expect(burger).toBeFocused();

    await burger.click();
    await sidebar.getByRole("link", { name: "Папки" }).click();
    await expect(page).toHaveURL(/\/folders$/);
    await expect(sidebar).not.toHaveClass(/open/);

    // «назад» в браузере тоже закрывает меню
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await expect(sidebar).toHaveClass(/open/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sidebar).not.toHaveClass(/open/);
  });

  test("на телефоне нет горизонтальной прокрутки", async ({ authed: page }) => {
    await searchFromHome(page);
    for (const path of ["/summary", "/map", "/compare", "/folders", "/documents/ac-mo-f05-1234-2024"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
