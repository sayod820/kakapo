// ════════════════════════════════════════════════
// KAKAPO — стор синхронизации офлайн-кассы
// online-статус, очередь операций, авто-flush после связи
// ════════════════════════════════════════════════
import { create } from 'zustand'
import { getApiUrl } from './config'
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
  queueOp: <P>(kind: QueueKind, payload: P, opts?: { localId?: string }) => Promise<PendingOp<P>>
  /** пометить, что связи нет (запрос упал с сетевой ошибкой) */
  markOffline: () => void
  /** повторить отклонённую операцию */
  retry: (clientRef: string) => Promise<void>
  /** убрать отклонённую операцию из очереди */
  drop: (clientRef: string) => Promise<void>
  /** отправить очередь прямо сейчас */
  syncNow: () => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null

/** Реальная проверка связи: navigator.onLine врёт при «есть Wi-Fi, нет интернета» */
async function pingServer(): Promise<boolean> {
  if (!isOnline()) return false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${getApiUrl()}/health`, { cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

/** Полное обновление данных после возврата связи */
async function refetchEverything() {
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
    if (!isOnline()) { set({ online: false }); return }
    set({ syncing: true, lastError: null, progress: { done: 0, total: get().pending } })
    try {
      const res = await flushQueue((done, total) => set({ progress: { done, total } }))
      set({
        syncing: false,
        online: !res.stopped,
        lastSyncAtIso: res.stopped ? get().lastSyncAtIso : new Date().toISOString(),
        progress: { done: 0, total: 0 },
      })
      await get().refresh()
      // очередь ушла — подтягиваем свежие остатки, смены, карты и долги
      if (res.sent > 0 && !res.stopped) {
        try { await refetchEverything() } catch { /* обновим при следующем цикле */ }
        try { await markLocalSyncAt() } catch { /* ignore */ }
      }
    } catch (e) {
      set({
        syncing: false,
        progress: { done: 0, total: 0 },
        lastError: e instanceof Error ? e.message : 'Ошибка синхронизации',
      })
    }
  },

  queueSale: async (payload) => {
    await enqueueSale(payload)
    set({ online: false })
    await get().refresh()
  },

  queueOp: async (kind, payload, opts) => {
    const row = await enqueueOp(kind, payload, opts)
    set({ online: false })
    await get().refresh()
    return row
  },

  markOffline: () => set({ online: false }),

  retry: async (clientRef) => {
    await retryPending(clientRef)
    await get().refresh()
    if (isOnline()) await get().flush()
  },

  drop: async (clientRef) => {
    await dropPending(clientRef)
    await get().refresh()
  },

  syncNow: async () => {
    const alive = await pingServer()
    if (!alive) { set({ online: false }); return }
    set({ online: true })
    await get().flush()
    try { await refetchEverything() } catch { /* обновим при следующем цикле */ }
    try { await markLocalSyncAt() } catch { /* ignore */ }
    set({ lastSyncAtIso: new Date().toISOString() })
  },

  start: () => {
    if (get().started || typeof window === 'undefined') return
    set({ started: true, online: isOnline() })

    const goOnline = () => { void reconnect() }
    const goOffline = () => { set({ online: false }) }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    /** связь вернулась: очередь → полное обновление данных */
    const reconnect = async () => {
      const alive = await pingServer()
      if (!alive) { set({ online: false }); return }
      const hadQueue = get().pending > 0
      set({ online: true })
      await get().flush()
      if (!hadQueue) {
        try { await refetchEverything() } catch { /* обновим при следующем цикле */ }
        set({ lastSyncAtIso: new Date().toISOString() })
      }
    }

    void get().refresh()
    void reconnect()

    // страховка: события online/offline срабатывают не всегда
    if (intervalId) clearInterval(intervalId)
    intervalId = setInterval(() => {
      if (get().syncing) return
      void (async () => {
        const wasOnline = get().online
        const alive = await pingServer()
        if (!alive) { set({ online: false }); return }
        if (!wasOnline) { await reconnect(); return }
        set({ online: true })
        if (get().pending > 0) await get().flush()
      })()
    }, 45000)
  },
}))
