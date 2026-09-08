/**
 * Статическая сборка клиентского магазина в store-android/www.
 * Запуск: npm run store:android:build-ui
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
const wwwDir = path.join(root, 'store-android', 'www')

const backendUrl = (process.env.KAKAPO_ANDROID_BACKEND || 'https://kakappo.shop/api/kakapo').replace(/\/$/, '')
const wsUrl = (process.env.KAKAPO_ANDROID_WS || 'wss://kakappo.shop').replace(/\/$/, '')

const SKIP_ROOT = new Set([
  'node_modules', '.next', 'out', 'android-app', 'store-android', 'desktop', '.git',
  'server', 'data', 'tmp', '.claude', '.gradle-local',
])

function run(cwd, cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (res.status !== 0) {
    console.error(`\n[store-android-ui] Команда прервалась: ${cmd} ${args.join(' ')}`)
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

const tmp = path.join(os.tmpdir(), 'kakapo-store-android-ui')
console.log('[store-android-ui] Копия проекта без app/api →', tmp)
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
    console.log('[store-android-ui] junction не вышел — копирую node_modules')
    cpSync(nmSrc, nmDst, { recursive: true })
  }
}

console.log('[store-android-ui] Сборка Next (export)…')
console.log(`[store-android-ui] API: ${backendUrl}`)
run(tmp, 'npx', ['next', 'build'], {
  KAKAPO_ANDROID_EXPORT: 'true',
  NODE_ENV: 'production',
  NEXT_PUBLIC_USE_API: 'true',
  NEXT_PUBLIC_STORE_ANDROID: 'true',
  NEXT_PUBLIC_API_URL: backendUrl,
  KAKAPO_BACKEND_URL: backendUrl,
  NEXT_PUBLIC_WS_URL: wsUrl,
})

const outDir = path.join(tmp, 'out')
if (!existsSync(outDir)) {
  console.error('[store-android-ui] папка out не создана')
  process.exit(1)
}

console.log('[store-android-ui] Копирование в store-android/www…')
rmSync(wwwDir, { recursive: true, force: true })
mkdirSync(wwwDir, { recursive: true })
cpSync(outDir, wwwDir, { recursive: true })

// Корень export уже магазин (/). Подстрахуем index.
writeFileSync(
  path.join(wwwDir, 'build-info.json'),
  `${JSON.stringify({
    app: 'store',
    builtAtIso: new Date().toISOString(),
    backendUrl,
    wsUrl,
  }, null, 2)}\n`,
  'utf8',
)

console.log('[store-android-ui] Готово: store-android/www → магазин /')
