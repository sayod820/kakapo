export type WarehouseTab = 'stock' | 'receipts' | 'writeoffs' | 'revisions' | 'expiry'

export const WAREHOUSE_TABS: { id: WarehouseTab; label: string; icon: string }[] = [
  { id: 'stock', label: 'Остатки', icon: '📦' },
  { id: 'receipts', label: 'Приходы', icon: '📥' },
  { id: 'writeoffs', label: 'Списания', icon: '📤' },
  { id: 'revisions', label: 'Ревизия', icon: '📋' },
  { id: 'expiry', label: 'Сроки', icon: '⏰' },
]

export function fmtMoney(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}

export function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return iso
  }
}

export function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function filterProducts(products: { id: number; name: string; art?: string }[], q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return products.slice(0, 30)
  return products.filter(p => `${p.name} ${p.art || ''}`.toLowerCase().includes(s)).slice(0, 30)
}
