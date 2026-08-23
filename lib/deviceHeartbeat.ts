/**
 * Пульс аппарата для сервера: онлайн, длина очереди, opSeq.
 * Ревизия позже будет ждать queueFlushed у выбранных устройств.
 */
import { api } from './api'
import { USE_API } from './config'
import { getPending } from './offline'
import { getPosOpSeqSnapshot } from './posOpSeq'
import {
  ensureTradeDeviceReady,
  getTradeDeviceBindSync,
  getTradeDeviceIdSync,
} from './tradeDevice'

const MIN_INTERVAL_MS = 45000

let lastSentAt = 0
let inflight: Promise<void> | null = null

export type DeviceHeartbeatContext = {
  /** Обойти троттлинг (после flush) */
  force?: boolean
  /** Идёт отправка очереди — queueFlushed будет false */
  syncing?: boolean
}

export async function sendDeviceHeartbeat(ctx?: DeviceHeartbeatContext): Promise<void> {
  if (!USE_API || typeof window === 'undefined') return

  const now = Date.now()
  if (!ctx?.force && now - lastSentAt < MIN_INTERVAL_MS) return
  if (inflight) return inflight

  inflight = (async () => {
    try {
      await ensureTradeDeviceReady()
      const bind = getTradeDeviceBindSync()
      const deviceId = getTradeDeviceIdSync()
      const posId = String(bind?.posId || '').trim()
      if (!deviceId || !posId) return

      const list = await getPending()
      const queueFailed = list.filter(r => r.failed).length
      const queueLen = list.filter(r => !r.failed).length
      const queueFlushed = queueLen === 0 && !ctx?.syncing

      await api.sendDeviceHeartbeat({
        deviceId,
        posId,
        deviceName: bind?.deviceName,
        queueLen,
        queueFailed,
        queueFlushed,
        lastOpSeqByKey: getPosOpSeqSnapshot(),
        sentAtIso: new Date().toISOString(),
      })
      lastSentAt = Date.now()
    } catch {
      /* best-effort — не мешаем кассе */
    }
  })().finally(() => {
    inflight = null
  })

  return inflight
}
