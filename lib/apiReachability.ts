// ════════════════════════════════════════════════
// Достижимость API — отдельно от navigator.onLine
// (в Electron флаг часто «залипает» после обрыва Wi‑Fi)
// ════════════════════════════════════════════════

let lastOkAt = 0
let lastFailAt = 0

/** Браузер считает, что сети нет */
export function browserSaysOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function noteApiOk() {
  lastOkAt = Date.now()
}

export function noteApiFail() {
  lastFailAt = Date.now()
}

/** Недавно успешно достучались до API */
export function recentlyApiOk(withinMs = 90_000): boolean {
  return lastOkAt > 0 && Date.now() - lastOkAt < withinMs
}

/**
 * Стоит ли сразу отменять запрос без попытки fetch.
 * Не блокируем, если недавно API отвечал — типичный баг Electron после reconnect.
 */
export function shouldSkipFetchAsOffline(): boolean {
  if (!browserSaysOffline()) return false
  if (recentlyApiOk()) return false
  // navigator offline и давно не было успешного ping — не ждём длинный таймаут
  return true
}

export function lastApiOkAt(): number {
  return lastOkAt
}

export function lastApiFailAt(): number {
  return lastFailAt
}
