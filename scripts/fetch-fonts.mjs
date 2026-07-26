/**
 * Скачивает шрифты Google в public/fonts и генерирует app/fonts.css.
 *
 * Нужно для офлайна: касса открывается без интернета, а @import с
 * fonts.googleapis.com в этот момент не грузится и текст «прыгает».
 *
 * Запуск: node scripts/fetch-fonts.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const outDir = path.join(root, 'public', 'fonts')

const CSS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Unbounded:wght@400;500;600;700;800;900' +
  '&family=Nunito:wght@400;500;600;700;800;900' +
  '&family=JetBrains+Mono:wght@500;600;700;800' +
  '&display=swap'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
if (!res.ok) {
  console.error('[fonts] Google вернул', res.status)
  process.exit(1)
}
let css = await res.text()

mkdirSync(outDir, { recursive: true })

const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map(m => m[1]))]
console.log(`[fonts] файлов: ${urls.length}`)

let index = 0
for (const url of urls) {
  const family = (css.slice(0, css.indexOf(url)).match(/font-family:\s*'([^']+)'/g) || []).pop()
  const name = String(family || 'font')
    .replace(/font-family:\s*'/, '')
    .replace(/'$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  const file = `${name}-${String(++index).padStart(2, '0')}.woff2`
  const bin = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!bin.ok) {
    console.error('[fonts] не скачался', url, bin.status)
    process.exit(1)
  }
  writeFileSync(path.join(outDir, file), Buffer.from(await bin.arrayBuffer()))
  css = css.split(url).join(`/fonts/${file}`)
  console.log('[fonts]', file)
}

writeFileSync(
  path.join(root, 'app', 'fonts.css'),
  `/* Сгенерировано scripts/fetch-fonts.mjs — шрифты лежат локально, работают без интернета */\n${css}`,
  'utf8',
)

console.log('[fonts] Готово: public/fonts + app/fonts.css')
