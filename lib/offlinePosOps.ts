// ════════════════════════════════════════════════
// KAKAPO — операции кассы без интернета
// Local-first: сразу локально + очередь, синк с сервером в фоне
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import { findDuplicateDebtRepay, isLocalId, isOnline, newClientRef, newLocalId, persistPosSnapshot, cacheData, readCachedData } from './offline'
import { cardNumsMatch, effectiveDebt } from './cardCrm'
import { phonesMatch, type AdminClient } from './clientCrm'
import { debtAccountKey, recordStoreDebtRepayment } from './clientVipCredit'
import { localFirstOp, type OfflineResult } from './localFirst'
import { markMoneyPending } from './loyaltySaveGuard'
import { isTradeLocalFirst, shadowMirrorPut, shadowMirrorSale, shadowMirrorShift } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import { useClientStore } from './clientStore'
import { useCardStore } from './cardStore'
import { allocPosOpSeq, ensurePosOpSeqReady } from './posOpSeq'
import { getBoundDeviceNameSync, getTradeDeviceIdSync } from './tradeDevice'
import type { FinanceMove, PosExpense, PosSale, PosShift } from './types'

export type SaleCartLine = {
  productId: number
  qty: number
  weightKg?: number | null
}

export type CreateSaleSafeInput = {
  salePayload: Record<string, unknown>
  cart: SaleCartLine[]
  shiftId: string
  cashPaid: number
  cardPaid: number
  debtAdded: number
  walletPaid?: number
  total: number
  /** Карта / кошелёк / бонусы — нужен живой сервер, если онлайн */
  needsLiveServer: boolean
  /** Браузер реально офлайн */
  forceOffline: boolean
  client?: {
    id: string
    card?: string
    debt?: number
    wallet?: number
  } | null
  bonusSpend?: number
  bonusEarn?: number
}

/** @deprecated — оставлен для совместимости типов */
export type { OfflineResult }

const KEY_LOCAL_ORDER_SEQ = 'local_order_seq'
const KEY_LOCAL_SALE_NUM = 'local_sale_num'

/** Локальный K-… и №… для печати, пока сервер не присвоил свой номер */
async function allocateLocalSaleDisplay(): Promise<{ number: number; orderId: string }> {
  const sales = usePosStore.getState().sales || []
  let maxOrder = 0
  let maxNum = 0
  for (const s of sales) {
    maxNum = Math.max(maxNum, Number(s.number) || 0)
    const m = String(s.orderId || '').match(/^K-(\d+)$/i)
    if (m) maxOrder = Math.max(maxOrder, Number(m[1]) || 0)
  }
  let storedOrder = 0
  let storedNum = 0
  try {
    storedOrder = Number(await readCachedData<number>(KEY_LOCAL_ORDER_SEQ)) || 0
    storedNum = Number(await readCachedData<number>(KEY_LOCAL_SALE_NUM)) || 0
  } catch { /* ignore */ }
  const nextOrder = Math.max(maxOrder, storedOrder) + 1
  const nextNum = Math.max(maxNum, storedNum) + 1
  void cacheData(KEY_LOCAL_ORDER_SEQ, nextOrder)
  void cacheData(KEY_LOCAL_SALE_NUM, nextNum)
  return { number: nextNum, orderId: `K-${nextOrder}` }
}

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function patchShift(shiftId: string, patch: Partial<PosShift>) {
  usePosStore.setState(s => ({
    shifts: s.shifts.map(x => (x.id === shiftId ? { ...x, ...patch } : x)),
  }))
}

function shiftById(shiftId: string): PosShift | undefined {
  return usePosStore.getState().shifts.find(s => s.id === shiftId)
}

export function shiftExpectedCashLocal(shift: Pick<PosShift, 'openingCash' | 'salesCash' | 'cashInTotal' | 'expenseTotal'>): number {
  return round2(
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    + (Number(shift.cashInTotal) || 0)
    - (Number(shift.expenseTotal) || 0),
  )
}

/** Открытая смена: по точке, иначе любая. */
export function resolveOpenShift(posId?: string): PosShift | undefined {
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  if (!opens.length) return undefined
  const want = String(posId || '').trim()
  if (want) {
    const match = opens.find(s => String(s.posId || '') === want)
    if (match) return match
  }
  return opens[0]
}

/**
 * Local-first: сразу localApply (очередь + стор), сервер в фоне.
 * apiCall игнорируется — оставлен в сигнатуре для совместимости вызовов.
 */
async function raceCashierOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}

// ── Смена ──

export async function openShiftSafe(input: {
  cashierId: string
  cashierName: string
  openingCash: number
  posId?: string
  note?: string
}): Promise<OfflineResult<PosShift>> {
  const clientRef = newClientRef()
  const payload = {
    clientRef,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    openingCash: round2(input.openingCash),
    posId: input.posId,
    note: input.note,
  }

  const applyLocal = async () => {
    const localId = newLocalId('shift')
    const shift: PosShift = {
      id: localId,
      posId: input.posId,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      openedAtIso: new Date().toISOString(),
      openingCash: round2(input.openingCash),
      salesCash: 0,
      salesCard: 0,
      salesCredit: 0,
      salesCount: 0,
      expenseTotal: 0,
      cashInTotal: 0,
      status: 'open',
      note: input.note,
    }
    await useOfflineSync.getState().queueOp('shift_open', payload, { localId })
    usePosStore.setState(s => ({ shifts: [shift, ...s.shifts] }))
    return shift
  }

  const res = await raceCashierOp(() => api.openPosShift(payload), applyLocal)
  if (res.data) shadowMirrorShift(res.data)
  return res
}

export async function closeShiftSafe(
  shiftId: string,
  input: { closingCash: number; note?: string },
): Promise<OfflineResult<PosShift | null>> {
  const clientRef = newClientRef()
  const payload = { clientRef, shiftId, closingCash: round2(input.closingCash), note: input.note }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('shift_close', payload)
    const current = shiftById(shiftId)
    const expected = current
      ? round2((current.openingCash || 0) + (current.salesCash || 0) + (current.cashInTotal || 0) - (current.expenseTotal || 0))
      : payload.closingCash
    const closedAtIso = new Date().toISOString()
    patchShift(shiftId, {
      status: 'closed',
      closedAtIso,
      closingCash: payload.closingCash,
      actualCash: payload.closingCash,
      expectedCash: expected,
      cashDiff: round2(payload.closingCash - expected),
    })
    if (current) {
      applyLocalVaultTransfer({
        ...current,
        status: 'closed',
        closedAtIso,
        closingCash: payload.closingCash,
        actualCash: payload.closingCash,
        expectedCash: expected,
        cashDiff: round2(payload.closingCash - expected),
      })
    }
    void persistPosSnapshot()
    return current
      ? {
          ...current,
          status: 'closed' as const,
          closedAtIso,
          closingCash: payload.closingCash,
          actualCash: payload.closingCash,
          expectedCash: expected,
          cashDiff: round2(payload.closingCash - expected),
        }
      : null
  }

  const res = await raceCashierOp(
    () => api.closePosShift(shiftId, {
      clientRef,
      closingCash: payload.closingCash,
      note: input.note,
    }),
    applyLocal,
  )
  if (res.data) {
    shadowMirrorShift(res.data)
    if (res.data.status === 'closed' && !res.offline) {
      applyLocalVaultTransfer(res.data)
      void persistPosSnapshot()
    }
  }
  return res
}

