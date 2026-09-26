/**
 * Офлайн-вход кассы: сервер хранит bcrypt, касса сверяет SHA-256 (offlinePinHash).
 * Run: node scripts/employee-offline-login-test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createEmployee, loginEmployee, listEmployeesLocalAuth } from '../server/kakapo-api/employeesLogic.js'
import { hashPassword } from '../server/kakapo-api/passwordHash.js'

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
expect(String(la.passwordHash || '').startsWith('$2'), 'server passwordHash is bcrypt')
expect(client.isOfflinePasswordHash(la.offlinePinHash), 'server offlinePinHash is SHA-256 hex')

console.log('kassa cache from server')
const [cached] = await client.mergeServerAuthRows([la], [])
expect(cached.passwordHash === la.offlinePinHash, 'kassa takes offlinePinHash, not bcrypt')
expect(await client.employeePasswordMatches('4321', cached), 'offline login with right password')
expect(!(await client.employeePasswordMatches('1111', cached)), 'wrong password rejected')

console.log('bcrypt only (old employee without offlinePinHash)')
const bcryptOnly = { ...la, offlinePinHash: null }
const [noPin] = await client.mergeServerAuthRows([bcryptOnly], [])
expect(noPin.passwordHash === '', 'bcrypt never stored as local hash')
const localHash = await client.hashEmployeePassword('4321')
const [kept] = await client.mergeServerAuthRows([bcryptOnly], [{ id: la.id, passwordHash: localHash }])
expect(kept.passwordHash === localHash, 'local hash from last online login is kept')
expect(await client.employeePasswordMatches('4321', kept), 'offline login still works')
const [bad] = await client.mergeServerAuthRows([bcryptOnly], [{ id: la.id, passwordHash: la.passwordHash }])
expect(bad.passwordHash === '', 'old cached bcrypt is dropped')
expect(!(await client.employeePasswordMatches('4321', { passwordHash: la.passwordHash })), 'bcrypt hash never matches locally')

console.log('online login backfills offlinePinHash')
row().offlinePinHash = undefined
row().passwordHash = hashPassword('4321')
loginEmployee(db, { id: emp.id, password: '4321' })
expect(row().offlinePinHash === localHash, 'login sets offlinePinHash = kassa hash')
let threw = false
try { loginEmployee(db, { id: emp.id, password: '0000' }) } catch { threw = true }
expect(threw && row().offlinePinHash === localHash, 'failed login does not touch offlinePinHash')

console.log(`\nemployee offline login: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
