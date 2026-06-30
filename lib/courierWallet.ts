import type { AdminCourier } from './courierTeam'
import type { PricingConfig } from './courierData'
import { DEFAULT_PRICING } from './courierData'
import type { Order } from './types'
import { resolveOrderDeliveryFee } from './deliveryFee'

function normalizePhoneDigits(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export type CourierWalletCheck = {
  ok: boolean
  commission: number
  balance: number
  percent: number
  deliveryFee: number
  msg?: string
}

export type CourierCommissionContext = {
  order?: Order | null
  roadKm?: Record<string, number>
}

/** Процент комиссии платформы с курьера */
export function getCourierCommissionPercent(
  pricing?: Partial<PricingConfig> | null,
  courier?: Pick<AdminCourier, 'commissionPercent'> | null,
): number {
  const custom = Number(courier?.commissionPercent)
  if (Number.isFinite(custom) && custom > 0) return Math.min(100, Math.round(custom * 100) / 100)
  const fromTariff = Number(pricing?.courierCommissionPercent ?? DEFAULT_PRICING.courierCommissionPercent)
  return Math.max(0, Math.min(100, Math.round((Number.isFinite(fromTariff) ? fromTariff : 15) * 100) / 100))
}

export function getCourierBalance(courier?: Pick<AdminCourier, 'balance'> | null): number {
  return Math.max(0, Math.round((Number(courier?.balance) || 0) * 100) / 100)
}

function roundSm(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100)
}

/** Стоимость доставки для расчёта комиссии */
export function resolveDeliveryFeeForCommission(
  order: Order | null | undefined,
  pricing: Partial<PricingConfig>,
  roadKm: Record<string, number> = {},
): number {
  const fullPricing = { ...DEFAULT_PRICING, ...pricing }
  if (order) {
    return Math.max(0, resolveOrderDeliveryFee(order, fullPricing, roadKm))
  }
  return Math.max(0, Number(fullPricing.base) || 0)
}

/** Комиссия в ЅМ = % от стоимости доставки */
export function calcCourierCommissionAmount(deliveryFee: number, percent: number): number {
  if (!percent || percent <= 0 || deliveryFee <= 0) return 0
  return roundSm((deliveryFee * percent) / 100)
}

export function getCourierCommissionForOrder(
  pricing?: Partial<PricingConfig> | null,
  courier?: Pick<AdminCourier, 'commissionPercent'> | null,
  ctx?: CourierCommissionContext,
): { commission: number; percent: number; deliveryFee: number } {
  const percent = getCourierCommissionPercent(pricing, courier)
  const deliveryFee = resolveDeliveryFeeForCommission(ctx?.order, pricing || {}, ctx?.roadKm || {})
  const commission = calcCourierCommissionAmount(deliveryFee, percent)
  return { commission, percent, deliveryFee }
}

/** Минимальная оценка комиссии (базовая доставка × %) */
export function getMinCourierCommissionEstimate(
  pricing?: Partial<PricingConfig> | null,
  courier?: Pick<AdminCourier, 'commissionPercent'> | null,
): number {
  return getCourierCommissionForOrder(pricing, courier).commission
}

/** @deprecated используйте getCourierCommissionForOrder */
export function getCourierCommissionPerOrder(
  pricing?: Partial<PricingConfig> | null,
  courier?: Pick<AdminCourier, 'commissionPercent'> | null,
  ctx?: CourierCommissionContext,
): number {
  return getCourierCommissionForOrder(pricing, courier, ctx).commission
}

export function canCourierAffordOrder(
  courier: Pick<AdminCourier, 'balance' | 'commissionPercent' | 'blocked'> | null | undefined,
  pricing?: Partial<PricingConfig> | null,
  ctx?: CourierCommissionContext,
): CourierWalletCheck {
  if (!courier) {
    return { ok: false, commission: 0, balance: 0, percent: 0, deliveryFee: 0, msg: 'Профиль курьера не найден' }
  }
  if (courier.blocked) {
    return { ok: false, commission: 0, balance: 0, percent: 0, deliveryFee: 0, msg: 'Аккаунт заблокирован администратором' }
  }
  const { commission, percent, deliveryFee } = getCourierCommissionForOrder(pricing, courier, ctx)
  const balance = getCourierBalance(courier)
  if (commission <= 0) return { ok: true, commission: 0, balance, percent, deliveryFee }
  if (balance + 0.001 < commission) {
    return {
      ok: false,
      commission,
      balance,
      percent,
      deliveryFee,
      msg: `Недостаточно средств на счёте. Нужно ${commission} ЅМ (${percent}% от ${deliveryFee} ЅМ доставки), на счёте ${balance} ЅМ.`,
    }
  }
  return { ok: true, commission, balance, percent, deliveryFee }
}

export function formatCourierCommissionPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`
}

export function phonesMatchCourier(a?: string, b?: string): boolean {
  const ka = normalizePhoneDigits(a || '')
  const kb = normalizePhoneDigits(b || '')
  return !!ka && !!kb && ka === kb
}

export function isNewCourierAssignment(
  prev?: { courier?: { phone?: string; name?: string } | null; courierCommissionPaid?: number } | null,
  patch?: { courier?: { phone?: string; name?: string } | null },
): boolean {
  if (!patch?.courier?.phone && !patch?.courier?.name) return false
  if (Number(prev?.courierCommissionPaid) > 0) return false
  const prevKey = normalizePhoneDigits(prev?.courier?.phone || '')
  const nextKey = normalizePhoneDigits(patch.courier?.phone || '')
  if (!nextKey) return false
  if (!prevKey) return true
  return prevKey !== nextKey
}
