'use client'

import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { phonesMatch } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync, fetchCrmStoreUser, findMergedClientByPhone } from './clientProfileSync'
import { USE_API } from './config'
import { api } from './api'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { ACCOUNT_NS, accountStorageKey, loadAccountJson, saveAccountJson } from './clientAccountStorage'
import { phoneDigits, type StoreUser } from './clientSession'
import { resolveEffectiveDebtLimit } from './loyaltyStatusConfig'
import {
  allocateSaleRemainsToDebtBudget,
  diagnoseDebtProjection as diagnoseDebtProjectionCore,
  resolveAuthoritativeCustomerDebt as resolveAuthoritativeCustomerDebtCore,
  sumOpenDebtLedgerRemaining,
} from './debtUiProjectionCore.mjs'
import {
  CASH_ADVANCE_HISTORY_LABEL,
  findMatchingCashAdvanceLocal,
  isCashAdvanceLedgerSource,
  mapDebtLedgerSource,
  mergeOpenCashAdvancesFromClientLedger,
  upsertLocalCashAdvanceHistory,
} from './cashAdvanceHistoryCore.mjs'
import {
  buildLedgerHistoryRows,
  mergeLocalOnlyRows,
  selectAuthoritativeLedgerEntries,
} from './debtHistoryLedgerCore.mjs'

export {
  sumOpenDebtLedgerRemaining,
  CASH_ADVANCE_HISTORY_LABEL,
  mergeOpenCashAdvancesFromClientLedger,
}

/** Current displayed debt: debtLedger.remaining sum when present, else CRM client.debt. */
export function resolveAuthoritativeCustomerDebt(input: {
  clientDebt?: number | null
  cardDebt?: number | null
  debtLedger?: { remaining?: number }[] | null
  cardDebtLedger?: { remaining?: number }[] | null
}): number {
  return resolveAuthoritativeCustomerDebtCore(input)
}

export function diagnoseDebtProjection(input: {
  clientDebt?: number | null
  cardDebt?: number | null
  debtLedger?: { remaining?: number }[] | null
  cardDebtLedger?: { remaining?: number }[] | null
}) {
  return diagnoseDebtProjectionCore(input)
}

const DEBT_HIST = ACCOUNT_NS.debtHistory
export const DEBT_HISTORY_EVT = 'kakapo_debt_history'
const LEDGER_DEBT_PREFIX = 'ldg-'
const LEDGER_PAY_PREFIX = 'ldg-pay-'
/** Строка истории, построенная из серверной разбивки погашения (payments[]) — id = srvpay-<paymentId>-<entryId> */
const LEDGER_PAY_ROW_PREFIX = 'srvpay-'
const DEBT_HISTORY_CAP = 120
const ledgerSyncInflight = new Map<string, Promise<DebtLedgerResponse | null>>()

export type VipCreditState = {
  enabled: boolean
  isVip: boolean
  debt: number
  debtLimit: number
  available: number
  bonus: number
  card: string
}

export type DebtHistoryEntry = {
  id: string
  date: string
  time: string
  ts: number
  desc: string
  amount: number
  orderId?: string
  /** Краткое описание состава заказа */
  itemsSummary?: string
  /** debt = в долг, pay = погашение, purchase = оплаченная покупка в магазине */
  type: 'debt' | 'pay' | 'purchase'
  /** Откуда запись: manual — правка в разделе Долги; pos — чек кассы; order — заказ магазина; cashier — погашение на кассе */
  source?: 'manual' | 'pos' | 'order' | 'cashier'
  /** Одна оплата клиента, разбитая по нескольким чекам (FIFO) */
  batchId?: string
  /** sale = оплата текущего чека в одной операции с погашением долга (не влияет на остаток долга) */
  payScope?: 'sale' | 'debt'
  /** Ключ офлайн-операции — для отката при отказе сервера */
  clientRef?: string
  /** Срок погашения (ISO) — с серверного ledger */
  dueAtIso?: string
  /** id серверной записи журнала, к которой относится эта оплата (durable-разбивка) */
  ledgerEntryId?: string
  /** Человекочитаемый срок */
  dueDate?: string
  /** Дней до срока (отрицательное = просрочка) */
  daysLeft?: number
  overdue?: boolean
}

export type DebtLedgerEntry = {
  id: string
  amount: number
  remaining: number
  paidAmount: number
  createdAtIso: string
  dueAtIso: string
  dueDate: string
  daysLeft: number
  overdue: boolean
  source?: string
  orderId?: string
  saleId?: string
  desc: string
  status: 'open' | 'overdue' | 'paid'
  /** Разбивка погашений: какая оплата, когда и сколько закрыла по этой записи (durable, с сервера) */
  payments?: {
    id: string | null
    atIso: string | null
    amount: number
    method: string | null
  }[]
}

export type DebtLedgerResponse = {
  termDays: number
  debt: number
  debtLimit: number
  overdueStrikes: number
  creditBlocked: boolean
  nextDueDate: string | null
  nextDueDaysLeft: number | null
  entries: DebtLedgerEntry[]
}

export function emitDebtHistoryChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DEBT_HISTORY_EVT))
}

export function subscribeDebtHistory(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const h = () => cb()
  window.addEventListener(DEBT_HISTORY_EVT, h)
  return () => window.removeEventListener(DEBT_HISTORY_EVT, h)
}

export function debtHistoryTotals(list: DebtHistoryEntry[]) {
  let borrowed = 0
  let repaid = 0
  for (const row of list) {
    if (row.type === 'debt') borrowed += Math.abs(row.amount)
    else if (row.type === 'pay') repaid += row.amount
  }
  return { borrowed, repaid }
}

export function recordStorePurchase(
  phone: string,
  amount: number,
  desc = 'Покупка в магазине',
  meta?: { orderId?: string; itemsSummary?: string },
): void {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0) return
  pushDebtHistory(phone, {
    desc,
    amount: pay,
    type: 'purchase',
    orderId: meta?.orderId,
    itemsSummary: meta?.itemsSummary,
  })
}

/** Разделить заказы в долг на оплаченные (FIFO по погашениям) и неоплаченные */
export type DebtOrderBalance = DebtHistoryEntry & {
  originalAmount: number
  paidAmount: number
  remainingAmount: number
  partial: boolean
}

/** Совпадение orderId у долга и погашения (в т.ч. sale-… / id чека). */
export function debtOrderIdsMatch(a?: string, b?: string): boolean {
  const x = String(a || '').trim()
  const y = String(b || '').trim()
  if (!x || !y) return false
  if (x === y) return true
  if (x === `sale-${y}` || y === `sale-${x}`) return true
  return false
}

export function buildDebtOrderBalances(list: DebtHistoryEntry[]): {
  unpaid: DebtOrderBalance[]
  paid: DebtHistoryEntry[]
} {
  const debts = list.filter(h => h.type === 'debt').sort((a, b) => (a.ts || 0) - (b.ts || 0))
  const pays = list.filter(h => h.type === 'pay' && h.payScope !== 'sale')
  const remain = new Map<string, number>()
  for (const d of debts) {
    remain.set(d.id, Math.round(Math.abs(d.amount) * 100) / 100)
  }

  // Сначала погашения, привязанные к конкретному чеку/заказу/наличной выдаче
  let repayLeft = 0
  for (const p of pays) {
    const amt = Math.round(Math.abs(Number(p.amount) || 0) * 100) / 100
    if (!(amt > 0)) continue
    const oid = String(p.orderId || '').trim()
    if (oid) {
      const target = debts.find(d => {
        if ((remain.get(d.id) || 0) <= 0.001) return false
        if (debtOrderIdsMatch(d.orderId, oid)) return true
        // Наличная выдача: orderId = cash-D-… или сам id записи
        if (debtOrderIdsMatch(d.id, oid)) return true
        if (debtOrderIdsMatch(`cash-${d.id}`, oid)) return true
        return false
      })
      if (target) {
        const need = remain.get(target.id) || 0
        const apply = Math.min(need, amt)
        remain.set(target.id, Math.round((need - apply) * 100) / 100)
        const leftover = Math.round((amt - apply) * 100) / 100
        if (leftover > 0.001) repayLeft += leftover
        continue
      }
    }
    repayLeft += amt
  }

  // Остаток погашений без привязки — FIFO от старых долгов
  const paid: DebtHistoryEntry[] = []
  const unpaid: DebtOrderBalance[] = []

  for (const d of debts) {
    const original = Math.round(Math.abs(d.amount) * 100) / 100
    let left = remain.get(d.id) ?? original
    if (repayLeft > 0.001 && left > 0.001) {
      const apply = Math.min(left, repayLeft)
      left = Math.round((left - apply) * 100) / 100
      repayLeft = Math.round((repayLeft - apply) * 100) / 100
    }
    const paidAmount = Math.round((original - left) * 100) / 100
    if (left <= 0.001) {
      paid.push(d)
    } else if (paidAmount > 0.001) {
      unpaid.push({
        ...d,
        originalAmount: original,
        paidAmount,
        remainingAmount: left,
        partial: true,
      })
    } else {
      unpaid.push({
        ...d,
        originalAmount: original,
        paidAmount: 0,
        remainingAmount: left,
        partial: false,
      })
    }
  }

  const sortDesc = (a: { ts?: number }, b: { ts?: number }) => (b.ts || 0) - (a.ts || 0)
  return {
    unpaid: unpaid.sort(sortDesc),
    paid: paid.sort(sortDesc),
  }
}