/** Локально сдать закрытую смену в основной ящик (идемпотентно). */
export function applyLocalVaultTransfer(shift: PosShift) {
  if (!shift?.id || shift.status !== 'closed') return
  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  if ((vault.transfers || []).some(t => String(t.shiftId) === String(shift.id))) return

  const cashAmount = round2(
    shift.actualCash != null ? Number(shift.actualCash) : (Number(shift.closingCash) || 0),
  )
  const cardAmount = round2(Number(shift.salesCard) || 0)
  const transfer = {
    id: newLocalId('vtr'),
    shiftId: shift.id,
    posId: shift.posId || '',
    closedAtIso: shift.closedAtIso || new Date().toISOString(),
    cashAmount,
    cardAmount,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    note: shift.note,
  }
  usePosStore.setState(s => ({
    cashVault: {
      cashTotal: round2((Number(s.cashVault?.cashTotal) || 0) + cashAmount),
      cardTotal: round2((Number(s.cashVault?.cardTotal) || 0) + cardAmount),
      transfers: [transfer, ...(s.cashVault?.transfers || [])],
    },
  }))
}

/** Карта → нал в ящике (основной, потом открытые смены). */
export async function vaultCardToCashSafe(input: {
  amount: number
  note?: string
}): Promise<OfflineResult<{ id: string; amount: number }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  const mainCard = round2(Number(vault.cardTotal) || 0)
  const openCard = round2(opens.reduce((a, s) => a + (Number(s.salesCard) || 0), 0))
  const available = round2(mainCard + openCard)
  if (amount > available + 0.009) {
    throw new Error(`На карте только ${available.toFixed(2)} сом`)
  }

  const clientRef = newClientRef()
  const payload = { clientRef, amount, note: input.note }

  const applyLocal = async () => {
    const localId = newLocalId('vcc')
    await useOfflineSync.getState().queueOp('vault_card_to_cash', payload, { localId })
    applyLocalCardToCash(amount)
    void persistPosSnapshot()
    return { id: localId, amount }
  }

  return raceCashierOp(
    () => api.convertVaultCardToCash(payload),
    applyLocal,
  )
}

function applyLocalCardToCash(amount: number) {
  let left = round2(amount)
  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  const mainCard = round2(Number(vault.cardTotal) || 0)
  const fromMain = Math.min(left, mainCard)
  if (fromMain > 0.001) {
    usePosStore.setState(s => ({
      cashVault: {
        ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
        cardTotal: round2((Number(s.cashVault?.cardTotal) || 0) - fromMain),
        cashTotal: round2((Number(s.cashVault?.cashTotal) || 0) + fromMain),
      },
    }))
    left = round2(left - fromMain)
  }
  if (left <= 0.001) return
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  for (const sh of opens) {
    if (left <= 0.001) break
    const have = round2(Number(sh.salesCard) || 0)
    if (!(have > 0.001)) continue
    const take = Math.min(left, have)
    patchShift(sh.id, {
      salesCard: round2(have - take),
      cashInTotal: round2((Number(sh.cashInTotal) || 0) + take),
    })
    left = round2(left - take)
  }
}

function applyLocalCashToCard(amount: number) {
  let left = round2(amount)
  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  const mainCash = round2(Number(vault.cashTotal) || 0)
  const fromMain = Math.min(left, mainCash)
  if (fromMain > 0.001) {
    usePosStore.setState(s => ({
      cashVault: {
        ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
        cashTotal: round2((Number(s.cashVault?.cashTotal) || 0) - fromMain),
        cardTotal: round2((Number(s.cashVault?.cardTotal) || 0) + fromMain),
      },
    }))
    left = round2(left - fromMain)
  }
  if (left <= 0.001) return
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  for (const sh of opens) {
    if (left <= 0.001) break
    const have = shiftExpectedCashLocal(sh)
    if (!(have > 0.001)) continue
    const take = Math.min(left, have)
    let rest = take
    const fromIn = Math.min(rest, round2(Number(sh.cashInTotal) || 0))
    const patch: Partial<PosShift> = {
      salesCard: round2((Number(sh.salesCard) || 0) + take),
    }
    if (fromIn > 0.001) {
      patch.cashInTotal = round2((Number(sh.cashInTotal) || 0) - fromIn)
      rest = round2(rest - fromIn)
    }
    const fromSales = Math.min(rest, round2(Number(sh.salesCash) || 0))
    if (fromSales > 0.001) {
      patch.salesCash = round2((Number(sh.salesCash) || 0) - fromSales)
      rest = round2(rest - fromSales)
    }
    if (rest > 0.001) {
      patch.openingCash = round2(Math.max(0, (Number(sh.openingCash) || 0) - rest))
    }
    patchShift(sh.id, patch)
    left = round2(left - take)
  }
}

/** Нал → карта в ящике (основной, потом открытые смены). */
export async function vaultCashToCardSafe(input: {
  amount: number
  note?: string
}): Promise<OfflineResult<{ id: string; amount: number }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  const mainCash = round2(Number(vault.cashTotal) || 0)
  const openCash = round2(opens.reduce((a, s) => a + shiftExpectedCashLocal(s), 0))
  const available = round2(mainCash + openCash)
  if (amount > available + 0.009) {
    throw new Error(`Наличных только ${available.toFixed(2)} сом`)
  }

  const clientRef = newClientRef()
  const payload = { clientRef, amount, note: input.note }

  const applyLocal = async () => {
    const localId = newLocalId('vct')
    await useOfflineSync.getState().queueOp('vault_cash_to_card', payload, { localId })
    applyLocalCashToCard(amount)
    void persistPosSnapshot()
    return { id: localId, amount }
  }

  return raceCashierOp(
    () => api.convertVaultCashToCard(payload),
    applyLocal,
  )
}

