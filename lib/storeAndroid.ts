/** Детект Android APK клиентского магазина (Capacitor). */

const STORE_UA = /KakapoStoreAndroid/i

export function isStoreAndroidNative(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const w = window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
      kakapoStoreAndroid?: boolean
    }
    if (w.kakapoStoreAndroid === true) return true
    if (STORE_UA.test(navigator.userAgent || '')) return true
    if (w.Capacitor?.isNativePlatform?.()) {
      const platform = String(w.Capacitor.getPlatform?.() || '').toLowerCase()
      if (platform === 'android' || platform === 'ios') {
        // Не путать с кассой: касса ставит kakapoAndroid / KakapoTradeAndroid
        const trade = /KakapoTradeAndroid/i.test(navigator.userAgent || '')
          || !!(window as Window & { kakapoAndroid?: boolean }).kakapoAndroid
        if (!trade) return true
      }
    }
  } catch { /* ignore */ }
  return false
}
