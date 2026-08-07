# KAKAPO API — Node.js backend

**Express + PostgreSQL (JSONB) · fallback JSON · WebSocket · Hetzner Docker Compose**

## Хранилище

- **Production:** `DATABASE_URL` → PostgreSQL (`docs` + `kv_meta`). In-memory кэш как раньше; `persist()` пишет в PG.
- **Dev без Postgres:** без `DATABASE_URL` → `DATA_DIR/kakapo.json` (откат / локалка).
- При первом старте с пустым PG, если есть `/data/kakapo.json`, данные **импортируются автоматически**.

## Локально (JSON)

```bash
npm install
npm run dev
# → http://localhost:8000/health
```

## Локально (PostgreSQL)

```bash
docker compose up -d postgres
npm install
set DATABASE_URL=postgresql://kakapo:kakapo@127.0.0.1:5432/kakapo
npm run migrate:json-to-pg
npm run dev
```

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://kakapo:kakapo@127.0.0.1:5432/kakapo"
npm run migrate:json-to-pg
npm run dev
```

### Скрипты

| Команда | Назначение |
|---------|------------|
| `npm run migrate:json-to-pg` | `kakapo.json` → Postgres (+ `.bak-…`) |
| `npm run export:pg-to-json` | Postgres → JSON (откат) |

Повторная заливка: `MIGRATE_FORCE=1` или `--force`.

## Структура

```
kakapo-api/
├── index.js              # Express + WebSocket
├── db.js                 # load/save (JSON или Postgres)
├── pg/
│   ├── schema.sql
│   ├── client.js
│   └── store.js
├── migrateJsonToPg.js
├── exportPgToJson.js
├── seed.js
└── Dockerfile
```

## Health

`GET /health` → `engine: "postgres" | "json"`, counts products/clients/…

## Деплой

Часть стека [`deploy/hetzner`](../../deploy/hetzner/README.md). Volume `kakapo-data` — uploads + JSON-бэкап; `kakapo-pgdata` — PostgreSQL.

## Демо-доступы

| Роль | Данные |
|------|--------|
| OTP | `1234` |
| Админ | `admin@kakapo.tj` / любой пароль |
| Курьер OTP | `1234` |