// ── Движение по кассе ──

export async function financeMoveSafe(input: {
  type: 'deposit' | 'withdraw'
  amount: number
  note?: string
  createdBy?: string
  cashierId?: string
  cashierName?: string
  shiftId?: string
  posId?: string
  supplierId?: string
  reason?: string
}): Promise<OfflineResult<FinanceMove | null>> {
  const open = resolveOpenShift(input.posId)
  const shiftId = input.shiftId || open?.id
  const posId = input.posId || open?.posId || undefined
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  if (input.type === 'withdraw' && shiftId) {
    const shift = shiftById(shiftId)
    if (shift) {
      const expected = shiftExpectedCashLocal(shift)
      if (amount > expected + 0.009) {
        throw new Error(`В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`)
      }
    }
  }

  const clientRef = newClientRef()
  const payload = {
    ...input,
    clientRef,
    amount,
    shiftId,
    posId,
    createdBy: input.createdBy || input.cashierName || open?.cashierName,
    cashierId: input.cashierId || open?.cashierId,
    cashierName: input.cashierName || open?.cashierName,
  }

  // Оплата поставщику с кассы: без V2 — только онлайн; с V2 — локально + очередь
  if (input.supplierId && !isTradeLocalFirst()) {
    try {
      const move = await api.createFinanceMove(payload)
      return { offline: false, data: move }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      throw new Error('Оплата поставщику недоступна без связи')
    }
  }

  const applyLocal = async () => {
    const localId = newLocalId('fin')
    await useOfflineSync.getState().queueOp('finance_move', payload, { localId })
    const move: FinanceMove = {
      id: localId,
      type: payload.type,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
      createdAtIso: new Date().toISOString(),
      shiftId: payload.shiftId,
      posId: payload.posId,
      supplierId: payload.supplierId,
    }
    usePosStore.setState(s => ({ financeMoves: [move, ...s.financeMoves] }))
    shadowMirrorPut('finance_move', move.id, move)
    if (payload.shiftId) {
      const shift = shiftById(payload.shiftId)
      if (shift) {
        patchShift(payload.shiftId, payload.type === 'withdraw'
          ? { expenseTotal: round2((shift.expenseTotal || 0) + payload.amount) }
          : { cashInTotal: round2((shift.cashInTotal || 0) + payload.amount) })
      }
    }
    if (payload.supplierId && payload.type === 'withdraw') {
      usePosStore.setState(s => ({
        suppliers: s.suppliers.map(sup => {
          if (sup.id !== payload.supplierId) return sup
          const totalPaid = round2((Number(sup.totalPaid) || 0) + payload.amount)
          const totalSupplied = Number(sup.totalSupplied) || 0
          return {
            ...sup,
            totalPaid,
            payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
          }
        }),
      }))
    }
    void persistPosSnapshot()
    return move
  }

  return raceCashierOp(() => api.createFinanceMove(payload), applyLocal)
}

/** Выдать нал из открытой смены и записать долг на карту. Без смены / без наличных в ящике — ошибка. */
export async function chargeCashDebtFromOpenShift(
  client: AdminClient,
  amount: number,
  opts?: { note?: string; posId?: string },
): Promise<OfflineResult<{ debt: number }>> {
  const shift = resolveOpenShift(opts?.posId)
  if (!shift) {
    throw new Error('Откройте смену, чтобы выдать наличные из кассы')
  }
  const amt = round2(amount)
  if (!(amt > 0)) throw new Error('Укажите сумму')
  const expected = shiftExpectedCashLocal(shift)
  if (amt > expected + 0.009) {
    throw new Error(`В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`)
  }
  const note = opts?.note || `Выдача наличных · ${client.name}`
  await financeMoveSafe({
    type: 'withdraw',
    amount: amt,
    note,
    shiftId: shift.id,
    posId: shift.posId,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    createdBy: shift.cashierName,
  })
  try {
    const { adjustClientDebtSafe } = await import('./offlineLoyaltyOps')
    return await adjustClientDebtSafe(client, { action: 'charge', amount: amt })
  } catch (e) {
    await financeMoveSafe({
      type: 'deposit',
      amount: amt,
      note: `Отмена выдачи наличных · ${client.name}`,
      shiftId: shift.id,
      posId: shift.posId,
      cashierId: shift.cashierId,
      cashierName: shift.cashierName,
      createdBy: shift.cashierName,
    }).catch(() => { /* долг не записался — ящик вернём отдельно */ })
    throw e
  }
}

// ── Пополнение карты наличными ──

export async function cardTopupSafe(
  num: string,
  input: {
    cash: number
    credit: number
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId: string
    posId?: string
  },
): Promise<OfflineResult<null>> {
  const clientRef = newClientRef()
  const payload = { ...input, clientRef, cash: round2(input.cash), credit: round2(input.credit), num }

  const applyLocal = async () => {
    const { useCardStore } = await import('./cardStore')
    const card = useCardStore.getState().cards.find(c => c.num === num || cardNumsMatch(c.num, num))
    const nextBonus = round2((Number(card?.bonus) || 0) + payload.credit)
    const nextPos = round2((Number(card?.posCashBonus) || 0) + payload.credit)
    await useOfflineSync.getState().queueOp('card_topup', {
      ...payload,
      bonusAfter: nextBonus,
      posCashBonusAfter: nextPos,
    })
    const shift = input.shiftId ? shiftById(input.shiftId) : undefined
    if (shift) {
      patchShift(shift.id, { cashInTotal: round2((shift.cashInTotal || 0) + payload.cash) })
      usePosStore.setState(s => ({
        financeMoves: [{
          id: newLocalId('fin'),
          type: 'deposit',
          amount: payload.cash,
          note: input.note,
          createdBy: input.cashierName,
          createdAtIso: new Date().toISOString(),
          shiftId: shift.id,
          posId: input.posId,
          clientRef,
        } as FinanceMove, ...s.financeMoves],
      }))
    }
    useCardStore.getState().updateCardLoyalty(
      num,
      { bonus: nextBonus, posCashBonus: nextPos },
      { skipApi: true },
    )
    const { markMoneyPending } = await import('./loyaltySaveGuard')
    markMoneyPending({ cardNum: num, clientId: card?.clientId })
    return null
  }

  return raceCashierOp(
    async () => {
      await api.cashTopupCard(num, {
        clientRef,
        cash: payload.cash,
        credit: payload.credit,
        note: input.note,
        cashierId: input.cashierId,
        cashierName: input.cashierName,
        shiftId: input.shiftId,
        posId: input.posId,
      })
      return null
    },
    applyLocal,
  )
}

