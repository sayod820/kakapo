/** Кассиры кассы KAKAPO (/pos) — по образцу lib/assemblerTeam.ts */

export interface AdminCashier {
  id: string
  name: string
  pin: string
  blocked: boolean
  salesToday: number
  salesTotal: number
}

export const DEFAULT_ADMIN_CASHIERS: AdminCashier[] = [
  { id: 'PC-01', name: 'Наргис Салимова', pin: '1111', blocked: false, salesToday: 0, salesTotal: 0 },
]

export function emptyCashierForm(): Omit<AdminCashier, 'id' | 'salesToday' | 'salesTotal'> {
  return { name: '', pin: '0000', blocked: false }
}

export function normalizeCashier(raw: Partial<AdminCashier> & { id: string }): AdminCashier {
  return {
    id: raw.id,
    name: raw.name || '',
    pin: String(raw.pin || '0000'),
    blocked: !!raw.blocked,
    salesToday: Number(raw.salesToday) || 0,
    salesTotal: Number(raw.salesTotal) || 0,
  }
}

export function verifyCashierPin(
  cashiers: AdminCashier[],
  code: string,
  cashierId?: string,
): { ok: true; cashier: AdminCashier } | { ok: false; error: string } {
  if (cashierId) {
    const c = cashiers.find(x => x.id === cashierId)
    if (!c) return { ok: false, error: 'Кассир не найден · проверьте раздел «Кассиры» в админке' }
    if (c.blocked) return { ok: false, error: 'Доступ заблокирован администратором' }
    if (String(code) !== c.pin) {
      return { ok: false, error: `Неверный PIN · Демо: ${c.pin}` }
    }
    return { ok: true, cashier: c }
  }
  const match = cashiers.find(c => !c.blocked && c.pin === String(code))
  if (!match) return { ok: false, error: 'Неверный PIN · Демо: 1111' }
  return { ok: true, cashier: match }
}
