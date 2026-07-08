function nextShiftId(db) {
  if (!db._seq) db._seq = {}
  db._seq.posShift = (db._seq.posShift || 0) + 1
  return `SH-${String(db._seq.posShift).padStart(5, '0')}`
}

export function getOpenShift(db, cashierId) {
  return (db.posShifts || []).find(s => s.cashierId === cashierId && s.status === 'open') || null
}

/** Открытие смены кассира — с заявленной стартовой суммой наличных в кассе. */
export function openShift(db, payload) {
  const cashierId = String(payload?.cashierId || '').trim()
  if (!cashierId) throw new Error('Не указан кассир')
  if (getOpenShift(db, cashierId)) throw new Error('У этого кассира уже есть открытая смена')

  const shift = {
    id: nextShiftId(db),
    cashierId,
    cashierName: String(payload?.cashierName || '').trim(),
    openingCash: Math.max(0, Number(payload?.openingCash) || 0),
    openedAtIso: new Date().toISOString(),
    closedAtIso: null,
    closingCashDeclared: null,
    expectedCash: null,
    difference: null,
    status: 'open',
  }
  if (!Array.isArray(db.posShifts)) db.posShifts = []
  db.posShifts.push(shift)
  return shift
}

/**
 * Закрытие смены: сверяем заявленную кассиром фактическую наличность с ожидаемой
 * (стартовая сумма + наличные продажи этой смены; возвраты уже исключены, т.к. переводят
 * заказ в status='cancelled', который сюда не попадает).
 */
export function closeShift(db, payload) {
  const cashierId = String(payload?.cashierId || '').trim()
  const shift = getOpenShift(db, cashierId)
  if (!shift) throw new Error('У этого кассира нет открытой смены')

  const cashSales = (db.orders || []).filter(o =>
    o.shiftId === shift.id && o.source === 'pos' && o.status === 'delivered' && o.payment_method === 'cash',
  )
  const cashSalesTotal = cashSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const expectedCash = Math.round((shift.openingCash + cashSalesTotal) * 100) / 100
  const declared = Math.max(0, Number(payload?.closingCashDeclared) || 0)

  shift.closedAtIso = new Date().toISOString()
  shift.closingCashDeclared = declared
  shift.expectedCash = expectedCash
  shift.difference = Math.round((declared - expectedCash) * 100) / 100
  shift.status = 'closed'

  const allSales = (db.orders || []).filter(o => o.shiftId === shift.id && o.source === 'pos' && o.status === 'delivered')
  shift.salesCount = allSales.length
  shift.salesTotal = Math.round(allSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0) * 100) / 100

  return shift
}
