// ════════════════════════════════════════════════
// KAKAPO — стор синхронизации офлайн-кассы
// online-статус, очередь операций, авто-flush после связи
// ════════════════════════════════════════════════
import { create } from 'zustand'
import { getApiUrl } from './config'
import { noteApiFail, noteApiOk } from './apiReachability'
import { isCashierCritical, isCashierPaymentCritical, isCashierSearchBusy } from './cashierUiGate'
import {
  flushQueue,
  getPending,
  isOnline,
  enqueueSale,
  enqueueOp,
  retryPending,
  pendingRetryDelayMs,
  type PendingOp,
  type PosSalePayload,
  type QueueKind,
} from './offline'
import { markLocalSyncAt } from './offlineBootstrap'

interface OfflineSyncState {
  online: boolean
  pending: number
  failed: number
  /** содержимое очереди — только просмотр и повторная отправка */
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
  /** Кассир не может удалять очередь — операция должна уйти на сервер */
  drop: (clientRef: string) => Promise<void>
  /** отправить очередь прямо сейчас (сначала ping) */
  syncNow: () => Promise<void>
  /** отложенный sync — не дергает сеть на каждую партию/чек подряд */
  scheduleSyncDebounced: (delayMs?: number) => void
  /**
   * Принудительная синхронизация: вернуть ВСЕ failed в очередь
   * и несколько раз подряд прогнать отправку (для «застрявших»).
   */
  forceSync: (opts?: { clientRef?: string }) => Promise<void>
  /** запустить слушатели online/offline и периодический flush */
  start: () => void
}

let intervalId: ReturnType<typeof setInterval> | null = null
let lastIdlePingAt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let listenersBound = false
let syncLock = false
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null
/** Отпечаток очереди после flush без прогресса — не долбить каждые 2с */
let lastStuckFingerprint = ''
let lastStuckAt = 0

/** Слабый интернет: ping дольше; при очереди крутим умеренно, в покое — тихо */
const PING_TIMEOUT_MS = 4500
const PING_QUICK_MS = 2800
/** Простой онлайн без очереди: ping/refresh не чаще этого */
const POLL_IDLE_MS = 25000
/** Есть pending/failed или офлайн — догоняем, но не каждые 4с (UI замирает) */
const POLL_BUSY_MS = 12000
/** Если flush ничего не сдвинул — пауза перед следующим syncNow */
const STUCK_COOLDOWN_MS = 45000
const BACKOFF_MS = [2500, 4000, 7000, 12000, 20000, 30000, 45000]
/** syncNow не должен вечно держать «чёрный круг» */
const SYNC_WATCHDOG_MS = 55000
/** Фон: сколько раз auto-revive failed (дальше — только forceSync) */
const AUTO_RETRY_MAX_ATTEMPTS = 5

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
        scheduleReconnect(get, set, 4000)
        return
      }
      // Оплата/пробитие — ждём; поиск кассы не должен блокировать отправку очереди
      if (isCashierPaymentCritical()) {
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
        // Не сбрасываем backoff при застрявшей очереди — иначе вечный 2с цикл
        if (!hasWork) resetBackoff()
        set({ online: true })
      }
      await get().syncNow()
    })()
  }, wait)
}

/** Только реальная сеть / 5xx — не «связанная операция» и не «смена не найдена» */
function isTransientFailError(err: string): boolean {
  return /нет связи|сеть недоступ|timeout|timed?\s*out|не отвечает|failed to fetch|networkerror|network request|ECONN|ETIMEDOUT|ENOTFOUND|502|503|504|временно недоступ|abort/i.test(err)
}

/**
 * Явные ошибки валидации / блокировки — бессмысленно долбить бесконечно в фоне.
 * «Смена не найдена» сюда НЕ входит: смена может уехать на сервер следующей операцией.
 */
