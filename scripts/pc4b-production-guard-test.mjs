/**
 * PC-4B — production replay guard unit tests (no network, no sqlite).
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const guard = await import(pathToFileURL(path.join(ROOT, 'lib/recoveryProductionGuardCore.mjs')).href)
const adapter = await import(pathToFileURL(path.join(ROOT, 'lib/recoveryApiAdapterCore.mjs')).href)

let pass = 0
let fail = 0
function test(name, fn) {
  try {
    fn()
    pass++
    console.log('PASS ', name)
  } catch (e) {
    fail++
    console.error('FAIL ', name, e.message || e)
  }
}
function expect(c, m) { if (!c) throw new Error(m || 'expect') }

const PROD = 'https://kakappo.shop/api/kakapo'

test('1 default refuse production host without latch', () => {
  let err
  try { adapter.createRecoveryHttpAdapter({ baseUrl: PROD }) } catch (e) { err = e }
  expect(/REFUSE_PRODUCTION_HOST/.test(String(err)), String(err))
})

test('2 allowProductionHost alone still refuses without gate', () => {
  let err
  try {
    adapter.createRecoveryHttpAdapter({ baseUrl: PROD, allowProductionHost: true })
  } catch (e) { err = e }
  expect(/REFUSE_PRODUCTION_REPLAY/.test(String(err)), String(err))
})

test('3 env flag alone insufficient', () => {
  const g = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-x',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: null,
    baseUrl: PROD,
    envFlag: '1',
  })
  expect(!g.ok)
  expect(g.code === 'REFUSE_PRODUCTION_REPLAY')
})

test('4 all gates + token enables', () => {
  const token = guard.createOperatorEnableToken({ sessionId: 'RS-live', baseUrl: PROD })
  const g = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-live',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: token,
    baseUrl: PROD,
  })
  expect(g.ok, JSON.stringify(g))
  const api = adapter.createRecoveryHttpAdapter({
    baseUrl: PROD,
    allowProductionHost: true,
    productionReplayGate: g,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '[]' }),
  })
  expect(!!api.listOpenShifts)
})

test('5 non-allowlisted production-like host refused by gate', () => {
  const bad = 'https://evil.kakappo.shop/api/kakapo'
  const token = guard.createOperatorEnableToken({ sessionId: 'RS-live', baseUrl: bad })
  const g = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-live',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: token,
    baseUrl: bad,
  })
  expect(!g.ok)
  expect(g.fails.some(f => f === 'baseUrl_not_allowlisted'))
})

test('6 lab/mock host allowed without production gates', () => {
  const api = adapter.createRecoveryHttpAdapter({
    baseUrl: 'http://127.0.0.1:9',
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '[]' }),
  })
  expect(!!api.createPosSale)
})

console.log(`\nPC4B_GUARD pass=${pass} fail=${fail}`)
if (fail) process.exitCode = 1
