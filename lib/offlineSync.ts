// ════════════════════════════════════════════════
// KAKAPO — стор синхронизации офлайн-кассы
// online-статус, счётчик очереди, авто-flush
// ════════════════════════════════════════════════
import { create } from 'zustand'
import { flushQueue, getPending, isOnline, enqueueSale, type PosSalePayload } from './offline'

interface OfflineSyncState {
  online: boolean
  pending: number
  failed: number
  syncing: boolean
  lastSyncAtIso: string | null
  lastError: string | null
  started: boolean
  /** обновить счётчики из очереди */
  refresh: () => Promise<void>
  /** отправить очередь на сервер */
  flush: () => Promise<void>
  /** добавить чек в очередь (офлайн) и обновить счётчик */
  queueSale: (payload: PosSalePayload) => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null

export const useOfflineSync = create<OfflineSyncState>((set, get) => ({
  online: isOnline(),
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncAtIso: null,
  lastError: null,
  started: false,

  refresh: async () => {
    const list = await getPending()
    set({ pending: list.filter(r => !r.failed).length, failed: list.filter(r => r.failed).length })
  },

  flush: async () => {
    if (get().syncing) return
    if (!isOnline()) { set({ online: false }); return }
    set({ syncing: true, lastError: null })
    try {
      const res = await flushQueue()
      set({
        syncing: false,
        online: !res.stopped || isOnline(),
        lastSyncAtIso: new Date().toISOString(),
      })
      await get().refresh()
      // после успешной отправки подтягиваем свежие остатки/цены
      if (res.sent > 0) {
        try {
          const { useProducts } = await import('./store')
          await useProducts.getState().fetchProducts()
        } catch { /* ignore */ }
      }
    } catch (e) {
      set({ syncing: false, lastError: e instanceof Error ? e.message : 'Ошибка синхронизации' })
    }
  },

  queueSale: async (payload) => {
    await enqueueSale(payload)
    await get().refresh()
  },

  start: () => {
    if (get().started || typeof window === 'undefined') return
    set({ started: true, online: isOnline() })

    const goOnline = () => { set({ online: true }); void get().flush() }
    const goOffline = () => { set({ online: false }) }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    void get().refresh()
    if (isOnline()) void get().flush()

    // периодическая попытка синхронизации (страховка, если события не сработали)
    if (intervalId) clearInterval(intervalId)
    intervalId = setInterval(() => {
      set({ online: isOnline() })
      if (isOnline() && get().pending > 0) void get().flush()
    }, 20000)
  },
}))
