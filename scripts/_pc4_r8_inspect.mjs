/**
 * Quick REAL_CASHIER_8 inspect (LAB readonly). Electron ABI.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LAB = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8_LAB', 'kakapo.sqlite')
const SRC = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8', 'kakapo.sqlite')
const require = createRequire(path.join(ROOT, 'desktop', 'package.json'))
const Database = require('better-sqlite3')

function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase()
}

console.log('SRC', fs.statSync(SRC).size, sha(SRC))
console.log('LAB', fs.statSync(LAB).size, sha(LAB))

const db = new Database(LAB, { readonly: true, fileMustExist: true })
console.log('integrity', db.pragma('integrity_check', { simple: true }))
console.log('journal', db.pragma('journal_mode', { simple: true }))
console.log('queue', db.prepare('SELECT COUNT(*) AS n FROM queue').get().n)
const sample = db.prepare('SELECT client_ref, substr(payload,1,200) AS p FROM queue LIMIT 2').all()
console.log('sample', JSON.stringify(sample, null, 2))
const metaKeys = db.prepare('SELECT key FROM meta').all().map(r => r.key)
console.log('metaKeys', metaKeys.slice(0, 30))
const kvKeys = db.prepare('SELECT key FROM kv').all().map(r => r.key)
console.log('kvKeys sample', kvKeys.filter(k => /queue|sync|device|pos|client|card/i.test(k)).slice(0, 40))
for (const key of ['queue_seq', 'sync_cursor', 'trade_device_id', 'data_pos_snapshot']) {
  const m = db.prepare('SELECT value FROM meta WHERE key=?').get(key)
  const k = db.prepare('SELECT value FROM kv WHERE key=?').get(key)
  const v = m || k
  if (!v) { console.log(key, 'MISSING'); continue }
  const parsed = (() => { try { return JSON.parse(v.value) } catch { return v.value } })()
  if (key === 'data_pos_snapshot') {
    console.log(key, 'shifts', parsed?.shifts?.length, 'sales', parsed?.sales?.length)
  } else console.log(key, parsed)
}
db.close()
console.log('OK')
