/** Разделы приложения «Торговля» и шаблоны доступа */

export type TradePageId =
  | 'sales'
  | 'products'
  | 'clients'
  | 'debts'
  | 'warehouse'
  | 'suppliers'
  | 'finance'
  | 'reports'

export type EmployeeRole = 'cashier' | 'warehouse' | 'manager' | 'custom'

export const TRADE_PAGES: { id: TradePageId; label: string; icon: string }[] = [
  { id: 'sales', label: 'Точка продаж', icon: '🛒' },
  { id: 'products', label: 'Товары', icon: '📦' },
  { id: 'clients', label: 'Клиенты', icon: '👥' },
  { id: 'debts', label: 'Долги', icon: '💳' },
  { id: 'warehouse', label: 'Склад', icon: '🏬' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚' },
  { id: 'finance', label: 'Финансы', icon: '💰' },
  { id: 'reports', label: 'Отчёты', icon: '📊' },
]

export const EMPLOYEE_ROLE_PRESETS: Record<
  EmployeeRole,
  { label: string; permissions: TradePageId[]; hint: string }
> = {
  cashier: {
    label: 'Кассир',
    permissions: ['sales', 'clients', 'debts'],
    hint: 'Касса, клиенты и долги',
  },
  warehouse: {
    label: 'Склад',
    permissions: ['products', 'warehouse', 'suppliers'],
    hint: 'Товары, склад, поставщики',
  },
  manager: {
    label: 'Старший / админ',
    permissions: TRADE_PAGES.map(p => p.id),
    hint: 'Все разделы Торговли',
  },
  custom: {
    label: 'Свой набор',
    permissions: [],
    hint: 'Отметьте разделы вручную',
  },
}

export function permissionsForRole(role: EmployeeRole): TradePageId[] {
  return [...EMPLOYEE_ROLE_PRESETS[role].permissions]
}

export function canAccessTradePage(permissions: string[] | undefined, page: string) {
  return Array.isArray(permissions) && permissions.includes(page)
}

export function firstAllowedTradePage(permissions: string[] | undefined): TradePageId {
  for (const p of TRADE_PAGES) {
    if (canAccessTradePage(permissions, p.id)) return p.id
  }
  return 'sales'
}
