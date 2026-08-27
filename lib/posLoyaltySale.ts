'use client'

import type { Order, PosSale } from './types'
import type { ClientLevel } from './clientCrm'
import { hasEarnedBronze, loyaltyStatsFromOrders, resolveEffectiveClientLevel, phonesMatch } from './clientCrm'
import { calcMarginalBonusEarned } from './loyaltyBonus'
import {
  autoStatusValidUntilIso,
  isAutoStatusPeriodActive,
  type LevelAssignMode,
} from './loyaltyAdminLock'
import { loadLoyaltyStatusConfig } from './loyaltyStatusConfig'

export type PosLoyaltyClientMeta = {
  id?: string
  phone?: string
  level?: ClientLevel | 'new' | ''
  vip?: boolean
  levelValidUntil?: string | null
  bonusEligibleFrom?: string
  levelAssignMode?: LevelAssignMode
  accountGeneration?: number
}

/** POS-чеки как delivered-заказы для расчёта нал-трат. */
export function posSalesToLoyaltyOrders(sales: PosSale[], phone: string): Order[] {
  return sales
    .filter(s => phonesMatch(s.clientPhone || '', phone) && (Number(s.paidCash) || 0) > 0.001)
    .map(s => ({
      id: String(s.orderId || s.id),
      type: 'market' as const,
      status: 'delivered' as const,
      channel: 'pos',
      posSaleId: s.id,
      createdAt: s.createdAtIso,
      createdAtIso: s.createdAtIso,
      deliveredAtIso: s.createdAtIso,
      paidCash: Number(s.paidCash) || 0,
      pay: s.paymentMethod,
      payment_method: s.paymentMethod,
      total: Number(s.total) || 0,
      goodsTotal: Number(s.orderGoodsTotal) || Number(s.total) || 0,
      client: {
        name: s.clientName || '',
        phone: s.clientPhone || '',
        addr: 'Касса',
      },
      items: [],
    }))
}

export function loyaltyOrdersWithPos(
  apiOrders: Order[],
  posSales: PosSale[],
  phone: string,
): Order[] {
  const fromPos = posSalesToLoyaltyOrders(posSales, phone)
  const ids = new Set(fromPos.map(o => o.id))
  return [...fromPos, ...apiOrders.filter(o => !ids.has(o.id))]
}

/** Тип 1: кэшбэк статуса за наличную часть покупки (до порога статуса = 0). */
export function previewPosStatusCashBonus(
  phone: string,
  apiOrders: Order[],
  cashAmount: number,
  meta: PosLoyaltyClientMeta = {},
  posSales: PosSale[] = [],
): number {
  const cash = Math.max(0, Number(cashAmount) || 0)
  if (!(cash > 0) || !phone.trim()) return 0
  const orders = loyaltyOrdersWithPos(apiOrders, posSales, phone)
  const { spent } = loyaltyStatsFromOrders(orders, phone, meta)
  return calcMarginalBonusEarned(spent, cash, !!meta.vip, loadLoyaltyStatusConfig())
}

/** После наличной покупки: уровень и при необходимости новый 30-дневный период. */
export function statusFieldsAfterPosCashPurchase(
  phone: string,
  apiOrders: Order[],
  cashAmount: number,
  meta: PosLoyaltyClientMeta = {},
  posSales: PosSale[] = [],
): { level: ClientLevel; levelValidUntil?: string | null; levelAssignMode: 'auto' } {
  const cash = Math.max(0, Number(cashAmount) || 0)
  const orders = loyaltyOrdersWithPos(apiOrders, posSales, phone)
  const { spent, orderCount } = loyaltyStatsFromOrders(orders, phone, meta)
  const totalAfter = Math.round((spent + cash) * 10) / 10
  const countAfter = orderCount + (cash > 0 ? 1 : 0)
  const hadBronze = hasEarnedBronze(spent, orderCount)
  const hasBronzeAfter = hasEarnedBronze(totalAfter, countAfter)
  const periodActive = isAutoStatusPeriodActive(meta.levelValidUntil)

  let levelValidUntil = meta.levelValidUntil ?? null
  if (meta.levelAssignMode !== 'manual') {
    if (!hadBronze && hasBronzeAfter) {
      levelValidUntil = autoStatusValidUntilIso()
    } else if (!periodActive && hasBronzeAfter) {
      levelValidUntil = autoStatusValidUntilIso()
    }
  }

  const level = resolveEffectiveClientLevel(totalAfter, countAfter, meta.level, {
    level: meta.level,
    levelAssignMode: meta.levelAssignMode,
    levelValidUntil: levelValidUntil ?? undefined,
    vip: meta.vip,
  }) as ClientLevel

  return {
    level,
    levelValidUntil,
    levelAssignMode: 'auto',
  }
}
