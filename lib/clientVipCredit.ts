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
  type: 'debt' | 'pay'
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

/** Разделить заказы в долг на оплаченные (FIFO по погашениям) и неоплаченные */
export type DebtOrderBalance = DebtHistoryEntry & {
  originalAmount: number
  paidAmount: number
  remainingAmount: number
  partial: boolean
}

export function buildDebtOrderBalances(list: DebtHistoryEntry[]): {
  unpaid: DebtOrderBalance[]
  paid: DebtHistoryEntry[]
} {
  const debts = list.filter(h => h.type === 'debt').sort((a, b) => (a.ts || 0) - (b.ts || 0))
  const pays = list.filter(h => h.type === 'pay')
  let repayLeft = pays.reduce((s, h) => s + h.amount, 0)

  const paid: DebtHistoryEntry[] = []
  const unpaid: DebtOrderBalance[] = []

  for (const d of debts) {
    const amt = Math.round(Math.abs(d.amount) * 100) / 100
    if (repayLeft >= amt - 0.001) {
      paid.push(d)
      repayLeft = Math.round((repayLeft - amt) * 100) / 100
    } else if (repayLeft > 0.001) {
      const paidAmount = repayLeft
      const remainingAmount = Math.round((amt - paidAmount) * 100) / 100
      unpaid.push({
        ...d,
        originalAmount: amt,
        paidAmount,
        remainingAmount,
        partial: true,
      })
      repayLeft = 0
    } else {
      unpaid.push({
        ...d,
        originalAmount: amt,
        paidAmount: 0,
        remainingAmount: amt,
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
  saveAccountJson(DEBT_HIST, [row, ...prev].slice(0, 100), phone)
  emitDebtHistoryChange()
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
    { vip: merged.vip, debt: merged.debt, debtLimit: merged.debtLimit, blocked: merged.blocked },
    amount,
  )
  if (!check.ok) throw new Error(check.reason || 'Оплата в долг недоступна')
  const newDebt = Math.round((merged.debt + amount) * 100) / 100
  setDebtOnCard(phone, newDebt)
  pushDebtHistory(phone, {
    desc: `Заказ ${orderId}`,
    amount: -amount,
    orderId,
    itemsSummary: meta?.itemsSummary,
    type: 'debt',
  })
  return newDebt
}

export function recordStoreDebtRepayment(
  phone: string,
  amount: number,
  meta?: { desc?: string; method?: 'cash' | 'card' },
): void {
  const pay = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || pay <= 0) return
  const methodLabel = meta?.method === 'card' ? 'карта' : meta?.method === 'cash' ? 'наличные' : ''
  const desc = meta?.desc
    || (methodLabel ? `Погашение долга · ${methodLabel}` : 'Погашение долга')
  pushDebtHistory(phone, {
    desc,
    amount: pay,
    type: 'pay',
  })
}

export function recordStoreDebtCharge(
  phone: string,
  amount: number,
  desc = 'Начисление через поддержку',
  meta?: { orderId?: string; itemsSummary?: string },
): void {
  const debt = Math.max(0, Math.round(amount * 100) / 100)
  if (!phone.trim() || debt <= 0) return
  pushDebtHistory(phone, {
    desc,
    amount: -debt,
    type: 'debt',
    orderId: meta?.orderId,
    itemsSummary: meta?.itemsSummary,
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
  const bonusAmt = Math.max(0, Math.floor(bonus))
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
  const cash = Math.max(0, Math.floor(Number(t.cash) || 0))
  const bonus = Math.max(0, Math.floor(Number(t.bonus) || 0))
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
