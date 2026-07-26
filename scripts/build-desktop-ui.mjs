/**
 * Сборка интерфейса «Торговли» внутрь десктоп-приложения.
 *
 * Next собирается в режиме standalone и складывается в desktop/ui.
 * Electron поднимает эту сборку локально, поэтому касса открывается
 * даже без интернета, а запросы к API идут через тот же rewrite
 * /api/kakapo/* — значит CORS не нужен и код фронтенда не меняется.
 *
 * Запуск: npm run desktop:build-ui
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const uiDir = path.join(root, 'desktop', 'ui')

const backendUrl = (process.env.KAKAPO_DESKTOP_BACKEND || 'https://kakappo.shop/api/kakapo').replace(/\/$/, '')
const wsUrl = (process.env.KAKAPO_DESKTOP_WS || 'wss://kakappo.shop').replace(/\/$/, '')

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (res.status !== 0) {
    console.error(`\n[desktop-ui] Команда прервалась: ${cmd} ${args.join(' ')}`)
    process.exit(res.status || 1)
  }
}

console.log('[desktop-ui] Сборка Next (standalone)…')
console.log(`[desktop-ui] API: ${backendUrl}`)
console.log(`[desktop-ui] WS:  ${wsUrl}`)

run('npx', ['next', 'build'], {
  KAKAPO_STANDALONE: 'true',
  NODE_ENV: 'production',
  NEXT_PUBLIC_USE_API: 'true',
  KAKAPO_BACKEND_URL: backendUrl,
  NEXT_PUBLIC_WS_URL: wsUrl,
})

const standaloneDir = path.join(root, '.next', 'standalone')
if (!existsSync(standaloneDir)) {
  console.error('[desktop-ui] .next/standalone не создан — проверьте next.config.js')
  process.exit(1)
}

console.log('[desktop-ui] Копирование сборки в desktop/ui…')
rmSync(uiDir, { recursive: true, force: true })
mkdirSync(uiDir, { recursive: true })

cpSync(standaloneDir, uiDir, { recursive: true })
cpSync(path.join(root, '.next', 'static'), path.join(uiDir, '.next', 'static'), { recursive: true })
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(uiDir, 'public'), { recursive: true })
}

writeFileSync(
  path.join(uiDir, 'build-info.json'),
  `${JSON.stringify({ builtAtIso: new Date().toISOString(), backendUrl, wsUrl }, null, 2)}\n`,
  'utf8',
)

console.log('[desktop-ui] Готово: desktop/ui')
