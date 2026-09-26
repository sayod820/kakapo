/**
 * Офлайн-вход кассы: сервер хранит bcrypt, касса сверяет SHA-256 (offlinePinHash).
 * Run: node scripts/employee-offline-login-test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  createEmployee,
  updateEmployee,
  loginEmployee,
  listEmployeesLocalAuth,
  migrateEmployeeCredentials,
  employeesAuthRev,
} from '../server/kakapo-api/employeesLogic.js'
import { hashPassword, checkOfflineVerifier } from '../server/kakapo-api/passwordHash.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
function expect(cond, name) {
  if (cond) { passed++; console.log(`  OK   ${name}`) } else { failed++; console.error(`  FAIL ${name}`) }
}

async function loadClient() {
  const src = fs.readFileSync(path.join(root, 'lib/employeePassword.ts'), 'utf8')
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
  const file = path.join(os.tmpdir(), `employeePassword-${process.pid}.mjs`)
  fs.writeFileSync(file, out.outputText)
  return import(pathToFileURL(file).href)
}

const client = await loadClient()
const db = { employees: [] }
const emp = createEmployee(db, { name: 'Тест Кассир', password: '4321', role: 'cashier' })
const row = () => db.employees.find(e => e.id === emp.id)

console.log('server rows')
const [la] = listEmployeesLocalAuth(db)
expect(String(row().passwordHash || '').startsWith('$2'), 'server stores bcrypt')
expect(!la.passwordHash, 'local-auth does not ship bcrypt to devices')
expect(client.isOfflinePasswordHash(la.offlinePinHash), 'server offlinePinHash is SHA-256 hex')
expect(client.isOfflineVerifier(la.offlineVerifier), 'server ships PBKDF2 offlineVerifier')

console.log('kassa cache from server')
const [cached] = await client.mergeServerAuthRows([la], [])
expect(cached.passwordHash === la.offlinePinHash, 'kassa takes offlinePinHash, not bcrypt')
expect(await client.employeePasswordMatches('4321', cached), 'offline login with right password')
expect(!(await client.employeePasswordMatches('1111', cached)), 'wrong password rejected')

expect(cached.offlineVerifier === la.offlineVerifier, 'kassa keeps offlineVerifier')

console.log('PBKDF2 verifier')
expect(checkOfflineVerifier('4321', la.offlineVerifier), 'server checks its own verifier')
expect(await client.employeePasswordMatches('4321', { offlineVerifier: la.offlineVerifier }), 'kassa WebCrypto matches server PBKDF2')
expect(!(await client.employeePasswordMatches('4322', { offlineVerifier: la.offlineVerifier })), 'kassa rejects wrong password via verifier')
const twin = createEmployee(db, { name: 'Близнец', password: '4321', role: 'cashier' })
const twinRow = db.employees.find(e => e.id === twin.id)
expect(twinRow.offlineVerifier !== row().offlineVerifier, 'same password → different salt/verifier')
const stalePinHash = await client.hashEmployeePassword('9999')
expect(!(await client.employeePasswordMatches('9999', { offlineVerifier: la.offlineVerifier, passwordHash: stalePinHash })),
  'verifier wins over stale SHA')

console.log('password change / block reach the kassa')
const rev0 = employeesAuthRev(db)
expect(rev0 === employeesAuthRev(db), 'rev stable without changes')
updateEmployee(db, emp.id, { password: '5555' })
const rev1 = employeesAuthRev(db)
expect(rev1 !== rev0, 'rev changes on password change')
const afterChange = await client.mergeServerAuthRows(listEmployeesLocalAuth(db), [cached])
const mine = afterChange.find(r => r.id === emp.id)
expect(await client.employeePasswordMatches('5555', mine), 'new password works offline after sync')
expect(!(await client.employeePasswordMatches('4321', mine)), 'old password stops working after sync')
updateEmployee(db, twin.id, { active: false })
expect(employeesAuthRev(db) !== rev1, 'rev changes when employee blocked')
const afterBlock = await client.mergeServerAuthRows(listEmployeesLocalAuth(db), afterChange)
expect(!afterBlock.some(r => r.id === twin.id), 'blocked employee removed from kassa cache')
updateEmployee(db, emp.id, { password: '4321' })

console.log('legacy plaintext migrated on startup')
const legacyDb = { employees: [{ id: 'EMP-OLD', name: 'Старый', role: 'cashier', permissions: ['sales'], active: true, password: 'abcd1234' }] }
expect(migrateEmployeeCredentials(legacyDb) === 1, 'one legacy row migrated')
const old = legacyDb.employees[0]
expect(!('password' in old) && String(old.passwordHash).startsWith('$2'), 'plaintext removed, bcrypt set')
const [oldLa] = listEmployeesLocalAuth(legacyDb)
expect(await client.employeePasswordMatches('abcd1234', (await client.mergeServerAuthRows([oldLa], []))[0]),
  'legacy employee can log in offline right after migration')
expect(migrateEmployeeCredentials(legacyDb) === 0, 'migration is idempotent')
expect(loginEmployee(legacyDb, { id: 'EMP-OLD', password: 'abcd1234' }).id === 'EMP-OLD', 'online login still works after migration')

console.log('offline credential presence')
expect(!client.hasOfflineCredential({ passwordHash: '', offlineVerifier: '' }), 'no credential detected')
expect(client.hasOfflineCredential({ offlineVerifier: la.offlineVerifier }), 'verifier counts as credential')

console.log('bcrypt only (old employee without offlinePinHash)')
const bcryptOnly = { ...la, passwordHash: row().passwordHash, offlinePinHash: null, offlineVerifier: null }
const [noPin] = await client.mergeServerAuthRows([bcryptOnly], [])
expect(noPin.passwordHash === '', 'bcrypt never stored as local hash')
const localHash = await client.hashEmployeePassword('4321')
const [kept] = await client.mergeServerAuthRows([bcryptOnly], [{ id: la.id, passwordHash: localHash }])
expect(kept.passwordHash === localHash, 'local hash from last online login is kept')
expect(await client.employeePasswordMatches('4321', kept), 'offline login still works')
const [bad] = await client.mergeServerAuthRows([bcryptOnly], [{ id: la.id, passwordHash: bcryptOnly.passwordHash }])
expect(bad.passwordHash === '', 'old cached bcrypt is dropped')
expect(!(await client.employeePasswordMatches('4321', { passwordHash: bcryptOnly.passwordHash })), 'bcrypt hash never matches locally')

console.log('online login backfills offline credentials')
row().offlinePinHash = undefined
row().offlineVerifier = undefined
row().passwordHash = hashPassword('4321')
loginEmployee(db, { id: emp.id, password: '4321' })
expect(row().offlinePinHash === localHash, 'login sets offlinePinHash = kassa hash')
expect(checkOfflineVerifier('4321', row().offlineVerifier), 'login sets offlineVerifier')
const verAfterLogin = row().offlineVerifier
loginEmployee(db, { id: emp.id, password: '4321' })
expect(row().offlineVerifier === verAfterLogin, 'repeat login keeps the same verifier (rev stable)')
let threw = false
try { loginEmployee(db, { id: emp.id, password: '0000' }) } catch { threw = true }
expect(threw && row().offlinePinHash === localHash && row().offlineVerifier === verAfterLogin,
  'failed login does not touch offline credentials')

console.log(`\nemployee offline login: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