function isHardValidationError(err: string): boolean {
  return /обязател|некоррект|invalid|validation|дубликат|уже существу|forbidden|403|401|нет прав|связанная операция|сначала дождитесь|поставщик не найден|товар #|смена уже закрыта|недостаточно|нечего возвращать|чек не найден/i.test(err)
}

function queueFingerprint(list: PendingOp[]): string {
  return list
    .map(r => `${r.clientRef}:${r.failed ? 1 : 0}:${r.attempts}:${String(r.lastError || '').slice(0, 40)}`)
    .sort()
    .join('|')
}

function earliestRetryWaitMs(list: PendingOp[]): number {
  const now = Date.now()
  let minWait = STUCK_COOLDOWN_MS
  for (const row of list) {
    const at = Number(row.nextRetryAt) || 0
    if (at > now) minWait = Math.min(minWait, at - now)
    else if (row.failed) minWait = Math.min(minWait, pendingRetryDelayMs(row.attempts))
  }
  return Math.max(5000, Math.min(STUCK_COOLDOWN_MS, minWait))
}

async function autoRetryFailed(opts?: { forceAll?: boolean }): Promise<number> {
  let n = 0
  try {
    const list = await getPending()
    const forceAll = !!opts?.forceAll
    const now = Date.now()
    for (const row of list) {
      if (!row.failed) continue
      const err = String(row.lastError || '')
      const attempts = Number(row.attempts) || 0
      const nextAt = Number(row.nextRetryAt) || 0
      if (!forceAll && nextAt > now) continue

      if (forceAll) {
        await retryPending(row.clientRef)
        n++
        continue
      }

      // Жёсткая валидация / broken-ref — только ручной forceSync
      if (err && isHardValidationError(err) && !isTransientFailError(err)) continue
      // Фон: не больше N попыток на op
      if (attempts >= AUTO_RETRY_MAX_ATTEMPTS) continue
      // Только сеть/пусто/ранние попытки
      if (!err || isTransientFailError(err) || attempts < 2) {
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
      let lastProg = 0
      const res = await flushQueue((done, total) => {
        const t = Date.now()
        if (t - lastProg < 280 && done < total) return
        lastProg = t
        set({ progress: { done, total } })
      })
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

      const list = get().items
      const fp = queueFingerprint(list)
      if (res.sent > 0) {
        lastStuckFingerprint = ''
        lastStuckAt = 0
        resetBackoff()
      } else if (get().pending > 0 || get().failed > 0) {
        // Тот же набор ops без прогресса — длинная пауза, не крутить каждые 2с
        if (fp && fp === lastStuckFingerprint) {
          lastStuckAt = Date.now()
        } else {
          lastStuckFingerprint = fp
          lastStuckAt = Date.now()
        }
      } else {
        lastStuckFingerprint = ''
        lastStuckAt = 0
      }

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
          try {
            const { pullStockLayersFromServer } = await import('./stockLayersLocal')
            await pullStockLayersFromServer({ bumpProducts: true })
          } catch { /* ignore */ }
          try { await markLocalSyncAt() } catch { /* ignore */ }
          try {
            const { sendDeviceHeartbeat } = await import('./deviceHeartbeat')
            void sendDeviceHeartbeat({ force: true })
          } catch { /* ignore */ }
        }
      }
      if (get().pending > 0 || get().failed > 0) {
        const wait = res.sent > 0
          ? 3000
          : Math.max(earliestRetryWaitMs(list), online ? STUCK_COOLDOWN_MS : nextBackoffMs())
        scheduleReconnect(get, set, wait)
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
    lastStuckFingerprint = ''
    lastStuckAt = 0
    void get().refresh()
    // Сразу пробуем уйти на сервер (не ждём 10с опроса)
    scheduleReconnect(get, set, 600)
  },

  queueOp: async (kind, payload, opts) => {
    const row = await enqueueOp(kind, payload, opts)
    lastStuckFingerprint = ''
    lastStuckAt = 0
    // Не ждём полный getPending — иначе «Пробить» тормозит на SQLite
    void get().refresh()
    scheduleReconnect(get, set, 600)
    return row
  },

  markOffline: () => {
    set({ online: false })
    scheduleReconnect(get, set)
  },

  retry: async (clientRef) => {
    await get().forceSync({ clientRef })
  },

  drop: async () => {
    await get().refresh()
  },

  scheduleSyncDebounced: (delayMs = 450) => {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer)
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null
      void get().syncNow()
    }, delayMs)
  },

  syncNow: async () => {
    if (syncLock || get().syncing) {
      // Не ставим новый таймер на каждый клик — один reconnect уже в полёте
      if (!reconnectTimer) scheduleReconnect(get, set, 4000)
      return
    }
    // Только оплата/пробитие — полный стоп. Поиск кассы НЕ блокирует отправку очереди.
    if (isCashierPaymentCritical()) {
      scheduleReconnect(get, set, 2500)
      return
    }

    // Застрявшая очередь без прогресса — не крутить softSync+flush каждые пару секунд
    if (
      lastStuckFingerprint
      && lastStuckAt > 0
      && Date.now() - lastStuckAt < STUCK_COOLDOWN_MS
      && (get().pending > 0 || get().failed > 0)
    ) {
      if (!reconnectTimer) {
        scheduleReconnect(get, set, STUCK_COOLDOWN_MS - (Date.now() - lastStuckAt))
      }
      return
    }

    syncLock = true
    const run = async () => {
      await get().refresh()
      const hasWork = get().pending > 0 || get().failed > 0
      const searchBusy = isCashierSearchBusy()

      // Слабый интернет: ping часто «врёт» (timeout). Есть очередь — всё равно шлём.
      const alive = await pingServer({ quick: !hasWork })
      if (alive) {
        if (!hasWork) resetBackoff()
        set({ online: true, lastError: null })
      } else if (!hasWork) {
        set({ online: false, lastError: 'Сервер не отвечает — ждём связь, пробуем сами' })
        scheduleReconnect(get, set)
        return
      } else {
        // Очередь есть — не ставим «офлайн» навсегда, пробуем flush
        set({ lastError: 'Слабая связь — пробуем отправить очередь…' })
      }

      if (isCashierPaymentCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }

      // Вернуть failed в очередь (авто, с лимитом и nextRetryAt)
      const revived = await autoRetryFailed()
      if (revived > 0) await get().refresh()

      if (isCashierPaymentCritical()) {
        scheduleReconnect(get, set, 2500)
        return
      }

      // Исходящая очередь: сначала только flush — softSync до flush тормозит UI и мешает отправке
      if (get().pending > 0) {
        const beforeFp = queueFingerprint(get().items)
        const beforePending = get().pending
        await get().flush()
        // Входящий softSync — только если очередь реально сдвинулась
        if (
          alive
          && !isCashierPaymentCritical()
          && (get().pending < beforePending || beforeFp !== queueFingerprint(get().items))
        ) {
          try {
            const { softSyncPosAfterSale } = await import('./posStore')
            void softSyncPosAfterSale({ force: true })
          } catch { /* ignore */ }
        }
      } else if (alive && !searchBusy) {
        // Нет исходящих — лёгкий pull (не force softSync каждый раз)
        set({ online: true, lastSyncAtIso: new Date().toISOString(), lastError: null })
        try {
          const { pullSyncChanges } = await import('./syncPull')
          await Promise.race([
            pullSyncChanges(),
            new Promise(resolve => setTimeout(resolve, 10000)),
          ])
        } catch { /* ignore */ }
        try { await markLocalSyncAt() } catch { /* ignore */ }
        try {
          const { sendDeviceHeartbeat } = await import('./deviceHeartbeat')
          void sendDeviceHeartbeat()
        } catch { /* ignore */ }
      }

      if (get().pending > 0 || get().failed > 0 || !get().online) {
        const wait = lastStuckFingerprint
          ? Math.max(earliestRetryWaitMs(get().items), STUCK_COOLDOWN_MS)
          : (get().online ? 8000 : undefined)
        scheduleReconnect(get, set, wait)
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
      scheduleReconnect(get, set, 8000)
    } finally {
      syncLock = false
      if (get().syncing) set({ syncing: false, progress: { done: 0, total: 0 } })
    }
  },

  forceSync: async (opts) => {
    // Ручная отправка: блокируем только реальное пробитие, не поиск
    if (isCashierPaymentCritical()) {
      scheduleReconnect(get, set, 1500)
      return
    }
    // Ждём, пока обычный sync отпустит замок (пользователь нажал «отправить»)
    for (let i = 0; i < 40 && (syncLock || get().syncing); i++) {
      await new Promise(r => setTimeout(r, 250))
      if (isCashierPaymentCritical()) {
        scheduleReconnect(get, set, 1500)
        return
      }
    }
    if (syncLock || get().syncing) {
      scheduleReconnect(get, set, 1500)
      return
    }

    lastStuckFingerprint = ''
    lastStuckAt = 0
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
      const rounds = 3
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
          try {
            const { pullStockLayersFromServer } = await import('./stockLayersLocal')
            await pullStockLayersFromServer({ bumpProducts: true })
          } catch { /* ignore */ }
          try { await markLocalSyncAt() } catch { /* ignore */ }
          break
        }

        // Прогресс есть — ещё круг; нет — пауза и ещё попытка
        if (after >= before) {
          await new Promise(r => setTimeout(r, 2000 + round * 1000))
        } else {
          await new Promise(r => setTimeout(r, 500))
        }
      }

      await get().refresh()
      if (get().pending > 0 || get().failed > 0) {
        set({
          lastError: get().failed > 0
            ? 'Часть операций ещё не ушла — отправим снова сами'
            : 'Очередь ещё ждёт связь — пробуем сами',
        })
        scheduleReconnect(get, set, STUCK_COOLDOWN_MS)
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
      scheduleReconnect(get, set, 8000)
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
      if (isCashierPaymentCritical()) {
        scheduleReconnect(get, set, 2000)
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
          if (isCashierPaymentCritical()) return
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
      if (isCashierPaymentCritical()) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void (async () => {
        // Быстрый взгляд по стору: в покое не дёргаем SQLite/refresh каждые 4с
        const quickPending = get().pending
        const quickFailed = get().failed
        const quickOnline = get().online
        const maybeIdle = quickPending === 0 && quickFailed === 0 && quickOnline

        if (maybeIdle) {
          if (isCashierSearchBusy()) return
          if (Date.now() - lastIdlePingAt < POLL_IDLE_MS) return
          lastIdlePingAt = Date.now()
          await get().refresh()
          // После refresh могли появиться pending — тогда сразу syncNow
          if (get().pending > 0 || get().failed > 0 || !get().online) {
            try {
              const { sendDeviceHeartbeat } = await import('./deviceHeartbeat')
              void sendDeviceHeartbeat({ syncing: get().syncing })
            } catch { /* ignore */ }
            await get().syncNow()
            return
          }
          const alive = await pingServer({ quick: true })
          if (!alive) {
            set({ online: false })
            scheduleReconnect(get, set)
          } else {
            set({ online: true })
          }
          try {
            const { sendDeviceHeartbeat } = await import('./deviceHeartbeat')
            void sendDeviceHeartbeat()
          } catch { /* ignore */ }
          return
        }

        // Очередь / офлайн — редкий догон (не каждые 4с: иначе UI замирает на 6 ops)
        if (lastStuckFingerprint && Date.now() - lastStuckAt < STUCK_COOLDOWN_MS) {
          return
        }
        await get().refresh()
        try {
          const { sendDeviceHeartbeat } = await import('./deviceHeartbeat')
          void sendDeviceHeartbeat({ syncing: get().syncing })
        } catch { /* ignore */ }
        await get().syncNow()
      })()
    }, POLL_BUSY_MS)
  },
}))
