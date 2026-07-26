/**
 * Готовит папку desktop/publish-out для заливки на сервер:
 *   latest.yml + KAKAPO-Kassa-Setup-*.exe
 *
 * Использование:
 *   npm run desktop:dist
 *   npm run publish-out --prefix desktop
 * Затем скопируйте содержимое desktop/publish-out/ на сервер в:
 *   DATA_DIR/updates/kassa/   (часто /data/updates/kassa)
 * URL: https://kakappo.shop/updates/kassa/
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distDir = join(root, 'desktop', 'dist')
const outDir = join(root, 'desktop', 'publish-out')

function fail(msg) {
  console.error(`[publish-desktop-update] ${msg}`)
  process.exit(1)
}

if (!existsSync(distDir)) {
  fail(`Нет папки ${distDir}. Сначала: npm run desktop:dist`)
}

const files = readdirSync(distDir)
const latestYml = files.find(f => f === 'latest.yml')
const setupExe = files
  .filter(f => /^KAKAPO-Kassa-Setup-.*\.exe$/i.test(f) && !f.endsWith('.blockmap'))
  .sort()
  .at(-1)

if (!latestYml) fail('В dist/ нет latest.yml — проверьте publish в desktop/package.json')
if (!setupExe) fail('В dist/ нет KAKAPO-Kassa-Setup-*.exe')

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

copyFileSync(join(distDir, latestYml), join(outDir, latestYml))
copyFileSync(join(distDir, setupExe), join(outDir, setupExe))

const blockmap = `${setupExe}.blockmap`
if (existsSync(join(distDir, blockmap))) {
  copyFileSync(join(distDir, blockmap), join(outDir, blockmap))
}

const readme = `KAKAPO Касса — пакет обновления

1. Залейте ВСЕ файлы из этой папки на сервер в каталог:
   DATA_DIR/updates/kassa/
   (на Hetzner обычно /data/updates/kassa)

2. Проверьте в браузере:
   https://kakappo.shop/updates/kassa/latest.yml

3. На кассах: Настройки → Обновления → Проверить / Скачать и установить

Файлы:
- ${latestYml}
- ${setupExe}
${existsSync(join(outDir, blockmap)) ? `- ${blockmap}` : ''}
`

writeFileSync(join(outDir, 'README.txt'), readme, 'utf8')

console.log(`[publish-desktop-update] Готово: ${outDir}`)
console.log(`  - ${latestYml}`)
console.log(`  - ${setupExe}`)
if (existsSync(join(outDir, blockmap))) console.log(`  - ${blockmap}`)
console.log('Залейте содержимое publish-out/ → DATA_DIR/updates/kassa/ на сервере')
