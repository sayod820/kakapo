#!/usr/bin/env bash
# Резервная копия: PostgreSQL (pg_dump) + снимок JSON из /data (если есть)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
BACKUP_DIR="${1:-/var/backups/kakapo}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# 1) pg_dump (основная БД)
PG_OUT="$BACKUP_DIR/kakapo-pg-$STAMP.sql"
if compose ps postgres --status running -q 2>/dev/null | grep -q .; then
  compose exec -T postgres pg_dump -U "${POSTGRES_USER:-kakapo}" -d "${POSTGRES_DB:-kakapo}" --no-owner --no-acl > "$PG_OUT"
  gzip -f "$PG_OUT"
  echo "✅ Postgres: ${PG_OUT}.gz"
else
  echo "⚠️  Контейнер postgres не запущен — pg_dump пропущен"
fi

# 2) JSON snapshot из volume (бэкап / откат / uploads рядом)
JSON_OUT="$BACKUP_DIR/kakapo-json-$STAMP.json"
if compose exec -T api test -f /data/kakapo.json 2>/dev/null; then
  compose exec -T api cat /data/kakapo.json > "$JSON_OUT"
  gzip -f "$JSON_OUT"
  echo "✅ JSON: ${JSON_OUT}.gz"
else
  # Экспорт живого снимка из API (если скрипт доступен в образе)
  if compose exec -T api node -e "process.exit(0)" 2>/dev/null; then
    EXPORT_OUT="/data/kakapo.export-$STAMP.json"
    if compose exec -T -e DATA_DIR=/data api node exportPgToJson.js "$EXPORT_OUT" 2>/dev/null; then
      compose exec -T api cat "$EXPORT_OUT" > "$JSON_OUT"
      gzip -f "$JSON_OUT"
      echo "✅ JSON export: ${JSON_OUT}.gz"
    else
      echo "⚠️  JSON-снимок недоступен (нет kakapo.json и export не удался)"
    fi
  fi
fi

echo "Готово → $BACKUP_DIR"
