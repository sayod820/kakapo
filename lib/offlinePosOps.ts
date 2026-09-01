// ════════════════════════════════════════════════
// KAKAPO — операции кассы без интернета
// Local-first: сразу локально + очередь, синк с сервером в фоне
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import { dropPending, findDuplicateDebtRepay, getPending, isLocalId, isOnline, newClientRef, newLocalId, persistPosSnapshot, cacheData, readCachedData, resolveLocalId } from './offline'
import { cardNumsMatch, effectiveDebt } from './cardCrm'
import { phonesMatch, type AdminClient } from './clientCrm'
import { debtAccountKey, dropDebtHistoryByClientRef, recordStoreDebtRepayment } from './clientVipCredit'
import { localFirstOp, type OfflineResult } from './localFirst'
import { markMoneyPending, clearMoneyPending } from './loyaltySaveGuard'
import { isTradeLocalFirst, shadowMirrorPut, shadowMirrorSale, shadowMirrorShift } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore, noteInboundDeletedIds } from './posStore'
import { supplierPayVersion } from './offlineSupplierOps'
import { useClientStore } from './clientStore'
import { useCardStore } from './cardStore'
import { allocPosOpSeq, ensurePosOpSeqReady } from './posOpSeq'
import { getBoundDeviceNameSync, getTradeDeviceIdSync } from './tradeDevice'
import type { FinanceMove, PosExpense, PosSale, PosShift, MoneyPayFrom, MoneyPayMethod } from './types'

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
    shifts: s.shifts.map(x => (
      x.id === shiftId
        ? { ...x, ...patch, updatedAtIso: patch.updatedAtIso || new Date().toISOString() }
        : x
    )),
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
  const posId = String(input.posId || '').trim()
  const opens = usePosStore.getState().shifts.filter(s => s.status === 'open')
  if (posId && opens.some(s => String(s.posId || '') === posId)) {
    throw new Error('На этой точке продаж уже открыта сессия')
  }
  if (opens.some(s => String(s.cashierId || '') === String(input.cashierId))) {
    throw new Error('У кассира уже открыта смена')
  }

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
    const openedAtIso = new Date().toISOString()
    const shift: PosShift = {
      id: localId,
      posId: input.posId,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      openedAtIso,
      openingCash: round2(input.openingCash),
      salesCash: 0,
      salesCard: 0,
      salesCredit: 0,
      salesCount: 0,
      expenseTotal: 0,
      cashInTotal: 0,
      status: 'open',
      note: input.note,
      clientRef,
    }
    await useOfflineSync.getState().queueOp('shift_open', { ...payload, openedAtIso }, { localId })
    usePosStore.setState(s => ({ shifts: [shift, ...s.shifts] }))
    return shift
  }

  const res = await raceCashierOp(() => api.openPosShift(payload), applyLocal)
  if (res.data) shadowMirrorShift(res.data)
  return res
}

export async function closeShiftSafe(
  shiftId: string,
  input: { closingCash: number; closingCard?: number; note?: string },
): Promise<OfflineResult<PosShift | null>> {
  const clientRef = newClientRef()
  const payload = {
    clientRef,
    shiftId,
    closingCash: round2(input.closingCash),
    closingCard: input.closingCard != null ? round2(input.closingCard) : undefined,
    note: input.note,
  }

  const applyLocal = async () => {
    const current = shiftById(shiftId)
    const expected = current
      ? round2((current.openingCash || 0) + (current.salesCash || 0) + (current.cashInTotal || 0) - (current.expenseTotal || 0))
      : payload.closingCash
    const expectedCard = current ? round2(Number(current.salesCard) || 0) : 0
    const actualCard = payload.closingCard != null ? payload.closingCard : expectedCard
    const cashDiff = round2(payload.closingCash - expected)
    const cardDiff = round2(actualCard - expectedCard)
    const net = round2(cashDiff + cardDiff)
    const moved = Math.abs(cashDiff) >= 0.009 && Math.abs(cardDiff) >= 0.009
      && Math.abs(net) < 0.009 && Math.sign(cashDiff) !== Math.sign(cardDiff)
    const reconcileNote = moved
      ? (cashDiff < 0
        ? `Переместили ${Math.abs(cashDiff).toFixed(2)} сом с нал → карта`
        : `Переместили ${Math.abs(cardDiff).toFixed(2)} сом с карта → нал`)
      : (Math.abs(cashDiff) < 0.009 && Math.abs(cardDiff) < 0.009
        ? 'Всё совпало'
        : [
            Math.abs(cashDiff) < 0.009 ? 'нал · без расхождения' : (cashDiff > 0 ? `нал · излишек ${cashDiff.toFixed(2)}` : `нал · недостача ${Math.abs(cashDiff).toFixed(2)}`),
            Math.abs(cardDiff) < 0.009 ? 'карта · без расхождения' : (cardDiff > 0 ? `карта · излишек ${cardDiff.toFixed(2)}` : `карта · недостача ${Math.abs(cardDiff).toFixed(2)}`),
          ].join(' · '))
    const closedAtIso = new Date().toISOString()
    const note = String(payload.note || reconcileNote || '').trim()
    await useOfflineSync.getState().queueOp('shift_close', { ...payload, note, closedAtIso })
    const patch = {
      status: 'closed' as const,
      closedAtIso,
      closingCash: payload.closingCash,
      actualCash: payload.closingCash,
      expectedCash: expected,
      cashDiff,
      expectedCard,
      actualCard,
      closingCard: actualCard,
      cardDiff,
      reconcileNote,
      note,
    }
    patchShift(shiftId, patch)
    if (current) {
      applyLocalVaultTransfer({ ...current, ...patch })
    }
    void persistPosSnapshot()
    return current ? { ...current, ...patch } : null
  }

  const res = await raceCashierOp(
    () => api.closePosShift(shiftId, {
      clientRef,
      closingCash: payload.closingCash,
      closingCard: payload.closingCard,
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
  const cardAmount = round2(
    shift.actualCard != null ? Number(shift.actualCard)
      : (shift.closingCard != null ? Number(shift.closingCard) : (Number(shift.salesCard) || 0)),
  )
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
      vaultVersion: (Number(s.cashVault?.vaultVersion) || 0) + 1,
      transfers: [transfer, ...(s.cashVault?.transfers || [])],
      converts: s.cashVault?.converts,
    },
  }))
}

function vaultVersionLocal(): number {
  return Number(usePosStore.getState().cashVault?.vaultVersion) || 0
}

function bumpVaultVersionLocal() {
  usePosStore.setState(s => ({
    cashVault: {
      ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
      vaultVersion: (Number(s.cashVault?.vaultVersion) || 0) + 1,
    },
  }))
}

type VaultConvertShiftSlice = {
  shiftId: string
  amount: number
  fromIn?: number
  fromSales?: number
  fromOpening?: number
}

type VaultConvertSlice = {
  dir: 'card_to_cash' | 'cash_to_card'
  fromMain: number
  fromShifts: VaultConvertShiftSlice[]
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
  const expectedVaultVersion = vaultVersionLocal()
  const payload: Record<string, unknown> = {
    clientRef,
    amount,
    note: input.note,
    expectedVaultVersion,
  }

  const applyLocal = async () => {
    const localId = newLocalId('vcc')
    const slice = applyLocalCardToCash(amount)
    payload._revert = slice
    await useOfflineSync.getState().queueOp('vault_card_to_cash', payload, { localId, clientRef })
    void persistPosSnapshot()
    return { id: localId, amount }
  }

  return raceCashierOp(
    () => api.convertVaultCardToCash({
      clientRef,
      amount,
      note: input.note,
      expectedVaultVersion,
    }),
    applyLocal,
  )
}

function applyLocalCardToCash(amount: number): VaultConvertSlice {
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
        vaultVersion: (Number(s.cashVault?.vaultVersion) || 0) + 1,
      },
    }))
    left = round2(left - fromMain)
  } else {
    bumpVaultVersionLocal()
  }
  const fromShifts: VaultConvertShiftSlice[] = []
  if (left > 0.001) {
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
      fromShifts.push({ shiftId: sh.id, amount: take })
      left = round2(left - take)
    }
  }
  return { dir: 'card_to_cash', fromMain, fromShifts }
}

