'use client'

export type AdminSession = {
  login: string
  name: string
  role: string
  token: string
  userId?: number | string
}

const KEY = 'kakapo_admin_session'
const OFFLINE_CREDS_KEY = 'kakapo_admin_local_creds'

export const DEFAULT_ADMIN_LOGIN = 'admin'
export const DEFAULT_ADMIN_PASSWORD = 'admin123'

export type AdminLocalCreds = {
  login: string
  password: string
}

export function loadAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AdminSession
    if (!s?.login || !s?.token) return null
    return s
  } catch {
    return null
  }
}

export function saveAdminSession(session: AdminSession) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function clearAdminSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}

export function loadOfflineAdminCreds(): AdminLocalCreds {
  if (typeof window === 'undefined') {
    return { login: DEFAULT_ADMIN_LOGIN, password: DEFAULT_ADMIN_PASSWORD }
  }
  try {
    const raw = localStorage.getItem(OFFLINE_CREDS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as AdminLocalCreds
      if (p?.login && p?.password) return { login: String(p.login), password: String(p.password) }
    }
  } catch { /* ignore */ }
  return { login: DEFAULT_ADMIN_LOGIN, password: DEFAULT_ADMIN_PASSWORD }
}

export function saveOfflineAdminCreds(creds: AdminLocalCreds) {
  if (typeof window === 'undefined') return
  localStorage.setItem(OFFLINE_CREDS_KEY, JSON.stringify({
    login: String(creds.login || DEFAULT_ADMIN_LOGIN).trim(),
    password: String(creds.password || ''),
  }))
}
