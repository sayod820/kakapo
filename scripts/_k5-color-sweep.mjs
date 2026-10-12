import fs from 'node:fs'

const FILE = 'components/store/StoreApp.tsx'
let src = fs.readFileSync(FILE, 'utf8')

// Порядок важен: сначала более длинные/специфичные подстроки.
const RULES = [
  // --- зелёный бренд ---
  [/rgba\(31,215,96,/g, 'rgba(7,136,61,'],
  [/#1FD760/g, '#07883D'],
  [/#17B34E/g, '#066F33'],
  [/#0F8A3A/g, '#055B2A'],
  [/#0F7A38/g, '#066F33'],
  // --- золото (VIP) ---
  [/rgba\(255,184,0,/g, 'rgba(233,174,0,'],
  [/rgba\(255,220,100,/g, 'rgba(138,100,0,'],
  [/#FFD700/g, '#E9AE00'],
  [/#FFB800/g, '#E0A400'],
  [/#E89E00/g, '#C98F00'],
  [/#B8860B/g, '#A97800'],
  [/#C9A227/g, '#A97800'],
  // --- красный / ошибки ---
  [/rgba\(255,69,69,/g, 'rgba(195,52,52,'],
  [/#FF4545/g, '#C33434'],
  [/#FF8080/g, '#C33434'],
  [/#FF9090/g, '#C33434'],
  [/#FF8C8C/g, '#C33434'],
  [/#FF6969/g, '#C33434'],
  [/#FF5A5A/g, '#C33434'],
  [/#D63031/g, '#C33434'],
  [/#CC2A2A/g, '#C33434'],
  [/rgba\(255,200,200,/g, 'rgba(195,52,52,'],
  [/rgba\(255,140,140,/g, 'rgba(195,52,52,'],
  // --- синий ---
  [/rgba\(59,142,240,/g, 'rgba(37,99,235,'],
  [/#3B8EF0/g, '#2563EB'],
  [/#29B6F6/g, '#0284C7'],
  [/#5B9CF5/g, '#2563EB'],
  [/rgba\(41,182,246,/g, 'rgba(2,132,199,'],
  // --- оранжевый ---
  [/rgba\(255,140,0,/g, 'rgba(194,65,12,'],
  [/rgba\(255,125,59,/g, 'rgba(194,65,12,'],
  [/#FF8C00/g, '#C2410C'],
  [/#FF7D3B/g, '#C2410C'],
  [/#EA580C/g, '#C2410C'],
  // --- фиолетовый / бирюза ---
  [/rgba\(155,109,255,/g, 'rgba(124,58,237,'],
  [/#9B6DFF/g, '#7C3AED'],
  [/rgba\(0,212,200,/g, 'rgba(14,116,144,'],
  [/#00D4C8/g, '#0E7490'],
  // --- тёмные тени/оверлеи -> нейтральный зелёно-тёмный ---
  [/rgba\(0,0,0,/g, 'rgba(23,37,27,'],
  // --- тёмные подложки заголовков -> светлые ---
  [/rgba\(10,8,2,\.97\)/g, 'var(--header-bg)'],
  [/rgba\(10,8,2,\.96\)/g, 'var(--header-bg)'],
  [/rgba\(3,11,5,\.96\)/g, 'var(--header-bg)'],
  [/rgba\(6,16,10,\.72\)/g, 'var(--fab-bg)'],
  [/rgba\(38,24,0,\.96\)/g, 'var(--header-bg)'],
  [/rgba\(86,56,0,\.92\)/g, 'var(--header-bg)'],
  [/rgba\(30,18,0,\.96\)/g, 'var(--header-bg)'],
  // --- тёмный текст на золоте -> тёмно-коричневый ---
  [/#1a1000/g, '#3A2A00'],
  [/#1A1000/g, '#3A2A00'],
]

let total = 0
for (const [re, to] of RULES) {
  const before = src
  src = src.replace(re, to)
  const n = (before.match(re) || []).length
  if (n) { total += n; console.log(String(n).padStart(5), re.toString(), '->', to) }
}
fs.writeFileSync(FILE, src)
console.log('\nTOTAL replacements:', total)