function applyLocalCashToCard(amount: number): VaultConvertSlice {
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
        vaultVersion: (Number(s.cashVault?.vaultVersion) || 0) + 1,
      },
    }))
    left = round2(left - fromMain)
  } else {
    bumpVaultVersionLocal()
  }
  const fromShifts: VaultConvertShiftSlice[] = []
  if (left > 0.001) {
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
      const fromOpening = rest > 0.001 ? rest : 0
      if (fromOpening > 0.001) {
        patch.openingCash = round2(Math.max(0, (Number(sh.openingCash) || 0) - fromOpening))
      }
      patchShift(sh.id, patch)
      fromShifts.push({ shiftId: sh.id, amount: take, fromIn, fromSales, fromOpening })
      left = round2(left - take)
    }
  }
  return { dir: 'cash_to_card', fromMain, fromShifts }
}

function revertVaultConvertSlice(slice: VaultConvertSlice | Record<string, unknown> | undefined) {
  if (!slice || typeof slice !== 'object') return
  const dir = String((slice as VaultConvertSlice).dir || '')
  const fromMain = round2(Number((slice as VaultConvertSlice).fromMain) || 0)
  const fromShifts = Array.isArray((slice as VaultConvertSlice).fromShifts)
    ? (slice as VaultConvertSlice).fromShifts
    : []

  const decVault = () => {
    usePosStore.setState(s => ({
      cashVault: {
        ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
        vaultVersion: Math.max(0, (Number(s.cashVault?.vaultVersion) || 0) - 1),
      },
    }))
  }

  if (dir === 'card_to_cash') {
    if (fromMain > 0.001) {
      usePosStore.setState(s => ({
        cashVault: {
          ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
          cardTotal: round2((Number(s.cashVault?.cardTotal) || 0) + fromMain),
          cashTotal: round2(Math.max(0, (Number(s.cashVault?.cashTotal) || 0) - fromMain)),
          vaultVersion: Math.max(0, (Number(s.cashVault?.vaultVersion) || 0) - 1),
        },
      }))
    } else {
      decVault()
    }
    for (const part of fromShifts) {
      const sh = shiftById(String(part.shiftId || ''))
      if (!sh) continue
      const take = round2(Number(part.amount) || 0)
      if (!(take > 0.001)) continue
      patchShift(sh.id, {
        salesCard: round2((Number(sh.salesCard) || 0) + take),
        cashInTotal: round2(Math.max(0, (Number(sh.cashInTotal) || 0) - take)),
      })
    }
  } else if (dir === 'cash_to_card') {
    if (fromMain > 0.001) {
      usePosStore.setState(s => ({
        cashVault: {
          ...(s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }),
          cashTotal: round2((Number(s.cashVault?.cashTotal) || 0) + fromMain),
          cardTotal: round2(Math.max(0, (Number(s.cashVault?.cardTotal) || 0) - fromMain)),
          vaultVersion: Math.max(0, (Number(s.cashVault?.vaultVersion) || 0) - 1),
        },
      }))
    } else {
      decVault()
    }
    for (const part of fromShifts) {
      const sh = shiftById(String(part.shiftId || ''))
      if (!sh) continue
      const take = round2(Number(part.amount) || 0)
      if (!(take > 0.001)) continue
      const fromIn = round2(Number(part.fromIn) || 0)
      const fromSales = round2(Number(part.fromSales) || 0)
      const fromOpening = round2(Number(part.fromOpening) || 0)
      patchShift(sh.id, {
        salesCard: round2(Math.max(0, (Number(sh.salesCard) || 0) - take)),
        cashInTotal: round2((Number(sh.cashInTotal) || 0) + fromIn),
        salesCash: round2((Number(sh.salesCash) || 0) + fromSales),
        openingCash: round2((Number(sh.openingCash) || 0) + fromOpening),
      })
    }
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
  const expectedVaultVersion = vaultVersionLocal()
  const payload: Record<string, unknown> = {
    clientRef,
    amount,
    note: input.note,
    expectedVaultVersion,
  }

  const applyLocal = async () => {
    const localId = newLocalId('vct')
    const slice = applyLocalCashToCard(amount)
    payload._revert = slice
    await useOfflineSync.getState().queueOp('vault_cash_to_card', payload, { localId, clientRef })
    void persistPosSnapshot()
    return { id: localId, amount }
  }

  return raceCashierOp(
    () => api.convertVaultCashToCard({
      clientRef,
      amount,
      note: input.note,
      expectedVaultVersion,
    }),
    applyLocal,
  )
}

/** Откат локального перевода ящика, если сервер отказал */
export function revertLocalVaultConvertOnReject(payload: Record<string, unknown>) {
  revertVaultConvertSlice((payload._revert || payload) as VaultConvertSlice)
  void persistPosSnapshot()
}

/** Сколько доступно в основном ящике */
export function vaultAvailableLocal(method: MoneyPayMethod = 'cash'): number {
  const vault = usePosStore.getState().cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  return round2(method === 'card'
    ? (Number(vault.cardTotal) || 0)
    : (Number(vault.cashTotal) || 0))
}

/** Сколько доступно в открытой смене (нал или карта) */
export function shiftAvailableLocal(
  shift: Pick<PosShift, 'openingCash' | 'salesCash' | 'cashInTotal' | 'expenseTotal' | 'salesCard'>,
  method: MoneyPayMethod = 'cash',
): number {
  if (method === 'card') return round2(Number(shift.salesCard) || 0)
  return shiftExpectedCashLocal(shift)
}

/**
 * Списать / вернуть деньги из кассы смены или основного ящика.
 * dir=1 — списание (оплата/снятие), dir=-1 — вернуть обратно.
 */
export function applyMoneyOutLocal(opts: {
  amount: number
  payFrom?: MoneyPayFrom
  method?: MoneyPayMethod
  dir?: 1 | -1
  posId?: string
  shiftId?: string
}): { shiftId?: string; payFrom: MoneyPayFrom; method: MoneyPayMethod } {
  const amt = round2(opts.amount)
  const payFrom: MoneyPayFrom = opts.payFrom === 'vault' ? 'vault' : 'shift'
  const method: MoneyPayMethod = opts.method === 'card' ? 'card' : 'cash'
  const dir = opts.dir === -1 ? -1 : 1
  if (!(amt > 0.001)) return { payFrom, method }

  if (payFrom === 'vault') {
    const have = vaultAvailableLocal(method)
    if (dir > 0 && amt > have + 0.009) {
      throw new Error(
        method === 'card'
          ? `В основном ящике на карте только ${have.toFixed(2)} сом`
          : `В основном ящике наличных только ${have.toFixed(2)} сом`,
      )
    }
    usePosStore.setState(s => {
      const v = s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
      const nextVer = dir > 0
        ? (Number(v.vaultVersion) || 0) + 1
        : Math.max(0, (Number(v.vaultVersion) || 0) - 1)
      if (method === 'card') {
        return {
          cashVault: {
            ...v,
            cardTotal: round2(Math.max(0, (Number(v.cardTotal) || 0) - dir * amt)),
            vaultVersion: nextVer,
          },
        }
      }
      return {
        cashVault: {
          ...v,
          cashTotal: round2(Math.max(0, (Number(v.cashTotal) || 0) - dir * amt)),
          vaultVersion: nextVer,
        },
      }
    })
    void persistPosSnapshot()
    return { payFrom, method }
  }

  const open = opts.shiftId
    ? shiftById(opts.shiftId)
    : resolveOpenShift(opts.posId)
  if (!open) {
    if (dir > 0) throw new Error('Нет открытой смены — откройте смену или оплатите из основного ящика')
    return { payFrom, method }
  }
  if (dir > 0) {
    const have = shiftAvailableLocal(open, method)
    if (amt > have + 0.009) {
      throw new Error(
        method === 'card'
          ? `На карте смены только ${have.toFixed(2)} сом`
          : `В кассе недостаточно наличных (доступно ${have.toFixed(2)} сом)`,
      )
    }
  }
  if (method === 'card') {
    patchShift(open.id, {
      salesCard: round2(Math.max(0, (Number(open.salesCard) || 0) - dir * amt)),
    })
  } else {
    applyExpenseToShift(open.id, amt, dir)
  }
  void persistPosSnapshot()
  return { shiftId: open.id, payFrom, method }
}

