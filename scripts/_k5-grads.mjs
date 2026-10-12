import fs from 'node:fs'
const s = fs.readFileSync('components/store/StoreApp.tsx', 'utf8')
const set = new Map()
for (const m of s.matchAll(/linear-gradient\([^"'`]*\)/g)) set.set(m[0], (set.get(m[0]) || 0) + 1)
;[...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(String(v).padStart(3), k))
console.log('--- shadows')
const sh = new Map()
for (const m of s.matchAll(/boxShadow:\s*"[^"]*"/g)) sh.set(m[0], (sh.get(m[0]) || 0) + 1)
;[...sh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(String(v).padStart(3), k))
