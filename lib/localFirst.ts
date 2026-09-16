// ════════════════════════════════════════════════
// KAKAPO — mutation contract: local-first vs online-direct
// ════════════════════════════════════════════════
import { useOfflineSync } from './offlineSync'
import { isTradeLocalFirst } from './offlineV2'
import { racePlatformOpCore } from './racePlatformOpCore.mjs'

export interface OfflineResult<T> {
  /** true — подтверждено локально, сервер догонит из очереди */
  offline: boolean
  data: T
}

/**
 * Desktop/Android local-first: сразу локально (стор + очередь), синк в фоне.
 * Не вызывать из browser online path — используйте racePlatformOp.
 */
export async function localFirstOp<T>(
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  const data = await localApply()
  useOfflineSync.getState().scheduleSyncDebounced()
  return { offline: true, data }
}

export type RacePlatformOpts = {
  /** Override for tests. Default: isTradeLocalFirst() */
  isLocalFirst?: () => boolean
}

/**
 * Platform-aware mutation:
 * - local-first (Desktop/Android): localApply only; apiCall ignored; offline:true
 * - browser online: await apiCall exactly once; localApply NEVER; offline:false
 *
 * Browser API failure must propagate — no localApply fallback, no queueOp.
 */
export async function racePlatformOp<T>(
  apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
  opts?: RacePlatformOpts,
): Promise<OfflineResult<T>> {
  return racePlatformOpCore(apiCall, localApply, {
    isLocalFirst: opts?.isLocalFirst ?? isTradeLocalFirst,
    localFirstOp,
  }) as Promise<OfflineResult<T>>
}
