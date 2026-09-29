/**
 * Вход/выход не должны ждать полного снимка базы перед ответом
 * (иначе админ видит «Сервер не отвечает», пока идёт flush 50k+ документов).
 * Изменение данных (например PATCH клиента) по-прежнему ждёт снимок.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { installDurableHttpResponse } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/durableHttpResponse.js')).href)

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`) }
}

let mw = null
installDurableHttpResponse({ use: fn => { mw = fn } })

function sentImmediately(method, reqPath) {
  let sent = false
  const res = { locals: {}, statusCode: 200, headersSent: false, json: () => { sent = true }, send() {}, end() {} }
  mw({ method, path: reqPath }, res, () => {})
  res.json({ ok: true })
  return sent
}

check('POST /auth/login отвечает сразу', sentImmediately('POST', '/auth/login'))
check('POST /auth/logout отвечает сразу', sentImmediately('POST', '/auth/logout'))
check('POST /employees/login отвечает сразу', sentImmediately('POST', '/employees/login'))
check('PATCH /clients/:id ждёт снимок', !sentImmediately('PATCH', '/clients/U-1'))
check('PATCH /auth/admin (смена пароля) ждёт снимок', !sentImmediately('PATCH', '/auth/admin'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