/** Остаток долга по чеку. Полный возврат = 0. Не подставляем total, если debtAdded уже 0. */
export function saleOpenCreditAmount(s: {
  status?: string
  paymentMethod?: string
  debtAdded?: number | null
  total?: number
  items?: { qty?: number; returnedQty?: number }[]
}): number {
  if (s.status === 'returned') return 0
  const items = s.items || []
  if (
    items.length > 0
    && items.every(it => (Number(it.returnedQty) || 0) >= (Number(it.qty) || 0) - 0.001)
  ) {
    return 0
  }
  if (s.debtAdded != null && Number.isFinite(Number(s.debtAdded))) {
    return Math.max(0, Math.round(Number(s.debtAdded) * 100) / 100)
  }
  if (s.paymentMethod === 'credit') {
    return Math.max(0, Math.round((Number(s.total) || 0) * 100) / 100)
  }
  return 0
}

/** Чек был в долг — в том числе уже возвращённый. */
export function saleWasOnCredit(s: {
  status?: string
  paymentMethod?: string
  debtAdded?: number | null
  total?: number
  items?: { qty?: number; returnedQty?: number }[]
}): boolean {
  if (saleOpenCreditAmount(s) > 0.001) return true
  if (s.paymentMethod === 'credit') return true
  return false
}

/** Остаток долга по конкретному чеку (по orderId / сумме+времени). */
export function debtStatusForSale(
  list: DebtHistoryEntry[],
  sale: { id: string; orderId?: string; debtAdded: number; dateIso?: string },
): { status: 'paid' | 'partial' | 'open'; paid: number; remain: number } {
  const total = Math.round(Math.abs(Number(sale.debtAdded) || 0) * 100) / 100
  if (!(total > 0.001)) return { status: 'paid', paid: 0, remain: 0 }

  const { unpaid, paid } = buildDebtOrderBalances(list)
  const keys = [sale.id, sale.orderId, sale.id ? `sale-${sale.id}` : '', sale.orderId ? `sale-${sale.orderId}` : '']
    .map(k => String(k || '').trim())
    .filter(Boolean)

  const byOrderUnpaid = unpaid.find(d => keys.some(k => debtOrderIdsMatch(d.orderId, k)))
  if (byOrderUnpaid) {
    return {
      status: byOrderUnpaid.partial ? 'partial' : 'open',
      paid: byOrderUnpaid.paidAmount,
      remain: byOrderUnpaid.remainingAmount,
    }
  }
  const byOrderPaid = paid.find(d => keys.some(k => debtOrderIdsMatch(d.orderId, k)))
  if (byOrderPaid) {
    const amt = Math.round(Math.abs(Number(byOrderPaid.amount) || total) * 100) / 100
    return { status: 'paid', paid: amt, remain: 0 }
  }

  const saleTs = sale.dateIso ? Date.parse(sale.dateIso) || 0 : 0
  const nearUnpaid = unpaid.find(d =>
    Math.abs(Math.abs(Number(d.amount) || 0) - total) < 0.02
    && (!saleTs || Math.abs((d.ts || 0) - saleTs) < 10 * 60 * 1000),
  )
  if (nearUnpaid) {
    return {
      status: nearUnpaid.partial ? 'partial' : 'open',
      paid: nearUnpaid.paidAmount,
      remain: nearUnpaid.remainingAmount,
    }
  }

  // Прямые погашения по id чека без строки долга в истории
  const targeted = list
    .filter(h => h.type === 'pay' && keys.some(k => debtOrderIdsMatch(h.orderId, k)))
    .reduce((s, h) => s + Math.abs(Number(h.amount) || 0), 0)
  const paidAmt = Math.round(Math.min(total, targeted) * 100) / 100
  const remain = Math.round((total - paidAmt) * 100) / 100
  if (remain <= 0.001) return { status: 'paid', paid: total, remain: 0 }
  if (paidAmt > 0.001) return { status: 'partial', paid: paidAmt, remain }
  return { status: 'open', paid: 0, remain: total }
}

export type SaleDebtStatus = { status: 'paid' | 'partial' | 'open'; paid: number; remain: number }

function saleOrderKeys(s: { id: string; orderId?: string }): string[] {
  return [s.id, s.orderId, s.id ? `sale-${s.id}` : '', s.orderId ? `sale-${s.orderId}` : '']
    .map(k => String(k || '').trim())
    .filter(Boolean)
}

/**
 * Остатки по чекам в пределах authoritative current debt (CRM / debtLedger).
 * Одна логика для раздела «Долги» и окна клиента в кассе.
 *
 * sale.debtAdded = original credit only. Never resurrect historical debtAdded
 * into current totals after authoritative debt has been cleared (≈0).
 */
export function buildSaleDebtStatuses(
  sales: { id: string; orderId?: string; debtAdded: number; dateIso: string }[],
  history: DebtHistoryEntry[],
  cardDebt: number,
  debtLedger?: Array<{ saleId?: string; remaining?: number }> | null,
): { saleStatus: Record<string, SaleDebtStatus>; posOriginal: number; posRemain: number; cashOnCard: number } {
  const debt = Math.max(0, Math.round(cardDebt * 100) / 100)

  const historyRemainBySaleId: Record<string, SaleDebtStatus> = {}
  for (const s of sales) historyRemainBySaleId[s.id] = debtStatusForSale(history, s)

  const allocated = allocateSaleRemainsToDebtBudget(
    sales,
    historyRemainBySaleId,
    debt,
    {
      debtLedger: debtLedger || undefined,
      isLinked: (s) => {
        const keys = saleOrderKeys(s)
        return history.some(h =>
          (h.type === 'debt' || h.type === 'pay')
          && keys.some(k => debtOrderIdsMatch(h.orderId, k)),
        )
      },
    },
  )

  // When CRM/ledger debt is open, cash slice may come from local history ledger
  // but must never push displayed goods+cash above authoritative debt.
  if (debt >= 0.001 && history.some(h => h.type === 'debt')) {
    const ledgerCash = computeDebtFromLedger(history).cash
    const posRemain = allocated.posRemain
    const cashOnCard = Math.min(
      Math.max(0, ledgerCash),
      Math.max(0, Math.round((debt - posRemain) * 100) / 100),
    )
    return {
      saleStatus: allocated.saleStatus as Record<string, SaleDebtStatus>,
      posOriginal: allocated.posOriginal,
      posRemain,
      cashOnCard,
    }
  }

  return {
    saleStatus: allocated.saleStatus as Record<string, SaleDebtStatus>,
    posOriginal: allocated.posOriginal,
    posRemain: allocated.posRemain,
    cashOnCard: allocated.cashOnCard,
  }
}

