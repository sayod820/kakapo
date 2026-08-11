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

/** Уход со кассы / keep-alive скрыт — не держим «критично» из-за фокуса */
export function clearCashierSearchActivity() {
  searchBusyUntil = 0
}

/** Оплата / пробитие / модалки — нельзя трогать очередь и UI */
export function isCashierPaymentCritical(): boolean {
  return depth > 0
}

/** Поиск кассы: не дёргать каталог/pull, но очередь отправлять можно */
export function isCashierSearchBusy(): boolean {
  if (Date.now() < searchBusyUntil) return true
  if (typeof document !== 'undefined') {
    const ae = document.activeElement as HTMLElement | null
    if (ae?.getAttribute('data-cashier-search') === '1') return true
  }
  return false
}

/** Полный блок: оплата ИЛИ поиск (для тяжёлых softSync / fetchProducts) */
export function isCashierCritical(): boolean {
  return isCashierPaymentCritical() || isCashierSearchBusy()
}
