// ════════════════════════════════════════════════
// KAKAPO — стор синхронизации офлайн-кассы
// online-статус, очередь операций, авто-flush после связи
// ════════════════════════════════════════════════
import { create } from 'zustand'
import { getApiUrl } from './config'
import { noteApiFail, noteApiOk } from './apiReachability'
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
  /** отправить очередь прямо сейчас (сначала ping) */
  syncNow: () => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let listenersBound = false

const PING_TIMEOUT_MS = 7000
const POLL_MS = 8000
const BACKOFF_MS = [2000, 3000, 5000, 8000, 12000, 20000, 30000]

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

async function pingServer(): Promise<boolean> {
  const api = getApiUrl().replace(/\/$/, '')
  const candidates: string[] = [`${api}/health`]
  try {
    const origin = new URL(api).origin
    if (origin && `${origin}/health` !== candidates[0]) {
      candidates.push(`${origin}/health`)
    }
  } catch { /* ignore */ }

  // Две попытки — слабый интернет часто рвёт первый запрос
  for (let attempt = 0; attempt < 2; attempt++) {
    const timeout = attempt === 0 ? PING_TIMEOUT_MS : PING_TIMEOUT_MS + 2000
    for (const url of candidates) {
      if (await pingOnce(url, timeout)) {
        noteApiOk()
        return true
      }
    }
    if (await pingOnce(`${api}/products?limit=1`, timeout)) {
      noteApiOk()
      return true
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 600))
  }
  noteApiFail()
  return false
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
      if (get().syncing) {
        scheduleReconnect(get, set, 1500)
        return
      }
      const alive = await pingServer()
      if (!alive) {
        set({ online: false })
        // Продолжаем пробовать: очередь или просто «офлайн» статус
        scheduleReconnect(get, set)
        return
      }
      resetBackoff()
      set({ online: true })
      await get().syncNow()
    })()
  }, wait)
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
    set({ syncing: true, lastError: null, progress: { done: 0, total: get().pending } })
    try {
      const res = await flushQueue((done, total) => set({ progress: { done, total } }))
      let online = true
      if (res.stopped) {
        online = await pingServer()
      } else if (res.sent > 0) {
        noteApiOk()
      }
      set({
        syncing: false,
        online,
        lastSyncAtIso: res.sent > 0 ? new Date().toISOString() : get().lastSyncAtIso,
        progress: { done: 0, total: 0 },
        lastError: res.stopped && !online
          ? 'Нет связи при отправке очереди'
          : (res.remaining > 0 && res.failed > 0 ? 'Часть операций отклонена' : null),
      })
      await get().refresh()
      if (res.sent > 0) {
        try { await refetchEverything() } catch { /* следующий цикл */ }
        try { await markLocalSyncAt() } catch { /* ignore */ }
      }
      if (get().pending > 0) {
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
    await get().refresh()
    scheduleReconnect(get, set, 2000)
  },

  queueOp: async (kind, payload, opts) => {
    const row = await enqueueOp(kind, payload, opts)
    await get().refresh()
    scheduleReconnect(get, set, 2000)
    return row
  },

  markOffline: () => {
    set({ online: false })
    scheduleReconnect(get, set)
  },

  retry: async (clientRef) => {
    await retryPending(clientRef)
    await get().refresh()
    await get().syncNow()
  },

  drop: async (clientRef) => {
    await dropPending(clientRef)
    await get().refresh()
  },

  syncNow: async () => {
    const alive = await pingServer()
    if (!alive) {
      set({ online: false, lastError: 'Сервер не отвечает — очередь пока ждёт' })
      scheduleReconnect(get, set)
      return
    }
    resetBackoff()
    set({ online: true, lastError: null })
    // Сначала подтянуть смены (макс 4с) — иначе чеки падают с «Смена не найдена»
    try {
      const { softSyncPosAfterSale } = await import('./posStore')
      await Promise.race([
        softSyncPosAfterSale(),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ])
    } catch { /* ignore */ }
    // Вернуть в очередь отклонённые из‑за смены
    try {
      const list = await getPending()
      for (const row of list) {
        if (!row.failed) continue
        const err = String(row.lastError || '')
        if (/смена|связанная операция|не найдена/i.test(err)) {
          await retryPending(row.clientRef)
        }
      }
      await get().refresh()
    } catch { /* ignore */ }
    await get().flush()
    if (get().pending === 0 && get().online) {
      try { await refetchEverything() } catch { /* ignore */ }
      try { await markLocalSyncAt() } catch { /* ignore */ }
      set({ lastSyncAtIso: new Date().toISOString() })
    }
  },

  start: () => {
    if (get().started || typeof window === 'undefined') return
    set({ started: true, online: isOnline() })

    const reconnect = async () => {
      const alive = await pingServer()
      if (!alive) {
        set({ online: false })
        scheduleReconnect(get, set)
        return
      }
      resetBackoff()
      set({ online: true })
      await get().syncNow()
      try {
        const { silentSyncFromServer } = await import('./offlineBootstrap')
        await silentSyncFromServer()
      } catch { /* ignore */ }
      if (get().pending === 0) {
        set({ lastSyncAtIso: new Date().toISOString() })
      }
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
          const alive = await pingServer()
          if (!alive) {
            set({ online: false })
            scheduleReconnect(get, set)
            return
          }
          const wasOffline = !get().online
          resetBackoff()
          set({ online: true })
          if (wasOffline || get().pending > 0 || get().failed > 0) {
            await get().syncNow()
          }
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
      if (get().syncing) return
      void (async () => {
        const alive = await pingServer()
        if (!alive) {
          set({ online: false })
          scheduleReconnect(get, set)
          return
        }
        const wasOffline = !get().online
        resetBackoff()
        set({ online: true })
        if (wasOffline || get().pending > 0 || get().failed > 0) {
          await get().syncNow()
          if (wasOffline) {
            try {
              const { silentSyncFromServer } = await import('./offlineBootstrap')
              await silentSyncFromServer()
            } catch { /* ignore */ }
          }
        }
      })()
    }, POLL_MS)
  },
}))
