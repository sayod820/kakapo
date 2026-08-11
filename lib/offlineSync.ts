// ════════════════════════════════════════════════
// KAKAPO — стор синхронизации офлайн-кассы
// online-статус, очередь операций, авто-flush после связи
// ════════════════════════════════════════════════
import { create } from 'zustand'
import { getApiUrl } from './config'
import { noteApiFail, noteApiOk } from './apiReachability'
import { isCashierCritical } from './cashierUiGate'
import {
  flushQueue,
  getPending,
  isOnline,
  enqueueSale,
  enqueueOp,
  dropPending,
  retryPending,
  type PendingOp,
  type PosSalePayload,
  type QueueKind,
} from './offline'
import { markLocalSyncAt } from './offlineBootstrap'

interface OfflineSyncState {
  online: boolean
  pending: number
  failed: number
  /** содержимое очереди — для списка «требует разбора» */
  items: PendingOp[]
  syncing: boolean
  /** прогресс отправки очереди: сколько операций уже ушло из скольких */
  progress: { done: number; total: number }
  lastSyncAtIso: string | null
  lastError: string | null
  started: boolean
  /** обновить счётчики из очереди */
  refresh: () => Promise<void>
  /** отправить очередь на сервер и обновить данные */
  flush: () => Promise<void>
  /** добавить чек в очередь (офлайн) и обновить счётчик */
  queueSale: (payload: PosSalePayload) => Promise<void>
  /** добавить любую операцию кассы в очередь */
  queueOp: <P>(kind: QueueKind, payload: P, opts?: { localId?: string; clientRef?: string }) => Promise<PendingOp<P>>
  /** пометить, что связи нет (запрос упал с сетевой ошибкой) */
  markOffline: () => void
  /** повторить отклонённую операцию */
  retry: (clientRef: string) => Promise<void>
  /** убрать отклонённую операцию из очереди */
  drop: (clientRef: string) => Promise<void>
  /** отправить очередь прямо сейчас (сначала ping) */
  syncNow: () => Promise<void>
  /**
   * Принудительная синхронизация: вернуть ВСЕ failed в очередь
   * и несколько раз подряд прогнать отправку (для «застрявших»).
   */
  forceSync: (opts?: { clientRef?: string }) => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let listenersBound = false
let syncLock = false

/** Слабый интернет: ping дольше; при очереди крутим чаще */
const PING_TIMEOUT_MS = 4500
const PING_QUICK_MS = 2800
const POLL_IDLE_MS = 10000
const POLL_BUSY_MS = 4000
const BACKOFF_MS = [1500, 2500, 4000, 6000, 10000, 15000, 25000]
/** syncNow не должен вечно держать «чёрный круг» */
const SYNC_WATCHDOG_MS = 55000

/** Реальная проверка связи с API — не зависит от navigator.onLine */
async function pingOnce(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok || (res.status > 0 && res.status < 500)
  } catch {
    return false
  }
}

async function pingServer(opts?: { quick?: boolean }): Promise<boolean> {
  const api = getApiUrl().replace(/\/$/, '')
  const candidates: string[] = [`${api}/health`]
  try {
    const origin = new URL(api).origin
    if (origin && `${origin}/health` !== candidates[0]) {
      candidates.push(`${origin}/health`)
    }
  } catch { /* ignore */ }

  const quick = !!opts?.quick || isCashierCritical()
  const attempts = quick ? 1 : 3
  const baseTimeout = quick ? PING_QUICK_MS : PING_TIMEOUT_MS
  for (let attempt = 0; attempt < attempts; attempt++) {
    const timeout = baseTimeout + attempt * 1200
    for (const url of candidates) {
      if (await pingOnce(url, timeout)) {
        noteApiOk()
        return true
      }
    }
    // products?limit=1 только вне оплаты — иначе лишняя нагрузка на кассу
    if (!quick && await pingOnce(`${api}/products?limit=1`, timeout)) {
      noteApiOk()
      return true
    }
    if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 300 + attempt * 200))
  }
  noteApiFail()
  return false
}

/** Полное обновление данных после возврата связи — через pull дельт */
async function refetchEverything() {
  try {
    const { pullSyncChanges } = await import('./syncPull')
    const res = await pullSyncChanges({ forceFull: false })
    if (res.ok) return
    if (res.skipped === 'pending') return
  } catch { /* fallback ниже */ }
  const [{ useProducts }, { syncPosFromApi }, { syncClientsFromApi }, { syncCardsFromApi }] = await Promise.all([
    import('./store'),
    import('./posStore'),
    import('./clientStore'),
    import('./cardStore'),
  ])
  await Promise.allSettled([
    useProducts.getState().fetchProducts(),
    syncPosFromApi(),
    syncClientsFromApi(),
    syncCardsFromApi(),
  ])
}