/**
 * Внести деньги в кассу смены или основной ящик.
 */
export function applyMoneyInLocal(opts: {
  amount: number
  payFrom?: MoneyPayFrom
  method?: MoneyPayMethod
  posId?: string
  shiftId?: string
}): { shiftId?: string; payFrom: MoneyPayFrom; method: MoneyPayMethod } {
  const amt = round2(opts.amount)
  const payFrom: MoneyPayFrom = opts.payFrom === 'vault' ? 'vault' : 'shift'
  const method: MoneyPayMethod = opts.method === 'card' ? 'card' : 'cash'
  if (!(amt > 0.001)) return { payFrom, method }

  if (payFrom === 'vault') {
    usePosStore.setState(s => {
      const v = s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
      if (method === 'card') {
        return {
          cashVault: {
            ...v,
            cardTotal: round2((Number(v.cardTotal) || 0) + amt),
            vaultVersion: (Number(v.vaultVersion) || 0) + 1,
          },
        }
      }
      return {
        cashVault: {
          ...v,
          cashTotal: round2((Number(v.cashTotal) || 0) + amt),
          vaultVersion: (Number(v.vaultVersion) || 0) + 1,
        },
      }
    })
    void persistPosSnapshot()
    return { payFrom, method }
  }

  const open = opts.shiftId
    ? shiftById(opts.shiftId)
    : resolveOpenShift(opts.posId)
  if (!open) throw new Error('Нет открытой смены — откройте смену или внесите в основной ящик')
  if (method === 'card') {
    patchShift(open.id, {
      salesCard: round2((Number(open.salesCard) || 0) + amt),
    })
  } else {
    patchShift(open.id, {
      cashInTotal: round2((Number(open.cashInTotal) || 0) + amt),
    })
  }
  void persistPosSnapshot()
  return { shiftId: open.id, payFrom, method }
}

// ── Движение по кассе ──

const financeMoveInflight = new Map<string, Promise<OfflineResult<FinanceMove | null>>>()

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
  /** shift (по умолчанию) | vault */
  payFrom?: MoneyPayFrom
  /** cash (по умолчанию) | card */
  method?: MoneyPayMethod
}): Promise<OfflineResult<FinanceMove | null>> {
  const payFrom: MoneyPayFrom = input.payFrom === 'vault' ? 'vault' : 'shift'
  const method: MoneyPayMethod = input.method === 'card' ? 'card' : 'cash'
  const open = resolveOpenShift(input.posId)
  const shiftId = payFrom === 'vault'
    ? (input.shiftId || undefined)
    : (input.shiftId || open?.id)
  const posId = input.posId || open?.posId || undefined
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  if (input.type === 'withdraw') {
    if (payFrom === 'vault') {
      const have = vaultAvailableLocal(method)
      if (amount > have + 0.009) {
        throw new Error(
          method === 'card'
            ? `В основном ящике на карте только ${have.toFixed(2)} сом`
            : `В основном ящике наличных только ${have.toFixed(2)} сом`,
        )
      }
    } else if (shiftId) {
      const shift = shiftById(shiftId)
      if (shift) {
        const expected = shiftAvailableLocal(shift, method)
        if (amount > expected + 0.009) {
          throw new Error(
            method === 'card'
              ? `На карте смены только ${expected.toFixed(2)} сом`
              : `В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`,
          )
        }
      }
    } else {
      throw new Error('Нет открытой смены — откройте смену или снимите из основного ящика')
    }
  } else if (payFrom === 'shift' && !shiftId) {
    throw new Error('Нет открытой смены — откройте смену или внесите в основной ящик')
  }

  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const expectedPayVersion = input.supplierId
    ? supplierPayVersion(usePosStore.getState().suppliers.find(s => s.id === input.supplierId))
    : undefined
  const expectedVaultVersion = payFrom === 'vault' ? vaultVersionLocal() : undefined
  const payload = {
    ...input,
    payFrom,
    method,
    clientRef,
    amount,
    shiftId: payFrom === 'shift' ? shiftId : (shiftId || undefined),
    posId,
    createdAtIso,
    createdBy: input.createdBy || input.cashierName || open?.cashierName,
    cashierId: input.cashierId || open?.cashierId,
    cashierName: input.cashierName || open?.cashierName,
    ...(input.supplierId && expectedPayVersion != null ? { expectedPayVersion } : {}),
    ...(expectedVaultVersion != null ? { expectedVaultVersion } : {}),
  }

  const inflightKey = ['fin', payload.type, amount, payFrom, method, String(payload.shiftId || ''), String(payload.note || '').trim(), String(payload.supplierId || '')].join('|')
  const existing = financeMoveInflight.get(inflightKey)
  if (existing) return existing

  const run = (async (): Promise<OfflineResult<FinanceMove | null>> => {
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
      const queued = await useOfflineSync.getState().queueOp('finance_move', payload, { localId, clientRef })
      const already = queued.clientRef !== clientRef || queued.localId !== localId
      if (already) {
        const existingMove = usePosStore.getState().financeMoves.find(m =>
          m.clientRef === queued.clientRef || m.id === queued.localId,
        )
        if (existingMove) return existingMove
      }
      const applied = payload.type === 'withdraw'
        ? applyMoneyOutLocal({
          amount: payload.amount,
          payFrom,
          method,
          dir: 1,
          shiftId: payload.shiftId,
          posId: payload.posId,
        })
        : applyMoneyInLocal({
          amount: payload.amount,
          payFrom,
          method,
          shiftId: payload.shiftId,
          posId: payload.posId,
        })
    const move: FinanceMove = {
      id: localId,
      type: payload.type,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
        createdAtIso,
        shiftId: applied.shiftId || payload.shiftId,
      posId: payload.posId,
      supplierId: payload.supplierId,
        clientRef,
        payFrom,
        method,
    }
    usePosStore.setState(s => ({ financeMoves: [move, ...s.financeMoves] }))
    shadowMirrorPut('finance_move', move.id, move)
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
              payVersion: supplierPayVersion(sup) + 1,
          }
        }),
      }))
    }
      void persistPosSnapshot()
    return move
  }

  return raceCashierOp(() => api.createFinanceMove(payload), applyLocal)
  })()
  financeMoveInflight.set(inflightKey, run)
  try {
    return await run
  } finally {
    financeMoveInflight.delete(inflightKey)
  }
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
): Promise<OfflineResult<{ clientRef: string }>> {
  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const cardNow = useCardStore.getState().cards.find(c => c.num === num || cardNumsMatch(c.num, num))
  const expectedBonusPayVersion = Number(cardNow?.bonusPayVersion) || 0
  const prevBonus = round2(Number(cardNow?.bonus) || 0)
  const prevPosCashBonus = round2(Number(cardNow?.posCashBonus) || 0)
  const payload = {
    ...input,
    clientRef,
    createdAtIso,
    cash: round2(input.cash),
    credit: round2(input.credit),
    num,
    expectedBonusPayVersion,
    prevBonus,
    prevPosCashBonus,
  }

  const applyLocal = async () => {
    const card = useCardStore.getState().cards.find(c => c.num === num || cardNumsMatch(c.num, num))
    const nextBonus = round2((Number(card?.bonus) || 0) + payload.credit)
    const nextPos = round2((Number(card?.posCashBonus) || 0) + payload.credit)
    const finLocalId = newLocalId('fin')
    await useOfflineSync.getState().queueOp('card_topup', {
      ...payload,
      bonusAfter: nextBonus,
      posCashBonusAfter: nextPos,
    }, { localId: finLocalId, clientRef })
    const shift = input.shiftId ? shiftById(input.shiftId) : undefined
    if (shift) {
      patchShift(shift.id, { cashInTotal: round2((shift.cashInTotal || 0) + payload.cash) })
      usePosStore.setState(s => ({
        financeMoves: [{
          id: finLocalId,
          type: 'deposit',
          amount: payload.cash,
          note: input.note,
          reason: 'Пополнение бонусов клиента',
          refType: 'card_topup',
          cardNum: num,
          createdBy: input.cashierName,
          createdAtIso,
          shiftId: shift.id,
          posId: input.posId,
          clientRef,
        } as FinanceMove, ...s.financeMoves],
      }))
    }
    useCardStore.getState().updateCardLoyalty(
      num,
      {
        bonus: nextBonus,
        posCashBonus: nextPos,
        bonusPayVersion: expectedBonusPayVersion + 1,
      },
      { skipApi: true },
    )
    markMoneyPending({ cardNum: num, clientId: card?.clientId })
    return { clientRef }
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
        createdAtIso,
        expectedBonusPayVersion,
      })
      return { clientRef }
    },
    applyLocal,
  )
}

