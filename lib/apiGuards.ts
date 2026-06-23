/** Безопасное приведение ответа API к массиву — иначе .map() роняет весь UI. */
export function ensureArray<T>(value: unknown, label = 'данные'): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value != null) console.warn(`[kakapo] Ожидался массив (${label}), получено:`, typeof value)
  return []
}
