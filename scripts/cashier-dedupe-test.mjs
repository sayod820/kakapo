/**
 * Step 6: one person — one cashier. Merge duplicates, old id keeps working, no new duplicates.
 * Run: node scripts/cashier-dedupe-test.mjs
 */
import {
  mergeDuplicateCashiers,
  resolveCashierId,
  findCashierByName,
  normalizeCashierName,
} from '../server/kakapo-api/cashierIdentity.js'
import {
  createCashier,
  updateCashier,
  openPosShift,
  ensurePosCollections,
} from '../server/kakapo-api/posLogic.js'
import { appendMoneyLedger, listMoneyLedger } from '../server/kakapo-api/financeTruth.js'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok', name) } else { fail++; console.log('  FAIL', name) }
}

const OLD = 'CASHIER-msbrov4p-5fleg'
const DUP = 'CASHIER-mu41otk4-1pudx'

function prodLikeDb() {
  const db = {
    cashiers: [
      { id: OLD, name: 'Гафуров Сайёд', pin: '0000', active: true, salesCount: 10882, salesTotal: 220421.9, createdAtIso: '2026-08-02T12:19:13.177Z' },
      { id: DUP, name: 'Гафуров  Сайед ', pin: '0000', active: true, salesCount: 1144, salesTotal: 25073.89, createdAtIso: '2026-09-16T11:56:22.564Z' },
    ],
    posPoints: [{ id: 'POS-DEFAULT', name: 'КАКАПО МАРКЕТ', active: true, devices: [] }],
    posShifts: [
      { id: 'SHIFT-old', cashierId: OLD, posId: 'POS-DEFAULT', status: 'closed' },
      { id: 'SHIFT-open', cashierId: DUP, posId: 'POS-DEFAULT', status: 'open', _txCommittedAt: '2026-09-25T03:57:36.463Z' },
    ],
    posSales: [
      { id: 'S1', cashierId: OLD, shiftId: 'SHIFT-old' },
      { id: 'S2', cashierId: DUP, shiftId: 'SHIFT-open', returnedByCashierId: DUP },
    ],
    moneyLedger: [
      { id: 'L1', cashierId: DUP, type: 'sale_cash' },
      { id: 'L2', cashierId: '', type: 'other' },
    ],
    auditLog: [{ id: 'A1', entityId: DUP }],
    opRefs: [{ id: 'R1', cashierId: DUP }],
  }
  ensurePosCollections(db)
  return db
}

console.log('merge')
{
  const db = prodLikeDb()
  const out = mergeDuplicateCashiers(db, { now: '2026-09-25T12:00:00.000Z' })
  const old = db.cashiers.find(c => c.id === OLD)
  const dup = db.cashiers.find(c => c.id === DUP)
  ok(out.merged.length === 1 && out.merged[0].from === DUP && out.merged[0].to === OLD, 'дубль сливается в кассира с большим числом продаж')
  ok(old.salesCount === 12026 && old.salesTotal === 245495.79, 'счётчики сложены')
  ok(dup.mergedInto === OLD && dup.active === false && dup.salesCount === 0, 'дубль помечен и скрыт, строка осталась')
  ok(db.posShifts.every(s => s.cashierId === OLD), 'все смены на основном (включая открытую)')
  ok(db.posSales.every(s => s.cashierId === OLD) && db.posSales[1].returnedByCashierId === OLD, 'чеки и возвраты на основном')
  ok(db.moneyLedger[0].cashierId === OLD && db.moneyLedger[1].cashierId === '', 'деньги на основном, пустые не тронуты')
  ok(db.auditLog[0].entityId === DUP && db.opRefs[0].cashierId === DUP, 'история (audit/opRefs) не переписывается')
  ok(db.posShifts[1]._txCommittedAt === '2026-09-25T12:00:00.000Z', 'метка tx обновлена, snapshot upsert не отбросит строку')
  ok(out.remapped.posSales === 1 && out.remapped.posShifts === 1 && out.remapped.moneyLedger === 1, 'счётчик перепривязок')

  const again = mergeDuplicateCashiers(db)
  ok(again.merged.length === 0 && Object.keys(again.remapped).length === 0, 'повторный запуск ничего не меняет')

  db.posSales.push({ id: 'S3', cashierId: DUP })
  const late = mergeDuplicateCashiers(db)
  ok(late.merged.length === 0 && db.posSales[2].cashierId === OLD, 'поздно пришедшая ссылка на дубль переводится при следующем старте')
}

console.log('old id keeps working')
{
  const db = prodLikeDb()
  db.posShifts[1].status = 'closed'
  mergeDuplicateCashiers(db)
  ok(resolveCashierId(db, DUP) === OLD && resolveCashierId(db, OLD) === OLD && resolveCashierId(db, 'X') === 'X', 'resolveCashierId')
  const sh = openPosShift(db, { cashierId: DUP, cashierName: 'Гафуров Сайёд', posId: 'POS-DEFAULT', openingCash: 0 })
  ok(sh.cashierId === OLD, 'смена, открытая со старым id, записана на основного')
  const led = appendMoneyLedger(db, { type: 'cash_in', amount: 5, cashierId: DUP })
  ok(led.cashierId === OLD, 'движение денег со старым id — на основного')
  ok(listMoneyLedger(db, { cashierId: DUP }).some(r => r.id === led.id), 'фильтр отчёта по старому id находит основного')
}

console.log('no new duplicates')
{
  const db = prodLikeDb()
  mergeDuplicateCashiers(db)
  const before = db.cashiers.length
  const same = createCashier(db, { name: '  гафуров сайёд ', pin: '0000' })
  ok(same.id === OLD && db.cashiers.length === before, 'создание с тем же именем возвращает существующего')
  const fresh = createCashier(db, { name: 'Новый Кассир', pin: '1111', clientRef: 'ref-1' })
  const replay = createCashier(db, { name: 'Новый Кассир 2', pin: '1111', clientRef: 'ref-1' })
  ok(replay.id === fresh.id && db.cashiers.length === before + 1, 'повтор офлайн-очереди по clientRef не создаёт второго')
  let err = ''
  try { updateCashier(db, fresh.id, { name: 'Гафуров Сайёд' }) } catch (e) { err = e.message }
  ok(/уже есть/.test(err), 'переименовать в чужое имя нельзя')
  const self = updateCashier(db, fresh.id, { name: 'Новый  кассир', mergedInto: OLD, salesCount: 999 })
  ok(self.name === 'Новый  кассир' && !self.mergedInto && self.salesCount === 0, 'своё имя менять можно; служебные поля патчем не меняются')
  const viaOld = updateCashier(db, DUP, { pin: '4321' })
  ok(viaOld.id === OLD && viaOld.pin === '4321', 'правка по старому id меняет основного')
}

console.log('shift rename does not create a clash')
{
  const db = prodLikeDb()
  db.posShifts[1].status = 'closed'
  mergeDuplicateCashiers(db)
  const other = createCashier(db, { name: 'Азиз', pin: '2222' })
  openPosShift(db, { cashierId: other.id, cashierName: 'Гафуров Сайёд', posId: 'POS-DEFAULT', openingCash: 0 })
  ok(other.name === 'Азиз' && findCashierByName(db, 'Гафуров Сайёд').id === OLD, 'имя на смене не переименовывает кассира в чужое')
  ok(normalizeCashierName(' Ёлка  Пётр ') === 'елка петр', 'нормализация имени')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
