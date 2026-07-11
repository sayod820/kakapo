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

/** Разбирает "250 гр" / "10 шт" / "1 kg" на количество-в-упаковке и метку. */
export function parsePackUnit(unitRaw: string | undefined): { qty: number; label: string } {
  const unit = (unitRaw || 'шт').trim()
  const m = /^(\d+(?:[.,]\d+)?)\s*(.+)$/.exec(unit)
  if (m) {
    const qty = parseFloat(m[1].replace(',', '.'))
    if (qty > 0 && m[2].trim()) return { qty, label: m[2].trim() }
  }
  return { qty: 1, label: unit || 'шт' }
}

export function isGramLabel(label: string) {
  return /^(г|гр|g)\.?$/i.test(label)
}

export function isKgLabel(label: string) {
  return /^(кг|kg)\.?$/i.test(label)
}

export function formatQty(n: number) {
  return String(Math.round(n * 1000) / 1000)
}

/** Переводит количество упаковок в реальную величину: граммы → кг, иначе qty × label. */
export function packRealWorld(count: number, info: { qty: number; label: string }): { value: number; label: string } | null {
  if (isGramLabel(info.label)) return { value: (count * info.qty) / 1000, label: 'кг' }
  if (isKgLabel(info.label)) return { value: count * info.qty, label: 'кг' }
  if (info.qty !== 1) return { value: count * info.qty, label: info.label }
  return null
}

export function packInputUnitLabel(info: { qty: number; label: string }) {
  if (info.qty !== 1) return 'уп.'
  return isKgLabel(info.label) ? 'кг' : info.label
}

/**
 * Приводит ввод в числовых полях (кол-во/сумма/цена) к безопасной строке:
 * заменяет запятую на точку, убирает всё лишнее, не даёт вставить вторую точку.
 * Используется вместо type="number", у которого в RU-локали браузера ломается
 * ввод через запятую и колесо мыши меняет значение при скролле страницы.
 */
export function sanitizeDecimalInput(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = v.indexOf('.')
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
  }
  return v
}
