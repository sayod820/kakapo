/** Общая фабрика сессий сотрудника (courier/assembler/restaurant): sessionStorage load/save/clear */

export function createRoleSession<T extends object>(key: string, isValid: (s: any) => s is T) {
  function load(): T | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return null
      const s = JSON.parse(raw)
      return isValid(s) ? s : null
    } catch {
      return null
    }
  }

  function save(session: T) {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(key, JSON.stringify(session))
  }

  function clear() {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem(key)
  }

  return { load, save, clear }
}
