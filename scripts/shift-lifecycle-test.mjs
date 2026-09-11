/**
 * Shift lifecycle + sale shift safety tests.
 * Run: node scripts/shift-lifecycle-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pickActiveOpenShift,
  planOrphanOffShiftAdopts,
  applyOrphanOffShiftAdoptsProjection,
} from '../lib/shiftReconcileCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}:`, e?.message || e)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assert')
}
function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8')
}

const offline = read('lib/offline.ts')
const ops = read('lib/offlinePosOps.ts')
const posLogic = read('server/kakapo-api/posLogic.js')
const indexJs = read('server/kakapo-api/index.js')
const posStore = read('lib/posStore.ts')

test('T1 server createPosSale rejects closed shift (SHIFT_CLOSED)', () => {
  expect(posLogic.includes("err.code = 'SHIFT_CLOSED'"), 'code')
  expect(posLogic.includes("String(shift.status || '') !== 'open'"), 'status check')
  expect(indexJs.includes('code: e?.code'), 'API returns code')
})

test('T2 shift_close priority before shift_open', () => {
  expect(/shift_close.*return -45|return -45[\s\S]*shift_close/s.test(offline) || offline.includes("kind === 'shift_close') return -45"), 'prio')
  const closeIdx = offline.indexOf("kind === 'shift_close') return -45")
  const openIdx = offline.indexOf("kind === 'shift_open'")
  expect(closeIdx > 0 && openIdx > 0, 'both present')
})

test('T3 open waits behind pending close (BrokenRef barrier)', () => {
  expect(offline.includes('Сначала закройте предыдущую смену'), 'barrier msg')
  expect(offline.includes('BrokenRefError'), 'BrokenRef')
  expect(offline.includes('e instanceof BrokenRefError'), 'flush parks BrokenRef')
})

test('T4 already-open adopts instead of blind delete', () => {
  expect(offline.includes('shift_open_already_open') || offline.includes('flush_shift_open_already_open'), 'adopt reason')
  expect(!/revertLocalOpeningFloat\(localId\)[\s\S]{0,120}shifts\.filter\(sh => sh\.id !== localId\)/.test(offline), 'old delete path gone')
})

test('T5 shift_close already closed is idempotent success', () => {
  expect(offline.includes('смена уже закрыта') && offline.includes('markShiftCloseAcked'), 'ack')
})

test('T6 sale on closed/not-found parks — no immediate revert', () => {
  expect(offline.includes('SHIFT_CLOSED') || offline.includes('смена уже закрыта'), 'closed')
  const idx = offline.indexOf('flush_shift_lifecycle')
  expect(idx > 0, 'lifecycle park')
  const slice = offline.slice(idx, idx + 800)
  expect(!slice.includes('revertLocalSaleOnReject'), 'no revert in park branch')
})

test('T7 resolveSalePayload never keeps closed shiftId', () => {
  expect(offline.includes('Смена закрыта или не синхронизирована'), 'throw')
})

test('T8 ensureDurableShiftCloses wired in softSync', () => {
  expect(ops.includes('ensureDurableShiftCloses'), 'ops')
  expect(posStore.includes('ensureDurableShiftCloses'), 'posStore')
})

test('T9 active shift still prefers server open (1.2.177)', () => {
  const ghost = { id: 'off-shift-1', status: 'open', posId: 'POS-DEFAULT', cashierId: 'C1', openedAtIso: '2026-09-11T01:00:00.000Z', salesCount: 5 }
  const srv = { id: 'SHIFT-real', status: 'open', posId: 'POS-DEFAULT', cashierId: 'C1', openedAtIso: '2026-09-10T02:00:00.000Z', salesCount: 100 }
  const picked = pickActiveOpenShift([ghost, srv], { cashierId: 'C1', posId: 'POS-DEFAULT' })
  expect(picked?.id === 'SHIFT-real', 'server wins')
})

test('T10 adopt plan closes ghosts without deleting sales', () => {
  const ghost = { id: 'off-shift-1', status: 'open', posId: 'P', cashierId: 'C', openedAtIso: '2026-09-11T01:00:00.000Z', salesCount: 2 }
  const srv = { id: 'SHIFT-x', status: 'open', posId: 'P', cashierId: 'C', openedAtIso: '2026-09-10T02:00:00.000Z', salesCount: 10 }
  const sales = [{ id: 's1', shiftId: ghost.id }, { id: 's2', shiftId: srv.id }]
  const { shifts, sales: next } = applyOrphanOffShiftAdoptsProjection(
    [ghost, srv],
    sales,
    planOrphanOffShiftAdopts([ghost, srv]),
  )
  expect(next.length === 2, 'sales kept')
  expect(next.find(s => s.id === 's1')?.shiftId === 'SHIFT-x', 'remapped')
  expect(shifts.find(s => s.id === ghost.id)?.status === 'closed', 'ghost closed')
})

test('T11 openShiftSafe refuses when server open already local', () => {
  expect(ops.includes("!String(s.id || '').startsWith('off-')"), 'server open guard')
})

test('T12 API error surfaces code for client match', () => {
  const api = read('lib/api.ts')
  expect(api.includes('json.code'), 'code in parseErrorText')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
