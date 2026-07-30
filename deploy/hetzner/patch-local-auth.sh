#!/usr/bin/env bash
# Обновить API на сервере: добавить /employees/local-auth
# Запуск на Hetzner: bash deploy/hetzner/patch-local-auth.sh
set -euo pipefail
cd /opt/kakapo
git pull || true
docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env up -d --build api
echo "Проверка:"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/employees/local-auth