/**
 * Ledger-first расчёт долга: группирует remaining по source.
 * goods = pos + order + backfill; cash = manual + cashier (без orderId).
 */
export function computeDebtFromLedger(
  history: DebtHistoryEntry[],
): { goods: number; cash: number; total: number } {
  const cashAdvRows = history.filter(isCashAdvanceHistoryRow)
  const isCashAdvPay = (oid: string) => cashAdvRows.some(d =>
    debtOrderIdsMatch(d.orderId, oid)
    || debtOrderIdsMatch(d.id, oid)
    || debtOrderIdsMatch(`cash-${d.id}`, oid),
  )
  let goods = 0
  let cash = 0
  for (const row of history) {
    if (row.type !== 'debt') continue
    const amt = Math.abs(Number(row.amount) || 0)
    if (amt < 0.005) continue
    const src = row.source || ''
    if (isCashAdvanceHistoryRow(row)) {
      cash += amt
    } else if (src === 'pos' || src === 'order' || row.orderId) {
      goods += amt
    } else {
      cash += amt
    }
  }
  let goodsPaid = 0
  let cashPaid = 0
  for (const row of history) {
    if (row.type !== 'pay') continue
    if (row.payScope === 'sale') continue
    const amt = Math.abs(Number(row.amount) || 0)
    if (amt < 0.005) continue
    const src = row.source || ''
    const payOid = String(row.orderId || '').trim()
    if (payOid && src !== 'pos' && src !== 'order' && isCashAdvPay(payOid)) {
      cashPaid += amt
    } else if (src === 'pos' || src === 'order' || payOid) {
      goodsPaid += amt
    } else {
      cashPaid += amt
    }
  }
  const g = Math.max(0, Math.round((goods - goodsPaid) * 100) / 100)
  const c = Math.max(0, Math.round((cash - cashPaid) * 100) / 100)
  return { goods: g, cash: c, total: Math.round((g + c) * 100) / 100 }
}

export function splitDebtHistoryBySettlement(
  list: DebtHistoryEntry[],
  includePayments = true,
): { unpaid: DebtOrderBalance[]; paid: DebtHistoryEntry[] } {
  const { unpaid, paid } = buildDebtOrderBalances(list)
  const pays = list.filter(h => h.type === 'pay')
  const sortDesc = (a: DebtHistoryEntry, b: DebtHistoryEntry) => (b.ts || 0) - (a.ts || 0)
  return {
    unpaid,
    paid: [...paid, ...(includePayments ? pays : [])].sort(sortDesc),
  }
}

export function getVipCreditState(user?: Partial<StoreUser> | null): VipCreditState {
  const debt = Number(user?.debt) || 0
  const debtLimit = resolveEffectiveDebtLimit({
    level: user?.level,
    vip: !!user?.vip,
    debtLimit: user?.debtLimit,
    debtEnabled: user?.debtEnabled,
    levelAssignMode: user?.levelAssignMode,
  })
  const isVip = !!user?.vip
  const blocked = !!user?.blocked
  const enabled = isVip && debtLimit > 0 && !blocked
  const available = enabled ? Math.max(0, Math.round((debtLimit - debt) * 100) / 100) : 0
  return {
    enabled,
    isVip,
    debt,
    debtLimit,
    available,
    bonus: Number(user?.bonus) || 0,
    card: user?.card || '',
  }
}

export function canPayWithCredit(user: Partial<StoreUser> | null | undefined, amount: number): { ok: boolean; reason?: string } {
  const s = getVipCreditState(user)
  if (user?.debtCreditBlocked) {
    return {
      ok: false,
      reason: 'Новый долг недоступен: была повторная просрочка. Погасите текущий долг в магазине.',
    }
  }
  if (!s.enabled) return { ok: false, reason: 'VIP-кредит недоступен. Нужен VIP и лимит от администратора.' }
  if (amount <= 0) return { ok: false, reason: 'Сумма заказа должна быть больше 0' }
  if (amount > s.available + 0.001) {
    return { ok: false, reason: `Недостаточно лимита. Доступно ${s.available.toLocaleString()} ЅМ` }
  }
  return { ok: true }
}

export function getBonusUsable(user: Partial<StoreUser> | null | undefined, goodsSubtotal: number): number {
  const bonus = Number(user?.bonus) || 0
  const goods = Math.max(0, Number(goodsSubtotal) || 0)
  if (bonus <= 0 || goods <= 0) return 0
  return Math.min(bonus, Math.floor(goods))
}

function ensureCrmStores() {
  const cs = useCardStore.getState()
  const cl = useClientStore.getState()
  if (!cs.hydrated) cs.hydrate()
  if (!cl.hydrated) cl.hydrate()
}

function findCardForPhone(phone: string): AdminCard | null {
  ensureCrmStores()
  const cards = useCardStore.getState().cards
  const clients = useClientStore.getState().clients
  const client = clients.find(c => phonesMatch(c.phone, phone))
  if (client?.card) {
    const c = cards.find(x => x.num === client.card && x.status !== 'unlinked')
    if (c) return normalizeCard(c)
  }
  const byPhone = cards.find(c => c.status !== 'unlinked' && c.phone && phonesMatch(c.phone, phone))
  return byPhone ? normalizeCard(byPhone) : null
}

function setDebtOnCard(phone: string, newDebt: number, newBonus?: number) {
  const card = findCardForPhone(phone)
  if (!card) throw new Error('Карта клиента не найдена')
  const patch: Partial<AdminCard> = { debt: Math.max(0, Math.round(newDebt * 100) / 100) }
  if (newBonus != null) patch.bonus = Math.max(0, Math.floor(newBonus))
  useCardStore.getState().updateCardLoyalty(card.num, patch)
  emitCrmSync()
}

function isCidHistoryKey(key: string): boolean {
  return String(key || '').startsWith('cid:')
}

function debtHistLsKey(key: string): string {
  const k = String(key || '').trim()
  if (!k) return ''
  if (isCidHistoryKey(k)) return `kakapo_acct_${k}_${DEBT_HIST}`
  return accountStorageKey(DEBT_HIST, k)
}

/**
 * Durable-зеркало долговой истории для Desktop.
 * Локальный список оплат живёт в origin, а Desktop открывает кассу на каждый запуск
 * со случайного порта (`listen(0)`) — значит localStorage обнуляется. Копия в локальной
 * базе Desktop (userData, не origin) это переживает, поэтому история оплат не пропадает.
 */
const DEBT_HISTORY_DURABLE_KEY = 'debt_history_durable_v1'
type DebtHistoryDurableMap = Record<string, DebtHistoryEntry[]>
let durableHistCache: DebtHistoryDurableMap | null = null
let durableHistChain: Promise<void> = Promise.resolve()

async function durableHistRead(): Promise<DebtHistoryDurableMap | null> {
  const desk = getKakapoDesktop()
  if (!isKakapoDesktop() || !desk?.localDbKvGet) return null
  try {
    const raw = await desk.localDbKvGet(DEBT_HISTORY_DURABLE_KEY)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as DebtHistoryDurableMap
  } catch {
    return null
  }
}

/** Запись сериализована: параллельные сохранения не затирают друг друга. */
function durableHistWrite(lsKey: string, list: DebtHistoryEntry[]): Promise<void> {
  const desk = getKakapoDesktop()
  if (!isKakapoDesktop() || !desk?.localDbKvSet || !lsKey) return Promise.resolve()
  durableHistChain = durableHistChain.then(async () => {
    if (!durableHistCache) durableHistCache = (await durableHistRead()) || {}
    durableHistCache[lsKey] = list.slice(0, DEBT_HISTORY_CAP)
    try { await desk.localDbKvSet(DEBT_HISTORY_DURABLE_KEY, durableHistCache) } catch { /* ignore */ }
  }).catch(() => { /* ignore */ })
  return durableHistChain
}

/**
 * Вернуть долговую историю из durable-хранилища Desktop в localStorage.
 * Без телефона — все известные ключи (старт приложения); с телефоном — только его.
 */
