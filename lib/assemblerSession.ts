/** Сессия сборщика после входа по PIN */

export interface AssemblerSession {
  assemblerId: string
  name: string
}

const KEY = 'kakapo_assembler_session'

export function loadAssemblerSession(): AssemblerSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AssemblerSession
    if (!s?.assemblerId || !s?.name) return null
    return s
  } catch {
    return null
  }
}

export function saveAssemblerSession(session: AssemblerSession) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearAssemblerSession() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(KEY)
}
