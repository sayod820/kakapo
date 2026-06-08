# KAKAPO — Супермаркет + Маркетплейс
**г. Яван, Таджикистан · Next.js 14 + TypeScript + Zustand**

## 5 приложений

| Маршрут | Приложение | Описание |
|---------|-----------|----------|
| `/` | Портал | Лаунчер всех приложений |
| `/store` | 🛒 Магазин | Клиентское приложение |
| `/restaurant` | 🍽 Ресторан | Кабинет партнёра |
| `/assembler` | 📦 Сборщик | Сборка заказов |
| `/courier` | 🛵 Курьер | Доставка |
| `/admin` | ⚙️ Админ | Управление всем |

## Запуск

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Демо-доступы

| Роль | Данные |
|------|--------|
| 🛒 Клиент OTP | `1234` |
| 🛵 Курьер OTP | `1234` |
| 📦 Сборщик PIN | `5678` |
| 🍽 Ресторан | `chaihona@kakapo.tj` / `rest123` |
| ⚙️ Админ | `admin@kakapo.tj` / `admin123` |

## Структура

```
kakapo-next/
├── app/
│   ├── page.tsx              # Портал
│   ├── globals.css           # Глобальные стили
│   ├── layout.tsx            # Root layout
│   ├── store/page.tsx        # Магазин
│   ├── restaurant/page.tsx   # Ресторан
│   ├── assembler/page.tsx    # Сборщик
│   ├── courier/page.tsx      # Курьер
│   └── admin/page.tsx        # Админ
├── components/
│   ├── store/StoreApp.tsx        # ~5800 строк
│   ├── admin/AdminApp.tsx        # ~1620 строк
│   ├── restaurant/RestaurantApp  # ~790 строк
│   ├── assembler/AssemblerApp    # ~586 строк
│   └── courier/CourierApp        # ~200 строк
└── lib/
    ├── store.ts              # Zustand (общий стейт)
    ├── data.ts               # Данные
    └── types.ts              # TypeScript типы
```

## Функции магазина (StoreApp)

- 🛒 Каталог с категориями и **подкатегориями**
- 🍽 Рестораны (маркетплейс)
- 🔍 Поиск товаров
- 🛒 Корзина и оформление заказа
- 📍 GPS определение адреса
- 💳 Карты лояльности KAKAPO-XXXX
- ⭐ Бонусная система
- 👥 Реферальная программа
- 🔔 Уведомления
- 📦 История заказов

## Функции админа (AdminApp)

- 📊 Dashboard — все 4 приложения
- 📦 Заказы — магазин + рестораны
- 🥦 Товары + артикулы KAK-XXXX
- 📁 Категории с **родительским контролем** (подкатегории)
- 💸 Акции и промокоды
- 🍽 Рестораны — меню, комиссии, выплаты
- ⭐ Отзывы клиентов
- 🛵 Курьеры — live карта
- 📦 Сборщики
- 👥 Клиенты + CRM
- 💳 Карты лояльности
- 🔔 Push уведомления
- 💰 Финансы + выплаты ресторанам
- ⚙️ Настройки — GBS Market, доставка, SMS

## GBS Market

Настройки → GBS Market:
- IP: `http://192.168.1.100`
- Порт: `8419`
- Синхронизация по артикулам KAK-XXXX

## Деплой (Vercel — бесплатно)

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Деплой (Hetzner VPS ~$46/год)

```bash
# На сервере Ubuntu 22.04:
sudo apt update && sudo apt install -y nodejs npm nginx
npm install
npm run build
npm start
```
