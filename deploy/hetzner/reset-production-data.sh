#!/usr/bin/env bash
# Полный сброс данных на сервере (оставляет админа и сотрудников).
# Запуск НА СЕРВЕРЕ из /opt/kakapo:
#   bash deploy/hetzner/reset-production-data.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/server/kakapo-api"
COMPOSE="$ROOT/deploy/hetzner/docker-compose.yml"
ENVF="$ROOT/deploy/hetzner/.env"

if [[ ! -f "$API_DIR/resetData.js" ]]; then
  echo "Нет $API_DIR/resetData.js"
  exit 1
fi

echo "=== Резервная копия volume → /root/kakapo-data-backup-*.tgz ==="
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker run --rm -v kakapo-data:/data -v /root:/backup alpine \
  tar czf "/backup/kakapo-data-backup-${STAMP}.tgz" -C /data .

echo "=== Копирую resetData.js в контейнер ==="
docker cp "$API_DIR/resetData.js" kakapo-api:/app/resetData.js
docker cp "$API_DIR/marketCategoriesSeed.js" kakapo-api:/app/marketCategoriesSeed.js

echo "=== Очистка данных (DATA_DIR=/data) ==="
docker exec -e DATA_DIR=/data -w /app kakapo-api node resetData.js

echo "=== Перезапуск API ==="
if [[ -f "$ENVF" ]]; then
  docker compose -f "$COMPOSE" --env-file "$ENVF" up -d --force-recreate api
else
  docker restart kakapo-api
fi

echo "Готово. Проверьте: curl -s http://127.0.0.1:8000/health"
