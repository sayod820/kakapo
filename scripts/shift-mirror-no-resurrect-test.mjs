/**
 * Desktop boot: SQLite shift mirror (written at sale time, status open) must not
 * reopen shifts already closed in the snapshot — касса утром показывала «Принять смену»
 * по вчерашним закрытым сменам.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-mirror-'))
const src = fs.readFileSync(path.join(root, 'lib', 'localSaleAtomic.ts'), 'utf8')
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText.replace(/from '\.\/([\w]+)'/g, "from './$1.mjs'").replace(/import\('\.\/([\w]+)'\)/g, "import('./$1.mjs')")
fs.writeFileSync(path.join(dir, 'localSaleAtomic.mjs'), js)
fs.writeFileSync(path.join(dir, 'desktopBridge.mjs'), `
export const isKakapoDesktop = () => true
export const getKakapoDesktop = () => globalThis.__desk
`)
fs.writeFileSync(path.join(dir, 'devTelemetry.mjs'), 'export const isPerfEnabled = () => false; export const perfNote = () => {}')
fs.writeFileSync(path.join(dir, 'posStore.mjs'), `
let state = { sales: [], shifts: [] }
export const usePosStore = {
  getState: () => state,
  setState: fn => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } },
}
`)
fs.writeFileSync(path.join(dir, 'offline.mjs'), `
export const isShiftCloseAcked = async id => (globalThis.__acked || []).includes(id)
export const getPending = async () => globalThis.__pending || []
`)

const mod = await import(pathToFileURL(path.join(dir, 'localSaleAtomic.mjs')).href)
const { usePosStore } = await import(pathToFileURL(path.join(dir, 'posStore.mjs')).href)

let pass = 0
let fail = 0
async function test(name, fn) {
  try { await fn(); pass += 1; console.log('PASS ', name) } catch (e) { fail += 1; console.log('FAIL ', name, '—', e.message) }
}
function expect(cond, msg) { if (!cond) throw new Error(msg) }

function setup({ shifts, mirrors, acked = [] }) {
  usePosStore.setState({ sales: [], shifts })
  globalThis.__acked = acked
  globalThis.__pending = []
  globalThis.__desk = {
    localDbMirrorList: async kind => (kind === 'shift' ? mirrors.map(m => ({ id: m.id, data: m })) : []),
    localDbMirrorGet: async () => null,
  }
  if (typeof mod.canAtomicLocalSaleCommit === 'function') {
    globalThis.__desk.localDbSaleCommit = async () => ({})
  }
}
const statusOf = id => usePosStore.getState().shifts.find(s => s.id === id)?.status

const closed = (id, cashier, openedAtIso, salesCount) => ({
  id, posId: 'POS-DEFAULT', cashierName: cashier, status: 'closed', openedAtIso,
  closedAtIso: '2026-10-01T12:00:00Z', salesCount, actualCash: 100,
})
const mirrorOpen = (id, cashier, openedAtIso, salesCount, extra = {}) => ({
  id, posId: 'POS-DEFAULT', cashierName: cashier, status: 'open', openedAtIso, salesCount, ...extra,
})

await test('closed shift in snapshot stays closed when mirror says open (same count)', async () => {
  setup({
    shifts: [
      closed('SHIFT-mupgjjqx', 'Мадина', '2026-10-01T11:32:33Z', 7),
      closed('SHIFT-mupfryz2', 'Гафуров', '2026-10-01T11:09:45Z', 9),
    ],
    mirrors: [
      mirrorOpen('SHIFT-mupgjjqx', 'Мадина', '2026-10-01T11:32:33Z', 7),
      mirrorOpen('SHIFT-mupfryz2', 'Гафуров', '2026-10-01T11:09:45Z', 9),
    ],
  })
  await mod.reconcileLocalSalesFromDurables()
  expect(statusOf('SHIFT-mupgjjqx') === 'closed', 'mupgjjqx reopened')
  expect(statusOf('SHIFT-mupfryz2') === 'closed', 'mupfryz2 reopened')
})

await test('open shift still takes newer mirror counters (crash recovery kept)', async () => {
  setup({
    shifts: [{ id: 'SHIFT-a', posId: 'POS-DEFAULT', status: 'open', openedAtIso: '2026-10-02T02:38:00Z', salesCount: 3, salesCash: 10 }],
    mirrors: [mirrorOpen('SHIFT-a', 'Гафуров', '2026-10-02T02:38:00Z', 4, { salesCash: 15 })],
  })
  await mod.reconcileLocalSalesFromDurables()
  const sh = usePosStore.getState().shifts.find(s => s.id === 'SHIFT-a')
  expect(sh.salesCount === 4 && sh.salesCash === 15, 'counters not merged')
})

await test('mirror-only open shift older than a known shift is not added', async () => {
  setup({
    shifts: [closed('SHIFT-new', 'Гафуров', '2026-10-01T11:58:44Z', 84)],
    mirrors: [mirrorOpen('SHIFT-old', 'Мадина', '2026-10-01T11:32:33Z', 7)],
  })
  await mod.reconcileLocalSalesFromDurables()
  expect(!statusOf('SHIFT-old'), 'stale mirror shift was added')
})

await test('mirror-only open shift with close acked is not added', async () => {
  setup({ shifts: [], mirrors: [mirrorOpen('SHIFT-x', 'Мадина', '2026-10-01T11:32:33Z', 7)], acked: ['SHIFT-x'] })
  await mod.reconcileLocalSalesFromDurables()
  expect(!statusOf('SHIFT-x'), 'acked-closed shift was added')
})

await test('off-* mirror already remapped (same clientRef) is not added', async () => {
  setup({
    shifts: [closed('SHIFT-srv', 'Мадина', '2026-10-01T11:32:33Z', 7)].map(s => ({ ...s, clientRef: 'cr-1' })),
    mirrors: [mirrorOpen('off-shift-1', 'Мадина', '2026-10-01T11:32:33Z', 7, { clientRef: 'cr-1' })],
  })
  await mod.reconcileLocalSalesFromDurables()
  expect(!statusOf('off-shift-1'), 'remapped off- shift was added')
})

await test('fresh mirror-only open shift (crash before snapshot) is still restored', async () => {
  setup({
    shifts: [closed('SHIFT-yday', 'Гафуров', '2026-10-01T11:58:44Z', 84)],
    mirrors: [mirrorOpen('off-shift-today', 'Гафуров', '2026-10-02T02:38:25Z', 1)],
  })
  await mod.reconcileLocalSalesFromDurables()
  expect(statusOf('off-shift-today') === 'open', 'fresh shift not restored')
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
