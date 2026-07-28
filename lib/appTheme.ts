'use client'

import { useCallback, useEffect, useState } from 'react'

export type AppTheme = 'dark' | 'light'

/** Общий ключ темы для всех приложений КАКАПО */
export const APP_THEME_KEY = 'kakapo_ui_theme'
/** Старый ключ Trade/POS — синхронизируем */
export const TRADE_THEME_KEY = 'kakapo_trade_pos_theme'

export const THEME_BG = {
  dark: '#030B05',
  light: '#F3F7F4',
} as const

export function loadAppTheme(): AppTheme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const v = localStorage.getItem(APP_THEME_KEY)
    if (v === 'light' || v === 'dark') return v
    const trade = localStorage.getItem(TRADE_THEME_KEY)
    if (trade === 'light' || trade === 'dark') return trade
  } catch { /* private mode */ }
  return 'dark'
}

export function saveAppTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(APP_THEME_KEY, theme)
    localStorage.setItem(TRADE_THEME_KEY, theme)
  } catch { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent('kakapo-theme', { detail: theme }))
  } catch { /* ignore */ }
}

export function applyDocumentTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  const bg = THEME_BG[theme]
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.background = bg
  document.body.style.background = bg
  document.body.style.color = theme === 'light' ? '#0C1A10' : '#EBF5ED'
}

/** Только тёмная тема на экране (без записи в localStorage) — клиент / курьер / сборщик / ресторан */
export function useForcedDarkTheme() {
  useEffect(() => {
    applyDocumentTheme('dark')
  }, [])
}

export function useAppTheme() {
  const [theme, setThemeState] = useState<AppTheme>(() => loadAppTheme())

  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== APP_THEME_KEY && e.key !== TRADE_THEME_KEY) return
      if (e.newValue === 'light' || e.newValue === 'dark') setThemeState(e.newValue)
    }
    const onLocal = (e: Event) => {
      const t = (e as CustomEvent).detail
      if (t === 'light' || t === 'dark') setThemeState(t)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('kakapo-theme', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('kakapo-theme', onLocal)
    }
  }, [])

  const setTheme = useCallback((next: AppTheme) => {
    saveAppTheme(next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [theme, setTheme])

  return { theme, setTheme, toggleTheme }
}
