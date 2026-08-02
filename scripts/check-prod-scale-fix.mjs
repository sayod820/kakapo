const base = 'https://kakappo.shop'
const path = '/_next/static/chunks/200.ff5b832f51bf3328.js'
const body = await fetch(base + path).then((r) => r.text())

const markers = [
  'SCALE_BARCODE_PREFIX',
  'startsWith("21")',
  "startsWith('21')",
  'itemCodeRaw',
  'digits[0]',
  'length!==13',
  'length!=13',
]
for (const m of markers) {
  const i = body.indexOf(m)
  console.log(m, i)
  if (i >= 0) console.log(body.slice(i - 100, i + 180))
  console.log('---')
}

// find function that checks length 13 and starts with
const re = /function\s+\w*\([^)]*\)\{[^}]{0,40}replace\(\/\\D\/g[^}]{0,200}13[^}]{0,300}\}/g
const m = body.match(/replace\(\/\\D\/g,?""\)[^;]{0,80}13[\s\S]{0,400}startsWith\([^)]+\)/)
console.log('fn match', m ? m[0].slice(0, 500) : null)

const m2 = body.match(/replace\(\/\\D\/g[^)]*\)[\s\S]{0,120}(?:length|length)[\s\S]{0,80}(?:21|startsWith|\(0\))[\s\S]{0,200}/)
console.log('m2', m2 ? m2[0].slice(0, 600) : null)