/** Откат локального пополнения бонусов при отказе сервера (риск 3.5). */
export function revertLocalCardTopupOnReject(payload: {
  num?: string
  cash?: number
  credit?: number
  shiftId?: string
  clientRef?: string
  expectedBonusPayVersion?: number
  prevBonus?: number
  prevPosCashBonus?: number
  localId?: string
}) {
  const num = String(payload.num || '')
  const cash = round2(Number(payload.cash) || 0)
  const credit = round2(Number(payload.credit) || 0)
  if (!num || !(cash > 0 || credit > 0)) return
  const ver = Math.max(0, Number(payload.expectedBonusPayVersion) || 0)
  const prevBonus = payload.prevBonus != null
    ? round2(Number(payload.prevBonus))
    : round2(Math.max(0, (Number(useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))?.bonus) || 0) - credit))
  const prevPos = payload.prevPosCashBonus != null
    ? round2(Number(payload.prevPosCashBonus))
    : round2(Math.max(0, (Number(useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))?.posCashBonus) || 0) - credit))

  if (payload.shiftId) {
    const shift = shiftById(payload.shiftId)
    if (shift && cash > 0) {
      patchShift(shift.id, {
        cashInTotal: round2(Math.max(0, (Number(shift.cashInTotal) || 0) - cash)),
      })
    }
  }

  const ref = String(payload.clientRef || '').trim()
  if (ref) {
    usePosStore.setState(s => ({
      financeMoves: s.financeMoves.filter(m => String(m.clientRef || '') !== ref),
    }))
  }

  useCardStore.getState().updateCardLoyalty(
    num,
    { bonus: prevBonus, posCashBonus: prevPos, bonusPayVersion: ver },
    { skipApi: true },
  )

  const card = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))
  if (card?.clientId) {
    useClientStore.getState().updateClient(card.clientId, { bonus: prevBonus }, { skipApi: true })
  }
  if (card?.phone) {
    void import('./clientVipCredit').then(({ dropBalanceTopupByClientRef }) => {
      dropBalanceTopupByClientRef(card.phone, ref)
    })
  }

  clearMoneyPending({ cardNum: num, clientId: card?.clientId })
}

// ── Погашение долга ──

export type DebtRepayResult = {
  nextDebt: number
  bonusEarned: number
  /** Повтор того же погашения — касса и история уже записаны */
  duplicate?: boolean
  /** Ключ операции — привязать историю для отката при отказе сервера */
  clientRef?: string
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

  const cardNow = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))
  const expectedDebtPayVersion = Number(cardNow?.debtPayVersion) || 0

  const clientRef = newClientRef()
  const histKey = debtAccountKey({
    id: input.clientId,
    phone: useClientStore.getState().clients.find(c => c.id === input.clientId)?.phone
      || useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))?.phone,
  })
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
    prevDebt: round2(input.prevDebt),
    expectedDebtPayVersion,
    histKey: histKey || undefined,
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
        clientRef: String((dup.payload as any)?.clientRef || clientRef),
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
    const nextVer = expectedDebtPayVersion + 1
    useCardStore.getState().updateCardLoyalty(
      num,
      { debt: nextDebt, debtPayVersion: nextVer },
      { skipApi: true },
    )
    if (input.clientId) {
      useClientStore.getState().updateClient(input.clientId, { debt: nextDebt }, { skipApi: true })
    }
    markMoneyPending({ clientId: input.clientId, cardNum: num })
    return { nextDebt, bonusEarned: 0, clientRef }
  }

  const run = localFirstOp(applyLocal)
  debtRepayInflight.set(key, run)
  try {
    return await run
  } finally {
    debtRepayInflight.delete(key)
  }
}

/** Откат локального погашения, если сервер отклонил по debtPayVersion (риск 2.5). */
export function revertLocalDebtRepayOnReject(payload: {
  num?: string
  amount?: number
  method?: string
  shiftId?: string
  clientId?: string
  prevDebt?: number
  nextDebt?: number
  expectedDebtPayVersion?: number
  histKey?: string
  clientRef?: string
}) {
  const num = String(payload.num || '')
  const amount = round2(Number(payload.amount) || 0)
  if (!num || !(amount > 0)) return
  const prevDebt = payload.prevDebt != null
    ? round2(Number(payload.prevDebt))
    : round2((Number(payload.nextDebt) || 0) + amount)
  const ver = Math.max(0, Number(payload.expectedDebtPayVersion) || 0)

  if (payload.shiftId) {
    const shift = shiftById(payload.shiftId)
    if (shift) {
      const method = payload.method === 'card' ? 'card' : 'cash'
      if (method === 'card') {
        patchShift(shift.id, { salesCard: round2(Math.max(0, (Number(shift.salesCard) || 0) - amount)) })
      } else {
        patchShift(shift.id, { salesCash: round2(Math.max(0, (Number(shift.salesCash) || 0) - amount)) })
      }
    }
  }
  useCardStore.getState().updateCardLoyalty(
    num,
    { debt: prevDebt, debtPayVersion: ver },
    { skipApi: true },
  )
  if (payload.clientId) {
    useClientStore.getState().updateClient(String(payload.clientId), { debt: prevDebt }, { skipApi: true })
  }

  const histKey = String(payload.histKey || '').trim()
    || debtAccountKey({
      id: payload.clientId,
      phone: useClientStore.getState().clients.find(c => c.id === payload.clientId)?.phone
        || useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))?.phone,
    })
  const clientRef = String(payload.clientRef || '').trim()
  if (histKey && clientRef) {
    dropDebtHistoryByClientRef(histKey, clientRef)
  }

  clearMoneyPending({ clientId: payload.clientId, cardNum: num })
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
  // Риск 5.4: возврат чека, который ещё не на сервере — ломает цепочку
  if (isLocalId(sale.id)) {
    throw new Error('Чек ещё не ушёл на сервер — дождитесь отправки, потом возвращайте')
  }
  const pending = await getPending()
  const saleStillQueued = pending.some(r =>
    !r.failed
    && r.kind === 'sale'
    && (
      String(r.localId || '') === String(sale.id)
      || String((r.payload as any)?.clientRef || '') === String(sale.clientRef || '')
    ),
  )
  if (saleStillQueued) {
    throw new Error('Чек ещё в очереди на отправку — дождитесь, потом возвращайте')
  }
  const dupReturn = pending.some(r =>
    !r.failed
    && r.kind === 'sale_return'
    && String((r.payload as any)?.saleId || '') === String(sale.id),
  )
  if (dupReturn) {
    throw new Error('Возврат по этому чеку уже в очереди')
  }

  const clientRef = newClientRef()
  const party = resolveSaleClientAndCard({
    clientId: sale.clientId,
    clientPhone: sale.clientPhone,
    cardNum: sale.cardNum,
  })
  const cardNow = party.card
    || (party.resolvedCardNum
      ? useCardStore.getState().cards.find(c => cardNumsMatch(c.num, party.resolvedCardNum!))
      : undefined)
  const expectedDebtPayVersion = Number(cardNow?.debtPayVersion) || 0
  const expectedBonusPayVersion = Number(cardNow?.bonusPayVersion) || 0
  const prevDebt = round2(effectiveDebt(party.cl, cardNow))
  const prevWallet = round2(Number(cardNow?.wallet) || Number(party.cl?.wallet) || 0)
  const prevBonus = round2(Number(cardNow?.bonus) || Number(party.cl?.bonus) || 0)
  const prevPosCashBonus = round2(Number(cardNow?.posCashBonus) || 0)
  const saleBefore = {
    items: (sale.items || []).map(it => ({ ...it })),
    status: sale.status,
    debtAdded: sale.debtAdded,
    paidCash: sale.paidCash,
    paidCard: sale.paidCard,
    paidWallet: sale.paidWallet,
    bonusSpent: sale.bonusSpent,
    total: sale.total,
    returns: Array.isArray(sale.returns) ? [...sale.returns] : [],
  }

  const applyAndQueue = async () => {
    const debtBefore = saleDebtBeforeReturn(sale)
    const returned = applyLocalReturn(sale, input.items)
    const partyAfter = resolveSaleClientAndCard({
      clientId: returned.clientId || sale.clientId,
      clientPhone: returned.clientPhone || sale.clientPhone,
      cardNum: returned.cardNum || sale.cardNum,
    })
    const lastRet = Array.isArray(returned.returns) && returned.returns.length
      ? returned.returns[returned.returns.length - 1]
      : null
    const cutDebt = Math.max(0, round2(debtBefore - (Number(returned.debtAdded) || 0)))
    const cutCash = round2(Number(lastRet?.cutCash) || 0)
    const cutCard = round2(Number(lastRet?.cutCard) || 0)
    const cutWallet = round2(Number(lastRet?.cutWallet) || 0)
    const cutBonus = round2(Number(lastRet?.cutBonus) || 0)
    await useOfflineSync.getState().queueOp('sale_return', {
    clientRef,
    saleId: sale.id,
    note: input.note,
    cashierId: input.cashierId,
    items: input.items,
      clientId: partyAfter.cl?.id || returned.clientId || sale.clientId,
      cardNum: partyAfter.resolvedCardNum || returned.cardNum || sale.cardNum,
      cutDebt,
      expectedDebtPayVersion: cutDebt > 0.001 ? expectedDebtPayVersion : undefined,
      expectedBonusPayVersion: cutBonus > 0.001 ? expectedBonusPayVersion : undefined,
      _revert: {
        saleId: sale.id,
        saleBefore,
        shiftId: sale.shiftId,
        cutCash,
        cutCard,
        cutDebt,
        cutWallet,
        cutBonus,
        fullyReturned: returned.status === 'returned',
        prevDebt,
        prevWallet,
        prevBonus,
        prevPosCashBonus,
        expectedDebtPayVersion,
        expectedBonusPayVersion,
        clientId: partyAfter.cl?.id || sale.clientId,
        cardNum: partyAfter.resolvedCardNum || sale.cardNum,
        restoreLines: lastRet?.items || [],
      },
    })
    return returned
  }

  const res = await localFirstOp(applyAndQueue)
  if (res.data) shadowMirrorSale(res.data)
  return res
}

