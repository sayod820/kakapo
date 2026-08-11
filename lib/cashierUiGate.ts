// ════════════════════════════════════════════════
// Блокировка тяжёлого фона во время оплаты/пробития/поиска
// (иначе слабый интернет + syncNow «замораживает» и дёргает поиск)
// ════════════════════════════════════════════════

let depth = 0
/** До какого времени считать «кассир печатает в поиске» */
let searchBusyUntil = 0

export function beginCashierCritical() {
  depth += 1
}

export function endCashierCritical() {
  depth = Math.max(0, depth - 1)
}

/** Вызывать на каждый ввод/фокус в поиске кассы */
export function noteCashierSearchActivity(holdMs = 3500) {
  const until = Date.now() + Math.max(800, holdMs)
  if (until > searchBusyUntil) searchBusyUntil = until
}

export function isCashierCritical(): boolean {
  if (depth > 0) return true
  if (Date.now() < searchBusyUntil) return true
  if (typeof document !== 'undefined') {
    const ae = document.activeElement as HTMLElement | null
    if (ae?.getAttribute('data-cashier-search') === '1') return true
  }
  return false
}
