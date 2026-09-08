import { registerDefaultKindHandlers, syncManager } from './handlers'
import { getBackgroundSyncWorker } from './worker'
import type { SyncEngineState } from './types'

export type { SyncOpStatus, SyncPriority, SyncEngineState } from './types'
export {
  syncPriorityForKind,
  syncPriorityRank,
  queueSortKey,
  pendingPriorityNumber,
} from './priorities'
export { syncManager, registerDefaultKindHandlers } from './handlers'
export type { SyncOpHandler } from './handlers'

let handlersReady = false

/** Запуск фонового Sync Engine (idempotent). */
export function startSyncEngine(): void {
  if (!handlersReady) {
    registerDefaultKindHandlers()
    handlersReady = true
  }
  getBackgroundSyncWorker().start()
}

/** processing → pending после краша / обрыва flush. */
export async function recoverStuckQueueOps(): Promise<number> {
  const { recoverStuckQueueOps: recover } = await import('../offline')
  return recover()
}

export function getSyncEngineStatus(): SyncEngineState {
  return getBackgroundSyncWorker().getStatus()
}

/** Прогон одной op через SyncManager (тесты / будущий batch). */
export async function dispatchSyncOp(row: import('../offline').PendingOp): Promise<string> {
  if (!handlersReady) {
    registerDefaultKindHandlers()
    handlersReady = true
  }
  return syncManager.dispatch(row)
}
