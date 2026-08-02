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
  /** отправить очередь прямо сейчас (сначала ping) */
  syncNow: () => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

/** Реальная проверка связи с API (не путать с Wi‑Fi без доступа к серверу) */
async function pingServer(): Promise<boolean> {
  if (!isOnline()) return false
  const api = getApiUrl().replace(/\/$/, '')
  const candidates: string[] = [`${api}/health`]
  try {
    const origin = new URL(api).origin
    if (origin && `${origin}/health` !== candidates[0]) {
      candidates.push(`${origin}/health`)
    }
  } catch { /* ignore */ }

  for (const url of candidates) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) return true
    } catch { /* следующий URL */ }
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`${api}/products?limit=1`, { cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    return res.status > 0 && res.status < 500
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

function scheduleReconnect(get: () => OfflineSyncState, set: (p: Partial<OfflineSyncState>) => void) {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void (async () => {
      if (get().syncing) return
      const alive = await pingServer()
      if (!alive) {
        set({ online: false })
        // ещё попытка через 8 сек, пока есть очередь
        if (get().pending > 0) scheduleReconnect(get, set)
        return
      }
      set({ online: true })
      if (get().pending > 0 || get().failed > 0) {
        await get().flush()
      }
    })()
  }, 2500)
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
      // Не помечаем «офлайн» только из-за таймаута одной операции —
      // сначала проверяем API ping.
      let online = true
      if (res.stopped) {
        online = await pingServer()
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
      // очередь ещё есть — повторим скоро
      if (get().pending > 0 && online) {
        scheduleReconnect(get, set)
      } else if (get().pending > 0 && !online) {
        scheduleReconnect(get, set)
      }
    } catch (e) {
      set({
        syncing: false,
        progress: { done: 0, total: 0 },
        lastError: e instanceof Error ? e.message : 'Ошибка синхронизации',
      })
      scheduleReconnect(get, set)
    }
  },

  queueSale: async (payload) => {
    await enqueueSale(payload)
    await get().refresh()
    scheduleReconnect(get, set)
  },

  queueOp: async (kind, payload, opts) => {
    const row = await enqueueOp(kind, payload, opts)
    await get().refresh()
    scheduleReconnect(get, set)
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
    set({ online: true, lastError: null })
    // Сначала подтянуть смены (макс 3с) — иначе чеки падают с «Смена не найдена»
    try {
      const { softSyncPosAfterSale } = await import('./posStore')
      await Promise.race([
        softSyncPosAfterSale(),
        new Promise(resolve => setTimeout(resolve, 3000)),
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
    if (get().pending === 0) {
      try { await refetchEverything() } catch { /* ignore */ }
      try { await markLocalSyncAt() } catch { /* ignore */ }
      set({ lastSyncAtIso: new Date().toISOString() })
    }
  },

  start: () => {
    if (get().started || typeof window === 'undefined') return
    set({ started: true, online: isOnline() })

    const goOnline = () => { void reconnect() }
    const goOffline = () => {
      set({ online: false })
      scheduleReconnect(get, set)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    const reconnect = async () => {
      const alive = await pingServer()
      if (!alive) {
        set({ online: false })
        scheduleReconnect(get, set)
        return
      }
      set({ online: true })
      await get().flush()
      try {
        const { silentSyncFromServer } = await import('./offlineBootstrap')
        await silentSyncFromServer()
      } catch { /* ignore */ }
      if (get().pending === 0) {
        set({ lastSyncAtIso: new Date().toISOString() })
      }
    }

    void get().refresh().then(() => {
      if (get().pending > 0) void reconnect()
      else void reconnect()
    })

    if (intervalId) clearInterval(intervalId)
    intervalId = setInterval(() => {
      if (get().syncing) return
      void (async () => {
        const alive = await pingServer()
        if (!alive) {
          set({ online: false })
          return
        }
        const wasOffline = !get().online
        set({ online: true })
        if (wasOffline || get().pending > 0) {
          await get().flush()
        }
      })()
    }, 12000)
  },
}))