export async function hydrateDebtHistoryDurable(phone?: string): Promise<boolean> {
  const all = await durableHistRead()
  if (!all) return false
  if (!durableHistCache) durableHistCache = { ...all }
  const lsKeys = phone ? [debtHistLsKey(phone)].filter(Boolean) : Object.keys(all)
  let changed = false
  for (const lsKey of lsKeys) {
    const durable = all[lsKey]
    if (!Array.isArray(durable) || !durable.length) continue
    const current = readDebtHistoryByLsKey(lsKey)
    const merged = mergeDebtHistoryRows(current, durable)
    if (merged.length === current.length) continue
    writeDebtHistoryByLsKey(lsKey, merged)
    changed = true
  }
  if (changed) emitDebtHistoryChange()
  return changed
}

function readDebtHistoryByLsKey(lsKey: string): DebtHistoryEntry[] {
  if (typeof window === 'undefined' || !lsKey) return []
  try {
    const raw = localStorage.getItem(lsKey)
    if (!raw) return []
    const list = JSON.parse(raw) as DebtHistoryEntry[]
    if (!Array.isArray(list)) return []
    return list.map((row, i) => ({
      ...row,
      time: row.time || '',
      ts: row.ts || Date.now() - i,
      /** Старые записи могли сохранить состав массивом — приводим к тексту, иначе UI падал при показе. */
      itemsSummary: normalizeHistoryItemsSummary(row.itemsSummary),
    }))
  } catch {
    return []
  }
}

function writeDebtHistoryByLsKey(lsKey: string, list: DebtHistoryEntry[]) {
  if (typeof window === 'undefined' || !lsKey) return
  try {
    localStorage.setItem(lsKey, JSON.stringify(list.slice(0, DEBT_HISTORY_CAP)))
  } catch { /* quota */ }
}

function mergeDebtHistoryRows(a: DebtHistoryEntry[], b: DebtHistoryEntry[]): DebtHistoryEntry[] {
  const seen = new Set<string>()
  const out: DebtHistoryEntry[] = []
  for (const row of [...a, ...b]) {
    const id = String(row.id || '')
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    out.push(row)
  }
  return out.sort((x, y) => (y.ts || 0) - (x.ts || 0))
}

/** Телефон, если есть; иначе id клиента — чтобы чек в долг без номера тоже писал историю. */
export function debtAccountKey(client: { phone?: string; id?: string } | null | undefined): string {
  const digits = phoneDigits(String(client?.phone || ''))
  if (digits) return digits
  const id = String(client?.id || '').trim()
  return id ? `cid:${id}` : ''
}

/** Состав из истории должен быть строкой. Старые записи могли сохранить массив — приводим к тексту. */
export function normalizeHistoryItemsSummary(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const it of value) {
      const rec = it as { name?: unknown; productName?: unknown; qty?: unknown }
      const name = String(rec?.name ?? rec?.productName ?? '').trim()
      if (!name) continue
      const qty = Number(rec?.qty)
      parts.push(Number.isFinite(qty) && qty !== 0 ? `${name} ×${qty}` : name)
    }
    return parts.length ? parts.join(', ') : undefined
  }
  return undefined
}

export function loadDebtHistory(phone: string): DebtHistoryEntry[] {
  return readDebtHistoryByLsKey(debtHistLsKey(phone))
}

export function loadDebtHistoryForClient(
  client: { phone?: string; id?: string } | null | undefined,
): DebtHistoryEntry[] {
  if (!client) return []
  const phone = phoneDigits(String(client.phone || ''))
  const cid = String(client.id || '').trim() ? `cid:${String(client.id).trim()}` : ''
  const fromPhone = phone ? loadDebtHistory(phone) : []
  const fromCid = cid ? loadDebtHistory(cid) : []
  if (!fromCid.length) return fromPhone
  if (!fromPhone.length) return fromCid
  return mergeDebtHistoryRows(fromPhone, fromCid)
}

/**
 * Последний ответ серверного журнала долга, полученный этим устройством.
 * Нужен, чтобы строить «историю» строго из сервера (с готовой разбивкой старых оплат),
 * а не из локального накопителя. Ключ — цифры телефона.
 */
const latestLedgerByPhone = new Map<string, DebtLedgerResponse>()

export function getLatestDebtLedger(phone?: string | null): DebtLedgerResponse | null {
  const key = phoneDigits(String(phone || ''))
  if (!key) return null
  return latestLedgerByPhone.get(key) || null
}

export function cacheLatestDebtLedger(phone: string, ledger: DebtLedgerResponse | null | undefined): void {
  if (!ledger || !Array.isArray(ledger.entries)) return
  const key = phoneDigits(phone) || String(phone || '').trim()
  if (!key) return
  latestLedgerByPhone.set(key, ledger)
}

/**
 * Авторитетная история долга для витрины: строится строго из серверного журнала
 * (client.debtLedger — один и тот же на всех устройствах) плюс разбивка оплат из
 * последнего ответа API, если он уже получен. Локально добавляются только ручные
 * записи раздела «Долги», которых ещё нет в серверном журнале. Так лента, чеки и
 * оплаты совпадают на всех устройствах и в онлайне.
 */
export function authoritativeDebtHistoryForClient(
  client: { phone?: string; id?: string; debtLedger?: unknown[] } | null | undefined,
): DebtHistoryEntry[] {
  if (!client) return []
  const phone = phoneDigits(String(client.phone || ''))
  const cached = phone ? latestLedgerByPhone.get(phone) : null
  // Источник правды — последний ответ сервера (полный журнал + разбивка старых оплат).
  // Сырой client.debtLedger подмешивается только свежими записями, которых в ответе ещё
  // нет, чтобы устаревший локальный снимок на одном устройстве не расходился с онлайн.
  const entries = selectAuthoritativeLedgerEntries(client.debtLedger, cached?.entries)
  const authoritative = buildLedgerHistoryRows(entries)
  if (!authoritative.length) {
    // Журнала нет (например, старый клиент без debtLedger) — показываем локальное как есть.
    return loadDebtHistoryForClient(client)
  }
  const local = loadDebtHistoryForClient(client)
  // Сохраняем локальные записи, которых ещё нет на сервере (офлайн-операции, ручные правки),
  // но отбрасываем дубли уже учтённых серверных операций. Ручные записи показываем всегда.
  return mergeLocalOnlyRows(
    authoritative,
    local,
    row => isManualDebtHistoryEntry(row) || !isImportedLedgerHistoryId(row.id),
  ) as DebtHistoryEntry[]
}

export function isImportedLedgerHistoryId(id?: string): boolean {
  const v = String(id || '')
  return v.startsWith(LEDGER_DEBT_PREFIX)
    || v.startsWith(LEDGER_PAY_PREFIX)
    || v.startsWith(LEDGER_PAY_ROW_PREFIX)
}

/** Ручная запись (начисление/погашение в разделе Долги) — можно править/удалить. Чеки и заказы — нет. */
export function isManualDebtHistoryEntry(row: DebtHistoryEntry): boolean {
  if (row.type === 'purchase') return false
  if (row.type !== 'debt' && row.type !== 'pay') return false
  // Серверный журнал — только для показа, не правим локально
  if (isImportedLedgerHistoryId(row.id)) return false
  // Привязка к чеку/заказу — не ручная правка
  if (row.orderId) return false
  if (row.source === 'manual') return true
  if (row.source === 'pos' || row.source === 'order' || row.source === 'cashier') return false
  // Старые строки без source: правим только явный ручной текст из «Долгов»
  const desc = String(row.desc || '').trim()
  if (!desc) return false
  if (/чек/i.test(desc)) return false
  if (/^заказ\b/i.test(desc)) return false
  if (/погашение/i.test(desc)) return false
  if (/в долг/i.test(desc)) return false
  if (/с сервера/i.test(desc)) return false
  if (/касса/i.test(desc)) return false
  return /ручн/i.test(desc)
    || /выдано наличн/i.test(desc)
    || /выдача наличн/i.test(desc)
    || /начисление/i.test(desc)
}

function saveDebtHistoryList(phone: string, list: DebtHistoryEntry[]) {
  const lsKey = debtHistLsKey(phone)
  if (!lsKey) return
  writeDebtHistoryByLsKey(lsKey, list)
  // Desktop: дублируем в локальную базу, иначе смена порта/обновление теряет историю
  void durableHistWrite(lsKey, list)
  emitDebtHistoryChange()
}

