/** Сессия курьера после входа по телефону */

export interface CourierSession {
  phone: string
  courierId: string
  name: string
}

const KEY = 'kakapo_courier_session'

export function loadCourierSession(): CourierSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as CourierSession
    if (!s?.phone || !s?.courierId) return null
    return s
  } catch {
    return null
  }
}

export function saveCourierSession(session: CourierSession) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearCourierSession() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(KEY)
}
