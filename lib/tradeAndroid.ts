/** Детект Android / Capacitor WebView для Trade (без оборудования чеков). */

const ANDROID_UA = /Android/i
const KAKAPO_ANDROID_UA = /KakapoTradeAndroid/i

/** Нативное приложение Торговля (APK), не браузер Chrome на телефоне. */
export function hasKakapoAndroidBridge(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const b = (window as Window & { KakapoAndroid?: { kvGet?: unknown } }).KakapoAndroid
    return typeof b?.kvGet === 'function'
  } catch {
    return false
  }
}

export function isTradeAndroidNative(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const w = window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
      kakapoAndroid?: boolean
    }
    if (hasKakapoAndroidBridge()) return true
    if (w.kakapoAndroid === true) return true
    if (w.Capacitor?.isNativePlatform?.()) {
      const platform = String(w.Capacitor.getPlatform?.() || '').toLowerCase()
      if (platform === 'android' || platform === 'ios') return true
    }
    if (KAKAPO_ANDROID_UA.test(navigator.userAgent || '')) return true
  } catch { /* ignore */ }
  return false
}

export function isTradeAndroid(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (isTradeAndroidNative()) return true
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

/** Мобильный UI (телефон / узкий экран) — без автофокуса поиска и клавиатуры. */
export function isTradeMobileUi(): boolean {
  if (typeof window === 'undefined') return false
  if (isTradeAndroid()) return true
  try {
    if (window.matchMedia('(max-width: 900px)').matches) return true
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true
  } catch {
    /* ignore */
  }
  return false
}

/** На телефоне нет USB-принтера / весов / шаблона чека — не показываем настройки. */
export function hideTradeHardwareUi(): boolean {
  return isTradeAndroid()
}
