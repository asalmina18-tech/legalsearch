#!/usr/bin/env bash
# Выкладка демо-стенда (интерфейс + API с поиском по корпусу) на сервер с Docker и
# общим Caddy, который подключает сайты из отдельных файлов (import sites/*.caddy) и
# видит приложения в docker-сети `web`.
#
#   DEPLOY_HOST=root@server DEMO_DOMAIN=demo.example.com ./deploy/deploy.sh
#
# Из frontend/.env.demo (не в git, права 600) берутся:
#   GIGACHAT_AUTH_KEY — ключ GigaChat (уходит только в .env контейнера API);
#   DEMO_AUTH_USER, DEMO_AUTH_HASH — логин и bcrypt-хеш общего пароля стенда
#     (хеш: `caddy hash-password`); DEMO_AUTH_PASSWORD — для проверки после выкладки.
#
# Необязательно: REMOTE_DIR (/root/legalsearch-demo), CADDY_SITES (/root/proxy/sites),
# CADDY_CONTAINER (proxy-caddy); ALLOW_PUBLIC=1 — без пароля; ALLOW_FIXTURE=1 — без
# корпуса (демонстрационная выдача).
#
# Порядок: сборка → загрузка → новые контейнеры → ждём healthy (иначе откат на прежние
# образы) → сайт в Caddy (невалидный конфиг или неудачный reload — откат файла сайта).
set -euo pipefail

: "${DEPLOY_HOST:?укажите DEPLOY_HOST, например root@server}"
: "${DEMO_DOMAIN:?укажите DEMO_DOMAIN — домен, который указывает на сервер}"
REMOTE_DIR="${REMOTE_DIR:-/root/legalsearch-demo}"
CADDY_SITES="${CADDY_SITES:-/root/proxy/sites}"
CADDY_CONTAINER="${CADDY_CONTAINER:-proxy-caddy}"

cd "$(dirname "$0")/.."

env_demo() { [ -f .env.demo ] && grep -E "^$1=" .env.demo | tail -1 | cut -d= -f2- || true; }
AUTH_USER="$(env_demo DEMO_AUTH_USER)"
AUTH_HASH="$(env_demo DEMO_AUTH_HASH)"
AUTH_PASSWORD="$(env_demo DEMO_AUTH_PASSWORD)"

echo "→ Проверки"
if [ -z "$AUTH_USER" ] || [ -z "$AUTH_HASH" ]; then
  if [ "${ALLOW_PUBLIC:-}" != "1" ]; then
    echo "   нет DEMO_AUTH_USER / DEMO_AUTH_HASH в .env.demo — стенд был бы открыт всем (ALLOW_PUBLIC=1, если так и задумано)" >&2
    exit 1
  fi
  echo "   ВНИМАНИЕ: стенд без пароля (ALLOW_PUBLIC=1)"
fi
if [ ! -f demo-api/data/corpus/meta.json ] && [ "${ALLOW_FIXTURE:-}" != "1" ]; then
  echo "   корпус не собран (demo-api/data/corpus) — выкладка заменила бы поиск демонстрационной выдачей (ALLOW_FIXTURE=1, если так и задумано)" >&2
  exit 1
fi
[ -f demo-api/certs/russian_trusted_root_ca.pem ] || { echo "   нет demo-api/certs/russian_trusted_root_ca.pem" >&2; exit 1; }

echo "→ Сборка (standalone, API за тем же доменом на /api, токен — в X-Auth-Token)"
rm -rf .next-deploy
NEXT_OUTPUT=standalone NEXT_DIST_DIR=.next-deploy NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_AUTH_HEADER=X-Auth-Token npx next build

echo "→ Пакет для сервера"
BUNDLE="$(mktemp -d)"
trap 'rm -rf "$BUNDLE"' EXIT
cp -R .next-deploy/standalone "$BUNDLE/app"
cp -R .next-deploy/static "$BUNDLE/app/.next-deploy/static"
[ -d public ] && cp -R public "$BUNDLE/app/public"
# sharp (оптимизация картинок) приложению не нужен, а собран под ОС разработчика.
rm -rf "$BUNDLE"/app/node_modules/@img "$BUNDLE"/app/node_modules/sharp
mkdir -p "$BUNDLE/mock" && cp mock/server.mjs "$BUNDLE/mock/"
cp deploy/Dockerfile deploy/Dockerfile.api deploy/docker-compose.yml "$BUNDLE/"
# Файл сайта для Caddy: подстановка без интерпретации спецсимволов хеша ($, /, .)
DOMAIN="$DEMO_DOMAIN" AUTH_USER="$AUTH_USER" AUTH_HASH="$AUTH_HASH" python3 -I - deploy/legalsearch.caddy "$BUNDLE/legalsearch.caddy" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
user, hash_ = os.environ["AUTH_USER"], os.environ["AUTH_HASH"]
if not (user and hash_):
    text = re.sub(r"\n\t# Доступ.*?\n\tbasic_auth \{.*?\n\t\}\n", "\n", text, flags=re.S)
