# KAKAPO — безопасная публикация офлайн-пакета кассы

Цель: агент (Cursor) может публиковать обновление интерфейса кассы **сам**, без
ручного root-шага, но **без root-доступа** к серверу. Для этого устанавливается
один узкий wrapper, который умеет ровно одно действие.

## Модель безопасности

```
Cursor (kakapo-deploy, SSH-ключ)
  └─ sudo -n /usr/local/sbin/kakapo-publish-kassa-ui      ← одна разрешённая команда
       └─ кладёт latest.json + ровно один ui-*.zip
          в kakapo-api:/data/updates/kassa-ui/
```

Wrapper:

- не принимает аргументов;
- читает только фиксированную папку `/home/kakapo-deploy/kassa-ui-update`;
- принимает ровно один `ui-*.zip` (строгое имя) и `latest.json`;
- проверяет, что `latest.json` ссылается на этот архив и что размер совпадает;
- при наличии `ui-*.zip.sha256` сверяет контрольную сумму;
- копирует файлы во приватную root-папку до проверки (защита от подмены);
- делает `docker cp` только в `/data/updates/kassa-ui/` контейнера `kakapo-api`;
- не выполняет shell, произвольный `docker`, `psql`, не читает `.env`, не трогает БД.

Sudoers даёт `kakapo-deploy` право без пароля ровно на этот скрипт.

## Установка (один раз, под root)

Скопировать на сервер и установить:

```bash
install -m 0755 /path/to/kakapo-publish-kassa-ui         /usr/local/sbin/kakapo-publish-kassa-ui
install -m 0440 /path/to/kakapo-publish-kassa-ui.sudoers /etc/sudoers.d/kakapo-publish-kassa-ui
visudo -cf /etc/sudoers.d/kakapo-publish-kassa-ui
```

Проверить, что право появилось (под `kakapo-deploy`):

```bash
sudo -n -l
# ожидается строка:
# (root) NOPASSWD: /usr/local/sbin/kakapo-publish-kassa-ui
```

## Использование

1. Подготовить папку (это обычный SSH, без root):

```bash
ssh kakapo-prod "mkdir -p /home/kakapo-deploy/kassa-ui-update && rm -f /home/kakapo-deploy/kassa-ui-update/*"
scp desktop/publish-ui-out/ui-<version>.zip kakapo-prod:/home/kakapo-deploy/kassa-ui-update/
scp desktop/publish-ui-out/latest.json      kakapo-prod:/home/kakapo-deploy/kassa-ui-update/
```

2. Опубликовать (одна разрешённая команда):

```bash
ssh kakapo-prod "sudo -n /usr/local/sbin/kakapo-publish-kassa-ui"
```

3. Проверить снаружи:

```bash
curl -s https://kakappo.shop/updates/kassa-ui/latest.json
```

## Что это НЕ даёт

- нет root и нет произвольного `sudo`;
- нет доступа к PostgreSQL, бизнес-данным, `.env`, `/etc`;
- нельзя публиковать что-либо вне `/data/updates/kassa-ui/`;
- нельзя запускать команды или контейнеры.

Sudoers-правило остаётся узким: без shell, без `docker`, без wildcard-аргументов.
