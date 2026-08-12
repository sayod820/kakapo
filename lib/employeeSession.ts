/** Сессия сотрудника «Торговля» после входа по паролю.
 *  Храним в localStorage — иначе на Android WebView sessionStorage сбрасывается
 *  при каждом убийстве процесса и снова просит пароль.
 */
import type { TradePageId } from './tradeAccess'

export interface TradeEmployeeSession {
  employeeId: string
  name: string
  role: string
  permissions: TradePageId[]
}

const KEY = 'kakapo_trade_employee_session'
const LAST_EMPLOYEE_KEY = 'kakapo_trade_last_employee_id'

function isValid(s: unknown): s is TradeEmployeeSession {
  if (!s || typeof s !== 'object') return false
  const row = s as TradeEmployeeSession
  return !!row.employeeId && !!row.name && Array.isArray(row.permissions)
}

export function loadTradeEmployeeSession(): TradeEmployeeSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isValid(parsed)) return null
    // Миграция со старого sessionStorage
    if (!localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, raw)
    }
    return parsed
  } catch {
    return null
  }
}

export function saveTradeEmployeeSession(session: TradeEmployeeSession) {
  if (typeof window === 'undefined') return
  const raw = JSON.stringify(session)
  localStorage.setItem(KEY, raw)
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LAST_EMPLOYEE_KEY, session.employeeId)
  } catch {
    /* ignore */
  }
}

export function clearTradeEmployeeSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function loadLastTradeEmployeeId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(LAST_EMPLOYEE_KEY) || ''
  } catch {
    return ''
  }
}
