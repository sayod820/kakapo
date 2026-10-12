import fs from 'node:fs'

const FILE = 'components/store/StoreApp.tsx'
let src = fs.readFileSync(FILE, 'utf8')
const count = (re) => (src.match(re) || []).length

const before = {
  gdText: count(/(color\s*:\s*['"]?)var\(--gd\)(['"])/g),
  gdIcon: count(/c="var\(--gd\)"/g),
}

// Текст и иконки: жёлтый на белом не читается — уводим в нейтральный/тёмно-янтарный
src = src.replace(/(color\s*:\s*['"]?)var\(--gd\)(['"])/g, '$1var(--t2)$2')
src = src.replace(/c="var\(--gd\)"/g, 'c="var(--gd2)"')

const bulk = [
  ["'rgba(195,52,52,.1)'", "'var(--red-soft)'"],
  ['"rgba(195,52,52,.1)"', '"var(--red-soft)"'],
  ["'rgba(195,52,52,.3)'", "'rgba(195,52,52,.35)'"],
  ['"rgba(195,52,52,.3)"', '"rgba(195,52,52,.35)"'],
  ['"#C33434"', '"var(--red)"'],
  ["'#C33434'", "'var(--red)'"],
  ['rgba(7,136,61,.08)', 'var(--gr-soft)'],
  ["'rgba(233,174,0,.08)'", "'rgba(233,174,0,.14)'"],
  ['"rgba(233,174,0,.08)"', '"rgba(233,174,0,.14)"'],
  ['rgba(52,211,153,.18)', 'var(--gr-soft)'],
  ['rgba(52,211,153,.35)', 'rgba(7,136,61,.25)'],
  ['"#34D399"', '"var(--gr3)"'],
  ['rgba(7,136,61,.4)', 'var(--gr)'],
  ['rgba(7,136,61,.35)', 'rgba(7,136,61,.38)'],
  ['rgba(7,136,61,.28)', 'rgba(7,136,61,.3)'],
  ['rgba(23,37,27,.45)', 'var(--overlay)'],
  ['rgba(23,37,27,.28)', 'rgba(23,37,27,.35)'],
]
const applied = []
for (const [from, to] of bulk) {
  const n = src.split(from).length - 1
  if (n) { src = src.split(from).join(to); applied.push(`${n}× ${from} → ${to}`) }
}

fs.writeFileSync(FILE, src)
console.log('gd text tokens:', before.gdText, '→ var(--t2)')
console.log('gd icon tokens:', before.gdIcon, '→ var(--gd2)')
applied.forEach(a => console.log(a))
