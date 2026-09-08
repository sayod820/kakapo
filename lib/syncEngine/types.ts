/** Sync Engine — статусы и приоритеты outbox-операций */

export type SyncOpStatus = 'pending' | 'processing' | 'failed' | 'synced'

export type SyncPriority = 'high' | 'medium' | 'low'

export interface SyncEngineState {
  running: boolean
  started: boolean
  lastTickAtIso: string | null
  lastError: string | null
  attempt: number
  pending: number
  failed: number
  lastSyncAtIso: string | null
}
