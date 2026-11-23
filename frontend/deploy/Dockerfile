# Демо-стенд: готовая standalone-сборка Next.js + mock-API.
# Сборка приложения делается на машине разработчика (deploy.sh), здесь — только
# упаковка: сервер не тратит память и время на `next build`.
FROM node:24-bookworm-slim
WORKDIR /srv
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
LABEL org.legalsearch.demo="1"
COPY app ./app
COPY mock ./mock
USER node