function mapLedgerSource(source?: string): DebtHistoryEntry['source'] {
  return mapDebtLedgerSource(source) as DebtHistoryEntry['source']
}

function ledgerWhen(iso?: string): { ts: number; date: string; time: string } {
  const ts = Date.parse(String(iso || '')) || Date.now()
  const when = new Date(ts)
  return {
    ts,
    date: when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  }
}

function findMatchingLocalDebt(local: DebtHistoryEntry[], e: DebtLedgerEntry): DebtHistoryEntry | undefined {
  if (isCashAdvanceLedgerSource(e.source)) {
    const hit = findMatchingCashAdvanceLocal(local, e)
    if (hit) return hit as DebtHistoryEntry
  }
  const ledgerId = `${LEDGER_DEBT_PREFIX}${e.id}`
  const byId = local.find(r => r.type === 'debt' && (r.id === ledgerId || r.id === e.id))
  if (byId) return byId
  const oid = String(e.orderId || e.saleId || '').trim()
  if (oid) {
    const byOrder = local.find(r => r.type === 'debt' && debtOrderIdsMatch(r.orderId, oid))
    if (byOrder) return byOrder
  }
  const ts = Date.parse(e.createdAtIso) || 0
  const amt = Math.abs(Number(e.amount) || 0)
  if (!(ts > 0) || !(amt > 0)) return undefined
  return local.find(r =>
    r.type === 'debt'
    && Math.abs(Math.abs(Number(r.amount) || 0) - amt) < 0.02
    && Math.abs((r.ts || 0) - ts) < 10 * 60 * 1000,
  )
}

function localPaysCovered(local: DebtHistoryEntry[], e: DebtLedgerEntry): number {
  const ledgerPayId = `${LEDGER_PAY_PREFIX}${e.id}`
  const oid = String(e.orderId || e.saleId || '').trim()
  const entryId = String(e.id || '')
  let covered = 0
  for (const r of local) {
    if (r.type !== 'pay') continue
    if (r.id === ledgerPayId) {
      covered += Math.abs(Number(r.amount) || 0)
      continue
    }
    // durable-разбивка: строки, построенные из e.payments[] этого же чека
    if (entryId && String(r.ledgerEntryId || '') === entryId && String(r.id || '').startsWith(LEDGER_PAY_ROW_PREFIX)) {
      covered += Math.abs(Number(r.amount) || 0)
      continue
    }
    if (oid && debtOrderIdsMatch(r.orderId, oid)) {
      covered += Math.abs(Number(r.amount) || 0)
    }
  }
  return Math.round(covered * 100) / 100
}

function historyDebtMatchesSale(
  row: DebtHistoryEntry,
  sale: { id: string; orderId?: string },
): boolean {
  return saleOrderKeys(sale).some(k => debtOrderIdsMatch(row.orderId, k))
}

/** Выдача наличных: orderId у неё — id записи журнала сервера, а не чек. */
export function isCashAdvanceHistoryRow(row: DebtHistoryEntry): boolean {
  if (row.type !== 'debt') return false
  if (row.source === 'pos' || row.source === 'order') return false
  const desc = String(row.desc || '')
  return desc.startsWith(CASH_ADVANCE_HISTORY_LABEL) || /выдач\S*\s+налич/i.test(desc)
}

/** Наличные / заказ с сервера — в ленте «Нал.», если это не чек POS (в т.ч. уже возвращённый). */
export function isLedgerCashHistoryDebt(
  row: DebtHistoryEntry,
  posSales: { id: string; orderId?: string }[],
): boolean {
  if (row.type !== 'debt') return false
  if (posSales.some(s => historyDebtMatchesSale(row, s))) return false
  // Чек / заказ — всегда «Товары», даже если чек вернули и он выпал из открытых.
  if (row.source === 'pos' || row.source === 'order') return false
  if (isCashAdvanceHistoryRow(row)) return true
  if (row.orderId) return false
  const desc = String(row.desc || '')
  if (/чек|заказ|возврат/i.test(desc)) return false
  if (isManualDebtHistoryEntry(row)) return true
  if (isImportedLedgerHistoryId(row.id)) {
    return !row.source || row.source === 'cashier' || row.source === 'manual'
  }
  if (!row.source) return true
  return row.source === 'cashier' || row.source === 'manual'
}

function applyLedgerFlagsToCrm(phone: string, ledger: DebtLedgerResponse) {
  const strikes = Math.max(0, Number(ledger.overdueStrikes) || 0)
  const blocked = !!ledger.creditBlocked
  const clients = useClientStore.getState().clients
  const cl = clients.find(c => phonesMatch(c.phone, phone))
  if (cl) {
    if (!!cl.debtCreditBlocked !== blocked || (Number(cl.debtOverdueStrikes) || 0) !== strikes) {
      useClientStore.getState().updateClient(cl.id, {
        debtCreditBlocked: blocked,
        debtOverdueStrikes: strikes,
      }, { skipApi: true })
    }
  }
  const card = findCardForPhone(phone)
  if (card && !!card.debtCreditBlocked !== blocked) {
    useCardStore.getState().updateCardLoyalty(card.num, { debtCreditBlocked: blocked }, { skipApi: true })
  }
}

