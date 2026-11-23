import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Сборка и артефакты e2e-тестов (Playwright)
    ".next-e2e/**",
    ".next-deploy/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
