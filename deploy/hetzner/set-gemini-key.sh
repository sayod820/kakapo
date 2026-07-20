#!/usr/bin/env bash
# Подключить Gemini на сервере Hetzner (один раз после создания ключа в AI Studio)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Создайте $ENV_FILE из .env.example"
  exit 1
fi

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  read -r -s -p "Вставьте GEMINI_API_KEY (AIzaSy...): " KEY
  echo
fi
KEY="$(echo "$KEY" | tr -d '[:space:]')"
if [[ -z "$KEY" ]]; then
  echo "Ключ пустой"
  exit 1
fi

MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

touch "$ENV_FILE"
if grep -q '^GEMINI_API_KEY=' "$ENV_FILE"; then
  sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$KEY|" "$ENV_FILE"
else
  printf '\nGEMINI_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
fi
if grep -q '^GEMINI_MODEL=' "$ENV_FILE"; then
  sed -i "s|^GEMINI_MODEL=.*|GEMINI_MODEL=$MODEL|" "$ENV_FILE"
else
  printf 'GEMINI_MODEL=%s\n' "$MODEL" >> "$ENV_FILE"
fi

cd "$REPO_ROOT"
echo "==> Перезапуск API с новым ключом..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate api

echo "==> Проверка..."
sleep 3
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e \
  "fetch('http://127.0.0.1:8000/admin/ai/status').then(r=>r.json()).then(j=>{console.log(JSON.stringify(j)); process.exit(j.configured?0:1)}).catch(e=>{console.error(e); process.exit(1)})"

echo "✅ Gemini подключён. Обновите админку в браузере (F5)."
