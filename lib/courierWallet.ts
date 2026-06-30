import type { AdminCourier } from './courierTeam'
import type { PricingConfig } from './courierData'
import { DEFAULT_PRICING } from './courierData'

function normalizePhoneDigits(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export type CourierWalletCheck = {
  ok: boolean
  commission: number
  balance: number
  msg?: string
}

/** Комиссия платформы за один принятый заказ, ЅМ */
export function getCourierCommissionPerOrder(
  pricing?: Partial<PricingConfig> | null,
  courier?: Pick<AdminCourier, 'commissionPerOrder'> | null,
): number {
  const custom = Number(courier?.commissionPerOrder)
  if (Number.isFinite(custom) && custom > 0) return Math.round(custom * 100) / 100
  const fromTariff = Number(pricing?.courierCommissionPerOrder ?? DEFAULT_PRICING.courierCommissionPerOrder)
  return Math.max(0, Math.round((Number.isFinite(fromTariff) ? fromTariff : 5) * 100) / 100)
}

export function getCourierBalance(courier?: Pick<AdminCourier, 'balance'> | null): number {
  return Math.max(0, Math.round((Number(courier?.balance) || 0) * 100) / 100)
}

export function canCourierAffordOrder(
  courier: Pick<AdminCourier, 'balance' | 'commissionPerOrder' | 'blocked'> | null | undefined,
  pricing?: Partial<PricingConfig> | null,
): CourierWalletCheck {
  if (!courier) {
    return { ok: false, commission: 0, balance: 0, msg: 'Профиль курьера не найден' }
  }
  if (courier.blocked) {
    return { ok: false, commission: 0, balance: 0, msg: 'Аккаунт заблокирован администратором' }
  }
  const commission = getCourierCommissionPerOrder(pricing, courier)
  const balance = getCourierBalance(courier)
  if (commission <= 0) return { ok: true, commission: 0, balance }
  if (balance + 0.001 < commission) {
    return {
      ok: false,
      commission,
      balance,
      msg: `Недостаточно средств на счёте. Нужно ${commission} ЅМ, на счёте ${balance} ЅМ. Пополните счёт у администратора.`,
    }
  }
  return { ok: true, commission, balance }
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
