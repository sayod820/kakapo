// ════════════════════════════════════════════════
// Блокировка тяжёлого фона во время оплаты/пробития
// (иначе слабый интернет + syncNow «замораживает» поиск и сканер)
// ════════════════════════════════════════════════

let depth = 0

export function beginCashierCritical() {
  depth += 1
}

export function endCashierCritical() {
  depth = Math.max(0, depth - 1)
}

export function isCashierCritical(): boolean {
  return depth > 0
}
