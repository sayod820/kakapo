/**
 * Смена открывается только на вошедшего сотрудника (сервер + касса).
 * node scripts/shift-owner-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShiftOpenOwner, isShiftHandoverOnSameTill } from '../server/kakapo-api/onlineO8Handlers.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
function expect(ok, name) {
  if (ok) { pass++; console.log('  PASS', name) } else { fail++; console.log('  FAIL', name) }
}

const db = {
  employees: [
    { id: 'EMP-A', name: 'Гафуров Сайёд', active: true },
    { id: 'EMP-B', name: 'Бухориева Мадина', active: true },
    { id: 'EMP-OFF', name: 'Уволенный Иван', active: false },
  ],
  cashiers: [
    { id: 'C-A', name: 'Гафуров Сайёд' },
    { id: 'C-A-dup', name: 'Гафуров Сайёд', mergedInto: 'C-A' },
    { id: 'C-B', name: 'Бухориева Мадина' },
    { id: 'C-OFF', name: 'Уволенный Иван' },
    { id: 'C-T', name: 'Тестовый кассир' },
  ],
}
const req = (subjectId, body, principal = 'STAFF') => ({ auth: { principal, subjectId }, body })

console.log('--- server checkShiftOpenOwner')
expect(checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-A', cashierName: 'Гафуров Сайёд' })).ok, 'A opens on self')
expect(checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-A-dup', cashierName: 'гафуров  сайед' })).ok, 'A opens via merged dup id / ё-е / spaces')
expect(!checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-B', cashierName: 'Бухориева Мадина' })).ok, 'A cannot open on B')
expect(!checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-B', cashierName: 'Гафуров Сайёд' })).ok, 'A cannot open on B id with own name')
expect(!checkShiftOpenOwner(db, req('EMP-B', { cashierId: 'C-A' }, 'CASHIER')).ok, 'CASHIER B cannot open on A')
expect(checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-OFF' })).ok, 'inactive employee name not protected')
expect(checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-T', cashierName: 'Тестовый кассир' })).ok, 'non-employee cashier allowed (test labs)')
expect(checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-B', openedAtIso: '2026-10-01T05:00:00Z' })).ok, 'offline replay skipped')
expect(checkShiftOpenOwner(db, { auth: { principal: 'ADMIN', subjectId: 'x' }, body: { cashierId: 'C-B' } }).ok, 'admin not restricted')
expect(checkShiftOpenOwner(db, { auth: null, body: { cashierId: 'C-B' } }).ok, 'no auth → other gates decide')
expect(checkShiftOpenOwner(db, req('EMP-UNKNOWN', { cashierId: 'C-B' })).ok, 'unknown employee → other gates decide')
const denied = checkShiftOpenOwner(db, req('EMP-A', { cashierId: 'C-B' }))
expect(/только на себя/.test(denied.detail || ''), 'denial message')

console.log('--- server isShiftHandoverOnSameTill')
const tillDb = {
  posPoints: [
    { id: 'POS-1', active: true, devices: [{ id: 'DEV-1' }] },
    { id: 'POS-2', active: true, devices: [{ id: 'DEV-2' }] },
  ],
  revokedPosDevices: [{ id: 'DEV-OLD' }],
}
const shift1 = { id: 'S1', posId: 'POS-1' }
const dreq = (auth) => ({ auth })
expect(isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'STAFF', subjectId: 'EMP-B', deviceAuth: true, deviceId: 'DEV-1' }), shift1), 'B on same till may close A shift')
expect(isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'CASHIER', subjectId: 'EMP-B', deviceAuth: true, deviceId: 'DEV-1' }), shift1), 'CASHIER on same till')
expect(!isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'STAFF', subjectId: 'EMP-B', deviceAuth: true, deviceId: 'DEV-2' }), shift1), 'other till cannot')
expect(!isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'STAFF', subjectId: 'EMP-B', deviceId: 'DEV-1' }), shift1), 'login token (no device key) cannot')
expect(!isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'DEVICE', subjectId: 'DEV-1', deviceAuth: true, deviceId: 'DEV-1' }), shift1), 'device without employee cannot')
expect(!isShiftHandoverOnSameTill({ ...tillDb, revokedPosDevices: [{ id: 'DEV-1' }] }, dreq({ principal: 'STAFF', deviceAuth: true, deviceId: 'DEV-1' }), shift1), 'revoked device cannot')
expect(!isShiftHandoverOnSameTill(tillDb, dreq({ principal: 'STAFF', deviceAuth: true, deviceId: 'DEV-1' }), { id: 'S0' }), 'shift without pos cannot')
const handlersSrc = fs.readFileSync(path.join(root, 'server/kakapo-api/onlineO8Handlers.js'), 'utf8')
const closeFn = handlersSrc.slice(handlersSrc.indexOf('export async function handleO8ShiftClose'))
expect(/!isShiftHandoverOnSameTill\(db, req, existing\)[\s\S]{0,400}AUTH_SHIFT_OWNER/.test(closeFn.slice(0, 2500)), 'close owner check skipped only for same-till handover')

console.log('--- handler wiring')
const handlers = fs.readFileSync(path.join(root, 'server/kakapo-api/onlineO8Handlers.js'), 'utf8')
const openFn = handlers.slice(handlers.indexOf('export async function handleO8ShiftOpen'))
expect(/checkShiftOpenOwner\(db, req\)[\s\S]{0,200}SHIFT_EMPLOYEE_MISMATCH/.test(openFn.slice(0, 1200)), 'handleO8ShiftOpen calls owner gate before tx')
expect(openFn.indexOf('checkShiftOpenOwner') < openFn.indexOf('runO8Tx'), 'gate runs before runO8Tx')

console.log('--- kassa CashierModule')
const cm = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
const openShiftFn = cm.slice(cm.indexOf('async function openShift()'), cm.indexOf('async function openShift()') + 3000)
expect(/sessionEmployeeName\s*\n?\s*\? await ensureCashier\(sessionEmployeeName/.test(openShiftFn), 'open shift uses logged-in employee')
const sw = cm.slice(cm.indexOf('async function switchCashier()'), cm.indexOf('function openCashierScreen('))
expect(/const accepting = shiftOwnedByOther/.test(sw), 'switch: accept vs handover by owner')
expect(/!accepting && cartsHaveItems/.test(sw), 'handover blocked with open carts')
expect(/saveShiftHandoverCash\(cash\)[\s\S]{0,1100}onLogout\?\.\(\)/.test(sw), 'handover saves cash then logs out')
expect(/saveShiftHandoverCash\(cash\)[\s\S]{0,500}await useOfflineSync\.getState\(\)\.flushShiftCloseBeforeLogout\(/.test(sw), 'offline close flushed before logout')
expect(/ensureCashier\(sessionEmployeeName, sessionCashierOpt\?\.id\)/.test(sw), 'accept opens on logged-in employee')
expect(!/switchCashierId/.test(cm), 'no free cashier picker on switch')
for (const fn of ['async function submitSale(', 'async function submitTillMove()', 'async function executeReturnConfirm()', 'async function submitTopup()', 'async function submitDebtRepay()']) {
  const i = cm.indexOf(fn)
  expect(i > 0 && /blockIfShiftNotMine\(\)/.test(cm.slice(i, i + 900)), `${fn} guarded`)
}
expect(/shiftOwnedByOther && !cashierScreen &&[\s\S]{0,400}Смена другого кассира/.test(cm), 'register overlay for other cashier shift')
expect(/useState\(\(\) => takeShiftHandoverCash\(\) \?\? '0\.00'\)/.test(cm), 'handover cash prefilled for next cashier')
const ta = fs.readFileSync(path.join(root, 'components/trade/TradeApp.tsx'), 'utf8')
expect(/<CashierModule[\s\S]{0,700}onLogout=\{onLogout\}/.test(ta), 'TradeApp passes onLogout')

console.log('--- offline queue while logged out')
const off = fs.readFileSync(path.join(root, 'lib/offline.ts'), 'utf8')
const flushFn = off.slice(off.indexOf('export async function flushQueue('), off.indexOf('export async function flushQueue(') + 600)
expect(/if \(tradeQueueWaitsForLogin\(\)\) return \{ sent: 0, failed: 0, stopped: true/.test(flushFn), 'flushQueue pauses while nobody logged in')
expect(/function tradeQueueWaitsForLogin\(\)[\s\S]{0,500}!loadTradeEmployeeSession\(\)\?\.employeeId/.test(off), 'pause = trade context without employee session')
const cls = await import('../lib/outboxErrorClassifierCore.mjs')
const e403 = Object.assign(new Error('Недостаточно прав'), { status: 403, code: 'AUTH_FORBIDDEN' })
expect(cls.classifyOutboxError('sale', e403).class === 'RETRYABLE', 'sale 403 AUTH_FORBIDDEN retried automatically')

console.log('--- shift_open barrier: no deadlock with close of the same shift')
const barrierFn = off.slice(off.indexOf('export function shiftCloseBlocksOpen('), off.indexOf('class BrokenRefError'))
expect(/closedShiftId === String\(open\.localId\)\) return false/.test(barrierFn), 'close of the same shift never blocks its open')
expect(/return cs < os/.test(barrierFn), 'only earlier closes block an open')
expect(/pending\.find\(r => shiftCloseBlocksOpen\(r, row\)\)/.test(off), 'shift_open uses the barrier helper')
{
  const ts = await import('typescript').catch(() => null)
  if (ts) {
    const js = ts.transpileModule(`${barrierFn}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    const mod = await import(`data:text/javascript,${encodeURIComponent(js)}`)
    const openA = { kind: 'shift_open', clientRef: 'oa', seq: 10, localId: 'off-shift-A', createdAtIso: '2026-10-01T10:08:00Z', payload: {} }
    const closeA = { kind: 'shift_close', clientRef: 'ca', seq: 20, createdAtIso: '2026-10-01T10:35:00Z', payload: { shiftId: 'off-shift-A' } }
    const openB = { kind: 'shift_open', clientRef: 'ob', seq: 21, localId: 'off-shift-B', createdAtIso: '2026-10-01T10:35:01Z', payload: {} }
    const closeOld = { kind: 'shift_close', clientRef: 'co', seq: 5, createdAtIso: '2026-10-01T09:00:00Z', payload: { shiftId: 'SHIFT-old' } }
    expect(!mod.shiftCloseBlocksOpen(closeA, openA), 'Madina 15:08 open not blocked by her own 15:35 close')
    expect(mod.shiftCloseBlocksOpen(closeA, openB), '15:35 open waits for 15:35 close of previous shift')
    expect(mod.shiftCloseBlocksOpen(closeOld, openA), 'earlier close of another shift still blocks')
    expect(!mod.shiftCloseBlocksOpen({ ...closeA, seq: 0, createdAtIso: '2026-10-01T11:00:00Z', payload: { shiftId: 'X' } }, { ...openA, seq: 0 }), 'later close (by time) does not block')
  } else {
    expect(false, 'typescript available for barrier logic test')
  }
}

console.log('--- queue goes by itself on handover')
const os = fs.readFileSync(path.join(root, 'lib/offlineSync.ts'), 'utf8')
expect(/flushShiftCloseBeforeLogout\(10_000\)/.test(sw), 'handover waits for the close itself, not a syncNow that may return early')
expect(/flushShiftCloseBeforeLogout: async[\s\S]{0,600}syncLock \|\| get\(\)\.syncing[\s\S]{0,300}await get\(\)\.flush\(\)/.test(os), 'waits for running sync, then flushes directly')
expect(/kickAfterLogin: \(\) => \{[\s\S]{0,200}lastStuckFingerprint = ''[\s\S]{0,120}scheduleReconnect\(get, set, 300\)/.test(os), 'login resets stuck pause and sends at once')
expect(/saveTradeEmployeeSession\(s\)\s*\n\s*setSession\(s\)\s*\n\s*useOfflineSync\.getState\(\)\.kickAfterLogin\(\)/.test(ta), 'login screen kicks the queue')

console.log('--- password after shift close / on kassa start')
const simpleCloseFn = cm.slice(cm.indexOf('async function closeShift()'), cm.indexOf('function applyShiftReconcile()'))
expect(/closed\.offline[\s\S]{0,200}flushShiftCloseBeforeLogout\(10_000\)/.test(simpleCloseFn), 'simple close sends the offline close before logout')
expect(/sessionStorage\.setItem\(LOGIN_NOTICE_KEY[\s\S]{0,200}onLogout\(\)/.test(simpleCloseFn), 'simple close logs out with a notice')
expect(/if \(saved && isKakapoDesktop\(\)\)[\s\S]{0,600}desktopSessionKeepsOpenShift\(saved\)[\s\S]{0,300}else clearTradeEmployeeSession\(\)/.test(ta), 'desktop start keeps session only with own open shift')
expect(/!ready \|\| localDbReady === null \|\| !sessionChecked/.test(ta), 'no auto-login before the start check finishes')
expect(!/^\s*setSession\(loadTradeEmployeeSession\(\)\)/m.test(ta), 'session is not restored unconditionally')

console.log('--- cashier create does not wait for full snapshot flush')
const idx = fs.readFileSync(path.join(root, 'server/kakapo-api/index.js'), 'utf8')
const cashierRoutes = idx.slice(idx.indexOf('async function saveMasterRows('), idx.indexOf("app.patch('/cashiers/:id'") + 600)
expect(/docs: \[plainDoc\('cashiers', row\)\]/.test(cashierRoutes), 'cashier row written alone')
expect(/_txCommittedAt: _t, \.\.\.data/.test(cashierRoutes), 'row written without stale tx stamp')
const empRoutes = idx.slice(idx.indexOf("app.post('/employees'"), idx.indexOf("app.delete('/employees/:id'") + 1200)
expect(/app\.patch\('\/employees\/:id', async[\s\S]{0,400}saveMasterRows\(res, 'employee_update'[\s\S]{0,400}docs: \[\.\.\.employeeDocs\(req\.params\.id\), \.\.\.\(cashier \? \[plainDoc\('cashiers', cashier\)\] : \[\]\)\]/.test(empRoutes), 'admin employee save writes only its rows (employee + linked cashier)')
expect(/saveMasterRows\(res, 'employee_create'/.test(empRoutes), 'employee create (no clientRef) writes one row')
expect(/saveMasterRows\(res, 'employee_delete'[\s\S]{0,200}deletes: \[\{ collection: 'employees'/.test(empRoutes), 'employee delete removes one row')
expect(!/persist\(\)/.test(empRoutes.slice(empRoutes.indexOf("app.patch('/employees/:id'"))), 'no full snapshot persist in employee update/delete')
expect(/markResponseEphemeral\(res\)/.test(cashierRoutes), 'response skips full snapshot flush')
expect(/app\.post\('\/cashiers', async[\s\S]{0,200}saveCashierRow\(res, 'cashier_upsert'/.test(cashierRoutes), 'POST /cashiers uses row write')
expect(/app\.patch\('\/cashiers\/:id', async[\s\S]{0,200}saveCashierRow\(res, 'cashier_update'/.test(cashierRoutes), 'PATCH /cashiers uses row write')

console.log(`\nshift-owner: ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