/**
 * Сколько долга ещё висит на чеке к возврату.
 * mixed: если debtAdded пропал — выводим из total − нал/карта/кошелёк.
 */
export function saleDebtBeforeReturn(sale: PosSale): number {
  const explicit = round2(Number(sale.debtAdded) || 0)
  if (explicit > 0.001) return explicit
  const method = String(sale.paymentMethod || '')
  if (method === 'credit') return round2(Number(sale.total) || 0)
  if (method === 'mixed') {
    const paid = round2(
      (Number(sale.paidCash) || 0)
      + (Number(sale.paidCard) || 0)
      + (Number(sale.paidWallet) || 0),
    )
    return round2(Math.max(0, (Number(sale.total) || 0) - paid))
  }
  return 0
}

/** Превью возврата: сколько выдать на руки (не сумма товаров). */
export function previewReturnPayout(sale: PosSale, returnTotal: number) {
  const cuts = computeReturnCuts(sale, round2(returnTotal))
  return {
    goodsTotal: round2(returnTotal),
    giveCash: cuts.cutCash,
    giveCard: cuts.cutCard,
    cutDebt: cuts.cutDebt,
    cutWallet: cuts.cutWallet,
    cutBonus: cuts.cutBonus,
    /** Деньги клиенту (нал + карта). Долг сюда не входит → при «всё в долг» = 0 */
    giveMoney: round2(cuts.cutCash + cuts.cutCard),
  }
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
  const debtBefore = saleDebtBeforeReturn(sale)
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
  const restoreLines: Array<{
    productId: number
    qty: number
    receiptId?: string
    productName?: string
    costPrice?: number
    retailPrice?: number
  }> = []

  const nextItems = lines.map((line, idx) => {
    const already = Number(line.returnedQty) || 0
    const left = Math.max(0, round2((Number(line.qty) || 0) - already))
    const asked = items
      ? Number(items.find(i => (i.index != null ? i.index === idx : i.productId === line.productId))?.qty) || 0
      : left
    const back = Math.min(left, round2(asked))
    if (back > 0) {
      backByProduct.set(line.productId, round2((backByProduct.get(line.productId) || 0) + back))
      restoreLines.push({
        productId: line.productId,
        qty: back,
        receiptId: line.receiptId || undefined,
        productName: line.productName,
        costPrice: Number(line.unitCost) || undefined,
        retailPrice: Number(line.price) || undefined,
      })
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

  const returnEntry = {
    atIso: new Date().toISOString(),
    total: round2(lastReturnTotal),
    cutCash: cuts.cutCash,
    cutCard: cuts.cutCard,
    cutDebt: cuts.cutDebt,
    cutWallet: cuts.cutWallet,
    cutBonus: cuts.cutBonus,
    items: restoreLines.map(l => ({
      productId: l.productId,
      productName: l.productName,
      qty: l.qty,
      price: Number(l.retailPrice) || 0,
      lineTotal: round2((Number(l.retailPrice) || 0) * l.qty),
    })),
  }

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
    returns: [...(Array.isArray(sale.returns) ? sale.returns : []), returnEntry],
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

  // Склад: партии + product.stock (раньше только stock — склад по партиям не рос)
  if (!(sale as { stockSkipped?: boolean }).stockSkipped && restoreLines.length) {
    void import('./stockLayersLocal')
      .then(m => m.restoreLocalLayersFifoBatch(restoreLines))
      .catch(() => {
  void (async () => {
          try {
    const { useProducts } = await import('./store')
    const ps = useProducts.getState()
    for (const [productId, qty] of backByProduct) {
      const p = ps.products.find(x => x.id === productId)
      if (!p) continue
      ps.updateProduct(productId, { stock: round2((Number(p.stock) || 0) + qty) })
    }
          } catch { /* ignore */ }
  })()
      })
  }

  return updated
}

function applyReturnClientMoneySync(sale: PosSale, cuts: ReturnType<typeof computeReturnCuts>) {
  if (!(cuts.cutDebt > 0 || cuts.cutWallet > 0 || cuts.cutBonus > 0)) return
  let { cl, card, phone, resolvedCardNum } = resolveSaleClientAndCard(sale)
  // Запасной поиск — иначе mixed-возврат режет чек, а долг на карте остаётся
  if (!cl && sale.clientId) {
    cl = useClientStore.getState().clients.find(c => c.id === sale.clientId)
  }
  if (!cl && sale.clientPhone) {
    cl = useClientStore.getState().clients.find(c => phonesMatch(c.phone, sale.clientPhone!))
  }
  if (!card && (sale.cardNum || cl?.card)) {
    const want = sale.cardNum || cl?.card || ''
    card = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, want))
  }
  if (!resolvedCardNum) resolvedCardNum = card?.num || sale.cardNum || cl?.card || ''

  markMoneyPending({ clientId: cl?.id || sale.clientId, cardNum: resolvedCardNum || sale.cardNum })
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
  const clientId = cl?.id || String(sale.clientId || '').trim()
  if (clientId && Object.keys(clientPatch).length) {
    useClientStore.getState().updateClient(clientId, clientPatch, { skipApi: true })
  }

  for (const num of nums) {
    const cur = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, num))
    if (!cur && !cl && !clientId) continue
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
  // Версию бампаем один раз на основной карте (не в цикле nums)
  const primaryNum = String(resolvedCardNum || sale.cardNum || cl?.card || '').trim()
  if (primaryNum && (cuts.cutDebt > 0 || cuts.cutBonus > 0)) {
    const cur = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, primaryNum))
    if (cur) {
      useCardStore.getState().updateCardLoyalty(primaryNum, {
        ...(cuts.cutDebt > 0 ? { debtPayVersion: (Number(cur.debtPayVersion) || 0) + 1 } : {}),
        ...(cuts.cutBonus > 0 ? { bonusPayVersion: (Number(cur.bonusPayVersion) || 0) + 1 } : {}),
      } as any, { skipApi: true })
    }
  }

  if (cuts.cutDebt > 0) {
    const histKey = debtAccountKey(cl || { id: sale.clientId, phone: sale.clientPhone })
      || String(phone || sale.clientPhone || '').trim()
    if (histKey) {
      recordStoreDebtRepayment(histKey, cuts.cutDebt, {
        desc: `Возврат чека · долг −${cuts.cutDebt}`,
        orderId: sale.orderId || sale.id,
        source: 'cashier',
      })
    }
  }
}

