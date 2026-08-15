/**
 * Статическая сборка Trade UI в android-app/www.
 * Телефон открывает кассу без сайта; API — kakappo.shop.
 *
 * Запуск: npm run android:build-ui
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const wwwDir = path.join(root, 'android-app', 'www')
const outDir = path.join(root, 'out')
const apiDir = path.join(root, 'app', 'api')
const apiPark = path.join(root, 'app', '_api_android_skip')

const backendUrl = (process.env.KAKAPO_ANDROID_BACKEND || 'https://kakappo.shop/api/kakapo').replace(/\/$/, '')
const wsUrl = (process.env.KAKAPO_ANDROID_WS || 'wss://kakappo.shop').replace(/\/$/, '')

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (res.status !== 0) {
    console.error(`\n[android-ui] Команда прервалась: ${cmd} ${args.join(' ')}`)
    process.exit(res.status || 1)
  }
}

let parkedApi = false
try {
  if (existsSync(apiDir) && !existsSync(apiPark)) {
    renameSync(apiDir, apiPark)
    parkedApi = true
    console.log('[android-ui] app/api временно убран (static export)')
  }

  console.log('[android-ui] Сборка Next (export)…')
  console.log(`[android-ui] API: ${backendUrl}`)
  run('npx', ['next', 'build'], {
    KAKAPO_ANDROID_EXPORT: 'true',
    NODE_ENV: 'production',
    NEXT_PUBLIC_USE_API: 'true',
    NEXT_PUBLIC_TRADE_ANDROID: 'true',
    NEXT_PUBLIC_API_URL: backendUrl,
    KAKAPO_BACKEND_URL: backendUrl,
    NEXT_PUBLIC_WS_URL: wsUrl,
  })
} finally {
  if (parkedApi && existsSync(apiPark) && !existsSync(apiDir)) {
    renameSync(apiPark, apiDir)
    console.log('[android-ui] app/api возвращён')
  }
}

if (!existsSync(outDir)) {
  console.error('[android-ui] папка out не создана')
  process.exit(1)
}

console.log('[android-ui] Копирование в android-app/www…')
rmSync(wwwDir, { recursive: true, force: true })
mkdirSync(wwwDir, { recursive: true })
cpSync(outDir, wwwDir, { recursive: true })

writeFileSync(
  path.join(wwwDir, 'index.html'),
  `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>КАКАПО Торговля</title>
  <script>window.kakapoAndroid=true;location.replace('./trade/');</script>
</head>
<body></body>
</html>
`,
  'utf8',
)

writeFileSync(
  path.join(wwwDir, 'build-info.json'),
  `${JSON.stringify({ builtAtIso: new Date().toISOString(), backendUrl, wsUrl }, null, 2)}\n`,
  'utf8',
)

console.log('[android-ui] Готово: android-app/www → /trade/')
