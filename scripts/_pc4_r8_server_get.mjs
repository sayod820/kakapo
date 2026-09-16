/**
 * PC-4 GET-only server snapshot (system Node). Never POST.
 * Usage: node scripts/_pc4_r8_server_get.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'diag', 'REAL_CASHIER_8_server_get.json')
const API = 'https://kakappo.shop/api/kakapo'

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

const started = Date.now()
console.log('[get] fetching…')
const [sales, shifts, clients, receipts, cards] = await Promise.all([
  getJson(`${API}/pos/sales`),
  getJson(`${API}/pos/shifts`),
  getJson(`${API}/clients`),
  getJson(`${API}/stock/receipts`),
  getJson(`${API}/cards`),
])

const out = {
  fetchedAt: new Date().toISOString(),
  elapsedMs: Date.now() - started,
  method: 'GET_ONLY',
  PRODUCTION_SERVER_POSTS: 0,
  sales: Array.isArray(sales) ? sales : [],
  shifts: Array.isArray(shifts) ? shifts : [],
  clients: Array.isArray(clients) ? clients : [],
  receipts: Array.isArray(receipts) ? receipts : [],
  cards: Array.isArray(cards) ? cards : [],
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log('[get] wrote', OUT)
console.log('[get] counts', {
  sales: out.sales.length,
  shifts: out.shifts.length,
  open: out.shifts.filter(s => s.status === 'open').length,
  clients: out.clients.length,
  receipts: out.receipts.length,
  cards: out.cards.length,
  mb: (fs.statSync(OUT).size / 1e6).toFixed(1),
})
