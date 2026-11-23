import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E-тесты собирают приложение в отдельную папку, чтобы не мешать `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Сборка для демо-стенда (deploy/deploy.sh): самодостаточный server.js без node_modules.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Индикатор dev-режима по умолчанию слева внизу и перекрывает профиль в сайдбаре.
  devIndicators: { position: "bottom-right" },
  // не сообщаем наружу, на чём сделан сайт
  poweredByHeader: false,
};

export default nextConfig;
