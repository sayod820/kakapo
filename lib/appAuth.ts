/** Авторизация приложений KAKAPO */

export type StaffRole = 'courier' | 'assembler' | 'restaurant' | 'client'

export interface AdminCredentials {
  email: string
  password: string
  name: string
}

export interface StaffSession {
  role: StaffRole
  phone: string
  name: string
  token?: string
  staffId?: string
  restaurantId?: string
}

export interface OtpVerifyResult {
  access_token: string
  role: string
  name: string
  phone?: string
  staff_id?: string
  restaurant_id?: string
}

export const DEFAULT_ADMIN: AdminCredentials = {
  email: 'admin@kakapo.tj',
  password: 'admin123',
  name: 'Владелец KAKAPO',
}

const ADMIN_CRED_KEY = 'kakapo_admin_credentials'
const ADMIN_SESSION_KEY = 'kakapo_admin_logged_in'

export function normalizePhone(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length >= 9) return d.slice(-9)
  return d
}

export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  return na.length >= 9 && na === nb
}

export function loadAdminCredentials(): AdminCredentials {
  if (typeof window === 'undefined') return { ...DEFAULT_ADMIN }
  try {
    const raw = localStorage.getItem(ADMIN_CRED_KEY)
    if (raw) return { ...DEFAULT_ADMIN, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_ADMIN }
}

export function saveAdminCredentials(creds: AdminCredentials) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ADMIN_CRED_KEY, JSON.stringify(creds))
}

export function verifyAdminLocal(email: string, password: string): boolean {
  const creds = loadAdminCredentials()
  return (
    creds.email.toLowerCase().trim() === email.toLowerCase().trim()
    && creds.password === password
  )
}

export function isAdminLoggedIn(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1'
}

export function setAdminLoggedIn(on: boolean) {
  if (typeof window === 'undefined') return
  if (on) sessionStorage.setItem(ADMIN_SESSION_KEY, '1')
  else sessionStorage.removeItem(ADMIN_SESSION_KEY)
}

function staffSessionKey(role: StaffRole) {
  return `kakapo_staff_session_${role}`
}

export function loadStaffSession(role: StaffRole): StaffSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(staffSessionKey(role))
    if (!raw) return null
    return JSON.parse(raw) as StaffSession
  } catch {
    return null
  }
}

export function saveStaffSession(session: StaffSession) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(staffSessionKey(session.role), JSON.stringify(session))
}

export function clearStaffSession(role: StaffRole) {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(staffSessionKey(role))
}

export function otpVerifyResultToSession(r: OtpVerifyResult, phone: string, role: StaffRole): StaffSession {
  return {
    role,
    phone: r.phone || phone,
    name: r.name,
    token: r.access_token,
    staffId: r.staff_id,
    restaurantId: r.restaurant_id,
  }
}

/** Демо-проверка OTP для курьера / сборщика / ресторана без API */
export function demoStaffOtp(
  phone: string,
  code: string,
  role: StaffRole,
  lists: {
    couriers?: { id: string; name: string; phone: string; otp?: string; blocked?: boolean }[]
    assemblers?: { id: string; name: string; phone: string; otp?: string; blocked?: boolean }[]
    restaurants?: { id: string; name: string; phone: string; otp?: string; blocked?: boolean }[]
  },
): StaffSession | null {
  const list = role === 'courier'
    ? lists.couriers
    : role === 'assembler'
      ? lists.assemblers
      : lists.restaurants
  if (!list?.length) return null
  const person = list.find(p => phonesMatch(p.phone, phone) && !p.blocked)
  if (!person) return null
  const expected = person.otp || '1234'
  if (String(code) !== expected) return null
  return {
    role,
    phone: person.phone,
    name: person.name,
    staffId: person.id,
    restaurantId: role === 'restaurant' ? person.id : undefined,
  }
}
