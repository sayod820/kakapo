import type { SyncEngineState } from './types'

const BACKOFF_MS = [2000, 3500, 5000, 8000, 12000, 20000, 30000]

/**
 * Singleton фонового воркера: один тик за раз, syncNow из offlineSync,
 * пауза на оплату, yield через syncUiYield, exponential backoff.
 */
class BackgroundSyncWorker {
  private static inst: BackgroundSyncWorker | null = null

  static get(): BackgroundSyncWorker {
    if (!BackgroundSyncWorker.inst) {
      BackgroundSyncWorker.inst = new BackgroundSyncWorker()
    }
    return BackgroundSyncWorker.inst
  }

  private started = false
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private lastTickAtIso: string | null = null
  private lastError: string | null = null
  private pending = 0
  private failed = 0
  private lastSyncAtIso: string | null = null

  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    this.schedule(800)
  }

  getStatus(): SyncEngineState {
    return {
      running: this.running,
      started: this.started,
      lastTickAtIso: this.lastTickAtIso,
      lastError: this.lastError,
      attempt: this.attempt,
      pending: this.pending,
      failed: this.failed,
      lastSyncAtIso: this.lastSyncAtIso,
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, Math.max(0, delayMs))
  }

  private nextBackoff(): number {
    const idx = Math.min(this.attempt, BACKOFF_MS.length - 1)
    this.attempt += 1
    return BACKOFF_MS[idx]
  }

  private async tick(): Promise<void> {
    if (!this.started) return
    if (this.running) {
      this.schedule(2000)
      return
    }

    try {
      const { isCashierPaymentCritical } = await import('../cashierUiGate')
      if (isCashierPaymentCritical()) {
        this.schedule(1500)
        return
      }

      const { syncBreath } = await import('../syncUiYield')
      await syncBreath()

      this.running = true
      this.lastTickAtIso = new Date().toISOString()
      this.lastError = null

      const { useOfflineSync } = await import('../offlineSync')
      const sync = useOfflineSync.getState()
      await sync.refresh()
      const afterRefresh = useOfflineSync.getState()
      this.pending = afterRefresh.pending
      this.failed = afterRefresh.failed
      this.lastSyncAtIso = afterRefresh.lastSyncAtIso
      const hasWork = afterRefresh.pending > 0 || afterRefresh.failed > 0

      if (!hasWork && afterRefresh.online) {
        this.attempt = 0
        // Простой онлайн: редкий тик (inbound/ping остаётся в offlineSync idle)
        this.schedule(25000)
        return
      }

      // Есть очередь / офлайн — один syncNow (offlineSync interval при engine.started не дублирует)
      await sync.syncNow()
      await sync.refresh()
      const st = useOfflineSync.getState()
      this.pending = st.pending
      this.failed = st.failed
      this.lastSyncAtIso = st.lastSyncAtIso
      if (st.pending > 0 || st.failed > 0 || !st.online) {
        this.schedule(this.nextBackoff())
      } else {
        this.attempt = 0
        this.schedule(20000)
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'sync worker tick failed'
      this.schedule(this.nextBackoff())
    } finally {
      this.running = false
    }
  }
}

export function getBackgroundSyncWorker(): BackgroundSyncWorker {
  return BackgroundSyncWorker.get()
}
