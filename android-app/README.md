# KAKAPO Trade — Android

Capacitor WebView → `https://kakappo.shop/trade`

**Есть:** касса, товары, клиенты, долги, склад, поставщики, финансы, отчёты  
**Нет на телефоне:** настройки принтера / весов / шаблона чека; печать чека пропускается

## Сборка APK

1. Установите [Android Studio](https://developer.android.com/studio) (ставит JDK + Android SDK).
2. В Android Studio один раз откройте папку `android-app/android` и дождитесь Gradle Sync.
3. В PowerShell:

```powershell
cd kakapo\android-app
.\build-apk.ps1
```

Готовый файл: `android-app/dist/KAKAPO-Trade-debug.apk`

Или вручную:

```powershell
cd kakapo\android-app
npm install
npx cap sync android
npx cap open android
# Build → Build APK(s)
```

## Важно

APK грузит **живой** сайт `kakappo.shop/trade`.  
Изменения UI (скрытие оборудования, имя кассира и т.д.) появятся на телефоне после деплоя Next на сервер.

## Права

`INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` (сканер штрихкодов).