// ── Погашение долга ──

export type DebtRepayResult = {
  nextDebt: number
  bonusEarned: number
  /** Повтор того же погашения — касса и история уже записаны */
  duplicate?: boolean
}

const debtRepayInflight = new Map<string, Promise<OfflineResult<DebtRepayResult>>>()

function debtRepayDupKey(input: {
  num: string
  amount: number
  shiftId?: string
  clientId?: string
  method?: string
  note?: string
}) {
  return [
    String(input.num).trim(),
    round2(input.amount),
    String(input.shiftId || ''),
    String(input.clientId || ''),
    input.method === 'card' ? 'card' : 'cash',
    String(input.note || '').trim(),
  ].join('|')
}

function liveDebtNow(num: string, clientId: string | undefined, fallback: number) {
  const card = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))
  const client = clientId
    ? useClientStore.getState().clients.find(c => c.id === clientId)
    : undefined
  return round2(Math.max(effectiveDebt(card, client), fallback))
}

/** Клиент и карта чека: id / телефон / номер, в обе стороны. */
function resolveSaleClientAndCard(sale: {
  clientId?: string
  clientPhone?: string
  cardNum?: string
}) {
  const clientId = String(sale.clientId || '')
  const saleCardNum = String(sale.cardNum || '')
  const phone = String(sale.clientPhone || '')
  const clients = useClientStore.getState().clients
  const cards = useCardStore.getState().cards

  let cl = clientId ? clients.find(c => c.id === clientId) : undefined
  if (!cl && phone) cl = clients.find(c => phonesMatch(c.phone, phone))

  const wantNum = saleCardNum || cl?.card || ''
  let card = wantNum ? cards.find(c => cardNumsMatch(c.num, wantNum)) : undefined
  if (!card && cl) {
    card = cards.find(c =>
      (c.clientId && c.clientId === cl!.id && c.status !== 'unlinked')
      || (!!cl!.phone && phonesMatch(c.phone, cl!.phone) && c.status !== 'unlinked'),
    )
  }
  if (!cl && card) {
    cl = card.clientId
      ? clients.find(c => c.id === card!.clientId)
      : clients.find(c =>
          cardNumsMatch(c.card, card!.num)
          || (!!card!.phone && phonesMatch(c.phone, card!.phone)),
        )
  }
  const resolvedCardNum = card?.num || wantNum || cl?.card || ''
  return { cl, card, phone, resolvedCardNum }
}

export async function debtRepaySafe(
  num: string,
  input: {
    amount: number
    method?: 'cash' | 'card'
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId?: string
    posId?: string
    clientId?: string
    prevDebt: number
  },
): Promise<OfflineResult<DebtRepayResult>> {
  const method: 'cash' | 'card' = input.method === 'card' ? 'card' : 'cash'
  const amount = round2(input.amount)
  const key = debtRepayDupKey({
    num,
    amount,
    shiftId: input.shiftId,
    clientId: input.clientId,
    method,
    note: input.note,
  })
  const pending = debtRepayInflight.get(key)
  if (pending) {
    const first = await pending
    return { offline: first.offline, data: { ...first.data, duplicate: true } }
  }

  const clientRef = newClientRef()
  const payload = {
    clientRef,
    num,
    amount,
    method,
    note: input.note,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    shiftId: input.shiftId,
    posId: input.posId,
    clientId: input.clientId,
  }

  const applyLocal = async (): Promise<DebtRepayResult> => {
    const dup = await findDuplicateDebtRepay({
      num,
      amount,
      shiftId: input.shiftId,
      clientRef,
      clientId: input.clientId,
      method,
      note: input.note,
    })
    if (dup) {
      return {
        nextDebt: liveDebtNow(num, input.clientId, round2(Math.max(0, input.prevDebt - amount))),
        bonusEarned: 0,
        duplicate: true,
      }
    }
    const nextDebt = round2(Math.max(0, input.prevDebt - amount))
    await useOfflineSync.getState().queueOp('debt_repay', { ...payload, nextDebt })
    if (input.shiftId) {
      const shift = shiftById(input.shiftId)
      if (shift) {
        if (method === 'card') {
          patchShift(shift.id, { salesCard: round2((shift.salesCard || 0) + amount) })
        } else {
          patchShift(shift.id, { salesCash: round2((shift.salesCash || 0) + amount) })
        }
      }
    }
    useCardStore.getState().updateCardLoyalty(num, { debt: nextDebt }, { skipApi: true })
    if (input.clientId) {
      useClientStore.getState().updateClient(input.clientId, { debt: nextDebt }, { skipApi: true })
    }
    markMoneyPending({ clientId: input.clientId, cardNum: num })
    return { nextDebt, bonusEarned: 0 }
  }

  const run = localFirstOp(applyLocal)
  debtRepayInflight.set(key, run)
  try {
    return await run
  } finally {
    debtRepayInflight.delete(key)
  }
}

// ── Возврат чека ──

export async function returnSaleSafe(
  sale: PosSale,
  input: {
    note?: string
    cashierId?: string
    items?: { index?: number; productId?: number; qty: number }[]
  },
): Promise<OfflineResult<PosSale>> {
  const clientRef = newClientRef()

  const applyAndQueue = async () => {
    const returned = applyLocalReturn(sale, input.items)
    const party = resolveSaleClientAndCard({
      clientId: returned.clientId || sale.clientId,
      clientPhone: returned.clientPhone || sale.clientPhone,
      cardNum: returned.cardNum || sale.cardNum,
    })
    const clientDebtAfter = (party.cl || party.card)
      ? round2(effectiveDebt(party.cl, party.card))
      : undefined
    await useOfflineSync.getState().queueOp('sale_return', {
      clientRef,
      saleId: sale.id,
      note: input.note,
      cashierId: input.cashierId,
      items: input.items,
      clientId: party.cl?.id || returned.clientId || sale.clientId,
      cardNum: party.resolvedCardNum || returned.cardNum || sale.cardNum,
      clientDebtAfter,
      cutDebt: Math.max(0, round2((Number(sale.debtAdded) || 0) - (Number(returned.debtAdded) || 0))),
    })
    return returned
  }

  if (isLocalId(sale.id)) {
    const returned = await applyAndQueue()
    shadowMirrorSale(returned)
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: returned }
  }

  const res = await raceCashierOp(
    () => api.returnPosSale(sale.id, { clientRef }),
    applyAndQueue,
  )
  if (res.data) shadowMirrorSale(res.data)
  return res
}

