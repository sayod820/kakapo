/**
 * Sayod/Holov identity+debt recovery — pure logic (no I/O).
 * Used by repair/rollback CLIs and local fixture tests.
 */

export const CONFIRM_TOKEN = 'SAYOD_HOLOV_REPAIR_2026_09_13'
export const ROLLBACK_CONFIRM_TOKEN = 'SAYOD_HOLOV_ROLLBACK_2026_09_13'

export const CARD_0001 = 'КАКАПО-0001'
export const CARD_0003 = 'КАКАПО-0003'
export const SAYOD_ID = 'U-01'
export const HOLOV_ID = 'U-03'
export const SAYOD_PHONE = '+992 50 190 31 41'
export const HOLOV_PHONE = '+992938463959'
export const SAYOD_NAME = 'Сайёд Гафуров'
export const HOLOV_NAME = 'Холов Баходур'
export const SAYOD_DEBT = 1741.31
export const HOLOV_DEBT = 912.24
export const HOLOV_BASE = 320.04
export const CA_ID = 'DL-1789309389399-c099'
export const CA_AMOUNT = 486.7
export const CA_CLIENT_REF = 'b56ef247-caab-400c-9311-310ca0ca56b9'
export const K9649 = {
  orderId: 'K-9649',
  saleId: 'SALE-mtzwd46g-vvx1g',
  clientRef: '2c9c8ad1-0d07-4e3b-9a6e-b816f732f536',
  remaining: 99,
  at: '2026-09-13T14:12:02.907Z',
}
export const K9652 = {
  orderId: 'K-9652',
  saleId: 'SALE-mtzwh59y-6e0e0',
  clientRef: 'b9d6bc1a-6c1c-4b96-992d-8321539214ba',
  remaining: 6.5,
  at: '2026-09-13T14:15:48.737Z',
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function openSum(led) {
  return round2((Array.isArray(led) ? led : [])
    .filter(e => Number(e?.remaining) > 0.001)
    .reduce((s, e) => s + Number(e.remaining), 0))
}

export function cardKey(n) {
  return String(n || '').trim().toUpperCase()
}

function ends0001(n) {
  return String(n || '').replace(/\D/g, '').endsWith('0001')
}
function ends0003(n) {
  return String(n || '').replace(/\D/g, '').endsWith('0003')
}

export function findCard(cards, suf) {
  const list = Array.isArray(cards) ? cards : []
  if (suf === '0001') return list.find(c => ends0001(c.num)) || null
  if (suf === '0003') return list.find(c => ends0003(c.num)) || null
  return null
}

export function findClient(clients, id) {
  return (Array.isArray(clients) ? clients : []).find(c => String(c.id) === id) || null
}

function approxEq(a, b, eps = 0.011) {
  return Math.abs(round2(a) - round2(b)) <= eps
}

function ledgerHasOpen(led, pred) {
  return (Array.isArray(led) ? led : []).some(e => Number(e?.remaining) > 0.001 && pred(e))
}

/**
 * Target repaired state check (idempotency).
 */
export function isAlreadyRepaired(state) {
  const u01 = findClient(state.clients, SAYOD_ID)
  const u03 = findClient(state.clients, HOLOV_ID)
  const c1 = findCard(state.cards, '0001')
  const c3 = findCard(state.cards, '0003')
  if (!u01 || !u03 || !c1 || !c3) return false
  if (cardKey(u01.card) !== CARD_0001) return false
  if (cardKey(u03.card) !== CARD_0003) return false
  if (String(c1.clientId) !== SAYOD_ID) return false
  if (String(c3.clientId) !== HOLOV_ID) return false
  if (c3.status === 'unlinked') return false
  if (!approxEq(u01.debt, SAYOD_DEBT) || !approxEq(c1.debt, SAYOD_DEBT)) return false
  if (!approxEq(u03.debt, HOLOV_DEBT) || !approxEq(c3.debt, HOLOV_DEBT)) return false
  if (!approxEq(openSum(c1.debtLedger), SAYOD_DEBT)) return false
  if (!approxEq(openSum(c3.debtLedger), HOLOV_DEBT)) return false
  const caOn3 = (c3.debtLedger || []).filter(e => String(e.id) === CA_ID && Number(e.remaining) > 0.001)
  const caOn1 = (c1.debtLedger || []).filter(e => String(e.id) === CA_ID && Number(e.remaining) > 0.001)
  if (caOn3.length !== 1 || caOn1.length !== 0) return false
  const k49 = (c3.debtLedger || []).filter(e => String(e.orderId) === 'K-9649' && Number(e.remaining) > 0.001)
  const k52 = (c3.debtLedger || []).filter(e => String(e.orderId) === 'K-9652' && Number(e.remaining) > 0.001)
  if (k49.length !== 1 || k52.length !== 1) return false
  return true
}

/**
 * Expected corrupted incident preconditions.
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function verifyCorruptedPreconditions(state) {
  const reasons = []
  const u01 = findClient(state.clients, SAYOD_ID)
  const u03 = findClient(state.clients, HOLOV_ID)
  const c1 = findCard(state.cards, '0001')
  const c3 = findCard(state.cards, '0003')
  if (!u01) reasons.push('missing U-01')
  if (!u03) reasons.push('missing U-03')
  if (!c1) reasons.push('missing card 0001')
  if (!c3) reasons.push('missing card 0003')
  if (reasons.length) return { ok: false, reasons }

  if (cardKey(u01.card) !== CARD_0001) reasons.push(`U-01.card=${u01.card}`)
  if (cardKey(u03.card) !== CARD_0001) reasons.push(`U-03.card=${u03.card} (expected 0001)`)
  if (!approxEq(u01.debt, 2228.01)) reasons.push(`U-01.debt=${u01.debt}`)
  if (!approxEq(u03.debt, 2228.01)) reasons.push(`U-03.debt=${u03.debt}`)
  if (!/холов/i.test(String(u01.name || ''))) reasons.push(`U-01.name=${u01.name} (expected Holov paint)`)

  if (String(c1.clientId) !== HOLOV_ID) reasons.push(`card0001.clientId=${c1.clientId}`)
  if (!approxEq(c1.debt, 2228.01)) reasons.push(`card0001.debt=${c1.debt}`)
  if (c1.status === 'unlinked') reasons.push('card0001 unlinked')

  if (c3.status !== 'unlinked') reasons.push(`card0003.status=${c3.status}`)
  if (!approxEq(c3.debt, 0)) reasons.push(`card0003.debt=${c3.debt}`)
  if (openSum(c3.debtLedger) > 0.001) reasons.push('card0003 open ledger not empty')

  const open1 = (c1.debtLedger || []).filter(e => Number(e.remaining) > 0.001)
  if (open1.length !== 2) reasons.push(`card0001 openN=${open1.length} expected 2`)

  const ca = open1.find(e => String(e.id) === CA_ID)
  if (!ca) reasons.push(`missing open CA ${CA_ID}`)
  else {
    if (!approxEq(ca.remaining, CA_AMOUNT) || !approxEq(ca.amount, CA_AMOUNT)) {
      reasons.push(`CA amount/remaining=${ca.amount}/${ca.remaining}`)
    }
    if (String(ca.clientRef || '') && String(ca.clientRef) !== CA_CLIENT_REF) {
      reasons.push(`CA clientRef mismatch ${ca.clientRef}`)
    }
  }

  const bf = open1.find(e => String(e.source) === 'backfill' && approxEq(e.remaining, SAYOD_DEBT))
  if (!bf) reasons.push('missing open backfill 1741.31 on card 0001')

  if (!approxEq(openSum(c1.debtLedger), 2228.01)) {
    reasons.push(`card0001 openSum=${openSum(c1.debtLedger)}`)
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/**
 * Expected repaired state before rollback restore.
 */
export function verifyRepairedPreconditions(state) {
  if (isAlreadyRepaired(state)) return { ok: true }
  return { ok: false, reasons: ['current state is not the expected repaired shape'] }
}

function clone(x) {
  return structuredClone(x)
}

function mkRow(partial) {
  return {
    id: partial.id,
    source: partial.source,
    amount: round2(partial.amount),
    remaining: round2(partial.remaining),
    orderId: partial.orderId,
    saleId: partial.saleId,
    clientRef: partial.clientRef,
    createdAtIso: partial.createdAtIso || partial.at || new Date().toISOString(),
    at: partial.at || partial.createdAtIso,
    desc: partial.desc || '',
    dueAtIso: partial.dueAtIso,
  }
}

/**
 * Build repaired copies of the four entities (does not mutate input).
 * @param {{ clients, cards, sayodOpenLedger?: any[], holovBaseOpenLedger?: any[] }} state
 */
export function buildRepairedEntities(state) {
  const u01 = clone(findClient(state.clients, SAYOD_ID))
  const u03 = clone(findClient(state.clients, HOLOV_ID))
  const c1 = clone(findCard(state.cards, '0001'))
  const c3 = clone(findCard(state.cards, '0003'))

  const caRow = (c1.debtLedger || []).find(e => String(e.id) === CA_ID)
  if (!caRow) throw new Error(`CA row ${CA_ID} missing during build`)

  // --- Sayod card 0001 ledger ---
  const closedOrOther = (c1.debtLedger || []).filter(e => {
    if (String(e.id) === CA_ID) return false
    if (Number(e.remaining) > 0.001 && String(e.source) === 'backfill' && approxEq(e.remaining, SAYOD_DEBT)) {
      return false // drop Holov-attributed / opaque open backfill
    }
    if (Number(e.remaining) > 0.001) return false // drop any other unexpected open
    return true
  })

  let sayodOpen
  if (Array.isArray(state.sayodOpenLedger) && state.sayodOpenLedger.length
    && approxEq(openSum(state.sayodOpenLedger), SAYOD_DEBT)) {
    sayodOpen = state.sayodOpenLedger.map(e => mkRow({ ...e, remaining: e.remaining, amount: e.amount ?? e.remaining }))
  } else {
    sayodOpen = [mkRow({
      id: 'DL-REPAIR-SAYOD-OPEN-1741.31',
      source: 'backfill',
      amount: SAYOD_DEBT,
      remaining: SAYOD_DEBT,
      createdAtIso: '2026-09-13T13:46:03.000Z',
      desc: 'REPAIR: Sayod proven open debt from backup4 entities (pre-merge 1741.31)',
    })]
  }

  c1.debtLedger = [...sayodOpen, ...closedOrOther]
  c1.debt = SAYOD_DEBT
  c1.debtEnabled = true
  c1.clientId = SAYOD_ID
  c1.client = SAYOD_NAME
  c1.phone = SAYOD_PHONE
  c1.status = 'active'
  c1.debtPayVersion = (Number(c1.debtPayVersion) || 0) + 1
  c1.updatedAtIso = new Date().toISOString()

  // --- Holov card 0003 ledger ---
  let holovBase
  if (Array.isArray(state.holovBaseOpenLedger) && state.holovBaseOpenLedger.length
    && approxEq(openSum(state.holovBaseOpenLedger), HOLOV_BASE)) {
    holovBase = state.holovBaseOpenLedger.map(e => mkRow({ ...e, remaining: e.remaining, amount: e.amount ?? e.remaining }))
  } else {
    holovBase = [mkRow({
      id: 'DL-REPAIR-HOLOV-BASE-320.04',
      source: 'backfill',
      amount: HOLOV_BASE,
      remaining: HOLOV_BASE,
      createdAtIso: '2026-09-13T11:41:27.000Z',
      desc: 'REPAIR: Holov proven open debt pre-incident (backup-stable 320.04)',
    })]
  }

  const movedCa = mkRow({
    ...caRow,
    id: CA_ID,
    source: 'cash_advance',
    amount: CA_AMOUNT,
    remaining: CA_AMOUNT,
    clientRef: caRow.clientRef || CA_CLIENT_REF,
    desc: caRow.desc || 'Выдача наличных · Холов Баходур',
    createdAtIso: caRow.createdAtIso || caRow.at || '2026-09-13T14:19:11.403Z',
  })

  const row9649 = mkRow({
    id: `DL-REPAIR-POS-${K9649.saleId}`,
    source: 'pos',
    amount: K9649.remaining,
    remaining: K9649.remaining,
    orderId: K9649.orderId,
    saleId: K9649.saleId,
    clientRef: K9649.clientRef,
    createdAtIso: K9649.at,
    desc: `Касса · ${K9649.orderId}`,
  })
  const row9652 = mkRow({
    id: `DL-REPAIR-POS-${K9652.saleId}`,
    source: 'pos',
    amount: K9652.remaining,
    remaining: K9652.remaining,
    orderId: K9652.orderId,
    saleId: K9652.saleId,
    clientRef: K9652.clientRef,
    createdAtIso: K9652.at,
    desc: `Касса · ${K9652.orderId}`,
  })

  c3.debtLedger = [...holovBase, row9649, row9652, movedCa]
  c3.debt = HOLOV_DEBT
  c3.debtEnabled = true
  c3.clientId = HOLOV_ID
  c3.client = HOLOV_NAME
  c3.phone = HOLOV_PHONE
  c3.status = 'active'
  c3.debtPayVersion = Math.max(1, Number(c3.debtPayVersion) || 0) + 1
  c3.updatedAtIso = new Date().toISOString()

  // --- clients ---
  u01.name = SAYOD_NAME
  u01.phone = SAYOD_PHONE
  u01.card = CARD_0001
  u01.debt = SAYOD_DEBT
  u01.debtEnabled = true
  u01.debtLedger = clone(c1.debtLedger)
  u01.updatedAtIso = c1.updatedAtIso

  u03.name = HOLOV_NAME
  u03.phone = HOLOV_PHONE
  u03.card = CARD_0003
  u03.debt = HOLOV_DEBT
  u03.debtEnabled = true
  u03.debtLedger = clone(c3.debtLedger)
  u03.updatedAtIso = c3.updatedAtIso

  if (!approxEq(openSum(c1.debtLedger), SAYOD_DEBT)) {
    throw new Error(`Sayod ledger sum ${openSum(c1.debtLedger)} != ${SAYOD_DEBT}`)
  }
  if (!approxEq(openSum(c3.debtLedger), HOLOV_DEBT)) {
    throw new Error(`Holov ledger sum ${openSum(c3.debtLedger)} != ${HOLOV_DEBT}`)
  }

  return { u01, u03, c1, c3 }
}

/**
 * Apply repaired entities into a mutable state {clients, cards}.
 * Optional failAt for injected failure tests.
 */
export function applyRepairedToState(state, repaired, opts = {}) {
  const failAt = opts.failAt
  const fail = (point) => {
    if (failAt && failAt === point) throw new Error(`INJECTED_FAIL:${point}`)
  }

  fail('before_write')
  const ci01 = state.clients.findIndex(c => c.id === SAYOD_ID)
  const ci03 = state.clients.findIndex(c => c.id === HOLOV_ID)
  const ki1 = state.cards.findIndex(c => ends0001(c.num))
  const ki3 = state.cards.findIndex(c => ends0003(c.num))
  if (ci01 < 0 || ci03 < 0 || ki1 < 0 || ki3 < 0) throw new Error('entity index missing')

  // Snapshot for local transactional rollback in memory
  const before = {
    u01: clone(state.clients[ci01]),
    u03: clone(state.clients[ci03]),
    c1: clone(state.cards[ki1]),
    c3: clone(state.cards[ki3]),
  }

  try {
    state.cards[ki1] = repaired.c1
    fail('after_card_0001')
    state.cards[ki3] = repaired.c3
    fail('after_card_0003')
    state.clients[ci01] = repaired.u01
    fail('after_client_u01')
    state.clients[ci03] = repaired.u03
    fail('after_client_u03')
    fail('before_commit')
  } catch (e) {
    state.clients[ci01] = before.u01
    state.clients[ci03] = before.u03
    state.cards[ki1] = before.c1
    state.cards[ki3] = before.c3
    throw e
  }
  return { ok: true }
}

export function exportRollbackSnapshot(state) {
  return {
    exportedAt: new Date().toISOString(),
    kind: 'sayod-holov-recovery-rollback-v1',
    clients: {
      [SAYOD_ID]: clone(findClient(state.clients, SAYOD_ID)),
      [HOLOV_ID]: clone(findClient(state.clients, HOLOV_ID)),
    },
    cards: {
      [CARD_0001]: clone(findCard(state.cards, '0001')),
      [CARD_0003]: clone(findCard(state.cards, '0003')),
    },
  }
}

export function applyRollbackSnapshotToState(state, snapshot, opts = {}) {
  const failAt = opts.failAt
  const fail = (point) => {
    if (failAt && failAt === point) throw new Error(`INJECTED_FAIL:${point}`)
  }
  const u01 = snapshot.clients?.[SAYOD_ID]
  const u03 = snapshot.clients?.[HOLOV_ID]
  const c1 = snapshot.cards?.[CARD_0001]
  const c3 = snapshot.cards?.[CARD_0003]
  if (!u01 || !u03 || !c1 || !c3) throw new Error('incomplete rollback snapshot')

  const ci01 = state.clients.findIndex(c => c.id === SAYOD_ID)
  const ci03 = state.clients.findIndex(c => c.id === HOLOV_ID)
  const ki1 = state.cards.findIndex(c => ends0001(c.num))
  const ki3 = state.cards.findIndex(c => ends0003(c.num))
  const before = {
    u01: clone(state.clients[ci01]),
    u03: clone(state.clients[ci03]),
    c1: clone(state.cards[ki1]),
    c3: clone(state.cards[ki3]),
  }
  try {
    fail('before_write')
    state.cards[ki1] = clone(c1)
    fail('after_card_0001')
    state.cards[ki3] = clone(c3)
    fail('after_card_0003')
    state.clients[ci01] = clone(u01)
    fail('after_client_u01')
    state.clients[ci03] = clone(u03)
    fail('before_commit')
  } catch (e) {
    state.clients[ci01] = before.u01
    state.clients[ci03] = before.u03
    state.cards[ki1] = before.c1
    state.cards[ki3] = before.c3
    throw e
  }
  return { ok: true }
}

export function countOpenBy(led, pred) {
  return (Array.isArray(led) ? led : []).filter(e => Number(e.remaining) > 0.001 && pred(e)).length
}

export function sideEffectGuards() {
  return {
    WOULD_TOUCH_STOCK: false,
    WOULD_TOUCH_SALES: false,
    WOULD_TOUCH_FINANCE: false,
    WOULD_TOUCH_LOYALTY: false,
    WOULD_TOUCH_SHIFT: false,
  }
}

export function planSummary(repaired) {
  return {
    WOULD_SET_SAYOD_DEBT: round2(repaired.c1.debt),
    WOULD_SET_HOLOV_DEBT: round2(repaired.c3.debt),
    WOULD_MOVE_CA_486_70: countOpenBy(repaired.c3.debtLedger, e => String(e.id) === CA_ID) === 1
      && countOpenBy(repaired.c1.debtLedger, e => String(e.id) === CA_ID) === 0,
    WOULD_RECREATE_K9649: countOpenBy(repaired.c3.debtLedger, e => String(e.orderId) === 'K-9649') === 1,
    WOULD_RECREATE_K9652: countOpenBy(repaired.c3.debtLedger, e => String(e.orderId) === 'K-9652') === 1,
    ...sideEffectGuards(),
  }
}
