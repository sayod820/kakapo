'use client'

import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { phonesMatch } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync, fetchCrmStoreUser, findMergedClientByPhone } from './clientProfileSync'
import { loadAccountJson, saveAccountJson } from './clientAccountStorage'
import type { StoreUser } from './clientSession'

const DEBT_HIST = 'debt_history'

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
  desc: string
  amount: number
  orderId?: string
  type: 'debt' | 'pay'
}

export function getVipCreditState(user?: Partial<StoreUser> | null): VipCreditState {
  const debt = Number(user?.debt) || 0
  const debtLimit = Number(user?.debtLimit) || 0
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

export function getBonusUsable(user: Partial<StoreUser> | null | undefined, orderTotal: number): number {
  const bonus = Number(user?.bonus) || 0
  if (bonus <= 0 || orderTotal <= 0) return 0
  return Math.min(bonus, Math.floor(orderTotal))
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
  return Array.isArray(list) ? list : []
}

function pushDebtHistory(phone: string, entry: Omit<DebtHistoryEntry, 'id' | 'date'>) {
  const prev = loadDebtHistory(phone)
  const row: DebtHistoryEntry = {
    ...entry,
    id: `D-${Date.now()}`,
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
  }
  saveAccountJson(DEBT_HIST, [row, ...prev].slice(0, 50), phone)
}

export async function chargeCredit(phone: string, amount: number, orderId: string): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) throw new Error('Клиент не найден в CRM')
  const check = canPayWithCredit(
    { vip: merged.vip, debt: merged.debt, debtLimit: merged.debtLimit, blocked: merged.blocked },
    amount,
  )
  if (!check.ok) throw new Error(check.reason || 'Оплата в долг недоступна')
  const newDebt = Math.round((merged.debt + amount) * 100) / 100
  setDebtOnCard(phone, newDebt)
  pushDebtHistory(phone, { desc: `Заказ ${orderId}`, amount: -amount, orderId, type: 'debt' })
  return newDebt
}

export async function repayCredit(phone: string, amount?: number): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) throw new Error('Клиент не найден')
  const pay = amount != null ? Math.min(merged.debt, Math.max(0, amount)) : merged.debt
  if (pay <= 0) throw new Error('Долга нет')
  const newDebt = Math.round((merged.debt - pay) * 100) / 100
  setDebtOnCard(phone, newDebt)
  pushDebtHistory(phone, { desc: 'Оплата долга', amount: pay, type: 'pay' })
  return newDebt
}

export async function spendBonus(phone: string, amount: number, orderId: string): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) throw new Error('Клиент не найден')
  const use = Math.min(merged.bonus, Math.max(0, Math.floor(amount)))
  if (use <= 0) return merged.bonus
  const newBonus = merged.bonus - use
  setDebtOnCard(phone, merged.debt, newBonus)
  return newBonus
}

export async function refreshStoreUserAfterCredit(phone: string, cardNum?: string): Promise<StoreUser | null> {
  return fetchCrmStoreUser(phone, cardNum)
}
