// ════════════════════════════════════════════════
// Local-first: UI ↔ база; SYNC-канал ↔ сервер
// ════════════════════════════════════════════════
import { isTradeLocalFirst } from './offlineV2'
import { hasDesktopSyncChannel, kickDesktopSyncChannel, bindDesktopSyncChannelListeners } from './syncChannel'

export type SyncKickMode = 'flush' | 'inbound' | 'both'

/** Не чаще чем раз в N мс будить inbound с UI — канал сам тянет по WS/таймеру */
const INBOUND_KICK_MIN_MS = 8000
let lastInboundKickAt = 0

/** Trade/POS local-first: UI не ходит на API за синками */
export function isSyncChannelMode(): boolean {
  return isTradeLocalFirst()
}

export async function kickSyncChannel(opts?: { mode?: SyncKickMode }): Promise<boolean> {
  if (!isSyncChannelMode()) return false
  let mode = opts?.mode || 'both'

  // Inbound throttle: пустая очередь + частые kick ломали кассу/историю
  if (mode === 'inbound' || mode === 'both') {
    const now = Date.now()
    if (now - lastInboundKickAt < INBOUND_KICK_MIN_MS) {
      if (mode === 'inbound') return true
      mode = 'flush'
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
    await kickInProcessSyncChannel({ mode })
    return true
  } catch {
    return false
  }
}
