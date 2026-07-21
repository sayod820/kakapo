#!/usr/bin/env bash
# Надёжный выпуск/обновление SSL Let's Encrypt и включение HTTPS.
# Решает «замкнутый круг»: сперва HTTP (для ACME), затем сертификат, затем HTTPS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
NGINX_DIR="$SCRIPT_DIR/nginx"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${DOMAIN:-}" ]]; then
  echo "Укажите DOMAIN в .env"
  exit 1
fi

CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"
export DOMAIN

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

cd "$REPO_ROOT"

echo "==> 1/4 Запуск nginx в HTTP-режиме (для ACME-challenge)"
envsubst '${DOMAIN}' < "$NGINX_DIR/default.http.conf.template" > "$NGINX_DIR/default.conf"
dc up -d api web
dc up -d nginx
dc restart nginx

echo "==> Проверка, что HTTP отвечает"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1/health" >/dev/null 2>&1 || curl -fsS "http://127.0.0.1/" >/dev/null 2>&1; then
    echo "   HTTP готов (${i}с)"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo "❌ nginx не отвечает по HTTP. Логи:"
    dc logs --tail=40 nginx
    exit 1
  fi
  sleep 1
done

echo "==> 2/4 Выпуск сертификата для $DOMAIN (+ www)"
# --keep-until-expiring: не тратим лимиты Let's Encrypt, если сертификат ещё свежий
# --entrypoint certbot: перекрываем "/bin/sh -c" из compose
dc run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --keep-until-expiring \
  --non-interactive || {
    echo ""
    echo "❌ Не удалось выпустить сертификат."
    echo "   Проверьте, что домен $DOMAIN указывает на этот сервер (A-запись),"
    echo "   и порт 80 открыт. Сайт продолжит работать по HTTP."
    exit 1
  }

echo "==> 3/4 Проверка наличия сертификата"
if ! dc run --rm --entrypoint sh certbot -c "[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]"; then
  echo "❌ Сертификат не найден после certbot. Остаёмся на HTTP."
  exit 1
fi

echo "==> 4/4 Включение HTTPS-конфига nginx"
envsubst '${DOMAIN}' < "$NGINX_DIR/default.ssl.conf.template" > "$NGINX_DIR/default.conf"
dc up -d nginx
dc restart nginx

echo ""
echo "==> Проверка HTTPS"
sleep 2
if curl -fsSk "https://127.0.0.1/health" >/dev/null 2>&1 || curl -fsSk "https://127.0.0.1/" >/dev/null 2>&1; then
  echo "✅ HTTPS работает: https://$DOMAIN"
else
  echo "⚠️  HTTPS-конфиг включён, но проверка не прошла. Логи nginx:"
  dc logs --tail=40 nginx
fi

echo ""
echo "Готово. Автопродление сертификата уже работает (контейнер certbot, каждые 12ч)."
echo "Если меняли PUBLIC_URL/WS_URL в .env — пересоберите web: bash deploy/hetzner/deploy.sh"
