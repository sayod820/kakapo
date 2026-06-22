#!/usr/bin/env bash
# Сборка и перезапуск всех сервисов КАКАПО
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Создайте $ENV_FILE из .env.example"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

cd "$REPO_ROOT"

echo "==> Сборка и запуск (API + Next.js + nginx)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate api web

echo "==> Ожидание API..."
for i in $(seq 1 40); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e \
    "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "   API готов (${i}с)"
    break
  fi
  if [[ $i -eq 40 ]]; then
    echo "❌ API не отвечает. Логи:"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=80 api
    exit 1
  fi
  sleep 2
done

echo "==> Ожидание Next.js..."
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T web node -e \
    "fetch('http://127.0.0.1:3000/store').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "   Web готов (${i}с)"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "❌ Next.js не отвечает. Логи:"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=80 web
    exit 1
  fi
  sleep 2
done

echo "==> Перезапуск nginx"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart nginx

echo ""
echo "==> Статус"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo ""
echo "==> Health API"
sleep 3
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e "fetch('http://127.0.0.1:8000/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.error(e))" || true

echo ""
echo "✅ Готово. Приложения:"
echo "   /store       — магазин"
echo "   /admin       — админка"
echo "   /courier     — курьер"
echo "   /restaurant  — ресторан"
echo "   /assembler   — сборщик"