function mergeLedgerIntoLocalHistory(phone: string, ledger: DebtLedgerResponse): boolean {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  if (!entries.length) return false

  const prev = loadDebtHistory(phone)
  const next = prev.map(r => ({ ...r }))
  let changed = false
  let unlinkedPayPool = Math.round(
    next
      .filter(r => r.type === 'pay' && !String(r.orderId || '').trim() && !isImportedLedgerHistoryId(r.id))
      .reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) * 100,
  ) / 100

  for (const e of entries) {
    const oid = String(e.orderId || e.saleId || '').trim() || undefined
    const amt = Math.abs(Number(e.amount) || 0)
    if (!(amt > 0.001)) continue

    if (isCashAdvanceLedgerSource(e.source)) {
      const when = ledgerWhen(e.createdAtIso)
      const upsert = upsertLocalCashAdvanceHistory(next, {
        amount: amt,
        ts: when.ts,
        createdAtIso: e.createdAtIso,
        ledgerEntryId: e.id,
        clientRef: (e as { clientRef?: string }).clientRef,
        when,
      })
      next.splice(0, next.length, ...upsert.next)
      if (upsert.changed) changed = true
      const idx = next.findIndex(r =>
        r.type === 'debt'
        && (r.id === `${LEDGER_DEBT_PREFIX}${e.id}` || r.id === e.id),
      )
      if (idx >= 0) {
        const cur = next[idx]
        if (
          cur.desc !== CASH_ADVANCE_HISTORY_LABEL
          || cur.dueAtIso !== e.dueAtIso
          || cur.dueDate !== e.dueDate
          || cur.daysLeft !== e.daysLeft
          || !!cur.overdue !== !!e.overdue
        ) {
          next[idx] = {
            ...cur,
            desc: CASH_ADVANCE_HISTORY_LABEL,
            source: 'cashier',
            orderId: cur.orderId || e.id,
            dueAtIso: e.dueAtIso,
            dueDate: e.dueDate,
            daysLeft: e.daysLeft,
            overdue: e.overdue,
          }
          changed = true
        } else if (!cur.orderId && e.id) {
          next[idx] = { ...cur, orderId: e.id }
          changed = true
        }
      }
    } else {
      const matched = findMatchingLocalDebt(next, e)
      if (matched) {
        const idx = next.findIndex(r => r.id === matched.id)
        if (idx >= 0) {
          const cur = next[idx]
          if (
            cur.dueAtIso !== e.dueAtIso
            || cur.dueDate !== e.dueDate
            || cur.daysLeft !== e.daysLeft
            || !!cur.overdue !== !!e.overdue
            || (oid && !cur.orderId)
          ) {
            next[idx] = {
              ...cur,
              dueAtIso: e.dueAtIso,
              dueDate: e.dueDate,
              daysLeft: e.daysLeft,
              overdue: e.overdue,
              orderId: cur.orderId || oid,
            }
            changed = true
          }
        }
      } else {
        const when = ledgerWhen(e.createdAtIso)
        next.push({
          id: `${LEDGER_DEBT_PREFIX}${e.id}`,
          date: when.date,
          time: when.time,
          ts: when.ts,
          desc: e.desc || 'Долг',
          amount: -amt,
          type: 'debt',
          orderId: oid,
          source: mapLedgerSource(e.source),
          dueAtIso: e.dueAtIso,
          dueDate: e.dueDate,
          daysLeft: e.daysLeft,
          overdue: e.overdue,
        })
        changed = true
      }
    }

    const paid = Math.max(0, Math.round((Number(e.paidAmount) || 0) * 100) / 100)
    if (paid > 0.05) {
      // Durable-разбивка: реальные оплаты (их дата/время, способ, сумма) — дата берётся из оплаты,
      // а не из даты чека, иначе погашение «переезжает» на день создания долга.
      const recorded = Array.isArray(e.payments) ? e.payments : []
      if (recorded.length) {
        // Убираем старую синтетическую строку «ldg-pay-…» по этому чеку — её место занимают реальные оплаты
        const staleIdx = next.findIndex(r => r.id === `${LEDGER_PAY_PREFIX}${e.id}`)
        if (staleIdx >= 0) {
          next.splice(staleIdx, 1)
          changed = true
        }
        for (const p of recorded) {
          const payAmt = Math.round((Number(p?.amount) || 0) * 100) / 100
          if (!(payAmt > 0.05)) continue
          const pid = String(p?.id || e.id)
          const rowId = `${LEDGER_PAY_ROW_PREFIX}${pid}-${e.id}`
          const method = String(p?.method || '')
          const payWhen = ledgerWhen(p?.atIso || e.createdAtIso)
          const row: DebtHistoryEntry = {
            id: rowId,
            date: payWhen.date,
            time: payWhen.time,
            ts: payWhen.ts,
            desc: method === 'card'
              ? 'Погашение · карта'
              : method === 'cash'
                ? 'Погашение · наличные'
                : 'Погашение долга',
            amount: payAmt,
            type: 'pay',
            orderId: oid,
            source: 'cashier',
            batchId: pid,
            ledgerEntryId: String(e.id || ''),
          }
          const rIdx = next.findIndex(r => r.id === rowId)
          if (rIdx >= 0) {
            const cur = next[rIdx]
            if (
              cur.ts !== row.ts
              || cur.amount !== row.amount
              || cur.date !== row.date
              || cur.time !== row.time
              || cur.desc !== row.desc
            ) {
              next[rIdx] = { ...cur, ...row }
              changed = true
            }
          } else {
            next.push(row)
            changed = true
          }
        }
      }
      const covered = localPaysCovered(next, e)
      let need = Math.round((paid - covered) * 100) / 100
      if (need > 0.05 && unlinkedPayPool > 0.05) {
        const fromPool = Math.min(need, unlinkedPayPool)
        unlinkedPayPool = Math.round((unlinkedPayPool - fromPool) * 100) / 100
        need = Math.round((need - fromPool) * 100) / 100
      }
      if (need > 0.05) {
        const payWhen = ledgerWhen(e.createdAtIso)
        next.push({
          id: `${LEDGER_PAY_PREFIX}${e.id}`,
          date: payWhen.date,
          time: payWhen.time,
          ts: payWhen.ts + 1,
          desc: 'Погашение (с сервера)',
          amount: need,
          type: 'pay',
          orderId: oid,
          source: 'cashier',
        })
        changed = true
      }
    }
  }

  if (!changed) return false
  next.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  saveDebtHistoryList(phone, next)
  return true
}

/**
 * Подтянуть серверный журнал долга в локальную историю (другое устройство / касса).
 * Локальные ручные строки не затирает. Без сети — no-op.
 */
export async function syncDebtHistoryFromLedger(phone: string): Promise<DebtLedgerResponse | null> {
  const p = String(phone || '').trim()
  if (!p || !USE_API || typeof window === 'undefined') return null
  const key = phoneDigits(p) || p
  const existing = ledgerSyncInflight.get(key)
  if (existing) return existing
  const run = (async () => {
    try {
      // Сначала возвращаем локальные строки из durable-копии Desktop (после смены порта их нет в origin)
      await hydrateDebtHistoryDurable(key)
      const ledger = await api.getDebtLedger(p)
      cacheLatestDebtLedger(p, ledger)
      mergeLedgerIntoLocalHistory(p, ledger)
      applyLedgerFlagsToCrm(p, ledger)
      // Витрина строит историю из серверного ответа (разбивка оплат). merge выше emits
      // только когда изменилась локальная копия — поэтому просим перерисовку всегда:
      // иначе устройство с уже «догнанной» локальной историей оставалось на сыром снимке.
      emitDebtHistoryChange()
      return ledger
    } catch {
      return null
    } finally {
      ledgerSyncInflight.delete(key)
    }
  })()
  ledgerSyncInflight.set(key, run)
  return run
}

/** Удалить запись истории. Погашения (type=pay) удалять нельзя. Возвращает удалённую строку или null. */
export function removeDebtHistoryEntry(phone: string, id: string): DebtHistoryEntry | null {
  if (!phone.trim() || !id) return null
  const prev = loadDebtHistory(phone)
  const idx = prev.findIndex(r => r.id === id)
  if (idx < 0) return null
  const removed = prev[idx]
  if (!isManualDebtHistoryEntry(removed)) return null
  // Риск 2.4: погашенный долг нельзя стереть из истории
  if (removed.type === 'pay') return null
  saveDebtHistoryList(phone, prev.filter(r => r.id !== id))
  return removed
}

/**
 * Системный откат истории при отказе сервера (риск 2.5).
 * Не для UI — снимает pay по clientRef / batchId операции.
 */
export function dropDebtHistoryByClientRef(phone: string, clientRef: string): number {
  const ref = String(clientRef || '').trim()
  if (!phone.trim() || !ref) return 0
  const prev = loadDebtHistory(phone)
  const next = prev.filter(r => {
    if (r.type !== 'pay') return true
    const rowRef = String(r.clientRef || '').trim()
    const batch = String(r.batchId || '').trim()
    return rowRef !== ref && batch !== ref
  })
  const removed = prev.length - next.length
  if (removed > 0) saveDebtHistoryList(phone, next)
  return removed
}

/** Привязать запись долга к чеку (если orderId ещё нет) — для целевого погашения. */
export function ensureDebtHistoryOrderId(phone: string, debtId: string, orderId: string): void {
  const oid = String(orderId || '').trim()
  if (!phone.trim() || !debtId || !oid) return
  const prev = loadDebtHistory(phone)
  const idx = prev.findIndex(r => r.id === debtId)
  if (idx < 0) return
  if (String(prev[idx].orderId || '').trim()) return
  const list = [...prev]
  list[idx] = { ...list[idx], orderId: oid }
  saveDebtHistoryList(phone, list)
}

/**
 * Изменить сумму/описание ручной записи.
 * amountAbs — положительная сумма (как в UI).
 */
export function updateDebtHistoryEntry(
  phone: string,
  id: string,
  patch: { amountAbs?: number; desc?: string },
): DebtHistoryEntry | null {
  if (!phone.trim() || !id) return null
  const prev = loadDebtHistory(phone)
  const idx = prev.findIndex(r => r.id === id)
  if (idx < 0) return null
  const row = prev[idx]
  if (!isManualDebtHistoryEntry(row)) return null
  // Погашения не правятся и не удаляются
  if (row.type === 'pay') return null
  if (row.type !== 'debt') return null

  const next = { ...row }
  if (patch.desc != null) {
    const d = String(patch.desc).trim()
    if (d) next.desc = d
  }
  if (patch.amountAbs != null) {
    const abs = Math.max(0, Math.round(Number(patch.amountAbs) * 100) / 100)
    if (!(abs > 0)) return null
    next.amount = -abs
  }
  const list = [...prev]
  list[idx] = next
  saveDebtHistoryList(phone, list)
  return next
}

