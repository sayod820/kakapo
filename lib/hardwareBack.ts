'use client'

import { useEffect } from 'react'

/**
 * Системная кнопка/жест «назад» Android — не отдельная кнопка в интерфейсе.
 * Стек обработчиков: модалка → деталь → история разделов → свернуть приложение.
 */

type BackHandler = () => boolean

const stack: BackHandler[] = []

export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler)
  return () => {
    const i = stack.lastIndexOf(handler)
    if (i >= 0) stack.splice(i, 1)
  }
}

function tryDomClose(): boolean {
  if (typeof document === 'undefined') return false
  const overlay = document.querySelector('.k-side-overlay.open') as HTMLElement | null
  if (overlay) {
    overlay.click()
    return true
  }
  const back = document.querySelector('.k-top-back') as HTMLElement | null
  if (back) {
    back.click()
    return true
  }
  const closeBtn = document.querySelector(
    '.k-modal [data-close], .k-modal-close, button[aria-label="Закрыть"]',
  ) as HTMLElement | null
  if (closeBtn) {
    closeBtn.click()
    return true
  }
  return false
}

function canGoHistoryBack(): boolean {
  if (typeof window === 'undefined') return false
  const st = window.history.state
  if (st && typeof st === 'object' && Number(st.kakapoDepth || 0) > 0) return true
  return window.history.length > 1
}

export function handleHardwareBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true
    } catch { /* next */ }
  }
  if (tryDomClose()) return true
  if (canGoHistoryBack()) {
    window.history.back()
    return true
  }
  return false
}

function capacitorApp(): {
  addListener?: (ev: string, cb: () => void) => { remove?: () => void }
  minimizeApp?: () => void
  exitApp?: () => void
} | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { Capacitor?: { Plugins?: { App?: any }; isNativePlatform?: () => boolean } }
  return w.Capacitor?.Plugins?.App || null
}

let installed = false

export function installHardwareBack(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true
  ;(window as Window & { __kakapoHandleBack?: () => boolean }).__kakapoHandleBack = handleHardwareBack

  const App = capacitorApp()
  if (App?.addListener) {
    App.addListener('backButton', () => {
      if (handleHardwareBack()) return
      if (App.minimizeApp) App.minimizeApp()
      else App.exitApp?.()
    })
  }

  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (handleHardwareBack()) e.preventDefault()
  })
}

/** Пока экран/модалка открыта — системная «назад» закрывает её. */
export function useBackClose(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => {
      close()
      return true
    })
  }, [active, close])
}
