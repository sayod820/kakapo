# Cutover: kakapo.json → PostgreSQL

Короткое окно на проде. Кассы могут копить офлайн-очередь — после рестарта API она уйдёт через обычный sync.

## Подготовка

1. `git pull` на сервере (`/opt/kakapo`).
2. В `deploy/hetzner/.env` задать (пароль сменить!):

```env
POSTGRES_USER=kakapo
POSTGRES_PASSWORD=...
POSTGRES_DB=kakapo
DATABASE_URL=postgresql://kakapo:...@postgres:5432/kakapo
```

3. Бэкап текущего JSON:

```bash
bash deploy/hetzner/backup.sh /var/backups/kakapo
docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env \
  exec -T api cat /data/kakapo.json > /var/backups/kakapo/pre-pg-kakapo.json
```

## Выкат

```bash
cd /opt/kakapo
bash deploy/hetzner/deploy.sh
```

Compose поднимет `postgres`, API с `DATABASE_URL`.  
Если PG пустой и есть `/data/kakapo.json` — **импорт при старте API** (см. логи `[db] Postgres empty — importing`).

Ручной импорт (если нужно):

```bash
docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env exec -T api \
  node migrateJsonToPg.js /data/kakapo.json
```

## Smoke (5 минут)

```bash
curl -s https://kakappo.shop/api/kakapo/health
# ожидайте "engine":"postgres", products > 0

curl -s https://kakappo.shop/api/kakapo/products | head -c 200
```

В кассе: открыть смену → тестовый чек → убедиться что очередь синка уходит.  
Админка / сайт: товары и клиенты на месте.

## Откат (48ч)

1. Экспорт из PG (опционально):

```bash
docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env exec -T api \
  node exportPgToJson.js /data/kakapo.rollback.json
```

2. Временно убрать `DATABASE_URL` из compose/env **нельзя в production** (API выйдет с ошибкой).  
   Откат на JSON: задеплоить предыдущий тег/коммит API без обязательного PG **или** восстановить JSON и запустить старый образ.

Практичный откат данных:

```bash
# восстановить SQL
gunzip -c /var/backups/kakapo/kakapo-pg-ДАТА.sql.gz | \
  docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env \
  exec -T postgres psql -U kakapo -d kakapo
```

Или вернуть `kakapo.json` и временно использовать сборку до миграции.

## После стабилизации

- Cron: `backup.sh` (pg_dump + JSON export).
- Файл `/data/kakapo.json` не писать API (только бэкап/импорт); uploads остаются в `/data/uploads`.
