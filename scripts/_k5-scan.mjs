import fs from 'node:fs'

const FILE = process.argv[2] || 'components/store/StoreApp.tsx'
const s = fs.readFileSync(FILE, 'utf8')
const lines = s.split(/\r?\n/)

const pats = [
  ['dark hex #0x-#3x', /#[0-3][0-9A-Fa-f]{5}/g],
  ['white alpha', /rgba\(255,\s*255,\s*255/g],
  ['black alpha', /rgba\(0,\s*0,\s*0/g],
  ['gr gradient', /linear-gradient\(135deg,\s*var\(--gr2\)/g],
  ['dark rgba', /rgba\([1-6]\d?,\s*[1-6]\d?,\s*[1-6]\d?\s*,/g],
  ['emoji tile', /fontSize:\s*3[0-9]/g],
]

for (const [n, p] of pats) {
  const m = s.match(p)
  console.log(n, m ? m.length : 0)
}

console.log('---')
// Столбцы: строка -> список компонентов, в которых встречаются тёмные цвета
const compLine = []
let cur = null
lines.forEach((l, i) => {
  const m = /^(?:const|function) ([A-Za-z0-9_]+)\s*(?:=|\()/.exec(l)
  if (m) cur = { name: m[1], line: i + 1 }
  compLine.push(cur ? { ...cur } : null)
})
const hits = new Map()
lines.forEach((l, i) => {
  if (/rgba\(255,\s*255,\s*255/.test(l) || /#[0-3][0-9A-Fa-f]{5}/.test(l) || /rgba\(0,\s*0,\s*0/.test(l)) {
    const c = compLine[i]
    const key = c ? c.name : '<root>'
    hits.set(key, (hits.get(key) || 0) + 1)
  }
})
console.log('dark-ish occurrences per component:')
;[...hits.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k))
