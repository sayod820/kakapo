# KAKAPO API v2.2 — Node.js backend для Next.js

**Express + JSON-хранилище · WebSocket · деплой на Render**

Полный перенос функций из локального `kakapo/server` (уведомления, push, finance, couriers, payouts, deliveryFeeLocked).

## Деплой на Render

### 1. Push в GitHub

```bash
cd kakapo-api
git add .
git commit -m "Migrate to Node.js backend for Render"
git push origin main
```

### 2. Render Dashboard

Если сервис **kakapo-api** уже есть (старый Python):

1. **Settings → Build & Deploy** — убедитесь, что Runtime = **Docker**
2. **Environment** — удалите `DATABASE_URL`, `SECRET_KEY` (PostgreSQL больше не нужен)
3. Добавьте:
   ```
   DATA_DIR=/data
   NODE_ENV=production
   CORS_ORIGINS=https://ваш-проект.vercel.app,http://localhost:3001
   ```
4. **Disks** → Add Disk: mount `/data`, 1 GB (рекомендуется на Starter; на Free данные сбросятся при redeploy)
5. **Manual Deploy** → Deploy latest commit

### 3. Blueprint (новый сервис)

Render → **New → Blueprint** → репозиторий `sayod820/kakapo-api` → задайте `CORS_ORIGINS`.

## Проверка

```
GET  https://kakapo-api.onrender.com/health
GET  https://kakapo-api.onrender.com/products
GET  https://kakapo-api.onrender.com/finance/summary
WS   wss://kakapo-api.onrender.com/ws/orders
```

## Локально

```bash
npm install
npm run dev
# → http://localhost:8000/health
```

## Фронтенд (Vercel)

```
NEXT_PUBLIC_USE_API=true
NEXT_PUBLIC_API_URL=https://kakapo-api.onrender.com
NEXT_PUBLIC_WS_URL=wss://kakapo-api.onrender.com
KAKAPO_BACKEND_URL=https://kakapo-api.onrender.com
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
├── Dockerfile
└── render.yaml
```

Папка `app/` — старый Python backend (не используется, можно удалить).

## Демо-доступы

| Роль | Данные |
|------|--------|
| OTP | `1234` |
| Админ | `admin@kakapo.tj` / любой пароль |
| Курьер OTP | `1234` |
