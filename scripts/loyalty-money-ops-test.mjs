/**
 * Форма «Лояльность карты»: PATCH клиента/карты без долга и бонусов,
 * долг и бонусы — отдельными операциями (debt-adjustments / bonus-adjustments).
 * Раньше форма слала debt/bonus в PATCH → сервер всегда отвечал 400.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import { ensureSchema, closePool, isPostgresEnabled } from '../server/kakapo-api/pg/client.js'
import { cleanupOnlineTestPrefixes, bootstrapTestLabCashVault } from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'LOYM-'

let passed = 0
let failed = 0
function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, init) {
  try {
    const res = await fetch(url, init)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { detail: String(e?.message || e) } }
  }
}

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: {
        ...process.env,
        PORT: String(port),
        KAKAPO_O8_TEST_API: '1',
        KAKAPO_LAB_AUTO_AUTH: '0',
        KAKAPO_AUTH_ENFORCE: '1',
        KAKAPO_LEGACY_POS_WRITE: '0',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    ;(async () => {
      const t0 = Date.now()
      while (Date.now() - t0 < 45000) {
        const r = await fetchJson(`${base}/health`)
        if (r.ok && r.body?.ok) return resolve({ child, base })
        await sleep(250)
      }
      try { child.kill('SIGKILL') } catch { /* */ }
      reject(new Error(`API failed: ${stderr.slice(-1200)}`))
    })()
  })
}

const cref = (tag) => `${PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const JSON_H = { 'Content-Type': 'application/json' }

console.log('\n=== LOYALTY MONEY OPS ===')
if (!isPostgresEnabled()) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
await cleanupOnlineTestPrefixes([PREFIX])
const api = await startApi(19300 + Math.floor(Math.random() * 80))

try {
  await bootstrapTestLabCashVault()
  const login = await fetchJson(`${api.base}/auth/login`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  })
  expect(login.ok && login.body?.access_token, 'admin login')
  const H = { ...JSON_H, Authorization: `Bearer ${login.body?.access_token}` }
  const B = api.base
  const post = (p, body) => fetchJson(`${B}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const patch = (p, body) => fetchJson(`${B}${p}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) })

  const phone = `+99290${String(Date.now()).slice(-7)}`
  const cl = await post('/clients', { name: `${PREFIX}Клиент`, phone, clientRef: cref('client') })
  expect(cl.ok && cl.body?.id, `client created (${cl.status} ${cl.body?.detail || ''})`)
  const clientId = cl.body?.id
  const num = `${PREFIX}${Date.now()}`
  const card = await post('/cards/ensure', { num, clientRef: cref('card') })
  expect(card.ok, `card ensured (${card.status} ${card.body?.detail || ''})`)

  console.log('\n--- старый запрос формы (с долгом/бонусом) ---')
  const oldLink = await patch(`/clients/${clientId}`, {
    card: num, name: `${PREFIX}Клиент`, phone, debt: 50, bonus: 10, level: 'basic', clientRef: cref('old-link'),
  })
  expect(oldLink.status === 400 && oldLink.body?.code === 'CRM_FINANCIAL_PATCH_FORBIDDEN', `old link body → 400 (${oldLink.status} ${oldLink.body?.code || ''})`)
  const oldCard = await patch(`/cards/${encodeURIComponent(num)}`, { debt: 50, bonus: 10 })
  expect(oldCard.status === 400, `old card body → 400 (${oldCard.status} ${oldCard.body?.code || ''})`)

  console.log('\n--- новый порядок: привязка → долг → карта → бонусы ---')
  const link = await patch(`/clients/${clientId}`, {
    card: num, name: `${PREFIX}Клиент`, phone, level: 'basic', vip: false, debtLimit: 500, clientRef: cref('link'),
  })
  expect(link.ok, `link without money (${link.status} ${link.body?.detail || ''})`)

  const debtRef = cref('debt')
  const debt = await post(`/clients/${clientId}/debt-adjustments`, { targetDebt: 50, reason: 'Ручная правка долга', clientRef: debtRef })
  expect(debt.ok && Number(debt.body?.nextDebt) === 50, `debt-adjustment 0 → 50 (${debt.status} ${debt.body?.detail || ''})`)
  const debtReplay = await post(`/clients/${clientId}/debt-adjustments`, { targetDebt: 50, reason: 'Ручная правка долга', clientRef: debtRef })
  expect(debtReplay.ok && debtReplay.body?.duplicate === true, 'повтор из очереди не проводит долг второй раз')

  const cardPatch = await patch(`/cards/${encodeURIComponent(num)}`, {
    phone, client: `${PREFIX}Клиент`, clientId, status: 'active', level: 'basic', vip: false,
    debtEnabled: true, debtLimit: 500, allowBonusDecrease: true, clientRef: cref('card-patch'),
  })
  expect(cardPatch.ok, `card PATCH without money (${cardPatch.status} ${cardPatch.body?.detail || ''})`)

  const bonus = await post(`/cards/${encodeURIComponent(num)}/bonus-adjustments`, { targetBonus: 12, clientRef: cref('bonus') })
  expect(bonus.ok && Number(bonus.body?.nextBonus) === 12, `bonus-adjustment 0 → 12 (${bonus.status} ${bonus.body?.detail || ''})`)

  const cards = await fetchJson(`${B}/cards`, { headers: H })
  const row = (cards.body || []).find(c => String(c.num).toUpperCase() === num.toUpperCase())
  expect(row && Number(row.debt) === 50 && Number(row.bonus) === 12, `card now debt 50, bonus 12 (${row?.debt}/${row?.bonus})`)
  const clients = await fetchJson(`${B}/clients`, { headers: H })
  const crow = (clients.body || []).find(c => c.id === clientId)
  expect(crow && Number(crow.debt) === 50 && String(crow.card).toUpperCase() === num.toUpperCase(), `client linked, debt 50 (${crow?.debt} ${crow?.card})`)

  console.log('\n--- списать долг и выключить раздел долга ---')
  const debt0 = await post(`/clients/${clientId}/debt-adjustments`, { targetDebt: 0, clientRef: cref('debt0') })
  expect(debt0.ok && Number(debt0.body?.nextDebt) === 0, `debt-adjustment 50 → 0 (${debt0.status})`)
  const off = await patch(`/cards/${encodeURIComponent(num)}`, { debtEnabled: false, clientRef: cref('off') })
  expect(off.ok, `debtEnabled off after debt cleared (${off.status} ${off.body?.detail || ''})`)
} finally {
  try { api.child.kill('SIGKILL') } catch { /* */ }
  await cleanupOnlineTestPrefixes([PREFIX]).catch(() => {})
  await closePool().catch(() => {})
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
