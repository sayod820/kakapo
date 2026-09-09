// ════════════════════════════════════════════════
// Local-first: UI ↔ база; SYNC-канал ↔ сервер
// ════════════════════════════════════════════════
import { isTradeLocalFirst } from './offlineV2'
import { hasDesktopSyncChannel, kickDesktopSyncChannel, bindDesktopSyncChannelListeners } from './syncChannel'

export type SyncKickMode = 'flush' | 'inbound' | 'both'

/** Не чаще чем раз в N мс будить inbound с UI — канал сам тянет по WS/таймеру */
const INBOUND_KICK_MIN_MS = 4000
let lastInboundKickAt = 0
let deferredInboundTimer: ReturnType<typeof setTimeout> | null = null

/** Trade/POS local-first: UI не ходит на API за синками */
export function isSyncChannelMode(): boolean {
  return isTradeLocalFirst()
}

function scheduleDeferredInbound(delayMs: number) {
  if (deferredInboundTimer) return
  deferredInboundTimer = setTimeout(() => {
    deferredInboundTimer = null
    lastInboundKickAt = 0
    void kickSyncChannel({ mode: 'inbound' })
  }, Math.max(200, delayMs))
}

export async function kickSyncChannel(opts?: {
  mode?: SyncKickMode
  expiryDays?: number
}): Promise<boolean> {
  if (!isSyncChannelMode()) return false
  let mode = opts?.mode || 'both'

  // Inbound throttle: не no-op — откладываем реальный inbound
  if (mode === 'inbound' || mode === 'both') {
    const now = Date.now()
    if (now - lastInboundKickAt < INBOUND_KICK_MIN_MS) {
      const wait = INBOUND_KICK_MIN_MS - (now - lastInboundKickAt) + 50
      if (mode === 'inbound') {
        scheduleDeferredInbound(wait)
        return true
      }
      mode = 'flush'
      scheduleDeferredInbound(wait)
    } else {
      lastInboundKickAt = now
    }
  }

  if (hasDesktopSyncChannel()) {
    try {
      bindDesktopSyncChannelListeners()
      const desk = (await import('./desktopBridge')).getKakapoDesktop()
      const { getApiUrl } = await import('./config')
      const { getToken } = await import('./api')
      const { getTradeDeviceIdSync } = await import('./tradeDevice')
      await desk!.syncChannelKick!({
        apiBase: getApiUrl().replace(/\/$/, ''),
        token: getToken() || '',
        deviceId: getTradeDeviceIdSync() || '',
        wsBase: (await import('./config')).getWsUrl().replace(/\/$/, ''),
        mode,
        ...(opts?.expiryDays != null ? { expiryDays: opts.expiryDays } : {}),
      })
      return true
    } catch {
      try {
        return await kickDesktopSyncChannel({ mode })
      } catch {
        return false
      }
    }
  }

  try {
    const { kickInProcessSyncChannel } = await import('./syncChannelInProcess')
    await kickInProcessSyncChannel({ mode, expiryDays: opts?.expiryDays })
    return true
  } catch {
    return false
  }
}