function nextBackoffMs() {
  const idx = Math.min(reconnectAttempt, BACKOFF_MS.length - 1)
  reconnectAttempt += 1
  return BACKOFF_MS[idx]
}

function resetBackoff() {
  reconnectAttempt = 0
}

function scheduleReconnect(
  get: () => OfflineSyncState,
  set: (p: Partial<OfflineSyncState>) => void,
  delayMs?: number,
) {
  if (reconnectTimer) return
  const wait = delayMs ?? nextBackoffMs()
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void (async () => {
      // Если сейчас идёт flush — не бросаем цепочку, повторим чуть позже
      if (get().syncing || syncLock) {
        scheduleReconnect(get, set, 1500)
        return
      }
      if (isCashierCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }
      // При слабом интернете ping может врать — если есть очередь, всё равно syncNow
      const hasWork = get().pending > 0 || get().failed > 0
      const alive = await pingServer({ quick: !hasWork })
      if (!alive && !hasWork) {
        set({ online: false })
        scheduleReconnect(get, set)
        return
      }
      if (alive) {
        resetBackoff()
        set({ online: true })
      }
      await get().syncNow()
    })()
  }, wait)
}

function isTransientFailError(err: string): boolean {
  return /сеть|связ|timeout|не отвечает|fetch|network|ECONN|ETIMEDOUT|502|503|504|смена|связанная операция|не найдена|временно|abort/i.test(err)
}

/** Явные ошибки валидации — бессмысленно долбить бесконечно в фоне */
function isHardValidationError(err: string): boolean {
  return /обязател|некоррект|invalid|validation|дубликат|уже существу|forbidden|403|401|нет прав/i.test(err)
    && !isTransientFailError(err)
}

async function autoRetryFailed(opts?: { forceAll?: boolean }): Promise<number> {
  let n = 0
  try {
    const list = await getPending()
    const forceAll = !!opts?.forceAll
    for (const row of list) {
      if (!row.failed) continue
      const err = String(row.lastError || '')
      const attempts = Number(row.attempts) || 0
      // Обычный фон: почти всё возвращаем; жёсткую валидацию — только с force
      if (
        forceAll
        || !err
        || isTransientFailError(err)
        || attempts < 12
        || !isHardValidationError(err)
      ) {
        await retryPending(row.clientRef)
        n++
      }
    }
  } catch { /* ignore */ }
  return n
}

function withWatchdog<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Синхронизация превысила время ожидания')), ms)
    promise.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