/** Откат локального возврата при отказе сервера (риск 5.1 / 5.5). */
export function revertLocalSaleReturnOnReject(payload: Record<string, unknown>) {
  const rev = (payload._revert || {}) as Record<string, unknown>
  const saleId = String(rev.saleId || payload.saleId || '').trim()
  if (!saleId) return

  const saleBefore = rev.saleBefore as Partial<PosSale> | undefined
  if (saleBefore && Array.isArray(saleBefore.items)) {
    usePosStore.setState(s => ({
      sales: s.sales.map(x => {
        if (x.id !== saleId) return x
        return {
          ...x,
          items: saleBefore.items as PosSale['items'],
          status: (saleBefore.status as PosSale['status']) || x.status,
          debtAdded: saleBefore.debtAdded as number | undefined,
          paidCash: saleBefore.paidCash as number | undefined,
          paidCard: saleBefore.paidCard as number | undefined,
          paidWallet: saleBefore.paidWallet as number | undefined,
          bonusSpent: saleBefore.bonusSpent as number | undefined,
          total: saleBefore.total as number | undefined,
          returns: (saleBefore.returns as PosSale['returns']) || [],
          lastReturnTotal: undefined,
        }
      }),
    }))
  }

  const cutCash = round2(Number(rev.cutCash) || 0)
  const cutCard = round2(Number(rev.cutCard) || 0)
  const cutDebt = round2(Number(rev.cutDebt) || 0)
  const cutWallet = round2(Number(rev.cutWallet) || 0)
  const cutBonus = round2(Number(rev.cutBonus) || 0)
  const shiftId = String(rev.shiftId || '').trim()
  const fullyReturned = !!rev.fullyReturned

  if (shiftId) {
    const shift = shiftById(shiftId)
    if (shift) {
      patchShift(shiftId, {
        ...(fullyReturned ? { salesCount: (Number(shift.salesCount) || 0) + 1 } : {}),
        salesCash: round2((Number(shift.salesCash) || 0) + cutCash),
        salesCard: round2((Number(shift.salesCard) || 0) + cutCard),
        salesCredit: round2((Number(shift.salesCredit) || 0) + cutDebt),
        ...(cutWallet > 0.001
          ? { salesWallet: round2((Number((shift as any).salesWallet) || 0) + cutWallet) }
          : {}),
      })
    }
  }

  // Склад: снова списать то, что вернули
  const restoreLines = Array.isArray(rev.restoreLines) ? rev.restoreLines as Array<{ productId?: number; qty?: number }> : []
  if (restoreLines.length) {
    void (async () => {
      try {
        const lines = restoreLines
          .map(l => ({ productId: Number(l.productId) || 0, qty: Number(l.qty) || 0 }))
          .filter(l => l.productId && l.qty > 0)
        if (!lines.length) return
        const { useProducts } = await import('./store')
        const ps = useProducts.getState()
        for (const l of lines) {
          const p = ps.products.find(x => x.id === l.productId)
          if (!p) continue
          ps.updateProduct(l.productId, { stock: Math.max(0, round2((Number(p.stock) || 0) - l.qty)) })
        }
        const { consumeLocalLayersFifoBatch } = await import('./stockLayersLocal')
        await consumeLocalLayersFifoBatch(lines)
      } catch { /* ignore */ }
    })()
  }

  const cardNum = String(rev.cardNum || '').trim()
  const clientId = String(rev.clientId || '').trim()
  const prevDebt = rev.prevDebt != null ? round2(Number(rev.prevDebt)) : null
  const prevWallet = rev.prevWallet != null ? round2(Number(rev.prevWallet)) : null
  const prevBonus = rev.prevBonus != null ? round2(Number(rev.prevBonus)) : null
  const prevPos = rev.prevPosCashBonus != null ? round2(Number(rev.prevPosCashBonus)) : null
  const debtVer = Math.max(0, Number(rev.expectedDebtPayVersion) || 0)
  const bonusVer = Math.max(0, Number(rev.expectedBonusPayVersion) || 0)

  if (cardNum && (cutDebt > 0.001 || cutWallet > 0.001 || cutBonus > 0.001)) {
    const patch: Record<string, unknown> = {}
    if (prevDebt != null && cutDebt > 0.001) {
      patch.debt = prevDebt
      patch.debtPayVersion = debtVer
    }
    if (prevWallet != null && cutWallet > 0.001) patch.wallet = prevWallet
    if (prevBonus != null && cutBonus > 0.001) {
      patch.bonus = prevBonus
      if (prevPos != null) patch.posCashBonus = prevPos
      patch.bonusPayVersion = bonusVer
    }
    if (Object.keys(patch).length) {
      useCardStore.getState().updateCardLoyalty(cardNum, patch as any, { skipApi: true })
    }
  }
  if (clientId && (cutDebt > 0.001 || cutWallet > 0.001 || cutBonus > 0.001)) {
    const patch: Record<string, unknown> = {}
    if (prevDebt != null && cutDebt > 0.001) patch.debt = prevDebt
    if (prevWallet != null && cutWallet > 0.001) patch.wallet = prevWallet
    if (prevBonus != null && cutBonus > 0.001) patch.bonus = prevBonus
    if (Object.keys(patch).length) {
      useClientStore.getState().updateClient(clientId, patch as any, { skipApi: true })
    }
  }

  // Убрать локальную запись погашения долга от возврата (если писали с clientRef нет — по orderId+desc сложно; пропуск)
  clearMoneyPending({ clientId, cardNum })
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
    // Флаг ДО markOffline: иначе любой local-first чек считался бы «офлайн» для ревизии
    const { browserSaysOffline } = await import('./apiReachability')
    const syncOnline = useOfflineSync.getState().online
    const queuedOffline = browserSaysOffline() || syncOnline === false
    useOfflineSync.getState().markOffline()
    const offlineSaleId = newLocalId('sale')
    const linkedCard = client?.card
      ? useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
      : undefined
    const nextDebt = client
      ? round2(effectiveDebt(client, linkedCard) + (debtAdded > 0.001 ? debtAdded : 0))
      : 0
    const expectedDebtPayVersion = Number(linkedCard?.debtPayVersion) || 0
    const expectedBonusPayVersion = Number(linkedCard?.bonusPayVersion) || 0
    if (queuedOffline) {
      salePayload.queuedOffline = true
      salePayload.skipStockAfterRevision = true
    }
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
      if (debtAdded > 0.001) salePayload.expectedDebtPayVersion = expectedDebtPayVersion
      if (spend > 0) salePayload.expectedBonusPayVersion = expectedBonusPayVersion
      // Снимки для отката при отказе сервера (риск 4.1 / 4.5)
      salePayload._revert = {
        prevDebt: round2(effectiveDebt(client, linkedCard)),
        prevWallet: round2(Number(client.wallet) || Number(linkedCard?.wallet) || 0),
        prevBonus: round2(Number(linkedCard?.bonus) || Number(client.bonus) || 0),
        prevPosCashBonus: round2(Number(linkedCard?.posCashBonus) || 0),
        expectedDebtPayVersion,
        expectedBonusPayVersion,
        cashPaid,
        cardPaid,
        debtAdded,
        walletPaid,
        bonusSpend: spend,
        bonusEarn: earn,
        clientId: client.id,
        cardNum: client.card,
        shiftId: input.shiftId,
        cart: input.cart,
      }
    } else {
      salePayload._revert = {
        cashPaid,
        cardPaid,
        debtAdded,
        walletPaid: 0,
        shiftId: input.shiftId,
        cart: input.cart,
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
            {
              debt: nextDebt,
              debtEnabled: true,
              debtPayVersion: expectedDebtPayVersion + 1,
            },
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
        const nextPos = Math.max(0, prevPos - spend)
        useCardStore.getState().updateCardLoyalty(
          client.card,
          {
            bonus: nextBonus,
            posCashBonus: nextPos,
            ...(spend > 0
              ? {
                  allowBonusDecrease: true,
                  bonusPayVersion: expectedBonusPayVersion + 1,
                }
              : {}),
          } as any,
          { skipApi: true },
        )
        useClientStore.getState().updateClient(client.id, { bonus: nextBonus }, { skipApi: true })
      }
      if (debtAdded > 0.001 || walletPaid > 0.001 || spend > 0 || earn > 0) {
        markMoneyPending({ clientId: client.id, cardNum: client.card })
      }
    }

    const display = await allocateLocalSaleDisplay()
    const { _revert: _omitRevert, ...saleFields } = salePayload as Record<string, unknown>
    const offlineSale: PosSale & { orderId?: string; _offline?: boolean } = {
      ...(saleFields as unknown as PosSale),
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

/**
 * Откат локального чека, если сервер отклонил (нет остатка / версия долга или бонусов).
 * Риск 4.1 / 4.5 / 4.8.
 */
export function revertLocalSaleOnReject(payload: Record<string, unknown>, localId?: string) {
  const rev = (payload._revert || {}) as Record<string, unknown>
  const cashPaid = round2(Number(rev.cashPaid ?? payload.paidCash) || 0)
  const cardPaid = round2(Number(rev.cardPaid ?? payload.paidCard) || 0)
  const debtAdded = round2(Number(rev.debtAdded ?? payload.debtAdded) || 0)
  const walletPaid = round2(Number(rev.walletPaid ?? payload.paidWallet) || 0)
  const spend = Math.max(0, Math.floor(Number(rev.bonusSpend ?? payload.bonusSpent) || 0))
  const earn = Math.max(0, Math.floor(Number(rev.bonusEarn ?? payload.bonusEarned) || 0))
  const shiftId = String(rev.shiftId || payload.shiftId || '')
  const clientId = String(rev.clientId || payload.clientId || '')
  const cardNum = String(rev.cardNum || payload.cardNum || '')
  const cart = Array.isArray(rev.cart)
    ? (rev.cart as SaleCartLine[])
    : Array.isArray(payload.items)
      ? (payload.items as any[]).map(it => ({
          productId: Number(it.productId) || 0,
          qty: Number(it.qty) || 0,
          weightKg: it.weightKg != null ? Number(it.weightKg) : null,
        }))
      : []

  const saleId = String(localId || payload.id || '').trim()
  if (saleId) {
    usePosStore.setState(s => ({ sales: s.sales.filter(x => x.id !== saleId) }))
    noteInboundDeletedIds([saleId])
  }

  if (shiftId) {
    const shift = shiftById(shiftId)
    if (shift) {
      patchShift(shiftId, {
        salesCash: round2(Math.max(0, (Number(shift.salesCash) || 0) - cashPaid)),
        salesCard: round2(Math.max(0, (Number(shift.salesCard) || 0) - cardPaid)),
        salesCredit: round2(Math.max(0, (Number(shift.salesCredit) || 0) - debtAdded)),
        salesCount: Math.max(0, (Number(shift.salesCount) || 0) - 1),
        ...(walletPaid > 0.001
          ? { salesWallet: round2(Math.max(0, (Number((shift as any).salesWallet) || 0) - walletPaid)) }
          : {}),
      })
    }
  }

  // Склад обратно
  if (cart.length) {
    void (async () => {
      try {
        const { useProducts } = await import('./store')
        const ps = useProducts.getState()
        for (const l of cart) {
          if (!l.productId) continue
          const p = ps.products.find(x => x.id === l.productId)
          if (!p) continue
          const add = l.weightKg != null ? Number(l.weightKg) : Number(l.qty) || 0
          if (!(add > 0)) continue
          ps.updateProduct(l.productId, { stock: round2((Number(p.stock) || 0) + add) })
        }
        const { restoreLocalLayersFifoBatch } = await import('./stockLayersLocal')
        await restoreLocalLayersFifoBatch(cart.map(l => ({
          productId: l.productId,
          qty: l.weightKg != null ? Number(l.weightKg) : Number(l.qty) || 0,
        })))
      } catch { /* ignore */ }
    })()
  }

  const prevDebt = rev.prevDebt != null ? round2(Number(rev.prevDebt)) : null
  const prevWallet = rev.prevWallet != null ? round2(Number(rev.prevWallet)) : null
  const prevBonus = rev.prevBonus != null ? round2(Number(rev.prevBonus)) : null
  const prevPos = rev.prevPosCashBonus != null ? round2(Number(rev.prevPosCashBonus)) : null
  const debtVer = Math.max(0, Number(rev.expectedDebtPayVersion) || 0)
  const bonusVer = Math.max(0, Number(rev.expectedBonusPayVersion) || 0)

  if (cardNum && (debtAdded > 0.001 || walletPaid > 0.001 || spend > 0 || earn > 0)) {
    const patch: Record<string, unknown> = {}
    if (prevDebt != null && debtAdded > 0.001) {
      patch.debt = prevDebt
      patch.debtPayVersion = debtVer
    }
    if (prevWallet != null && walletPaid > 0.001) patch.wallet = prevWallet
    if (prevBonus != null && (spend > 0 || earn > 0)) {
      patch.bonus = prevBonus
      if (prevPos != null) patch.posCashBonus = prevPos
      if (spend > 0) patch.bonusPayVersion = bonusVer
    }
    if (Object.keys(patch).length) {
      useCardStore.getState().updateCardLoyalty(cardNum, patch as any, { skipApi: true })
    }
  }
  if (clientId && (debtAdded > 0.001 || walletPaid > 0.001 || spend > 0 || earn > 0)) {
    const patch: Record<string, unknown> = {}
    if (prevDebt != null && debtAdded > 0.001) patch.debt = prevDebt
    if (prevWallet != null && walletPaid > 0.001) patch.wallet = prevWallet
    if (prevBonus != null && (spend > 0 || earn > 0)) patch.bonus = prevBonus
    if (Object.keys(patch).length) {
      useClientStore.getState().updateClient(clientId, patch as any, { skipApi: true })
    }
  }

  clearMoneyPending({ clientId, cardNum })
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

/** Оплата закупа с открытой смены или основного ящика (локально). */
export function applyPurchasePayToOpenShift(
  amount: number,
  dir: 1 | -1 = 1,
  posId?: string,
  opts?: { payFrom?: MoneyPayFrom; method?: MoneyPayMethod },
): string | undefined {
  const applied = applyMoneyOutLocal({
    amount,
    dir,
    posId,
    payFrom: opts?.payFrom,
    method: opts?.method,
  })
  return applied.shiftId
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
  const createdAtIso = new Date().toISOString()
  const payload = {
    ...input,
    shiftId,
    posId: input.posId || open?.posId,
    clientRef,
    createdAtIso,
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
    const queued = await useOfflineSync.getState().queueOp('expense_create', payload, { localId, clientRef })
    if (queued.clientRef !== clientRef || queued.localId !== localId) {
      const existing = usePosStore.getState().expenses.find(e =>
        e.clientRef === queued.clientRef || e.id === queued.localId,
      )
      if (existing) return existing
    }
    const exp: PosExpense = {
      id: localId,
      category: payload.category,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
      createdAtIso: payload.createdAtIso,
      shiftId: payload.shiftId,
      clientRef,
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

function reverseExpenseLocal(id: string, extraIds: Array<string | undefined | null> = []) {
  const exp = usePosStore.getState().expenses.find(e => e.id === id)
  if (exp) {
    applyExpenseToShift(exp.shiftId, Number(exp.amount) || 0, -1)
  }
  usePosStore.setState(s => ({ expenses: s.expenses.filter(e => e.id !== id) }))
  noteInboundDeletedIds([id, ...extraIds])
}

export async function expenseDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const mapped = isLocalId(id) ? await resolveLocalId(id) : id
  const hideIds = [id, mapped]

  if (!isTradeLocalFirst()) {
    await api.deleteExpense(mapped || id)
    reverseExpenseLocal(id, hideIds)
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    const serverId = mapped && !isLocalId(mapped) ? mapped : ''
    if (serverId) {
      await useOfflineSync.getState().queueOp('expense_delete', { clientRef, id: serverId }, { clientRef })
    }
    reverseExpenseLocal(id, hideIds)
    void persistPosSnapshot()
    return { id: serverId || id }
  }

  if (!mapped || isLocalId(mapped)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteExpense(mapped || id)
    reverseExpenseLocal(id, hideIds)
    void persistPosSnapshot()
    return { id }
  }, applyLocal)
}

// ── Удаление движения (Offline V2) ──

function sameFinanceFingerprint(a: Partial<FinanceMove>, b: Partial<FinanceMove>): boolean {
  if (a.type && b.type && a.type !== b.type) return false
  if (Math.abs((Number(a.amount) || 0) - (Number(b.amount) || 0)) > 0.009) return false
  if (a.shiftId && b.shiftId && String(a.shiftId) !== String(b.shiftId)) return false
  const ta = Date.parse(String(a.createdAtIso || ''))
  const tb = Date.parse(String(b.createdAtIso || ''))
  if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) > 20_000) return false
  return true
}

function isFinanceTwin(a: FinanceMove, b: FinanceMove): boolean {
  const ra = String(a.clientRef || '').trim()
  const rb = String(b.clientRef || '').trim()
  if (ra && rb) return ra === rb
  return sameFinanceFingerprint(a, b)
}

function applyFinanceCashReverse(
  move: FinanceMove,
  opts?: { payVersionDelta?: number },
) {
  const amount = round2(Number(move.amount) || 0)
  if (!(amount > 0)) return
  const payFrom = move.payFrom === 'vault' ? 'vault' as const : 'shift' as const
  const method = move.method === 'card' ? 'card' as const : 'cash' as const
  try {
    if (move.type === 'withdraw') {
      // вернуть деньги туда, откуда сняли
      applyMoneyOutLocal({
        amount,
        payFrom,
        method,
        dir: -1,
        shiftId: move.shiftId,
        posId: move.posId,
      })
    } else if (payFrom === 'vault') {
      // убрать внесённое из основного (без +версии — это откат)
      usePosStore.setState(s => {
        const v = s.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
        if (method === 'card') {
          return {
            cashVault: {
              ...v,
              cardTotal: round2(Math.max(0, (Number(v.cardTotal) || 0) - amount)),
              vaultVersion: Math.max(0, (Number(v.vaultVersion) || 0) - 1),
            },
          }
        }
        return {
          cashVault: {
            ...v,
            cashTotal: round2(Math.max(0, (Number(v.cashTotal) || 0) - amount)),
            vaultVersion: Math.max(0, (Number(v.vaultVersion) || 0) - 1),
          },
        }
      })
    } else if (move.shiftId) {
      const shift = shiftById(move.shiftId)
      if (shift) {
        if (method === 'card') {
          patchShift(move.shiftId, {
            salesCard: round2(Math.max(0, (Number(shift.salesCard) || 0) - amount)),
          })
        } else {
          patchShift(move.shiftId, {
            cashInTotal: round2(Math.max(0, (Number(shift.cashInTotal) || 0) - amount)),
          })
        }
      }
    }
  } catch {
    if (move.shiftId) {
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
  }
  if (move.supplierId && move.type === 'withdraw' && amount > 0) {
    usePosStore.setState(s => ({
      suppliers: s.suppliers.map(sup => {
        if (sup.id !== move.supplierId) return sup
        const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) - amount))
        const totalSupplied = Number(sup.totalSupplied) || 0
        const verDelta = opts?.payVersionDelta ?? 1
        return {
          ...sup,
          totalPaid,
          payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
          payVersion: Math.max(0, supplierPayVersion(sup) + verDelta),
        }
      }),
    }))
  }
}