/**
 * На сколько изменить баланс долга клиента при удалении/правке записи.
 * Положительное = увеличить долг, отрицательное = уменьшить.
 */
export function debtBalanceDeltaForHistoryChange(
  before: DebtHistoryEntry,
  after: DebtHistoryEntry | null,
): number {
  const contrib = (row: DebtHistoryEntry | null) => {
    if (!row) return 0
    if (row.type === 'debt') return Math.abs(Number(row.amount) || 0)
    if (row.type === 'pay') return -(Math.abs(Number(row.amount) || 0))
    return 0
  }
  return Math.round((contrib(after) - contrib(before)) * 100) / 100
}

function pushDebtHistory(
  phone: string,
  entry: Omit<DebtHistoryEntry, 'id' | 'date' | 'time' | 'ts'> & { ts?: number },
) {
  const prev = loadDebtHistory(phone)
  const now = entry.ts != null && Number.isFinite(entry.ts) ? new Date(entry.ts) : new Date()
  const id = `D-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`
  // Наличная выдача без чека — свой orderId, чтобы погашать по одной строке
  let orderId = entry.orderId
  if (
    entry.type === 'debt'
    && !orderId
    && entry.source !== 'pos'
    && entry.source !== 'order'
  ) {
    orderId = `cash-${id}`
  }
  const { ts: _omitTs, ...rest } = entry
  const row: DebtHistoryEntry = {
    ...rest,
    id,
    orderId,
    date: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    ts: now.getTime(),
  }
  saveDebtHistoryList(phone, [row, ...prev])
}

/**
 * Стабильный ключ для targeted погашения cash_advance — только server debtLedger.id.
 * Не синтезирует fake cash-${localId} (после recovery сервер не знает таких ключей).
 */
export function cashDebtOrderId(row: { id?: string; orderId?: string }): string {
  const oid = String(row.orderId || '').trim()
  if (oid && !/^cash-/i.test(oid)) return oid
  const rawId = String(row.id || '').trim()
  if (!rawId) return ''
  if (rawId.startsWith(LEDGER_DEBT_PREFIX)) {
    return rawId.slice(LEDGER_DEBT_PREFIX.length)
  }
  if (rawId.startsWith('DL-')) return rawId
  return ''
}

export async function chargeCredit(
  phone: string,
  amount: number,
  orderId: string,
  meta?: { itemsSummary?: string },
): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) throw new Error('Клиент не найден в CRM')
  const check = canPayWithCredit(
    {
      vip: merged.vip,
      debt: merged.debt,
      debtLimit: merged.debtLimit,
      blocked: merged.blocked,
      debtCreditBlocked: merged.debtCreditBlocked,
    },
    amount,
  )
  if (!check.ok) throw new Error(check.reason || 'Оплата в долг недоступна')
  const newDebt = Math.round((merged.debt + amount) * 100) / 100

  if (USE_API) {
    const cardNum = merged.card
    if (!cardNum) throw new Error('Карта клиента не найдена')
    await api.updateCard(cardNum, { debt: newDebt })
  } else {
    setDebtOnCard(phone, newDebt)
  }

  pushDebtHistory(phone, {
    desc: `Заказ ${orderId}`,
    amount: -amount,
    orderId,
    itemsSummary: meta?.itemsSummary,
    type: 'debt',
    source: 'order',
  })
  return newDebt
}

export function recordStoreDebtRepayment(
  phone: string,
  amount: number,
  meta?: {
    desc?: string
    method?: 'cash' | 'card'
    source?: DebtHistoryEntry['source']
    /** Привязка к чеку/заказу — погашение именно этой позиции */
    orderId?: string
    /** Общий id одной оплаты (несколько чеков) */
    batchId?: string
    /** sale — только для отображения в «Оплаты», не уменьшает долг */
    payScope?: 'sale' | 'debt'
    /** Ключ офлайн-операции для отката при отказе сервера */
    clientRef?: string
    /** Общее время пакета (чтобы FIFO не разъезжался) */
    ts?: number
    itemsSummary?: string
  },
): void {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0) return
  const methodLabel = meta?.method === 'card' ? 'карта' : meta?.method === 'cash' ? 'наличные' : ''
  const desc = meta?.desc
    || (methodLabel ? `Погашение долга · ${methodLabel}` : 'Погашение долга')
  const source = meta?.source
    ?? (meta?.method ? 'cashier' : 'manual')
  const clientRef = String(meta?.clientRef || '').trim() || undefined
  pushDebtHistory(phone, {
    desc,
    amount: pay,
    type: 'pay',
    source,
    orderId: meta?.orderId,
    batchId: meta?.batchId || clientRef,
    clientRef,
    ts: meta?.ts,
    payScope: meta?.payScope,
    itemsSummary: meta?.itemsSummary,
  })
}

/** Часть комбинированной оплаты: текущий пробитый чек (нал/карта) + погашение долга в одном batchId. */
export function recordStoreSalePaymentInBatch(
  phone: string,
  amount: number,
  meta: {
    orderId: string
    batchId: string
    clientRef?: string
    ts: number
    method?: 'cash' | 'card'
    label?: string
    itemsSummary?: string
  },
): void {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0 || !meta.orderId || !meta.batchId) return
  const methodLabel = meta.method === 'card' ? 'карта' : meta.method === 'cash' ? 'наличные' : ''
  const checkLabel = String(meta.label || '').trim() || 'Текущий чек'
  recordStoreDebtRepayment(phone, pay, {
    method: meta.method,
    orderId: meta.orderId,
    batchId: meta.batchId,
    clientRef: meta.clientRef,
    ts: meta.ts,
    payScope: 'sale',
    source: 'cashier',
    desc: methodLabel
      ? `Оплата · ${checkLabel} · ${methodLabel}`
      : `Оплата · ${checkLabel}`,
    itemsSummary: meta.itemsSummary,
  })
}

/**
 * Погашение со списанием со старых чеков (FIFO).
 * Пишет отдельные оплаты с orderId — остатки по чекам уменьшаются сразу.
 * Все части одной оплаты связаны через batchId.
 */
