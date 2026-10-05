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
 * Do NOT use max(client, card) — that hides disagreement.
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
 * Deterministic projection + diagnostic when sources disagree.
 * Never invents a "repaired" max/sum debt.
 */
export function diagnoseDebtProjection(input = {}) {
  const debt = resolveAuthoritativeCustomerDebt(input)
  const ledger = sumOpenDebtLedgerRemaining(input.debtLedger)
    ?? sumOpenDebtLedgerRemaining(input.cardDebtLedger)
  const clientN = Number(input.clientDebt)
  const cardN = Number(input.cardDebt)
  const hasClient = Number.isFinite(clientN)
  const hasCard = Number.isFinite(cardN)
  let source = 'zero'
  if (ledger != null) source = 'ledger'
  else if (hasClient) source = 'client'
  else if (hasCard) source = 'card'

  const drift = {
    clientCard: hasClient && hasCard && Math.abs(clientN - cardN) > 0.009,
    ledgerClient: ledger != null && hasClient && Math.abs(ledger - clientN) > 0.009,
    ledgerCard: ledger != null && hasCard && Math.abs(ledger - cardN) > 0.009,
  }
  const disagreed = !!(drift.clientCard || drift.ledgerClient || drift.ledgerCard)
  return { debt, source, ledger, clientDebt: hasClient ? round2(clientN) : null, cardDebt: hasCard ? round2(cardN) : null, drift, disagreed }
}

/** saleId → SUM(remaining) from server debtLedger entries; null when the ledger has no sale-linked rows. */
export function ledgerRemainBySaleId(ledger) {
  if (!Array.isArray(ledger) || ledger.length === 0) return null
  const map = new Map()
  for (const e of ledger) {
    if (!e || typeof e !== 'object') continue
    const saleId = String(e.saleId || '').trim()
    if (!saleId || !Object.prototype.hasOwnProperty.call(e, 'remaining')) continue
    const rem = Number(e.remaining)
    map.set(saleId, round2((map.get(saleId) || 0) + (Number.isFinite(rem) && rem > 0 ? rem : 0)))
  }
  return map.size ? map : null
}

/**
 * Allocate sale remains against an authoritative debt budget.
 * When debt≈0, never resurrect historical sale.debtAdded as current unpaid.
 *
 * @param {Array<{id:string, orderId?:string, debtAdded:number, dateIso?:string}>} sales
 * @param {Record<string,{remain:number,paid:number,status:string}>} historyRemainBySaleId
 * @param {number} authoritativeDebt
 * @param {{ isLinked?: (sale)=>boolean, debtLedger?: Array<{saleId?:string, remaining?:number}> }} [opts]
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

  const ledgerRemain = ledgerRemainBySaleId(opts.debtLedger)
  const isLinked = typeof opts.isLinked === 'function' ? opts.isLinked : () => false
  const fromLedger = []
  const locked = []
  const flexible = []
  for (const s of list) {
    if (ledgerRemain && ledgerRemain.has(String(s.id))) fromLedger.push(s)
    else if (isLinked(s)) locked.push(s)
    else flexible.push(s)
  }

  let budget = debt
  const apply = (s, ledgerRem) => {
    const orig = round2(Math.abs(Number(s.debtAdded) || 0))
    const hist = historyRemainBySaleId?.[s.id]
    const want = Number.isFinite(ledgerRem)
      ? Math.min(orig, Math.max(0, round2(ledgerRem)))
      : hist && Number.isFinite(Number(hist.remain))
        ? Math.min(orig, Math.max(0, round2(hist.remain)))
        : orig
    const remain = Math.min(want, Math.max(0, budget))
    budget = round2(budget - remain)
    const paid = round2(orig - remain)
    saleStatus[s.id] = {
      remain,
      paid,
      status: remain <= 0.001 ? 'paid' : paid > 0.001 ? 'partial' : 'open',
    }
  }

  // Server ledger per receipt first, then history-linked, then the rest.
  for (const s of fromLedger) apply(s, ledgerRemain.get(String(s.id)))
  for (const s of locked) apply(s)
  // With a ledger, unmatched receipts are either closed (pruned) or not yet synced — newest first.
  const dir = ledgerRemain ? -1 : 1
  const ordered = [...flexible].sort(
    (a, b) => dir * ((Date.parse(a.dateIso) || 0) - (Date.parse(b.dateIso) || 0)),
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
