/**
 * Доп. inbound для Android / in-process канала:
 * vault, layers, expiry, loyalty — как старый softSync*.
 */
import { api } from './api'
import { cacheData, readCachedData } from './offline'

export async function pullChannelExtrasInProcess(opts?: {
  expiryDays?: number
  skipLayers?: boolean
  skipVault?: boolean
}): Promise<string[]> {
  const scopes: string[] = []
  const days = Math.max(1, Math.min(90, Number(opts?.expiryDays) || 14))

  if (!opts?.skipVault) {
    try {
      const vault = await api.getCashVault()
      if (vault) {
        const snap = (await readCachedData<Record<string, unknown>>('pos_snapshot')) || {}
        const next = { ...snap, cashVault: vault }
        await cacheData('pos_snapshot', next)
        const desk = (await import('./desktopBridge')).getKakapoDesktop()
        if (desk?.localDbKvSet) {
          try { await desk.localDbKvSet('pos_snapshot', next) } catch { /* ignore */ }
        }
        scopes.push('pos')
      }
    } catch { /* ignore */ }
  }

  try {
    const expiry = await api.getStockExpiry(days)
    if (Array.isArray(expiry)) {
      const snap = (await readCachedData<Record<string, unknown>>('pos_snapshot')) || {}
      const next = { ...snap, expiry }
      await cacheData('pos_snapshot', next)
      scopes.push('pos')
    }
  } catch { /* ignore */ }

  if (!opts?.skipLayers) {
    try {
      const { USE_API } = await import('./config')
      if (USE_API) {
        const { isOnline, pendingBlocksStockLayerPull } = await import('./offline')
        if (isOnline() && !(await pendingBlocksStockLayerPull())) {
          const remote = (await api.getAllStockLayers()) || []
          const { cacheStockLayersAndSyncCatalog } = await import('./stockLayersLocal')
          await cacheStockLayersAndSyncCatalog(remote)
          scopes.push('stockLayers', 'products')
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const { bootstrapLoyaltyConfigFromServer } = await import('./loyaltyStatusConfig')
    await bootstrapLoyaltyConfigFromServer()
    scopes.push('loyalty')
  } catch { /* ignore */ }

  return [...new Set(scopes)]
}
