#!/usr/bin/env bash
# Аварийный откат nginx на HTTP (если HTTPS сломан / 443 не отвечает).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
NGINX_DIR="$SCRIPT_DIR/nginx"

# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
export DOMAIN="${DOMAIN:-_}"

cd "$REPO_ROOT"

envsubst '${DOMAIN}' < "$NGINX_DIR/default.http.conf.template" > "$NGINX_DIR/default.conf"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart nginx

echo ""
echo "✅ nginx работает только по HTTP (порт 80)."
echo "   Chrome может помнить HSTS и всё равно открывать https — сбросьте:"
echo "   chrome://net-internals/#hsts → Delete domain security policies → ${DOMAIN}"
echo ""
echo "   Включить HTTPS снова: bash deploy/hetzner/ssl-init.sh"
