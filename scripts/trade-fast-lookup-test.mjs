/**
 * lib/fastLookup.ts must return exactly what the linear scans it replaced return.
 * Randomized comparison against the original expressions + wiring checks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

let passed = 0
let failed = 0
function expect(ok, name) {
  if (ok) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  FAIL ${name}`) }
}

function extractFn(src, name) {
  const start = src.indexOf(`export function ${name}(`)
  if (start < 0) throw new Error(`no ${name}`)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`unterminated ${name}`)
}

const cardSrc = read('lib/cardCrm.ts')
const clientSrc = read('lib/clientCrm.ts')
const helpers = [
  extractFn(cardSrc, 'cardDigits'),
  extractFn(cardSrc, 'cardNumsMatch'),
  extractFn(clientSrc, 'normalizePhone'),
  extractFn(clientSrc, 'phonesMatch'),
].join('\n')
const fast = read('lib/fastLookup.ts').replace(/^import .*$/gm, '')

const ts = await import('typescript')
const js = ts.transpileModule(`${helpers}\n${fast}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const m = await import(`data:text/javascript,${encodeURIComponent(js)}`)

let seed = 12345
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const pick = arr => arr[rnd(arr.length)]

const nums = ['KAKAPO-0001', 'КАКАПО-0001', '0001', '1', 'KAKAPO-0002', '0002', 'KAKAPO-12', '12', '', undefined, 'ABC', 'abc', 'KAKAPO-0003']
const statuses = ['active', 'unlinked', undefined, 'blocked']
const clientIds = ['c1', 'c2', 'c3', '', undefined, null, 1, '1']
const phones = ['+992 93 123 45 67', '931234567', '992931234567', '93 123 45 68', '', undefined, '123', '+992 (93) 123-45-67', '000000000']

for (let round = 0; round < 300; round++) {
  const cards = Array.from({ length: rnd(25) }, (_, i) => ({ id: i, num: pick(nums), status: pick(statuses), clientId: pick(clientIds) }))
  for (let k = 0; k < 15; k++) {
    const num = pick(nums)
    const want = cards.find(c => m.cardNumsMatch(c.num, num) && c.status !== 'unlinked')
    const got = m.findLinkedCardByNum(cards, num)
    if (want !== got) { expect(false, `linked card by num round ${round} num=${num}`); break }
    const wantAny = cards.find(c => m.cardNumsMatch(c.num, num))
    if (wantAny !== m.findCardByNum(cards, num)) { expect(false, `any card by num round ${round} num=${num}`); break }
    const cid = pick(clientIds)
    const wantCid = cards.find(c => c.clientId === cid && c.status !== 'unlinked')
    if (wantCid !== m.findLinkedCardByClientId(cards, cid)) { expect(false, `card by clientId round ${round} cid=${cid}`); break }
  }

  const sales = Array.from({ length: rnd(60) }, (_, i) => ({ id: `s${i}`, clientId: pick(clientIds), clientPhone: pick(phones) }))
  for (let k = 0; k < 15; k++) {
    const client = { id: pick(clientIds), phone: pick(phones) }
    const want = sales.filter(s => (s.clientId && s.clientId === client.id) || (s.clientPhone && m.phonesMatch(s.clientPhone, client.phone)))
    const got = m.salesForClient(sales, client)
    if (want.length !== got.length || want.some((s, i) => s !== got[i])) {
      expect(false, `salesForClient round ${round} client=${JSON.stringify(client)}`)
      break
    }
  }
}
expect(failed === 0, 'randomized: card / sales lookups equal the original scans (300 rounds)')

{
  const cards = [{ num: 'KAKAPO-0001', status: 'active' }]
  const first = m.findLinkedCardByNum(cards, '0001')
  const grown = [...cards, { num: 'KAKAPO-0009', status: 'active' }]
  expect(first === cards[0] && m.findLinkedCardByNum(grown, '0009') === grown[1], 'new array reference gets its own index')
}

{
  const words = ['яблоко', 'Яблоко', 'ёж', 'еж', 'Banana', 'apple', '10', '9', 'Апельсин', 'арбуз', '', 'ä', 'a b', 'a-b']
  let same = true
  for (const a of words) for (const b of words) {
    if (Math.sign(a.localeCompare(b, 'ru')) !== Math.sign(m.compareRu(a, b))) same = false
    if (Math.sign(a.localeCompare(b)) !== Math.sign(m.compareLocale(a, b))) same = false
  }
  const isos = ['2026-10-01T10:00:00.000Z', '2026-10-01T09:59:59Z', '2026-09-30T23:00:00+05:00', '', '2026-10-01']
  for (const a of isos) for (const b of isos) {
    if (Math.sign(a.localeCompare(b)) !== Math.sign(m.compareLocale(a, b))) same = false
  }
  expect(same, 'compareRu / compareLocale order like localeCompare')
}

{
  const vals = ['2026-10-01T10:00:00.000Z', '2026-10-01', 'garbage', '', '2026-09-30T23:00:00+05:00']
  expect(vals.every(v => Object.is(m.isoMs(v), new Date(v).getTime()) && Object.is(m.isoMs(v), new Date(v).getTime())), 'isoMs equals new Date(iso).getTime() (cached and uncached)')
}

const debts = read('components/trade/DebtsModule.tsx')
const clients = read('components/trade/ClientsModule.tsx')
const reports = read('components/trade/reportsHelpers.ts')
const cashier = read('components/trade/CashierModule.tsx')
const trade = read('components/trade/TradeApp.tsx')
expect(/return findLinkedCardByNum\(cards, client\.card\)/.test(debts) && /return salesForClient\(sales, client\)/.test(debts), 'DebtsModule uses indexed card / sales lookups')
expect(/findLinkedCardByClientId\(cards, client\.id\)/.test(clients) && /return salesForClient\(sales, client\)/.test(clients), 'ClientsModule uses indexed card / sales lookups')
expect(/isoMs\(iso\)/.test(reports) && !/localeCompare\(/.test(reports), 'reportsHelpers: cached date parse, shared collators')
expect(/findCardByNum\(cards, c\.card\)/.test(cashier), 'Cashier client search uses indexed card lookup')
expect(/lagNavStart\(p\)/.test(trade) && /lagNavShown\(current\)/.test(trade), 'TradeApp reports section switch time')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
