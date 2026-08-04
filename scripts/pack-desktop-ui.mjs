/**
 * Упаковка desktop/ui → publish-ui-out/ для офлайн-синка кассы.
 *
 * Касса качает:
 *   https://kakappo.shop/updates/kassa-ui/latest.json
 *   + zip из поля url
 *
 * Запуск (после desktop:build-ui):
 *   node scripts/pack-desktop-ui.mjs
 *
 * Затем залить publish-ui-out/ на сервер в:
 *   DATA_DIR/updates/kassa-ui/
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const uiDir = path.join(root, 'desktop', 'ui')
const outDir = path.join(root, 'desktop', 'publish-ui-out')

function fail(msg) {
  console.error(`[pack-desktop-ui] ${msg}`)
  process.exit(1)
}

if (!existsSync(path.join(uiDir, 'server.js'))) {
  fail(`Нет ${uiDir}/server.js — сначала: npm run desktop:build-ui`)
}

let version = ''
try {
  version = readFileSync(path.join(uiDir, '.next', 'BUILD_ID'), 'utf8').trim()
} catch { /* ignore */ }
if (!version) {
  try {
    const info = JSON.parse(readFileSync(path.join(uiDir, 'build-info.json'), 'utf8'))
    version = String(info.builtAtIso || Date.now())
  } catch {
    version = `ui-${Date.now()}`
  }
}

const safeName = version.replace(/[^\w.-]+/g, '_').slice(0, 80)
const zipName = `ui-${safeName}.zip`
const zipPath = path.join(outDir, zipName)

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

console.log(`[pack-desktop-ui] Архивация ${uiDir} → ${zipName}`)
const pack = spawnSync('tar', ['-a', '-cf', zipPath, '-C', uiDir, '.'], {
  stdio: 'inherit',
  windowsHide: true,
})
if (pack.status !== 0 || !existsSync(zipPath)) {
  fail('tar не смог создать zip (нужен tar из Windows 10+)')
}

const publicBase = (process.env.KAKAPO_PUBLIC_ORIGIN || 'https://kakappo.shop').replace(/\/$/, '')
const latest = {
  version,
  url: `${publicBase}/updates/kassa-ui/${zipName}`,
  builtAt: new Date().toISOString(),
}

writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`, 'utf8')

const readme = `KAKAPO — офлайн UI для кассы (без полной переустановки)

1. Залейте ВСЕ файлы из этой папки на сервер:
   DATA_DIR/updates/kassa-ui/
   (на Hetzner часто /data/updates/kassa-ui)

2. Проверьте:
   ${publicBase}/updates/kassa-ui/latest.json

3. В кассе (новая версия Electron): меню → «Синхронизировать офлайн-интерфейс»
   или просто откройте кассу онлайн — синк идёт сам.

Файлы:
- latest.json
- ${zipName}
`

writeFileSync(path.join(outDir, 'README.txt'), readme, 'utf8')

console.log(`[pack-desktop-ui] Готово: ${outDir}`)
console.log(`  version=${version}`)
for (const f of readdirSync(outDir)) console.log(`  - ${f}`)
console.log(`Залейте publish-ui-out/ → DATA_DIR/updates/kassa-ui/`)
