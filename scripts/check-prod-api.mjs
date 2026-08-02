const base = 'https://kakappo.shop'
const html = await fetch(base + '/trade').then((r) => r.text())
console.log(html.slice(0, 1500))
console.log('---')
for (const path of ['/health', '/api/health', '/products', '/api/products']) {
  try {
    const r = await fetch(base + path)
    const t = await r.text()
    console.log(path, r.status, t.slice(0, 120).replace(/\s+/g, ' '))
  } catch (e) {
    console.log(path, e.message)
  }
}