/** Локальный возврат: товары на склад, долг/бонусы/кошелёк как на сервере */
function computeReturnCuts(sale: PosSale, returnTotal: number) {
  const bonusBefore = round2(Number(sale.bonusSpent) || 0)
  const origGoods = round2(
    Number((sale as any).orderGoodsTotal)
    || (Number((sale as any).originalTotal) || Number(sale.total) || 0) + bonusBefore
    || returnTotal,
  )
  let cutBonus = 0
  if (bonusBefore > 0 && origGoods > 0) {
    cutBonus = round2(Math.min(bonusBefore, bonusBefore * (returnTotal / origGoods)))
  }
  let remainCashCut = round2(Math.max(0, returnTotal - cutBonus))
  let cutDebt = 0
  let cutCash = 0
  let cutCard = 0
  let cutWallet = 0
  const debtBefore = round2(
    Number(sale.debtAdded) > 0
      ? Number(sale.debtAdded)
      : (sale.paymentMethod === 'credit' ? (Number(sale.total) || 0) : 0),
  )
  if (debtBefore > 0 && remainCashCut > 0) {
    cutDebt = Math.min(debtBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutDebt)
  }
  const walletBefore = round2(Number(sale.paidWallet) || 0)
  if (walletBefore > 0 && remainCashCut > 0) {
    cutWallet = Math.min(walletBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutWallet)
  }
  const cashBefore = round2(Number(sale.paidCash) || 0)
  if (cashBefore > 0 && remainCashCut > 0) {
    cutCash = Math.min(cashBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCash)
  }
  const cardBefore = round2(Number(sale.paidCard) || 0)
  if (cardBefore > 0 && remainCashCut > 0) {
    cutCard = Math.min(cardBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCard)
  }
  if (remainCashCut > 0) {
    if (cashBefore - cutCash > 0) {
      const extra = Math.min(cashBefore - cutCash, remainCashCut)
      cutCash = round2(cutCash + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
    if (remainCashCut > 0 && cardBefore - cutCard > 0) {
      const extra = Math.min(cardBefore - cutCard, remainCashCut)
      cutCard = round2(cutCard + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
    if (remainCashCut > 0 && bonusBefore - cutBonus > 0) {
      const extra = Math.min(bonusBefore - cutBonus, remainCashCut)
      cutBonus = round2(cutBonus + extra)
    }
  }
  return {
    cutBonus,
    cutDebt,
    cutCash,
    cutCard,
    cutWallet,
    debtBefore,
    walletBefore,
    cashBefore,
    cardBefore,
    bonusBefore,
  }
}

function applyLocalReturn(
  sale: PosSale,
  items?: { index?: number; productId?: number; qty: number }[],
): PosSale {
  const lines = Array.isArray(sale.items) ? sale.items : []
  const backByProduct = new Map<number, number>()

  const nextItems = lines.map((line, idx) => {
    const already = Number(line.returnedQty) || 0
    const left = Math.max(0, round2((Number(line.qty) || 0) - already))
    const asked = items
      ? Number(items.find(i => (i.index != null ? i.index === idx : i.productId === line.productId))?.qty) || 0
      : left
    const back = Math.min(left, round2(asked))
    if (back > 0) {
      backByProduct.set(line.productId, round2((backByProduct.get(line.productId) || 0) + back))
    }
    return back > 0 ? { ...line, returnedQty: round2(already + back) } : line
  })

  const fullyReturned = nextItems.every(l => (Number(l.returnedQty) || 0) >= (Number(l.qty) || 0) - 0.001)
  const lastReturnTotal = nextItems.reduce((sum, l, idx) => {
    const before = Number(lines[idx]?.returnedQty) || 0
    const after = Number(l.returnedQty) || 0
    const back = Math.max(0, after - before)
    if (back <= 0) return sum
    const qty = Number(l.qty) || 0
    const unit = qty > 0
      ? round2((Number(l.lineTotal) || 0) / qty)
      : round2(Number(l.price) || 0)
    return sum + back * unit
  }, 0)
  const cuts = computeReturnCuts(sale, round2(lastReturnTotal))

  const updated: PosSale = {
    ...sale,
    items: nextItems,
    status: fullyReturned ? 'returned' : 'partial',
    lastReturnTotal: round2(lastReturnTotal),
    debtAdded: Math.max(0, round2(cuts.debtBefore - cuts.cutDebt)),
    paidCash: Math.max(0, round2(cuts.cashBefore - cuts.cutCash)),
    paidCard: Math.max(0, round2(cuts.cardBefore - cuts.cutCard)),
    paidWallet: Math.max(0, round2(cuts.walletBefore - cuts.cutWallet)),
    bonusSpent: Math.max(0, round2(cuts.bonusBefore - cuts.cutBonus)),
    total: Math.max(0, round2((Number(sale.total) || 0) - (round2(lastReturnTotal) - cuts.cutBonus))),
  } as PosSale

  usePosStore.setState(s => ({ sales: s.sales.map(x => (x.id === sale.id ? updated : x)) }))

  if (sale.shiftId) {
    const shift = shiftById(sale.shiftId)
    if (shift && shift.status === 'open') {
      patchShift(sale.shiftId, {
        ...(fullyReturned ? { salesCount: Math.max(0, (Number(shift.salesCount) || 0) - 1) } : {}),
        salesCash: Math.max(0, round2((Number(shift.salesCash) || 0) - cuts.cutCash)),
        salesCard: Math.max(0, round2((Number(shift.salesCard) || 0) - cuts.cutCard)),
        salesCredit: Math.max(0, round2((Number(shift.salesCredit) || 0) - cuts.cutDebt)),
        ...(cuts.cutWallet > 0
          ? { salesWallet: Math.max(0, round2((Number((shift as any).salesWallet) || 0) - cuts.cutWallet)) }
          : {}),
      })
    }
  }

  applyReturnClientMoneySync(sale, cuts)

  void (async () => {
    const { useProducts } = await import('./store')
    const ps = useProducts.getState()
    for (const [productId, qty] of backByProduct) {
      const p = ps.products.find(x => x.id === productId)
      if (!p) continue
      ps.updateProduct(productId, { stock: round2((Number(p.stock) || 0) + qty) })
    }
  })()

  return updated
}

function applyReturnClientMoneySync(sale: PosSale, cuts: ReturnType<typeof computeReturnCuts>) {
  if (!(cuts.cutDebt > 0 || cuts.cutWallet > 0 || cuts.cutBonus > 0)) return
  const { cl, card, phone, resolvedCardNum } = resolveSaleClientAndCard(sale)
  markMoneyPending({ clientId: cl?.id, cardNum: resolvedCardNum })
  if (sale.cardNum && resolvedCardNum && !cardNumsMatch(sale.cardNum, resolvedCardNum)) {
    markMoneyPending({ cardNum: sale.cardNum })
  }
  if (cl?.card && resolvedCardNum && !cardNumsMatch(cl.card, resolvedCardNum)) {
    markMoneyPending({ cardNum: cl.card })
  }

  const nextDebt = Math.max(0, round2(effectiveDebt(cl, card) - cuts.cutDebt))
  const nums = [resolvedCardNum, sale.cardNum, cl?.card, card?.num]
    .map(n => String(n || '').trim())
    .filter((n, i, arr) => n && arr.findIndex(x => cardNumsMatch(x, n)) === i)

  const clientPatch: Partial<AdminClient> = {}
  if (cuts.cutDebt > 0) clientPatch.debt = nextDebt
  if (cuts.cutWallet > 0) clientPatch.wallet = round2((Number(cl?.wallet) || 0) + cuts.cutWallet)
  if (cuts.cutBonus > 0) clientPatch.bonus = round2((Number(cl?.bonus) || 0) + cuts.cutBonus)
  if (cl && Object.keys(clientPatch).length) {
    useClientStore.getState().updateClient(cl.id, clientPatch, { skipApi: true })
  }

  for (const num of nums) {
    const cur = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))
    if (!cur && !cl) continue
    const cardPatch: Record<string, unknown> = {}
    if (cuts.cutDebt > 0) cardPatch.debt = nextDebt
    if (cuts.cutWallet > 0) {
      cardPatch.wallet = round2((Number(cur?.wallet) || Number(cl?.wallet) || 0) + cuts.cutWallet)
    }
    if (cuts.cutBonus > 0) {
      cardPatch.bonus = round2((Number(cur?.bonus) || Number(cl?.bonus) || 0) + cuts.cutBonus)
      cardPatch.posCashBonus = round2((Number(cur?.posCashBonus) || 0) + cuts.cutBonus)
    }
    if (Object.keys(cardPatch).length) {
      useCardStore.getState().updateCardLoyalty(num, cardPatch as any, { skipApi: true })
    }
  }

  if (cuts.cutDebt > 0) {
    const histKey = debtAccountKey(cl) || String(phone || '').trim()
    if (histKey) {
      recordStoreDebtRepayment(histKey, cuts.cutDebt, {
        desc: `Возврат чека · долг −${cuts.cutDebt}`,
        orderId: sale.orderId || sale.id,
        source: 'cashier',
      })
    }
  }
}

// ── Продажа (касса) ──

/**
 * Пробитие чека: local-first (сразу локально + очередь).
 * Банковская карта без V2 — нужен живой сервер/терминал.
 * Offline V2=on: локально правит бонусы и кошелёк в сторе.
 */
export async function createSaleSafe(
  input: CreateSaleSafeInput,
): Promise<OfflineResult<PosSale & { orderId?: string; _offline?: boolean }>> {
  const cashPaid = round2(input.cashPaid)
  const cardPaid = round2(input.cardPaid)
  const debtAdded = round2(input.debtAdded)
  const walletPaid = round2(input.walletPaid || 0)
  const spend = Math.max(0, Math.floor(Number(input.bonusSpend) || 0))
  const earn = Math.max(0, Math.floor(Number(input.bonusEarn) || 0))
  const client = input.client || null
  const salePayload = { ...input.salePayload }
  if (!(Number(salePayload.opSeq) > 0)) {
    await ensurePosOpSeqReady()
    const posId = String(salePayload.posId || '').trim()
    const deviceId = String(salePayload.deviceId || getTradeDeviceIdSync() || '').trim()
    salePayload.deviceId = deviceId || undefined
    salePayload.deviceName = salePayload.deviceName || getBoundDeviceNameSync() || undefined
    salePayload.opSeq = allocPosOpSeq(posId, deviceId)
  }

  const applyLocal = async (): Promise<PosSale & { orderId?: string; _offline?: boolean }> => {
    useOfflineSync.getState().markOffline()
    const offlineSaleId = newLocalId('sale')
    const linkedCard = client?.card
      ? useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
      : undefined
    const nextDebt = client
      ? round2(effectiveDebt(client, linkedCard) + (debtAdded > 0.001 ? debtAdded : 0))
      : 0
    if (client) {
      const nextWallet = walletPaid > 0.001
        ? round2(Math.max(0, (Number(client.wallet) || 0) - walletPaid))
        : round2(Number(client.wallet) || 0)
      salePayload.appliedLocal = true
      salePayload.skipBalances = true
      salePayload.clientDebtAfter = nextDebt
      salePayload.walletAfter = nextWallet
      if (salePayload.bonusBalanceAfter != null) {
        salePayload.bonusAfter = salePayload.bonusBalanceAfter
      }
    }
    await useOfflineSync.getState().queueOp('sale', salePayload, { localId: offlineSaleId })

    try {
      const { useProducts } = await import('./store')
      const ps = useProducts.getState()
      for (const l of input.cart) {
        const p = ps.products.find(x => x.id === l.productId)
        if (!p) continue
        const dec = l.weightKg != null ? l.weightKg : l.qty
        ps.updateProduct(l.productId, { stock: Math.max(0, (Number(p.stock) || 0) - dec) })
      }
      // Партии — в фоне: раньше await entityPut по всем слоям на каждую позицию
      // держал «Пробиваем…» на секунды.
      const layerLines = input.cart.map(l => ({
        productId: l.productId,
        qty: l.weightKg != null ? l.weightKg : l.qty,
      }))
      void import('./stockLayersLocal')
        .then(m => m.consumeLocalLayersFifoBatch(layerLines))
        .catch(() => {})
    } catch { /* ignore */ }

    if (client) {
      if (debtAdded > 0.001) {
        useClientStore.getState().updateClient(
          client.id,
          { debt: nextDebt, debtEnabled: true },
          { skipApi: true },
        )
        if (client.card) {
          useCardStore.getState().updateCardLoyalty(
            client.card,
            { debt: nextDebt, debtEnabled: true },
            { skipApi: true },
          )
        }
      }

      if (walletPaid > 0.001) {
        const nextWallet = round2(Math.max(0, (Number(client.wallet) || 0) - walletPaid))
        useClientStore.getState().updateClient(client.id, { wallet: nextWallet }, { skipApi: true })
        if (client.card) {
          const currentCard = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
          useCardStore.getState().updateCardLoyalty(
            client.card,
            { wallet: round2(Math.max(0, (Number(currentCard?.wallet) || Number(client.wallet) || 0) - walletPaid)) },
            { skipApi: true },
          )
        }
      }

      if (client.card && (spend > 0 || earn > 0)) {
        const currentCard = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
        const base = Math.max(0, Math.floor(Number(currentCard?.bonus) || 0))
        const prevPos = Math.max(0, Math.floor(Number(currentCard?.posCashBonus) || 0))
        const nextBonus = Math.max(0, base - spend + earn)
        const nextPos = Math.max(0, prevPos - spend + earn)
        useCardStore.getState().updateCardLoyalty(
          client.card,
          {
            bonus: nextBonus,
            posCashBonus: nextPos,
            ...(spend > 0 ? { allowBonusDecrease: true } : {}),
          } as any,
          { skipApi: true },
        )
        useClientStore.getState().updateClient(client.id, { bonus: nextBonus }, { skipApi: true })
      }
      if (debtAdded > 0.001 || walletPaid > 0.001 || spend > 0 || earn > 0) {
        const { markMoneyPending } = await import('./loyaltySaveGuard')
        markMoneyPending({ clientId: client.id, cardNum: client.card })
      }
    }

    const display = await allocateLocalSaleDisplay()
    const offlineSale: PosSale & { orderId?: string; _offline?: boolean } = {
      ...(salePayload as unknown as PosSale),
      id: offlineSaleId,
      number: display.number,
      orderId: display.orderId,
      total: input.total,
      _offline: true,
    }
    usePosStore.setState(st => ({
      sales: [offlineSale, ...st.sales],
      shifts: st.shifts.map(sh => sh.id === input.shiftId ? {
        ...sh,
        salesCash: round2((sh.salesCash || 0) + cashPaid),
        salesCard: round2((sh.salesCard || 0) + cardPaid),
        salesCredit: round2((sh.salesCredit || 0) + debtAdded),
        salesCount: (sh.salesCount || 0) + 1,
        ...(walletPaid > 0.001
          ? { salesWallet: round2((Number((sh as any).salesWallet) || 0) + walletPaid) }
          : {}),
      } : sh),
    }))
    shadowMirrorSale(offlineSale)
    void persistPosSnapshot()
    return offlineSale
  }

  const patchShiftOnline = (created: PosSale) => {
    usePosStore.setState(st => ({
      sales: [created, ...st.sales.filter(x => x.id !== created.id)],
      shifts: st.shifts.map(sh => sh.id === input.shiftId ? {
        ...sh,
        salesCash: round2((sh.salesCash || 0) + cashPaid),
        salesCard: round2((sh.salesCard || 0) + cardPaid),
        salesCredit: round2((sh.salesCredit || 0) + debtAdded),
        salesCount: (sh.salesCount || 0) + 1,
        ...(walletPaid > 0.001
          ? { salesWallet: round2((Number((sh as any).salesWallet) || 0) + walletPaid) }
          : {}),
      } : sh),
    }))
    void (async () => {
      try {
        const { useProducts } = await import('./store')
        const ps = useProducts.getState()
        for (const l of input.cart) {
          const p = ps.products.find(x => x.id === l.productId)
          if (!p) continue
          const dec = l.weightKg != null ? l.weightKg : l.qty
          ps.updateProduct(l.productId, { stock: Math.max(0, (Number(p.stock) || 0) - dec) })
        }
      } catch { /* ignore */ }
    })()
    shadowMirrorSale(created)
  }

  // Всегда local-first: нал и карта сразу, сервер из очереди в фоне
  return localFirstOp(applyLocal)
}

// ── Расход (FinanceModule, Offline V2) ──

function openShiftId(): string | undefined {
  return resolveOpenShift()?.id
}

function applyExpenseToShift(shiftId: string | undefined, amount: number, dir: 1 | -1) {
  if (!shiftId || !(amount > 0)) return
  const shift = shiftById(shiftId)
  if (!shift) return
  const next = round2(Math.max(0, (Number(shift.expenseTotal) || 0) + dir * amount))
  patchShift(shiftId, { expenseTotal: next })
}

/** Оплата закупа налом с открытой смены (локально). */
export function applyPurchasePayToOpenShift(amount: number, dir: 1 | -1 = 1, posId?: string): string | undefined {
  const amt = round2(amount)
  if (!(amt > 0.001)) return undefined
  const open = resolveOpenShift(posId)
  if (!open) return undefined
  if (dir > 0) {
    const expected = shiftExpectedCashLocal(open)
    if (amt > expected + 0.009) {
      throw new Error(`В кассе недостаточно наличных для оплаты закупа (доступно ${expected.toFixed(2)} сом)`)
    }
  }
  applyExpenseToShift(open.id, amt, dir)
  return open.id
}

export async function expenseCreateSafe(input: {
  category: string
  amount: number
  note?: string
  createdBy?: string
  shiftId?: string
  posId?: string
}): Promise<OfflineResult<PosExpense>> {
  const clientRef = newClientRef()
  const open = resolveOpenShift(input.posId)
  const shiftId = input.shiftId || open?.id
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму расхода')
  if (shiftId) {
    const shift = shiftById(shiftId)
    if (shift) {
      const expected = shiftExpectedCashLocal(shift)
      if (amount > expected + 0.009) {
        throw new Error(`В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`)
      }
    }
  }
  const payload = {
    ...input,
    shiftId,
    posId: input.posId || open?.posId,
    clientRef,
    amount,
    category: String(input.category || 'Прочее').trim() || 'Прочее',
  }

  if (!isTradeLocalFirst()) {
    const exp = await api.createExpense(payload)
    if (exp?.shiftId) {
      applyExpenseToShift(String(exp.shiftId), Number(exp.amount) || payload.amount, 1)
    } else if (shiftId) {
      // сервер мог не вернуть shiftId — локально всё равно учтём открытую смену
      applyExpenseToShift(shiftId, payload.amount, 1)
    }
    usePosStore.setState(s => ({ expenses: [exp, ...s.expenses.filter(e => e.id !== exp.id)] }))
    void persistPosSnapshot()
    return { offline: false, data: exp }
  }

  const applyLocal = async () => {
    const localId = newLocalId('exp')
    await useOfflineSync.getState().queueOp('expense_create', payload, { localId, clientRef })
    const exp: PosExpense = {
      id: localId,
      category: payload.category,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
      createdAtIso: new Date().toISOString(),
      shiftId: payload.shiftId,
    }
    usePosStore.setState(s => ({ expenses: [exp, ...s.expenses] }))
    applyExpenseToShift(payload.shiftId, payload.amount, 1)
    void persistPosSnapshot()
    shadowMirrorPut('finance_move', `exp:${exp.id}`, exp)
    return exp
  }

  const res = await raceCashierOp(() => api.createExpense(payload), applyLocal)
  if (res.data) shadowMirrorPut('finance_move', `exp:${res.data.id}`, res.data)
  return res
}

// ── Удаление расхода (Offline V2) ──

function reverseExpenseLocal(id: string) {
  const exp = usePosStore.getState().expenses.find(e => e.id === id)
  if (exp) {
    applyExpenseToShift(exp.shiftId, Number(exp.amount) || 0, -1)
  }
  usePosStore.setState(s => ({ expenses: s.expenses.filter(e => e.id !== id) }))
}

export async function expenseDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isTradeLocalFirst()) {
    await api.deleteExpense(id)
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('expense_delete', { clientRef, id }, { clientRef })
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteExpense(id)
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { id }
  }, applyLocal)
}

