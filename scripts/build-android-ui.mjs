/**
 * Статическая сборка Trade UI в android-app/www.
 * Сборка в temp-копии без app/api (Windows часто не даёт переименовать api).
 *
 * Запуск: npm run android:build-ui
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const wwwDir = path.join(root, 'android-app', 'www')

const backendUrl = (process.env.KAKAPO_ANDROID_BACKEND || 'https://kakappo.shop/api/kakapo').replace(/\/$/, '')
const wsUrl = (process.env.KAKAPO_ANDROID_WS || 'wss://kakappo.shop').replace(/\/$/, '')

const SKIP_ROOT = new Set([
  'node_modules', '.next', 'out', 'android-app', 'desktop', '.git',
  'server', 'data', 'tmp', '.claude',
])

function run(cwd, cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (res.status !== 0) {
    console.error(`\n[android-ui] Команда прервалась: ${cmd} ${args.join(' ')}`)
    process.exit(res.status || 1)
  }
}

function copyTree(src, dest, { skipAppApi = false } = {}) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (SKIP_ROOT.has(name) && src === root) continue
    if (skipAppApi && name === 'api') continue
    const from = path.join(src, name)
    const to = path.join(dest, name)
    const st = statSync(from)
    if (st.isDirectory()) copyTree(from, to, { skipAppApi: false })
    else cpSync(from, to)
  }
}

const tmp = path.join(os.tmpdir(), 'kakapo-android-ui')
console.log('[android-ui] Копия проекта без app/api →', tmp)
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

for (const name of readdirSync(root)) {
  if (SKIP_ROOT.has(name)) continue
  const from = path.join(root, name)
  const to = path.join(tmp, name)
  const st = statSync(from)
  if (st.isDirectory()) {
    copyTree(from, to, { skipAppApi: name === 'app' })
  } else {
    cpSync(from, to)
  }
}

const nmSrc = path.join(root, 'node_modules')
const nmDst = path.join(tmp, 'node_modules')
if (existsSync(nmSrc) && !existsSync(nmDst)) {
  try {
    symlinkSync(nmSrc, nmDst, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    console.log('[android-ui] junction не вышел — копирую node_modules (долго)')
    cpSync(nmSrc, nmDst, { recursive: true })
  }
}

console.log('[android-ui] Сборка Next (export)…')
console.log(`[android-ui] API: ${backendUrl}`)
run(tmp, 'npx', ['next', 'build'], {
  KAKAPO_ANDROID_EXPORT: 'true',
  NODE_ENV: 'production',
  NEXT_PUBLIC_USE_API: 'true',
  NEXT_PUBLIC_TRADE_ANDROID: 'true',
  NEXT_PUBLIC_API_URL: backendUrl,
  KAKAPO_BACKEND_URL: backendUrl,
  NEXT_PUBLIC_WS_URL: wsUrl,
})

const outDir = path.join(tmp, 'out')
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
  <script>
    window.kakapoAndroid = true;
    var p = location.pathname || '';
    if (p === '/' || p === '/index.html' || p === '') {
      location.replace('/trade/index.html');
    }
  </script>
</head>
<body style="margin:0;background:#F3F7F4"></body>
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