/** Откат локального finance_move, если сервер отклонил */
export function revertLocalFinanceMoveOnReject(id: string) {
  reverseFinanceMoveLocal(id, [], { payVersionDelta: -1 })
}

/** Откат локального расхода при отказе сервера */
export function revertLocalExpenseOnReject(id: string) {
  reverseExpenseLocal(id)
  void persistPosSnapshot()
}

function reverseFinanceMoveLocal(
  id: string,
  extraIds: Array<string | undefined | null> = [],
  opts?: { payVersionDelta?: number },
) {
  const moves = usePosStore.getState().financeMoves
  const target = moves.find(m => m.id === id)
  if (!target) {
  usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => m.id !== id) }))
    noteInboundDeletedIds([id, ...extraIds])
    return
  }
  const ghosts = moves.filter(m => m.id !== id && isLocalId(m.id) && isFinanceTwin(m, target))
  const drop = new Set([id, ...ghosts.map(g => g.id)])
  const serverTwin = isLocalId(id)
    ? moves.find(m => !isLocalId(m.id) && isFinanceTwin(m, target))
    : undefined
  if (!serverTwin) applyFinanceCashReverse(target, opts)
  usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => !drop.has(m.id)) }))
  noteInboundDeletedIds([...drop, serverTwin?.id, ...extraIds])
}

