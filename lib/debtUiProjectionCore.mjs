/**
 * Pure debt UI projection helpers (Desktop list/footer).
 * No network, no storage writes — display math only.
 */

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * SUM(open debtLedger.remaining) when ledger is synchronized (entries with remaining).
 * Returns null if ledger is absent / not usable.
 */
export function sumOpenDebtLedgerRemaining(ledger) {
  if (!Array.isArray(ledger) || ledger.length === 0) return null
  let sum = 0
  let sawRemaining = false
  for (const e of ledger) {
    if (!e || typeof e !== 'object') continue
    if (!Object.prototype.hasOwnProperty.call(e, 'remaining')) continue
    sawRemaining = true
    const rem = Number(e.remaining)
    if (Number.isFinite(rem) && rem > 0) sum += rem
  }
  return sawRemaining ? round2(sum) : null
}

/**
 * Authoritative current customer debt for list/footer.
 * Prefer synchronized debtLedger remaining; else CRM client.debt
 * (server reconcile keeps client.debt ≈ ledger). Do not prefer inflated card.debt
 * when client.debt is present — card/client drift was observed in audit.
 */
export function resolveAuthoritativeCustomerDebt(input = {}) {
  const {
    clientDebt,
    cardDebt,
    debtLedger,
    cardDebtLedger,
  } = input

  const fromLedger = sumOpenDebtLedgerRemaining(debtLedger)
    ?? sumOpenDebtLedgerRemaining(cardDebtLedger)
  if (fromLedger != null) return fromLedger

  const c = Number(clientDebt)
  if (Number.isFinite(c)) return Math.max(0, round2(c))

  const k = Number(cardDebt)
  if (Number.isFinite(k)) return Math.max(0, round2(k))

  return 0
}

/**
 * Allocate sale remains against an authoritative debt budget.
 * When debt≈0, never resurrect historical sale.debtAdded as current unpaid.
 *
 * @param {Array<{id:string, orderId?:string, debtAdded:number, dateIso?:string}>} sales
 * @param {Record<string,{remain:number,paid:number,status:string}>} historyRemainBySaleId
 * @param {number} authoritativeDebt
 * @param {{ isLinked?: (sale)=>boolean }} [opts]
 */
export function allocateSaleRemainsToDebtBudget(sales, historyRemainBySaleId, authoritativeDebt, opts = {}) {
  const debt = Math.max(0, round2(authoritativeDebt))
  const list = Array.isArray(sales) ? sales : []
  const posOriginal = round2(list.reduce((s, x) => s + Math.abs(Number(x.debtAdded) || 0), 0))

  const saleStatus = {}
  if (debt < 0.001) {
    for (const s of list) {
      const orig = round2(Math.abs(Number(s.debtAdded) || 0))
      saleStatus[s.id] = { remain: 0, paid: orig, status: 'paid' }
    }
    return { saleStatus, posOriginal, posRemain: 0, cashOnCard: 0 }
  }

  const isLinked = typeof opts.isLinked === 'function' ? opts.isLinked : () => false
  const locked = []
  const flexible = []
  for (const s of list) {
    if (isLinked(s)) locked.push(s)
    else flexible.push(s)
  }

  let budget = debt
  const apply = (s, preferRemain) => {
    const orig = round2(Math.abs(Number(s.debtAdded) || 0))
    const hist = historyRemainBySaleId?.[s.id]
    const want = hist && Number.isFinite(Number(hist.remain))
      ? Math.min(orig, Math.max(0, round2(hist.remain)))
      : (Number.isFinite(preferRemain) ? Math.min(orig, Math.max(0, round2(preferRemain))) : orig)
    const remain = Math.min(want, Math.max(0, budget))
    budget = round2(budget - remain)
    const paid = round2(orig - remain)
    saleStatus[s.id] = {
      remain,
      paid,
      status: remain <= 0.001 ? 'paid' : paid > 0.001 ? 'partial' : 'open',
    }
  }

  // History-linked first (stable receipt mapping), then flexible oldest-first.
  for (const s of locked) apply(s)
  const ordered = [...flexible].sort(
    (a, b) => (Date.parse(a.dateIso) || 0) - (Date.parse(b.dateIso) || 0),
  )
  for (const s of ordered) apply(s)

  const posRemain = round2(
    Object.values(saleStatus).reduce((s, x) => s + (Number(x.remain) || 0), 0),
  )
  const cashOnCard = Math.max(0, round2(debt - posRemain))
  return { saleStatus, posOriginal, posRemain, cashOnCard }
}

/** Displayed current debt for one customer — always authoritative, never sale.debtAdded. */
export function displayedCustomerDebt(input) {
  return resolveAuthoritativeCustomerDebt(input)
}

/** Footer total from unique customer display debts. */
export function sumDisplayedCustomerDebts(rows) {
  return round2((rows || []).reduce((s, r) => s + Math.max(0, Number(r?.debt) || 0), 0))
}
