/** Сессия ресторана после входа по телефону */

export interface RestaurantSession {
  restId: string
  phone: string
  name: string
}

const KEY = 'kakapo_restaurant_session'

export function loadRestaurantSession(): RestaurantSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as RestaurantSession
    if (!s?.restId || !s?.phone) return null
    return s
  } catch {
    return null
  }
}

export function saveRestaurantSession(session: RestaurantSession) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearRestaurantSession() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(KEY)
}
