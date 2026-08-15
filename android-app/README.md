# KAKAPO Trade — Android

Интерфейс кассы **внутри APK**. Без сети касса работает из локального кэша (IndexedDB + очередь).  
Первый запуск — нужен интернет, чтобы скачать товары и пароли. Синк на сервер — когда сеть есть.

**Есть:** касса, товары, клиенты, долги, склад, поставщики, финансы, отчёты  
**Нет на телефоне:** настройки принтера / весов / шаблона чека

Браузер на телефоне (Chrome) по-прежнему только онлайн — это не APK.

## Сборка APK

1. Установите [Android Studio](https://developer.android.com/studio) (JDK + Android SDK).
2. Один раз откройте `android-app/android` в Android Studio (Gradle Sync).
3. Из корня репозитория `kakapo`:

```powershell
npm run android:apk
```

Или по шагам:

```powershell
npm run android:build-ui
cd android-app
.\build-apk.ps1
```

`android:build-ui` кладёт статическую сборку Next в `android-app/www` (открывается `/trade/`).  
Готовый файл: `android-app/dist/KAKAPO-Trade-debug.apk`

## Важно

После смены UI нужна новая сборка APK (`android:build-ui` + sync).  
Сайт `kakappo.shop/trade` в браузере от этого не зависит.

## Права

`INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` (сканер штрихкодов).