// ── Удаление движения (Offline V2) ──

function reverseFinanceMoveLocal(id: string) {
  const move = usePosStore.getState().financeMoves.find(m => m.id === id)
  if (!move) {
    usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => m.id !== id) }))
    return
  }
  const amount = round2(Number(move.amount) || 0)
  if (move.shiftId && amount > 0) {
    const shift = shiftById(move.shiftId)
    if (shift) {
      if (move.type === 'withdraw') {
        patchShift(move.shiftId, {
          expenseTotal: round2(Math.max(0, (Number(shift.expenseTotal) || 0) - amount)),
        })
      } else {
        patchShift(move.shiftId, {
          cashInTotal: round2(Math.max(0, (Number(shift.cashInTotal) || 0) - amount)),
        })
      }
    }
  }
  if (move.supplierId && move.type === 'withdraw' && amount > 0) {
    usePosStore.setState(s => ({
      suppliers: s.suppliers.map(sup => {
        if (sup.id !== move.supplierId) return sup
        const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) - amount))
        const totalSupplied = Number(sup.totalSupplied) || 0
        return {
          ...sup,
          totalPaid,
          payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
        }
      }),
    }))
  }
  usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => m.id !== id) }))
}

export async function financeMoveDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isTradeLocalFirst()) {
    await api.deleteFinanceMove(id)
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('finance_move_delete', { clientRef, id }, { clientRef })
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteFinanceMove(id)
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { id }
  }, applyLocal)
}

