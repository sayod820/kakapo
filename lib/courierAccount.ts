/** Номер счёта курьера для пополнения: KUR-0001 */

export const COURIER_ACCOUNT_PREFIX = 'KUR'

export function courierIdToSeq(id: string): number {
  const n = parseInt(String(id || '').replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function formatCourierAccountNumber(seq: number): string {
  const n = Math.max(1, Math.min(9999, Math.floor(seq) || 1))
  return `${COURIER_ACCOUNT_PREFIX}-${String(n).padStart(4, '0')}`
}

export function formatCourierAccountFromId(courierId: string): string {
  return formatCourierAccountNumber(courierIdToSeq(courierId))
}

/** Нормализация ввода: KUR0001, kur-1, 0001 → KUR-0001 */
export function normalizeCourierAccount(raw?: string | null, courierId?: string): string {
  const s = String(raw || '').trim().toUpperCase().replace(/\s/g, '')
  if (s) {
    const prefixed = s.match(/^KUR-?(\d{1,4})$/)
    if (prefixed) return formatCourierAccountNumber(parseInt(prefixed[1], 10) || 1)
    const digitsOnly = s.replace(/\D/g, '')
    if (digitsOnly.length >= 1 && digitsOnly.length <= 4) {
      return formatCourierAccountNumber(parseInt(digitsOnly, 10) || 1)
    }
  }
  if (courierId) return formatCourierAccountFromId(courierId)
  return formatCourierAccountNumber(1)
}

export function formatCourierAccountDisplay(account: string, courierId?: string): string {
  return normalizeCourierAccount(account, courierId)
}

export function nextCourierAccountNumber(couriers: { id: string; account?: string }[]): string {
  let max = 0
  for (const c of couriers) {
    const acc = normalizeCourierAccount(c.account, c.id)
    const n = parseInt(acc.replace(/\D/g, ''), 10)
    if (n > max) max = n
  }
  return formatCourierAccountNumber(max + 1)
}

export function findCourierByAccount<T extends { id: string; account?: string }>(
  couriers: T[],
  query: string,
): T | undefined {
  const q = normalizeCourierAccount(query)
  if (!q) return undefined
  return couriers.find(c => normalizeCourierAccount(c.account, c.id) === q)
}
