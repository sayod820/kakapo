// ════════════════════════════════════════════════
// KAKAPO — клиент отдельного SYNC-канала (UI сторона)
// UI ↔ SQLite; SYNC (main) ↔ сервер + SQLite
// ════════════════════════════════════════════════
import { getApiUrl, getWsUrl } from './config'
import { getToken } from './api'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { getTradeDeviceIdSync } from './tradeDevice'
import type { PendingOp, QueueKind } from './offline'

let listenersBound = false

export function hasDesktopSyncChannel(): boolean {
  if (!isKakapoDesktop()) return false
  const desk = getKakapoDesktop()
  return typeof desk?.syncChannelKick === 'function'
}

/** Разбудить SYNC-канал (сеть+очередь в main). UI не делает flush. */
export async function kickDesktopSyncChannel(opts?: { mode?: 'flush' | 'inbound' | 'both' }): Promise<boolean> {
  if (!hasDesktopSyncChannel()) return false
  const desk = getKakapoDesktop()
  try {
    await desk!.syncChannelKick!({
      apiBase: getApiUrl().replace(/\/$/, ''),
      token: getToken() || '',
      deviceId: getTradeDeviceIdSync() || '',
      wsBase: getWsUrl().replace(/\/$/, ''),
      mode: opts?.mode || 'both',
    })
    return true
  } catch {
    return false
  }
}

/** Подписка на события канала + delegate sendOp */
export function bindDesktopSyncChannelListeners(): void {
  if (listenersBound || !hasDesktopSyncChannel()) return
  listenersBound = true
  const desk = getKakapoDesktop()
  if (!desk) return

  void import('./offline').then(m => {
    try { void m.clearDesktopIdbQueueGhosts() } catch { /* ignore */ }
  }).catch(() => {})

  desk.onSyncChannelDelegate?.(async (msg) => {
    const id = Number(msg?.id)
    try {
      const row = msg?.row as PendingOp
      const { channelSendOneOp } = await import('./offline')
      const res = await channelSendOneOp(row)
      await desk.syncChannelDelegateResult?.({ id, ok: true, serverId: res.serverId })
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      const { isNetworkError } = await import('./api')
      await desk.syncChannelDelegateResult?.({
        id,
        ok: false,
        error: err,
        network: isNetworkError(e),
      })
    }
  })

  desk.onSyncChannelEvent?.(async (ev) => {
    try {
      if (ev?.type === 'op-ok') {
        const clientRef = String(ev.clientRef || '')
        if (clientRef) {
          try {
            const { dropPending } = await import('./offline')
            await dropPending(clientRef)
          } catch { /* ignore */ }
        }
        if (!ev.delegated) {
          const { channelOnOpSuccess } = await import('./offline')
          await channelOnOpSuccess({
            kind: ev.kind as QueueKind,
            localId: String(ev.localId || ''),
            serverId: String(ev.serverId || ''),
            clientRef,
          })
        }
        try {
          const { useOfflineSync } = await import('./offlineSync')
          void useOfflineSync.getState().refresh()
        } catch { /* ignore */ }
        return
      }
      if (ev?.type === 'op-fail') {
        const { channelOnOpFail } = await import('./offline')
        await channelOnOpFail(
          {
            clientRef: String(ev.clientRef || ''),
            kind: ev.kind as QueueKind,
            payload: ev.payload,
            localId: ev.localId,
            createdAtIso: new Date().toISOString(),
            seq: 0,
            attempts: 1,
            failed: true,
            lastError: String(ev.error || ''),
          } as PendingOp,
          String(ev.error || ''),
        )
        try {
          const { useOfflineSync } = await import('./offlineSync')
          void useOfflineSync.getState().refresh()
        } catch { /* ignore */ }
        return
      }
      if (ev?.type === 'device-unbind') {
        try {
          const unboundId = String(ev.deviceId || '')
          const { getTradeDeviceIdSync } = await import('./tradeDevice')
          const mine = getTradeDeviceIdSync()
          if (unboundId && mine && unboundId === mine) {
            window.dispatchEvent(new CustomEvent('kakapo:device-revoked'))
          }
        } catch { /* ignore */ }
        return
      }
      // Канал уже записал SQLite — UI только читает базу
      if (ev?.type === 'sqlite-updated' || ev?.type === 'inbound-ready') {
        const scopes = Array.isArray(ev.scopes) ? ev.scopes : undefined
        window.setTimeout(() => {
          void import('./cashierUiGate').then(({ isCashierPaymentCritical }) => {
            if (isCashierPaymentCritical()) {
              window.setTimeout(() => {
                void import('./reloadFromSqlite').then(m => m.reloadStoresFromSqlite(scopes as any)).catch(() => {})
              }, 600)
              return
            }
            void import('./reloadFromSqlite').then(m => m.reloadStoresFromSqlite(scopes as any)).catch(() => {})
          }).catch(() => {
            void import('./reloadFromSqlite').then(m => m.reloadStoresFromSqlite(scopes as any)).catch(() => {})
          })
        }, 80)
      }
      if (ev?.type === 'inbound' || ev?.type === 'done') {
        try {
          const { useOfflineSync } = await import('./offlineSync')
          void useOfflineSync.getState().refresh()
        } catch { /* ignore */ }
      }
      if (ev?.type === 'start' || ev?.type === 'progress') {
        try {
          const { useOfflineSync } = await import('./offlineSync')
          if (ev.type === 'start') {
            useOfflineSync.setState({ syncing: true, lastError: null })
          }
          if (ev.type === 'progress' && ev.total != null) {
            useOfflineSync.setState({
              syncing: true,
              progress: { done: Number(ev.done) || 0, total: Number(ev.total) || 0 },
            })
          }
        } catch { /* ignore */ }
      }
      if (ev?.type === 'done' || ev?.type === 'error' || ev?.type === 'network') {
        try {
          const { useOfflineSync } = await import('./offlineSync')
          useOfflineSync.setState({
            syncing: false,
            progress: { done: 0, total: 0 },
            lastSyncAtIso: ev?.type === 'done' ? new Date().toISOString() : useOfflineSync.getState().lastSyncAtIso,
            lastError: ev?.type === 'done' ? null : String(ev?.error || useOfflineSync.getState().lastError || ''),
            online: ev?.type === 'network' ? false : true,
          })
          void useOfflineSync.getState().refresh()
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  })
}
