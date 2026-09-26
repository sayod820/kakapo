/**
 * Офлайн-вход: отпечатки паролей сотрудников на кассе идут вместе с обычным синком.
 * Каждый ответ /sync/changes несёт employeesAuthRev; касса перекачивает
 * /employees/local-auth только когда он изменился (сменили пароль, права,
 * заблокировали или удалили сотрудника).
 */
import { api, setSyncMetaListener } from './api'
import { cacheEmployeesAuth, readCachedEmployeesAuth } from './offline'
import { mergeServerAuthRows } from './employeePassword'
import { loadTradeEmployeeSession } from './employeeSession'

const REV_KEY = 'kakapo_employees_auth_rev'
const FAIL_RETRY_MS = 5 * 60_000

export const EMPLOYEE_REVOKED_EVENT = 'kakapo:employee-revoked'

let inflight: Promise<void> | null = null
let failedRev = ''
let failedAt = 0

function readRev(): string {
  try { return localStorage.getItem(REV_KEY) || '' } catch { return '' }
}

function writeRev(rev: string) {
  try { localStorage.setItem(REV_KEY, rev) } catch { /* ignore */ }
}

export function emitEmployeeRevoked(employeeId: string, reason = '') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EMPLOYEE_REVOKED_EVENT, { detail: { employeeId, reason } }))
}

/** Перекачать отпечатки с сервера. false — сервер не дал списка (кэш не трогаем). */
export async function refreshEmployeesAuthFromServer(): Promise<boolean> {
  const full = await api.getEmployeesLocalAuth()
  // Empty list would lock everyone out offline; treat it as "no data".
  if (!Array.isArray(full) || !full.length) return false
  const rows = await mergeServerAuthRows(full, await readCachedEmployeesAuth())
  await cacheEmployeesAuth(rows)
  const session = loadTradeEmployeeSession()
  if (session && !rows.some(r => r.id === session.employeeId && r.active !== false)) {
    emitEmployeeRevoked(session.employeeId, 'Сотрудник заблокирован или удалён')
  }
  return true
}

export function noteEmployeesAuthRev(rev: string) {
  const next = String(rev || '').trim()
  if (!next || next === readRev() || inflight) return
  if (next === failedRev && Date.now() - failedAt < FAIL_RETRY_MS) return
  inflight = refreshEmployeesAuthFromServer()
    .then(ok => {
      if (ok) {
        writeRev(next)
        failedRev = ''
      } else {
        failedRev = next
        failedAt = Date.now()
      }
    })
    .catch(() => {
      failedRev = next
      failedAt = Date.now()
    })
    .finally(() => { inflight = null })
}

export function installEmployeesAuthSync() {
  setSyncMetaListener(meta => noteEmployeesAuthRev(String(meta?.employeesAuthRev || '')))
}
