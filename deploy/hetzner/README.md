# КАКАПО на Hetzner — полный перенос

Всё на **одном VPS**: API, Next.js (магазин, админка, курьер, ресторан, сборщик), nginx, SSL.

Данные клиентов и бонусов хранятся в Docker volume `kakapo-data` — **не стираются** при обновлении.

---

## Что нужно

| Ресурс | Рекомендация |
|--------|----------------|
| Сервер | Hetzner **CX22** (2 vCPU, 4 GB) или CX32 |
| ОС | Ubuntu 22.04 / 24.04 |
| Домен | Например `kakapo.tj` → A-запись на IP сервера |
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
DOMAIN=kakapo.tj
PUBLIC_URL=https://kakapo.tj
WS_URL=wss://kakapo.tj
CORS_ORIGINS=https://kakapo.tj
CERTBOT_EMAIL=admin@kakapo.tj
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

- https://kakapo.tj/store — магазин
- https://kakapo.tj/admin — админка
- https://kakapo.tj/courier — курьер
- https://kakapo.tj/restaurant — ресторан
- https://kakapo.tj/assembler — сборщик

---

## Шаг 4 — Отключить Vercel и Render

Когда всё работает на Hetzner:

1. **DNS** — домен уже на Hetzner (шаг 3)
2. **Vercel** — можно удалить проект или остановить деплой
3. **Render** — остановить сервис `kakapo-api` (на Free данные всё равно не сохранялись)

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
