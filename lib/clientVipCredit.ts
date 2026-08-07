'use client'

import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { phonesMatch } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync, fetchCrmStoreUser, findMergedClientByPhone } from './clientProfileSync'
import { USE_API } from './config'
import { api } from './api'
import { ACCOUNT_NS, loadAccountJson, saveAccountJson } from './clientAccountStorage'
import type { StoreUser } from './clientSession'
import { resolveEffectiveDebtLimit } from './loyaltyStatusConfig'

const DEBT_HIST = ACCOUNT_NS.debtHistory
export const DEBT_HISTORY_EVT = 'kakapo_debt_history'

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
  /** Срок погашения (ISO) — с серверного ledger */
  dueAtIso?: string
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
  const pays = list.filter(h => h.type === 'pay')
  const remain = new Map<string, number>()
  for (const d of debts) {
    remain.set(d.id, Math.round(Math.abs(d.amount) * 100) / 100)
  }

  // Сначала погашения, привязанные к конкретному чеку/заказу
  let repayLeft = 0
  for (const p of pays) {
    const amt = Math.round(Math.abs(Number(p.amount) || 0) * 100) / 100
    if (!(amt > 0)) continue
    const oid = String(p.orderId || '').trim()
    if (oid) {
      const target = debts.find(d => debtOrderIdsMatch(d.orderId, oid) && (remain.get(d.id) || 0) > 0.001)
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

export function loadDebtHistory(phone: string): DebtHistoryEntry[] {
  const list = loadAccountJson<DebtHistoryEntry[]>(DEBT_HIST, [], phone)
  if (!Array.isArray(list)) return []
  return list.map((row, i) => ({
    ...row,
    time: row.time || '',
    ts: row.ts || Date.now() - i,
  }))
}

/** Ручная запись (начисление/погашение в разделе Долги) — можно править/удалить. Чеки и заказы — нет. */
export function isManualDebtHistoryEntry(row: DebtHistoryEntry): boolean {
  if (row.type === 'purchase') return false
  // Привязка к чеку/заказу — не ручная правка
  if (row.orderId) return false
  if (row.source === 'manual') return true
  if (row.source === 'pos' || row.source === 'order' || row.source === 'cashier') return false
  const desc = String(row.desc || '')
  if (/чек/i.test(desc)) return false
  if (/^заказ\b/i.test(desc.trim())) return false
  // Погашение на кассе: «Погашение долга · наличные/карта»
  if (/погашение долга\s*·/i.test(desc)) return false
  return row.type === 'debt' || row.type === 'pay'
}

function saveDebtHistoryList(phone: string, list: DebtHistoryEntry[]) {
  saveAccountJson(DEBT_HIST, list.slice(0, 100), phone)
  emitDebtHistoryChange()
}

/** Удалить запись истории. Возвращает удалённую строку или null. */
export function removeDebtHistoryEntry(phone: string, id: string): DebtHistoryEntry | null {
  if (!phone.trim() || !id) return null
  const prev = loadDebtHistory(phone)
  const idx = prev.findIndex(r => r.id === id)
  if (idx < 0) return null
  const removed = prev[idx]
  if (!isManualDebtHistoryEntry(removed)) return null
  saveDebtHistoryList(phone, prev.filter(r => r.id !== id))
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
  if (row.type !== 'debt' && row.type !== 'pay') return null

  const next = { ...row }
  if (patch.desc != null) {
    const d = String(patch.desc).trim()
    if (d) next.desc = d
  }
  if (patch.amountAbs != null) {
    const abs = Math.max(0, Math.round(Number(patch.amountAbs) * 100) / 100)
    if (!(abs > 0)) return null
    next.amount = row.type === 'pay' ? abs : -abs
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

function pushDebtHistory(phone: string, entry: Omit<DebtHistoryEntry, 'id' | 'date' | 'time' | 'ts'>) {
  const prev = loadDebtHistory(phone)
  const now = new Date()
  const row: DebtHistoryEntry = {
    ...entry,
    id: `D-${now.getTime()}`,
    date: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    ts: now.getTime(),
  }
  saveDebtHistoryList(phone, [row, ...prev])
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
  },
): void {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0) return
  const methodLabel = meta?.method === 'card' ? 'карта' : meta?.method === 'cash' ? 'наличные' : ''
  const desc = meta?.desc
    || (methodLabel ? `Погашение долга · ${methodLabel}` : 'Погашение долга')
  const source = meta?.source
    ?? (meta?.method ? 'cashier' : 'manual')
  pushDebtHistory(phone, {
    desc,
    amount: pay,
    type: 'pay',
    source,
    orderId: meta?.orderId,
  })
}

export function recordStoreDebtCharge(
  phone: string,
  amount: number,
  desc = 'Ручное начисление',
  meta?: { orderId?: string; itemsSummary?: string; source?: DebtHistoryEntry['source'] },
): void {
  const debt = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || debt <= 0) return
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

export function recordBalanceTopup(phone: string, cash: number, bonus: number, desc = 'Пополнение баланса'): void {
  const cashAmt = Math.max(0, Math.round(cash * 100) / 100)
  const bonusAmt = Math.max(0, Math.round(bonus * 100) / 100)
  if (!phone.trim() || cashAmt <= 0) return
  const prev = loadBalanceTopups(phone)
  const now = new Date()
  const row: BalanceTopupEntry = {
    id: `T-${now.getTime()}`,
    date: now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    ts: now.getTime(),
    cash: cashAmt,
    bonus: bonusAmt,
    desc: String(desc || 'Пополнение баланса').trim() || 'Пополнение баланса',
  }
  saveAccountJson(TOPUP_HIST, [row, ...prev].slice(0, 100), phone)
  emitBalanceTopupChange()
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