// ── Точки продаж / кассиры (мгновенно локально) ──

export async function createPosPointSafe(input: {
  name: string
  code?: string
  note?: string
  receiptPhone?: string
}): Promise<OfflineResult<import('./types').PosPoint>> {
  const clientRef = newClientRef()
  const localId = newLocalId('pos')
  const point = {
    id: localId,
    name: String(input.name || '').trim(),
    code: input.code?.trim() || undefined,
    note: input.note?.trim() || undefined,
    receiptPhone: input.receiptPhone?.trim() || undefined,
    active: true,
    createdAtIso: new Date().toISOString(),
  }
  const applyLocal = async () => {
    usePosStore.setState(s => ({ posPoints: [point, ...s.posPoints] }))
    await useOfflineSync.getState().queueOp(
      'pos_point_upsert',
      { clientRef, localId, point },
      { localId, clientRef },
    )
    void persistPosSnapshot()
    return point
  }
  return localFirstOp(applyLocal)
}

export async function updatePosPointSafe(
  id: string,
  patch: Partial<{ name: string; code: string; note: string; receiptPhone: string; active: boolean }>,
): Promise<OfflineResult<import('./types').PosPoint>> {
  const clientRef = newClientRef()
  const applyLocal = async () => {
    const cur = usePosStore.getState().posPoints.find(p => p.id === id)
    if (!cur) throw new Error('Точка не найдена')
    const point = {
      ...cur,
      ...patch,
      name: patch.name != null ? String(patch.name).trim() : cur.name,
      code: patch.code != null ? String(patch.code).trim() : cur.code,
      note: patch.note != null ? String(patch.note).trim() : cur.note,
      receiptPhone: patch.receiptPhone != null ? String(patch.receiptPhone).trim() : cur.receiptPhone,
    }
    usePosStore.setState(s => ({
      posPoints: s.posPoints.map(p => (p.id === id ? point : p)),
    }))
    await useOfflineSync.getState().queueOp(
      'pos_point_upsert',
      { clientRef, localId: id, point },
      { localId: id, clientRef },
    )
    void persistPosSnapshot()
    return point
  }
  return localFirstOp(applyLocal)
}

