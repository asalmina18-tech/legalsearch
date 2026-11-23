import { defineConfig } from "@playwright/test";

// E2E-тесты поднимают СВОИ mock-API и production-сборку на отдельных портах,
// поэтому не мешают запущенным `npm run dev` / `npm run mock`.
const API_PORT = 8010;
const WEB_PORT = 3010;
const API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Тесты делят один mock-сервер (состояние сбрасывается перед каждым тестом) — гоняем последовательно.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Системный Google Chrome — без скачивания браузеров Playwright.
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node mock/server.mjs",
      env: { PORT: String(API_PORT), MOCK_DELAY_MS: "0", MOCK_ALLOW_RESET: "1" },
      url: `${API_URL}/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx next build && npx next start -p ${WEB_PORT}`,
      env: { NEXT_PUBLIC_API_URL: API_URL, NEXT_DIST_DIR: ".next-e2e" },
      url: `http://localhost:${WEB_PORT}/login`,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
