import fs from 'node:fs'

const src = fs.readFileSync('components/store/StoreApp.tsx', 'utf8')

const hex = new Map()
for (const m of src.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
  const k = '#' + m[1]
  hex.set(k, (hex.get(k) || 0) + 1)
}
const rgba = new Map()
for (const m of src.matchAll(/rgba?\(([^)]+)\)/g)) {
  const k = m[0].replace(/\s+/g, '')
  rgba.set(k, (rgba.get(k) || 0) + 1)
}

const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])

console.log('=== HEX (count, value) ===')
for (const [k, v] of sortDesc(hex)) console.log(String(v).padStart(4), k)
console.log('\n=== rgba/rgb (count, value) ===')
for (const [k, v] of sortDesc(rgba)) console.log(String(v).padStart(4), k)
