/** Детект Android / Capacitor WebView для Trade (без оборудования чеков). */

const ANDROID_UA = /Android/i
const KAKAPO_ANDROID_UA = /KakapoTradeAndroid/i

export function isTradeAndroid(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const w = window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
      kakapoAndroid?: boolean
    }
    if (w.kakapoAndroid === true) return true
    if (w.Capacitor?.isNativePlatform?.()) {
      const platform = String(w.Capacitor.getPlatform?.() || '').toLowerCase()
      if (platform === 'android' || !platform) return true
    }
    const ua = navigator.userAgent || ''
    if (KAKAPO_ANDROID_UA.test(ua)) return true
    if (ANDROID_UA.test(ua)) return true
  } catch {
    /* ignore */
  }
  return false
}

/** На телефоне нет USB-принтера / весов / шаблона чека */
export function hideTradeHardwareUi(): boolean {
  return isTradeAndroid()
}
