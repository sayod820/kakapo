// Проверка страниц магазина в браузере через CDP: текст, переполнение, ошибки консоли.
import fs from 'node:fs'

const PORT = process.env.KAKAPO_CDP_PORT || '9222'
const BASE = process.env.KAKAPO_BASE || 'http://localhost:3010'

const PAGES = [
  ['home', '/'],
  ['catalog', '/?p=catalog'],
  ['plist', '/?p=plist&cat=veg_fruit'],
  ['search', '/?p=search'],
  ['product', '/?p=product&id=3'],
  ['cart', '/?p=cart'],
  ['checkout', '/?p=checkout'],
  ['orders', '/?p=orders'],
  ['promos', '/?p=promos'],
  ['wishlist', '/?p=wishlist'],
  ['profile', '/?p=profile'],
  ['addresses', '/?p=addresses'],
  ['vip', '/?p=vip'],
  ['notifs', '/?p=notifs'],
  ['restaurants', '/?p=restaurants'],
  ['faq', '/?p=faq'],
  ['about', '/?p=about'],
  ['referral', '/?p=referral'],
  ['debts', '/?p=debts'],
  ['reviews', '/?p=reviews'],
  ['hot', '/?p=plist&cat=hot'],
]

async function cdp(targets, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(targets)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }))
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) { ws.close(); resolve(msg.result) }
    }
    ws.onerror = (e) => reject(new Error('ws error'))
  })
}

const listUrl = `http://127.0.0.1:${PORT}/json/list`
const res = await fetch(listUrl)
const tabs = await res.json()
const page = tabs.find(t => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const wsUrl = page.webSocketDebuggerUrl

async function send(method, params) {
  return cdp(wsUrl, method, params)
}

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

const out = []
for (const [name, path] of PAGES) {
  await send('Page.enable', {})
  await send('Page.navigate', { url: BASE + path })
  const r = await send('Runtime.evaluate', {
    expression: `new Promise(res=>setTimeout(()=>{
      const de=document.documentElement
      res(JSON.stringify({
        t:document.body.innerText.replace(/\\n+/g,' | ').slice(0,220),
        ov:de.scrollWidth-de.clientWidth,
        fixed:Array.from(document.querySelectorAll('*')).filter(e=>getComputedStyle(e).position==='fixed').map(e=>(e.className&&String(e.className).slice(0,40))||e.tagName),
        cards:document.querySelectorAll('.card,.store-row,.pc,.store-prod-grid > *').length,
      }))
    },2600))`,
    awaitPromise: true,
    returnByValue: true,
  })
  out.push({ name, path, ...JSON.parse(r.result.value) })
}

fs.writeFileSync('scripts/_k5-pages-report.json', JSON.stringify(out, null, 2))
for (const o of out) {
  console.log(`\n=== ${o.name}  (${o.path})`)
  console.log('  overflowX:', o.ov, ' fixed:', o.fixed.join(','))
  console.log('  text:', o.t)
}
