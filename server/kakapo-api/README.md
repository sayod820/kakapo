# KAKAPO API v2.2 — Node.js backend

**Express + JSON-хранилище · WebSocket · деплой на Hetzner (Docker Compose)**

Полный перенос функций из локального `kakapo/server` (уведомления, push, finance, couriers, payouts, deliveryFeeLocked).

## Деплой

Этот сервис — часть общего Hetzner docker-compose стека, описанного в [`deploy/hetzner/README.md`](../../deploy/hetzner/README.md). Отдельно не деплоится: `docker-compose.yml` в корне репозитория собирает его из `server/kakapo-api` (сервис `api`, порт 8000) и монтирует volume `kakapo-data` в `/data` для персистентного хранения `kakapo.json`.

## Локально

```bash
npm install
npm run dev
# → http://localhost:8000/health
```

## Структура

```
kakapo-api/
├── index.js           # Express + WebSocket
├── db.js              # JSON persistence (DATA_DIR)
├── seed.js            # демо-данные
├── ordersLogic.js
├── restaurantStats.js
├── deliveryFee.js
└── Dockerfile
```

## Демо-доступы

| Роль | Данные |
|------|--------|
| OTP | `1234` |
| Админ | `admin@kakapo.tj` / любой пароль |
| Курьер OTP | `1234` |
