/**
 * Единый статус связности кассы (онлайн / офлайн / синк / ошибка).
 * Источник — useOfflineSync; подписчики через subscribeConnectivity.
 */

export type ConnectivityState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'RECONNECTING'
  | 'SYNCING'
  | 'ERROR'

export type ConnectivitySnapshot = {
  online: boolean
  syncing: boolean
  pending: number
  failed: number
  lastError: string | null
}

const LABELS: Record<ConnectivityState, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  RECONNECTING: 'Переподключение…',
  SYNCING: 'Синхронизация…',
  ERROR: 'Ошибка связи',
}

let current: ConnectivityState = 'ONLINE'
const listeners = new Set<(state: ConnectivityState) => void>()

export function connectivityLabel(state: ConnectivityState): string {
  return LABELS[state] || state
}

export function deriveConnectivityState(s: ConnectivitySnapshot): ConnectivityState {
  if (s.syncing) return 'SYNCING'
  if (s.lastError && (!s.online || s.failed > 0)) return 'ERROR'
  if (!s.online && (s.pending > 0 || s.failed > 0)) return 'RECONNECTING'
  if (!s.online) return 'OFFLINE'
  return 'ONLINE'
}

export function getConnectivityState(): ConnectivityState {
  return current
}

export function subscribeConnectivity(cb: (state: ConnectivityState) => void): () => void {
  listeners.add(cb)
  try { cb(current) } catch { /* ignore */ }
  return () => { listeners.delete(cb) }
}

/** Лёгкий вызов после set() в offlineSync — без тяжёлой работы. */
export function notifyConnectivityChanged(snap?: ConnectivitySnapshot): void {
  if (!snap) return
  const next = deriveConnectivityState(snap)
  if (next === current) return
  current = next
  for (const cb of listeners) {
    try { cb(next) } catch { /* ignore */ }
  }
}
