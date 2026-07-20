# КАКАПО на Hetzner — полный перенос

Всё на **одном VPS**: API, Next.js (магазин, админка, курьер, ресторан, сборщик), nginx, SSL.

Данные клиентов и бонусов хранятся в Docker volume `kakapo-data` — **не стираются** при обновлении.

---

## Что нужно

| Ресурс | Рекомендация |
|--------|----------------|
| Сервер | Hetzner **CX22** (2 vCPU, 4 GB) или CX32 |
| ОС | Ubuntu 22.04 / 24.04 |
| Домен | Например `kakappo.shop` → A-запись на IP сервера |
| Репозиторий | `github.com/sayod820/kakapo` |

---

## Шаг 1 — Создать сервер в Hetzner

1. [console.hetzner.cloud](https://console.hetzner.cloud) → **Add Server**
2. Location: Falkenstein или Helsinki
3. Image: **Ubuntu 24.04**
4. Type: **CX22** (~€5/мес)
5. SSH-ключ — добавьте свой публичный ключ
6. Создать → скопировать **IP**

Подключение:

```bash
ssh root@ВАШ_IP
```

---

## Шаг 2 — Установка на сервере

```bash
apt-get update && apt-get install -y git
git clone https://github.com/sayod820/kakapo.git /opt/kakapo
cd /opt/kakapo

cp deploy/hetzner/.env.example deploy/hetzner/.env
nano deploy/hetzner/.env
```

Заполните `.env`:

```env
DOMAIN=kakappo.shop
PUBLIC_URL=https://kakappo.shop
WS_URL=wss://kakappo.shop
CORS_ORIGINS=https://kakappo.shop,https://www.kakappo.shop
CERTBOT_EMAIL=admin@kakappo.shop
```

Первичная установка (Docker, firewall, запуск):

```bash
bash deploy/hetzner/setup-server.sh
```

Или вручную только деплой:

```bash
bash deploy/hetzner/deploy.sh
```

Проверка по IP (до DNS):

```bash
curl http://ВАШ_IP/health
```

Должен вернуть JSON с `"persistentDisk": true`.

---

## Шаг 3 — DNS и SSL

У регистратора домена:

| Тип | Имя | Значение |
|-----|-----|----------|
| A | `@` | IP Hetzner |
| A | `www` | IP Hetzner (опционально) |

Подождите 5–30 минут, затем:

```bash
cd /opt/kakapo
bash deploy/hetzner/ssl-init.sh
bash deploy/hetzner/deploy.sh
```

После SSL откройте:

- https://kakappo.shop/store — магазин
- https://kakappo.shop/admin — админка
- https://kakappo.shop/courier — курьер
- https://kakappo.shop/restaurant — ресторан
- https://kakappo.shop/assembler — сборщик
- https://kakappo.shop/trade — торговля / касса
- https://kakappo.shop/pos — POS

---

## Обновление после изменений в коде

На сервере:

```bash
cd /opt/kakapo
git pull
bash deploy/hetzner/deploy.sh
```

База `kakapo.json` в volume **сохраняется**.

---

## Резервная копия

Ежедневно (cron):

```bash
0 3 * * * /opt/kakapo/deploy/hetzner/backup.sh /var/backups/kakapo
```

Восстановление:

```bash
gunzip -c /var/backups/kakapo/kakapo-ДАТА.json.gz | \
  docker compose -f deploy/hetzner/docker-compose.yml exec -T api tee /data/kakapo.json
docker compose -f deploy/hetzner/docker-compose.yml restart api
```

---

## Архитектура

```
Интернет → nginx:80/443
            ├─ /        → Next.js (web:3000) — все UI
            ├─ /api/*   → Next.js proxy → api:8000
            └─ /ws/*    → api:8000 (WebSocket)

api:8000 → volume kakapo-data:/data/kakapo.json
```

---

## Переменные окружения

| Переменная | Где | Назначение |
|------------|-----|------------|
| `DATA_DIR=/data` | API | Постоянная база |
| `KAKAPO_BACKEND_URL=http://api:8000` | Next.js | SSR и rewrites внутри Docker |
| `NEXT_PUBLIC_WS_URL=wss://домен` | Сборка Next | WebSocket для курьера/админки |
| `PUBLIC_URL` | Сборка Next | Публичный URL |

---

## Проблемы

**`/health` → `persistent: false`**  
Проверьте volume: `docker volume inspect kakapo-data`

**WebSocket не подключается**  
В `.env` должен быть `WS_URL=wss://ваш-домен` и выполнен `deploy.sh` после смены.

**502 Bad Gateway**  
`docker compose -f deploy/hetzner/docker-compose.yml logs web api nginx`

---

## Локальная проверка Docker (на ПК)

```bash
cp deploy/hetzner/.env.example deploy/hetzner/.env
# PUBLIC_URL и WS_URL можно оставить пустыми для теста по localhost

docker compose -f deploy/hetzner/docker-compose.yml --env-file deploy/hetzner/.env up -d --build
```

Откройте http://localhost/store
