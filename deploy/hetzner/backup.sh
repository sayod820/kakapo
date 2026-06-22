#!/usr/bin/env bash
# Резервная копия kakapo.json (база клиентов, заказов, бонусов)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
BACKUP_DIR="${1:-/var/backups/kakapo}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/kakapo-$STAMP.json"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api cat /data/kakapo.json > "$OUT"
gzip -f "$OUT"

echo "✅ Бэкап: ${OUT}.gz"