export const useOfflineSync = create<OfflineSyncState>((set, get) => ({
  online: isOnline(),
  pending: 0,
  failed: 0,
  items: [],
  syncing: false,
  progress: { done: 0, total: 0 },
  lastSyncAtIso: null,
  lastError: null,
  started: false,

  refresh: async () => {
    const list = await getPending()
    set({
      items: list,
      pending: list.filter(r => !r.failed).length,
      failed: list.filter(r => r.failed).length,
    })
  },

  flush: async () => {
    if (get().syncing) return
    // Не блокируем flush по navigator.onLine — сначала пробуем отправить
    set({ syncing: true, lastError: null, progress: { done: 0, total: Math.max(1, get().pending) } })
    try {
      const res = await flushQueue((done, total) => set({ progress: { done, total } }))
      let online = true
      if (res.stopped) {
        online = await pingServer({ quick: true })
      } else if (res.sent > 0) {
        noteApiOk()
        online = true
      }
      set({
        syncing: false,
        online,
        lastSyncAtIso: res.sent > 0 ? new Date().toISOString() : get().lastSyncAtIso,
        progress: { done: 0, total: 0 },
        lastError: res.stopped && !online
          ? 'Нет связи при отправке очереди — пробуем снова сами'
          : (res.remaining > 0 && res.failed > 0 ? 'Часть операций отклонена' : null),
      })
      await get().refresh()
      if (res.sent > 0 || (res.remaining === 0 && online)) {
        // Только после пустой/успешной очереди — входящий pull (не overwrite поверх pending)
        if (get().pending === 0 && online) {
          try {
            const { pullSyncChanges } = await import('./syncPull')
            await Promise.race([
              pullSyncChanges(),
              new Promise(resolve => setTimeout(resolve, 12000)),
            ])
          } catch {
            try { await refetchEverything() } catch { /* следующий цикл */ }
          }
          try { await markLocalSyncAt() } catch { /* ignore */ }
        }
      }
      if (get().pending > 0 || get().failed > 0) {
        scheduleReconnect(get, set, online ? 2000 : undefined)
      } else if (!online) {
        scheduleReconnect(get, set)
      } else {
        resetBackoff()
      }
    } catch (e) {
      set({
        syncing: false,
        online: false,
        progress: { done: 0, total: 0 },
        lastError: e instanceof Error ? e.message : 'Ошибка синхронизации',
      })
      scheduleReconnect(get, set)
    }
  },

  queueSale: async (payload) => {
    await enqueueSale(payload)
    void get().refresh()
    scheduleReconnect(get, set, 1500)
  },

  queueOp: async (kind, payload, opts) => {
    const row = await enqueueOp(kind, payload, opts)
    // Не ждём полный getPending — иначе «Пробить» тормозит на SQLite
    void get().refresh()
    scheduleReconnect(get, set, 1500)
    return row
  },

  markOffline: () => {
    set({ online: false })
    scheduleReconnect(get, set)
  },

  retry: async (clientRef) => {
    await get().forceSync({ clientRef })
  },

  drop: async (clientRef) => {
    await dropPending(clientRef)
    await get().refresh()
  },

  syncNow: async () => {
    if (syncLock || get().syncing) {
      scheduleReconnect(get, set, 2000)
      return
    }
    // Во время пробития/подтверждения не трогаем UI тяжёлым sync
    if (isCashierCritical()) {
      scheduleReconnect(get, set, 2500)
      return
    }

    syncLock = true
    const run = async () => {
      await get().refresh()
      const hasWork = get().pending > 0 || get().failed > 0

      // Слабый интернет: ping часто «врёт» (timeout). Есть очередь — всё равно шлём.
      const alive = await pingServer({ quick: !hasWork })
      if (alive) {
        resetBackoff()
        set({ online: true, lastError: null })
      } else if (!hasWork) {
        set({ online: false, lastError: 'Сервер не отвечает — ждём связь, пробуем сами' })
        scheduleReconnect(get, set)
        return
      } else {
        // Очередь есть — не ставим «офлайн» навсегда, пробуем flush
        set({ lastError: 'Слабая связь — пробуем отправить очередь…' })
      }

      if (isCashierCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }

      // Вернуть failed в очередь (авто, без кнопки)
      const revived = await autoRetryFailed()
      if (revived > 0) await get().refresh()

      if (isCashierCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }

      // Подтянуть смены коротко — иначе «Смена не найдена»
      if (alive) {
        try {
          const { softSyncPosAfterSale } = await import('./posStore')
          await Promise.race([
            softSyncPosAfterSale(),
            new Promise(resolve => setTimeout(resolve, 2500)),
          ])
        } catch { /* ignore */ }
      }

      if (isCashierCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }

      if (get().pending > 0) {
        await get().flush()
      } else if (alive) {
        set({ online: true, lastSyncAtIso: new Date().toISOString(), lastError: null })
        try {
          const { pullSyncChanges } = await import('./syncPull')
          await Promise.race([
            pullSyncChanges(),
            new Promise(resolve => setTimeout(resolve, 10000)),
          ])
        } catch { /* ignore */ }
        try { await markLocalSyncAt() } catch { /* ignore */ }
      }

      if (get().pending > 0 || get().failed > 0 || !get().online) {
        scheduleReconnect(get, set, get().online ? 3000 : undefined)
      }
    }

    try {
      await withWatchdog(run(), SYNC_WATCHDOG_MS)
    } catch (e) {
      set({
        syncing: false,
        lastError: e instanceof Error ? e.message : 'Синхронизация прервана — повторим сами',
        progress: { done: 0, total: 0 },
      })
      scheduleReconnect(get, set, 3000)
    } finally {
      syncLock = false
      if (get().syncing) set({ syncing: false, progress: { done: 0, total: 0 } })
    }
  },

  forceSync: async (opts) => {
    // Ждём, пока обычный sync отпустит замок (пользователь нажал «отправить»)
    for (let i = 0; i < 40 && (syncLock || get().syncing); i++) {
      await new Promise(r => setTimeout(r, 250))
    }
    if (syncLock || get().syncing) {
      scheduleReconnect(get, set, 1500)
      return
    }

    syncLock = true
    set({ lastError: 'Принудительная синхронизация…' })

    const run = async () => {
      await get().refresh()

      if (opts?.clientRef) {
        await retryPending(opts.clientRef)
      } else {
        await autoRetryFailed({ forceAll: true })
      }
      await get().refresh()

      const hasWork = get().pending > 0 || get().failed > 0
      if (!hasWork) {
        set({ lastError: null })
        return
      }

      // Несколько кругов: слабый интернет + «смена не найдена»
      const rounds = 4
      for (let round = 0; round < rounds; round++) {
        await get().refresh()
        if (get().pending === 0 && get().failed === 0) break

        // Снова поднять то, что снова упало как failed (кроме жёсткой валидации на последнем круге)
        await autoRetryFailed({ forceAll: round < rounds - 1 })
        await get().refresh()
        if (get().pending === 0) break

        const alive = await pingServer({ quick: false })
        if (alive) {
          resetBackoff()
          set({ online: true })
          try {
            const { softSyncPosAfterSale } = await import('./posStore')
            await Promise.race([
              softSyncPosAfterSale(),
              new Promise(resolve => setTimeout(resolve, 3500)),
            ])
          } catch { /* ignore */ }
        } else {
          set({ lastError: 'Слабая связь — принудительно пробуем отправить…' })
        }

        const before = get().pending + get().failed
        await get().flush()
        await get().refresh()
        const after = get().pending + get().failed

        if (after === 0) {
          set({ online: true, lastSyncAtIso: new Date().toISOString(), lastError: null })
          try {
            const { pullSyncChanges } = await import('./syncPull')
            await Promise.race([
              pullSyncChanges(),
              new Promise(resolve => setTimeout(resolve, 10000)),
            ])
          } catch { /* ignore */ }
          try { await markLocalSyncAt() } catch { /* ignore */ }
          break
        }

        // Прогресс есть — ещё круг; нет — пауза и ещё попытка
        if (after >= before) {
          await new Promise(r => setTimeout(r, 1200 + round * 800))
        } else {
          await new Promise(r => setTimeout(r, 400))
        }
      }

      await get().refresh()
      if (get().pending > 0 || get().failed > 0) {
        set({
          lastError: get().failed > 0
            ? 'Часть операций всё ещё не ушла — откройте очередь'
            : 'Очередь ещё ждёт связь — пробуем сами',
        })
        scheduleReconnect(get, set, 2000)
      } else {
        set({ lastError: null, lastSyncAtIso: new Date().toISOString() })
      }
    }

    try {
      await withWatchdog(run(), 90000)
    } catch (e) {
      set({
        syncing: false,
        lastError: e instanceof Error ? e.message : 'Принудительная синхронизация прервана',
        progress: { done: 0, total: 0 },
      })
      scheduleReconnect(get, set, 2500)
    } finally {
      syncLock = false
      if (get().syncing) set({ syncing: false, progress: { done: 0, total: 0 } })
      await get().refresh()
    }
  },

  start: () => {
    if (get().started || typeof window === 'undefined') return
    set({ started: true, online: isOnline() })

    const reconnect = async () => {
      if (isCashierCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }
      await get().syncNow()
    }

    const goOnline = () => {
      resetBackoff()
      void reconnect()
    }
    const goOffline = () => {
      set({ online: false })
      scheduleReconnect(get, set)
    }

    if (!listenersBound) {
      listenersBound = true
      window.addEventListener('online', goOnline)
      window.addEventListener('offline', goOffline)
      // После сворачивания / возврата в окно — сразу проверить связь
      const onWake = () => {
        void (async () => {
          if (isCashierCritical()) return
          resetBackoff()
          await get().syncNow()
        })()
      }
      window.addEventListener('focus', onWake)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onWake()
      })
    }

    void get().refresh().then(() => { void reconnect() })

    if (intervalId) clearInterval(intervalId)
    intervalId = setInterval(() => {
      if (get().syncing || syncLock) return
      if (isCashierCritical()) return
      void (async () => {
        await get().refresh()
        const failed = get().failed
        const pending = get().pending
        const hasWork = pending > 0 || failed > 0 || !get().online
        if (!hasWork) {
          const alive = await pingServer({ quick: true })
          if (!alive) {
            set({ online: false })
            scheduleReconnect(get, set)
          } else {
            set({ online: true })
          }
          return
        }
        // В фоне обычный sync; принудительный — только по кнопке в окне очереди
        await get().syncNow()
      })()
    }, POLL_BUSY_MS)
  },
}))