export function recordStoreDebtRepaymentFifo(
  phone: string,
  amount: number,
  targetsOldestFirst: { orderId?: string; remain: number; label?: string }[],
  meta?: {
    desc?: string
    method?: 'cash' | 'card'
    source?: DebtHistoryEntry['source']
    clientRef?: string
  },
): { appliedToChecks: number; residual: number; checkCount: number; batchId: string; ts: number } {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0) return { appliedToChecks: 0, residual: 0, checkCount: 0, batchId: '', ts: 0 }

  const clientRef = String(meta?.clientRef || '').trim() || undefined
  const batchId = clientRef || `payb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const ts = Date.now()
  let left = pay
  let appliedToChecks = 0
  let checkCount = 0
  for (const t of targetsOldestFirst) {
    if (left <= 0.001) break
    const need = Math.max(0, Math.round((Number(t.remain) || 0) * 100) / 100)
    if (need <= 0.001) continue
    const apply = Math.min(need, left)
    const oid = String(t.orderId || '').trim()
    recordStoreDebtRepayment(phone, apply, {
      method: meta?.method,
      source: meta?.source,
      orderId: oid || undefined,
      batchId,
      clientRef,
      ts,
      desc: t.label
        ? `Погашение · ${t.label}`
        : (meta?.desc || undefined),
    })
    left = Math.round((left - apply) * 100) / 100
    appliedToChecks = Math.round((appliedToChecks + apply) * 100) / 100
    checkCount += 1
  }
  if (left > 0.001) {
    recordStoreDebtRepayment(phone, left, {
      method: meta?.method,
      source: meta?.source,
      batchId,
      clientRef,
      ts,
      desc: meta?.desc || 'Погашение долга (сверх чеков)',
    })
  }
  return { appliedToChecks, residual: Math.max(0, left), checkCount, batchId, ts }
}

export function recordStoreDebtCharge(
  phone: string,
  amount: number,
  desc = 'Ручное начисление',
  meta?: { orderId?: string; itemsSummary?: string; source?: DebtHistoryEntry['source'] },
): void {
  const debt = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || debt <= 0) return
  const orderId = String(meta?.orderId || '').trim()
  // Не дублируем одну и ту же позицию чека (касса пишет и local-first, и в фоне)
  if (orderId) {
    const prev = loadDebtHistory(phone)
    const dup = prev.find(h =>
      h.type === 'debt'
      && debtOrderIdsMatch(h.orderId, orderId)
      && Math.abs(Math.abs(Number(h.amount) || 0) - debt) < 0.02,
    )
    if (dup) return
  }
  const source = meta?.source
    ?? (meta?.orderId ? (/^чек/i.test(desc) ? 'pos' : 'order') : 'manual')
  pushDebtHistory(phone, {
    desc,
    amount: -debt,
    type: 'debt',
    orderId: meta?.orderId,
    itemsSummary: meta?.itemsSummary,
    source,
  })
}

/**
 * Local cash-advance history row — fixed label, idempotent vs ledger sync / reconnect.
 */
export function recordCashAdvanceHistory(
  phone: string,
  amount: number,
  meta?: { clientRef?: string; ledgerEntryId?: string; ts?: number },
): void {
  const key = String(phone || '').trim()
  const debt = Math.max(0, Math.round(amount * 100) / 100)
  if (!key || debt <= 0) return
  const prev = loadDebtHistory(key)
  const upsert = upsertLocalCashAdvanceHistory(prev, {
    amount: debt,
    ts: meta?.ts || Date.now(),
    clientRef: meta?.clientRef,
    ledgerEntryId: meta?.ledgerEntryId,
  })
  if (!upsert.changed) return
  saveDebtHistoryList(key, upsert.next)
}

/** After cash advance commit: pull durable debtLedger into local history (no-op offline). */
export async function refreshDebtHistoryAfterCashAdvance(phone: string): Promise<void> {
  const p = String(phone || '').trim()
  if (!p) return
  await syncDebtHistoryFromLedger(p)
  emitDebtHistoryChange()
}

/** Убрать локальные строки долга/погашения по чеку (откат отклонённой продажи). */
export function removeDebtHistoryForSale(
  phone: string,
  sale: { id?: string; orderId?: string },
): number {
  const key = String(phone || '').trim()
  if (!key) return 0
  const keys = [sale.id, sale.orderId, sale.id ? `sale-${sale.id}` : '', sale.orderId ? `sale-${sale.orderId}` : '']
    .map(k => String(k || '').trim())
    .filter(Boolean)
  if (!keys.length) return 0
  const prev = loadDebtHistory(key)
  const next = prev.filter(h => !keys.some(k => debtOrderIdsMatch(h.orderId, k)))
  const removed = prev.length - next.length
  if (removed > 0) saveDebtHistoryList(key, next)
  return removed
}

/** FIFO: сколько погашений покрывает каждый долг (от старых к новым) */
export function allocateRepaymentFifo(
  unpaidOldestFirst: DebtOrderBalance[],
  repayAmount: number,
): { id: string; apply: number; remainAfter: number }[] {
  let left = Math.max(0, Math.round(repayAmount * 100) / 100)
  const out: { id: string; apply: number; remainAfter: number }[] = []
  for (const d of unpaidOldestFirst) {
    if (left <= 0.001) break
    const need = Math.max(0, Number(d.remainingAmount) || 0)
    if (need <= 0.001) continue
    const apply = Math.min(need, left)
    left = Math.round((left - apply) * 100) / 100
    out.push({
      id: d.id,
      apply,
      remainAfter: Math.round((need - apply) * 100) / 100,
    })
  }
  return out
}

/** Клиент не погашает долг сам — только через магазин (админ → Карты). */
export async function repayCredit(_phone: string, _amount?: number): Promise<number> {
  throw new Error('Погашение долга доступно только в магазине КАКАПО')
}

export async function spendBonus(phone: string, amount: number, orderId: string): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) throw new Error('Клиент не найден')
  const use = Math.min(merged.bonus, Math.max(0, Math.floor(amount)))
  if (use <= 0) return merged.bonus

  if (USE_API) {
    const cardNum = merged.card
    if (!cardNum) throw new Error('Карта клиента не найдена')
    const newBonus = merged.bonus - use
    await api.updateCard(cardNum, { bonus: newBonus, allowBonusDecrease: true })
    return newBonus
  }

  const newBonus = merged.bonus - use
  setDebtOnCard(phone, merged.debt, newBonus)
  return newBonus
}

export async function refreshStoreUserAfterCredit(phone: string, cardNum?: string): Promise<StoreUser | null> {
  return fetchCrmStoreUser(phone, cardNum)
}

const TOPUP_HIST = ACCOUNT_NS.balanceTopups
export const BALANCE_TOPUP_EVT = 'kakapo_balance_topup'

export type BalanceTopupEntry = {
  id: string
  date: string
  time: string
  ts: number
  cash: number
  bonus: number
  desc: string
  clientRef?: string
}

export function emitBalanceTopupChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BALANCE_TOPUP_EVT))
}

export function subscribeBalanceTopup(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const h = () => cb()
  window.addEventListener(BALANCE_TOPUP_EVT, h)
  return () => window.removeEventListener(BALANCE_TOPUP_EVT, h)
}

export function loadBalanceTopups(phone: string): BalanceTopupEntry[] {
  const list = loadAccountJson<BalanceTopupEntry[]>(TOPUP_HIST, [], phone)
  if (!Array.isArray(list)) return []
  return list.map((row, i) => ({
    ...row,
    time: row.time || '',
    ts: row.ts || Date.now() - i,
  }))
}

export function recordBalanceTopup(
  phone: string,
  cash: number,
  bonus: number,
  desc = 'Пополнение баланса',
  meta?: { clientRef?: string },
): void {
  const cashAmt = Math.max(0, Math.round(cash * 100) / 100)
  const bonusAmt = Math.max(0, Math.round(bonus * 100) / 100)
  if (!phone.trim() || cashAmt <= 0) return
  const prev = loadBalanceTopups(phone)
  const now = new Date()
  const clientRef = String(meta?.clientRef || '').trim() || undefined
  const row: BalanceTopupEntry = {
    id: `T-${now.getTime()}`,
    date: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    ts: now.getTime(),
    cash: cashAmt,
    bonus: bonusAmt,
    desc: String(desc || 'Пополнение баланса').trim() || 'Пополнение баланса',
    clientRef,
  }
  saveAccountJson(TOPUP_HIST, [row, ...prev].slice(0, 100), phone)
  emitBalanceTopupChange()
}

/** Системный откат истории пополнения при отказе сервера (риск 3.5). */
export function dropBalanceTopupByClientRef(phone: string, clientRef: string): number {
  const ref = String(clientRef || '').trim()
  if (!phone.trim() || !ref) return 0
  const prev = loadBalanceTopups(phone)
  const next = prev.filter(r => String(r.clientRef || '').trim() !== ref)
  const removed = prev.length - next.length
  if (removed > 0) {
    saveAccountJson(TOPUP_HIST, next, phone)
    emitBalanceTopupChange()
  }
  return removed
}

/** Сколько ⭐ реально должно быть на балансе по записи истории кассы. */
export function topupBalanceCredit(t: Pick<BalanceTopupEntry, 'cash' | 'bonus' | 'desc'>): number {
  const cash = Math.max(0, Math.round((Number(t.cash) || 0) * 100) / 100)
  const bonus = Math.max(0, Math.round((Number(t.bonus) || 0) * 100) / 100)
  const desc = String(t.desc || '')
  // Кэшбэк % за оплату/погашение — только bonus
  if (desc.includes('Оплата наличными') || desc.includes('Погашение долга')) return bonus
  // Пополнение: сумма (1:1) + % бонус.
  // Старые записи: bonus = только %, cash = внесённое → credit = cash + bonus.
  // Новые записи: bonus уже = cash + % → не суммируем дважды.
  if (!desc || desc.includes('Пополнение')) {
    if (cash > 0 && bonus >= cash) return bonus
    if (cash > 0) return cash + bonus
    return bonus
  }
  return Math.max(cash, bonus)
}
