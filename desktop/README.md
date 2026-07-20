# КАКАПО на ПК

Сайт: **https://kakappo.shop**

## Браузер (все приложения)

Откройте на компьютере:

| Приложение | Ссылка |
|---|---|
| Портал | https://kakappo.shop |
| Магазин | https://kakappo.shop/ |
| Админ | https://kakappo.shop/admin |
| Торговля / касса | https://kakappo.shop/trade |
| Курьер | https://kakappo.shop/courier |
| Сборщик | https://kakappo.shop/assembler |
| Ресторан | https://kakappo.shop/restaurant |

Можно добавить в закладки браузера или «Закрепить» на панели задач (Chrome → ⋮ → Сохранить и поделиться → Создать ярлык).

## Касса Electron (десктоп)

`desktop/config.json` указывает на:

```json
"tradeUrl": "https://kakappo.shop/trade"
```

Запуск:

```bash
cd desktop
npm install
npm start
```

Сборка установщика Windows:

```bash
npm run dist
```

Установщик: `desktop/dist/KAKAPO-Kassa-Setup-*.exe`