export async function deletePosPointSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const applyLocal = async () => {
    usePosStore.setState(s => ({
      posPoints: s.posPoints.filter(p => p.id !== id),
    }))
    if (!isLocalId(id)) {
      await useOfflineSync.getState().queueOp(
        'pos_point_delete',
        { clientRef, id },
        { clientRef },
      )
    }
    void persistPosSnapshot()
    return { id }
  }
  return localFirstOp(applyLocal)
}

export async function ensureCashierSafe(input: {
  name: string
  preferredId?: string
}): Promise<OfflineResult<import('./types').PosCashier>> {
  const preferredId = input.preferredId
  if (preferredId && preferredId !== 'local') {
    const found = usePosStore.getState().cashiers.find(c => c.id === preferredId)
    if (found) return { offline: false, data: found }
  }
  const trimmed = String(input.name || '').trim() || 'Кассир'
  const existing = usePosStore.getState().cashiers.find(c => c.name === trimmed)
  if (existing) return { offline: false, data: existing }

  const clientRef = newClientRef()
  const localId = newLocalId('csh')
  const cashier = {
    id: localId,
    name: trimmed,
    pin: '0000',
    active: true,
    salesCount: 0,
    salesTotal: 0,
    createdAtIso: new Date().toISOString(),
  }
  const applyLocal = async () => {
    usePosStore.setState(s => ({ cashiers: [...s.cashiers, cashier] }))
    await useOfflineSync.getState().queueOp(
      'cashier_upsert',
      { clientRef, localId, cashier },
      { localId, clientRef },
    )
    void persistPosSnapshot()
    return cashier
  }
  return localFirstOp(applyLocal)
}
