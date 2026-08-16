import { getKakapoDesktop, isKakapoDesktop, type KakapoDesktopApi } from './desktopBridge'
import { getAndroidLocalDbApi } from './androidQueueFile'

/** SQLite кассы: ПК (Electron) или Android (нативный файл). */
export function getLocalDb(): KakapoDesktopApi | null {
  if (typeof window === 'undefined') return null
  if (isKakapoDesktop()) {
    const d = getKakapoDesktop()
    if (d?.localDbKvGet && d?.localDbKvSet) return d
  }
  return getAndroidLocalDbApi()
}
