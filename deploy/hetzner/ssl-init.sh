#!/usr/bin/env bash
# Выпуск SSL-сертификата Let's Encrypt (после того как DNS указывает на сервер)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

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

cd "$REPO_ROOT"

echo "==> Certbot для $DOMAIN (+ www)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --force-renewal

echo "==> nginx с SSL"
export DOMAIN
envsubst '${DOMAIN}' < "$SCRIPT_DIR/nginx/default.ssl.conf.template" > "$SCRIPT_DIR/nginx/default.conf"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx

echo ""
echo "✅ HTTPS включён: https://$DOMAIN"
echo "   Пересоберите web с PUBLIC_URL/WS_URL если меняли .env:"
echo "   bash deploy/hetzner/deploy.sh"
