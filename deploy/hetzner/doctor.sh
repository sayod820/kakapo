#!/usr/bin/env bash
# Быстрая диагностика 502 на сервере
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет $ENV_FILE — запустите из /opt/kakapo"
  exit 1
fi

echo "==> Контейнеры"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -a

echo ""
echo "==> API health (внутри контейнера)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e \
  "fetch('http://127.0.0.1:8000/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.error('FAIL',e))" \
  || echo "API недоступен"

echo ""
echo "==> Web /store (внутри контейнера)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T web node -e \
  "fetch('http://127.0.0.1:3000/store').then(r=>console.log('status',r.status)).catch(e=>console.error('FAIL',e))" \
  || echo "Web недоступен"

echo ""
echo "==> Последние логи API"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=40 api

echo ""
echo "==> Последние логи Web"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=40 web

echo ""
echo "==> Последние логи nginx"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=20 nginx

echo ""
echo "==> Быстрый рестарт"
echo "bash deploy/hetzner/deploy.sh"
