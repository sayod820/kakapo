// ════════════════════════════════════════════════
// KAKAPO — local-first: сразу локально, сервер в фоне
// ════════════════════════════════════════════════
import { useOfflineSync } from './offlineSync'

export interface OfflineResult<T> {
  /** true — подтверждено локально, сервер догонит из очереди */
  offline: boolean
  data: T
}

/**
 * Всегда применяет локально (стор + очередь), затем запускает синк в фоне.
 * UI не ждёт сервер — касса остаётся шустрой.
 */
export async function localFirstOp<T>(
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  const data = await localApply()
  // Сразу отправить ИМЕННО эту op из очереди (flush), без inbound-шторма
  useOfflineSync.getState().scheduleSyncDebounced(120)
  return { offline: true, data }
}
