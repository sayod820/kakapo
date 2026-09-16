/**
 * Browser adopt server-open POS shift — unit tests A–F (no production I/O).
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const require = createRequire(import.meta.url)

const {
  mergeServerShiftsAuthoritative,
  needsServerOpenShiftAdopt,
} = await import('../lib/browserAdoptServerOpenShiftCore.mjs')

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', err: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}
function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

const SERVER_OPEN = {
  id: 'SHIFT-mu41otyn-aid26',
  status: 'open',
  posId: 'POS-DEFAULT',
  cashierId: 'CASHIER-mu41otk4-1pudx',
  cashierName: 'Гафуров Сайёд',
  salesCount: 0,
  salesCash: 0,
  openedAtIso: '2026-09-16T10:00:00.000Z',
  clientRef: 'ece8f552-9288-4276-89bf-d8bc7b90e0c6',
}

// A) local empty + server open → merge adopts
test('A) local empty + server open → browser projection has open', () => {
  const merged = mergeServerShiftsAuthoritative([], [SERVER_OPEN])
  expect(merged.some(s => s.id === SERVER_OPEN.id && s.status === 'open'), 'open present')
  expect(needsServerOpenShiftAdopt([], [SERVER_OPEN], 'POS-DEFAULT'), 'needs adopt')
})

// B) local closed/stale + server open → server wins
test('B) local closed/missing open + server open → server wins', () => {
  const local = [{
    id: 'SHIFT-old-closed',
    status: 'closed',
    posId: 'POS-DEFAULT',
    cashierId: 'CASHIER-other',
    openedAtIso: '2026-09-15T10:00:00.000Z',
  }]
  const merged = mergeServerShiftsAuthoritative(local, [SERVER_OPEN])
  const open = merged.find(s => s.status === 'open' && !String(s.id).startsWith('off-'))
  expect(open?.id === SERVER_OPEN.id, 'server open wins')
  expect(needsServerOpenShiftAdopt(local, [SERVER_OPEN], 'POS-DEFAULT'), 'needs adopt')
})

// B2) local wrongly closed same id → server open restores
test('B2) local same id closed + server open → status open', () => {
  const local = [{ ...SERVER_OPEN, status: 'closed', closedAtIso: '2026-09-16T12:00:00.000Z' }]
  const merged = mergeServerShiftsAuthoritative(local, [SERVER_OPEN])
  const row = merged.find(s => s.id === SERVER_OPEN.id)
  expect(row?.status === 'open', 'status restored to open')
})

// C) server no open → no adopt needed
test('C) server has no open → Новая сессия path (no adopt)', () => {
  const local = [{ id: 'SHIFT-x', status: 'closed', posId: 'POS-DEFAULT' }]
  const server = [{ id: 'SHIFT-x', status: 'closed', posId: 'POS-DEFAULT' }]
  expect(!needsServerOpenShiftAdopt(local, server, 'POS-DEFAULT'), 'no adopt')
  const merged = mergeServerShiftsAuthoritative(local, server)
  expect(!merged.some(s => s.status === 'open'), 'no open')
})

// D) refresh preserves same open id
test('D) re-merge preserves same open shift id', () => {
  const once = mergeServerShiftsAuthoritative([], [SERVER_OPEN])
  const twice = mergeServerShiftsAuthoritative(once, [SERVER_OPEN])
  expect(twice.filter(s => s.id === SERVER_OPEN.id).length === 1, 'single row')
  expect(twice.find(s => s.id === SERVER_OPEN.id)?.status === 'open', 'still open')
})

// E) wiring: no duplicate POST when server open (openShiftSafe adopts)
test('E) openShiftSafe adopts server open (no throw / no duplicate POST path)', () => {
  const ops = read('lib/offlinePosOps.ts')
  expect(ops.includes('adoptServerOpenShiftsBrowser'), 'calls adopt')
  expect(ops.includes('findAdoptedOpenShiftForPos'), 'returns adopted')
  expect(ops.includes("return { data: adopted, offline: false }"), 'returns existing')
})

// F) no duplicate cashier creation on adopt path
test('F) adopt path does not create cashier; CashierModule guards Новая сессия', () => {
  const adopt = read('lib/browserAdoptServerOpenShift.ts')
  expect(!/ensureCashier|createCashier|postCashier/i.test(adopt), 'no cashier create in adopt')
  const cash = read('components/trade/CashierModule.tsx')
  expect(cash.includes('requestNewSession'), 'new session guard')
  expect(cash.includes('adoptServerOpenShiftsBrowser'), 'startup/guard adopt')
  expect(cash.includes("reason: 'cashier_startup'"), 'startup')
  expect(cash.includes("reason: 'new_session_click'"), 'click guard')
})

// Soft-sync empty delta adopts in browser
test('softSync empty-delta calls browser adopt', () => {
  const pos = read('lib/posStore.ts')
  expect(pos.includes('softSync_empty_delta'), 'empty delta reason')
  expect(pos.includes('isBrowserOnlineShiftAdoptEnabled'), 'browser gate')
})

// Ghost off-* closed when server open present
test('off-* ghost open closed when server open for same POS', () => {
  const local = [{
    id: 'off-shift-ghost',
    status: 'open',
    posId: 'POS-DEFAULT',
    cashierId: 'CASHIER-local',
    openedAtIso: '2026-09-16T11:00:00.000Z',
  }]
  const merged = mergeServerShiftsAuthoritative(local, [SERVER_OPEN])
  const ghost = merged.find(s => s.id === 'off-shift-ghost')
  expect(ghost?.status === 'closed', 'ghost closed')
  expect(merged.some(s => s.id === SERVER_OPEN.id && s.status === 'open'), 'server open kept')
})

// Desktop local-first gate in façade
test('façade gated to browser online only', () => {
  const ts = read('lib/browserAdoptServerOpenShift.ts')
  expect(ts.includes('isTradeLocalFirst()'), 'desktop skip')
  expect(ts.includes('USE_API'), 'api gate')
  expect(ts.includes('api.getPosShifts'), 'GET /pos/shifts')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
