import type { Product } from '@/lib/types'
import { filterProductsBySearch } from '@/lib/productBarcodes'

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

/** Фильтр списка приходов/списаний по периоду (поля type=date, YYYY-MM-DD) */
export function matchesDateRange(iso: string, from: string, to: string) {
  if (!from && !to) return true
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (from) {
    const start = new Date(`${from}T00:00:00`).getTime()
    if (t < start) return false
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`).getTime()
    if (t > end) return false
  }
  return true
}

export function filterProducts(products: Product[], q: string) {
  return filterProductsBySearch(products, q, 30)
}

export type WriteoffReason = {
  id: string
  label: string
  icon: string
  color: string
  bg: string
}

export const WRITEOFF_REASONS: WriteoffReason[] = [
  { id: 'Порча', label: 'Порча', icon: '🗑️', color: '#FF5A5A', bg: 'rgba(255,90,90,.12)' },
  { id: 'Брак', label: 'Брак', icon: '⚠️', color: '#FFB800', bg: 'rgba(255,184,0,.12)' },
  { id: 'Просрочка', label: 'Просрочка', icon: '⏰', color: '#FF9F43', bg: 'rgba(255,159,67,.12)' },
  { id: 'Подарок', label: 'Подарок', icon: '🎁', color: '#9B6DFF', bg: 'rgba(155,109,255,.12)' },
  { id: 'Внутреннее использование', label: 'Внутр. исп.', icon: '🏠', color: '#3B8EF0', bg: 'rgba(59,142,240,.12)' },
  { id: 'Другое', label: 'Другое', icon: '📝', color: '#7E9A86', bg: 'rgba(126,154,134,.12)' },
]

export function writeoffReasonMeta(reason: string): WriteoffReason {
  return WRITEOFF_REASONS.find(r => r.id === reason || reason.startsWith(r.id))
    || WRITEOFF_REASONS.find(r => r.id === 'Другое')!
}
