import fs from 'node:fs'

const FILE = 'components/store/StoreApp.tsx'
let src = fs.readFileSync(FILE, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'

// 1) Включить уже заложенный светлый вариант во всех страницах магазина
const n1 = (src.match(/const light = false/g) || []).length
src = src.replace(/const light = false/g, 'const light = true')
console.log('light = true switched:', n1)

// 2) Читаемый акцент категории на светлом фоне (правки построчно, без зависимости от переводов строк)
const a = "  const c = base.color.startsWith('var(') ? '#129B45' : base.color"
const b = [
  "  const c = base.color.startsWith('var(') ? '#07883D' : base.color",
  "  // Светлые акценты на белом нечитаемы — затемняем оттенок для текста.",
  "  const ink = `color-mix(in srgb, ${c} 58%, #17251B)`",
].join(EOL)
if (!src.includes(a)) throw new Error('catThemeForMode: accent line not found')
src = src.replace(a, b)

const a2 = '    bg: `linear-gradient(145deg, color-mix(in srgb, ${c} 18%, #FFFFFF), color-mix(in srgb, ${c} 8%, #F3F7F4))`,'
const b2 = '    bg: `linear-gradient(145deg, color-mix(in srgb, ${c} 20%, #FFFFFF), color-mix(in srgb, ${c} 9%, #F6F7F5))`,'
if (!src.includes(a2)) throw new Error('catThemeForMode: bg line not found')
src = src.replace(a2, b2)

const a3 = '    color: c,' + EOL + '  }' + EOL + '}'
const b3 = '    color: ink,' + EOL + '  }' + EOL + '}'
if (!src.includes(a3)) throw new Error('catThemeForMode: color line not found')
src = src.replace(a3, b3)

// 3) Мягкие поверхности акцентов тоже на новом фоне
src = src.replace(
  /return `linear-gradient\(135deg, color-mix\(in srgb, \$\{c\} 16%, #FFFFFF\), color-mix\(in srgb, \$\{c\} 7%, #F3F7F4\)\)`/g,
  'return `linear-gradient(135deg, color-mix(in srgb, ${c} 18%, #FFFFFF), color-mix(in srgb, ${c} 8%, #F6F7F5))`',
)
src = src.replace(/#129B45/g, '#07883D')
console.log('catThemeForMode light branch updated')

fs.writeFileSync(FILE, src)
console.log('written')