text = text.replace("{{DOMAIN}}", os.environ["DOMAIN"]).replace("{{AUTH_USER}}", user).replace("{{AUTH_HASH}}", hash_)
open(dst, "w", encoding="utf-8").write(text)
PY

# Поисковый API: исходники (зависимости ставятся в образе), корпус, ключ GigaChat
mkdir -p "$BUNDLE/demo-api" "$BUNDLE/corpus"
cp -R demo-api/package.json demo-api/package-lock.json demo-api/lib demo-api/certs "$BUNDLE/demo-api/"
(
  umask 077
  : > "$BUNDLE/.env"
  if [ -f .env.demo ]; then grep -E '^GIGACHAT_[A-Z_]+=' .env.demo >> "$BUNDLE/.env" || true; fi
)
if [ -f demo-api/data/corpus/meta.json ]; then
  cp demo-api/data/corpus/{docs.json,chunks.json,vectors.f32,meta.json} "$BUNDLE/corpus/"
  echo "CORPUS_DIR=/srv/corpus" >> "$BUNDLE/.env"
  echo "   корпус: $(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["docs"], "актов,", m["chunks"], "фрагментов")' demo-api/data/corpus/meta.json)"
else
  echo "   без корпуса (ALLOW_FIXTURE=1): демонстрационная выдача"
fi

echo "→ Загрузка на $DEPLOY_HOST:$REMOTE_DIR"
rsync -az --delete "$BUNDLE/" "$DEPLOY_HOST:$REMOTE_DIR/"

echo "→ Контейнеры: сборка, запуск, проверка здоровья"
ssh "$DEPLOY_HOST" bash -s -- "$REMOTE_DIR" "$CADDY_SITES" "$CADDY_CONTAINER" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"; CADDY_SITES="$2"; CADDY_CONTAINER="$3"
cd "$REMOTE_DIR"
chmod 600 .env
IMAGES="legalsearch-demo legalsearch-demo-api"

# прежние образы — для отката, если новые не поднимутся
for img in $IMAGES; do
  if docker image inspect "$img:latest" >/dev/null 2>&1; then docker tag "$img:latest" "$img:prev"; fi
done

health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing; }
wait_healthy() {
  for _ in $(seq 1 100); do
    a="$(health legalsearch-api)"; w="$(health legalsearch-web)"
    [ "$a" = healthy ] && [ "$w" = healthy ] && return 0
    { [ "$a" = unhealthy ] || [ "$w" = unhealthy ]; } && return 1
    sleep 3
  done
  return 1
}

docker compose build
# --force-recreate: новый корпус (bind mount) подхватывается, даже если образ не менялся
docker compose up -d --force-recreate --remove-orphans
if ! wait_healthy; then
  echo "   новые контейнеры не поднялись — логи и откат на прежние образы:" >&2
  docker compose logs --tail 40 api web >&2 || true
  for img in $IMAGES; do
    if docker image inspect "$img:prev" >/dev/null 2>&1; then docker tag "$img:prev" "$img:latest"; fi
  done
  docker compose up -d --force-recreate --remove-orphans || true
  exit 1
fi
echo "   api: $(health legalsearch-api), web: $(health legalsearch-web)"

echo "→ Сайт в Caddy"
SITE="$CADDY_SITES/legalsearch.caddy"
BACKUP=""
if [ -f "$SITE" ]; then BACKUP="$(mktemp)"; cp "$SITE" "$BACKUP"; fi
restore_site() {
  if [ -n "$BACKUP" ]; then cp "$BACKUP" "$SITE"; else rm -f "$SITE"; fi
}
cp legalsearch.caddy "$SITE"
# Невалидный файл сайта не должен остаться в общем Caddy — иначе сломается и чужой reload.
if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
  || ! docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile; then
  restore_site
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  echo "   конфигурация Caddy не принята — файл сайта откатан" >&2
  exit 1
fi

# старые образы этого стенда (без тегов после пересборки); чужие проекты не трогаем
docker image prune -f --filter label=org.legalsearch.demo=1 >/dev/null
docker compose ps
REMOTE

echo "→ Проверка снаружи"
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DEMO_DOMAIN/api/health")"
if [ -n "$AUTH_HASH" ]; then
  [ "$code" = "401" ] || { echo "   без пароля ответ $code, ожидался 401" >&2; exit 1; }
  echo "   без пароля: 401 — стенд закрыт"
fi
if [ -n "$AUTH_PASSWORD" ]; then
  printf 'user = "%s:%s"\n' "$AUTH_USER" "$AUTH_PASSWORD" | curl -fsS -K - "https://$DEMO_DOMAIN/api/health" >/dev/null \
    || { echo "   с паролем /api/health не отвечает" >&2; exit 1; }
  echo "   с паролем: /api/health — ок"
fi

echo "✓ Готово: https://$DEMO_DOMAIN"