async function dropPendingFinanceCreates(target: FinanceMove | undefined, localIds: string[]) {
  const pending = await getPending()
  const refs = new Set(localIds.filter(Boolean))
  const moveRef = String(target?.clientRef || '').trim()
  for (const row of pending) {
    if (row.kind === 'finance_move' || row.kind === 'card_topup') {
      if (row.localId && refs.has(row.localId)) {
        await dropPending(row.clientRef)
        continue
      }
      if (moveRef && row.clientRef === moveRef && row.kind === 'finance_move') {
        await dropPending(row.clientRef)
      }
    }
  }
}

export async function financeMoveDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const target = usePosStore.getState().financeMoves.find(m => m.id === id)
  if (target && isLocalCardTopupMove(target)) {
    throw new Error('Пополнение бонусов нельзя удалить')
  }
  const deleteRef = newClientRef()
  const mapped = isLocalId(id) ? await resolveLocalId(id) : id
  const localIds = [
    id,
    ...usePosStore.getState().financeMoves
      .filter(m => m.id !== id && isLocalId(m.id) && target && isFinanceTwin(m, target))
      .map(m => m.id),
  ].filter(isLocalId)
  const serverTwin = target
    ? usePosStore.getState().financeMoves.find(m => !isLocalId(m.id) && m.id !== id && isFinanceTwin(m, target))
    : undefined
  const queueServerId = !isLocalId(id)
    ? id
    : (serverTwin ? '' : (mapped && !isLocalId(mapped) ? mapped : ''))

  if (!isTradeLocalFirst()) {
    await api.deleteFinanceMove(queueServerId || id)
    reverseFinanceMoveLocal(id, [mapped, queueServerId])
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await dropPendingFinanceCreates(target, localIds)
    reverseFinanceMoveLocal(id, [mapped, queueServerId])
    if (queueServerId) {
      await useOfflineSync.getState().queueOp('finance_move_delete', { clientRef: deleteRef, id: queueServerId }, { clientRef: deleteRef })
    }
    void persistPosSnapshot()
    return { id: queueServerId || id }
  }

  if (!queueServerId) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteFinanceMove(queueServerId)
    reverseFinanceMoveLocal(id, [mapped, queueServerId])
    void persistPosSnapshot()
    return { id: queueServerId }
  }, applyLocal)
}

function isLocalCardTopupMove(row: FinanceMove): boolean {
  if (String((row as any).refType || '') === 'card_topup') return true
  const reason = String((row as any).reason || '')
  const note = String(row.note || '')
  return /пополнение бонусов/i.test(reason) || /пополнение бонусов/i.test(note)
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
