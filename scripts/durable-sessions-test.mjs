/**
 * Step 5: API sessions survive restart (write-through backend, hashed tokens).
 * Run: node scripts/durable-sessions-test.mjs
 */
import {
  createSession,
  getSession,
  revokeSession,
  setSessionBackend,
  loadPersistedSessions,
  hashSessionToken,
  _clearAllSessionsForTests,
} from '../server/kakapo-api/apiAuth.js'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok', name) } else { fail++; console.log('  FAIL', name) }
}

const store = new Map()
const backend = {
  save(hash, row) { const { token: _t, ...rest } = row; store.set(hash, JSON.parse(JSON.stringify(rest))) },
  remove(hash) { store.delete(hash) },
}
const restart = () => {
  setSessionBackend(null)
  _clearAllSessionsForTests()
  loadPersistedSessions([...store.entries()].map(([hash, data]) => ({ hash, data })))
  setSessionBackend(backend)
}

setSessionBackend(backend)
const cashier = createSession({ principal: 'CASHIER', subjectId: 'EMP-1', permissions: ['sales'], deviceId: 'dev-1', name: 'Али' })
const admin = createSession({ principal: 'ADMIN', subjectId: 'ADM' })

ok(store.size === 2, 'every login is written to the durable store')
ok(![...store.keys()].includes(cashier.token) && store.has(hashSessionToken(cashier.token)), 'store key is sha256(token), not the token')
ok(!JSON.stringify([...store.values()]).includes(cashier.token), 'raw token never stored')

restart()
const back = getSession(cashier.token)
ok(!!back && back.subjectId === 'EMP-1' && back.caps.includes('SALE_CREATE'), 'cashier session valid after restart (caps kept)')
ok(back?.token === cashier.token, 'restored session exposes token to request handlers')
ok(getSession(admin.token)?.principal === 'ADMIN', 'admin session valid after restart')
ok(getSession('cashier_forged') === null, 'unknown token rejected')

revokeSession(admin.token)
ok(!store.has(hashSessionToken(admin.token)), 'logout removes durable row')
restart()
ok(getSession(admin.token) === null, 'revoked session stays revoked after restart')

const short = createSession({ principal: 'STAFF', subjectId: 'S', ttlMs: 5 })
await new Promise(r => setTimeout(r, 20))
restart()
ok(getSession(short.token) === null, 'expired session not restored')

ok(loadPersistedSessions([{ hash: 'x' }, { data: {} }, null]) === 0, 'broken rows ignored')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
