'use client'

import { useCallback, useEffect, useState } from 'react'

const PAGE_KEY = 'p'

export type NavParams = Record<string, string | number | boolean | null | undefined>

function currentPath(): string {
  if (typeof window === 'undefined') return '/trade/'
  return window.location.pathname || '/trade/'
}

function buildQuery(defaultPage: string, page: string, params: NavParams): string {
  const sp = new URLSearchParams()
  if (page && page !== defaultPage) sp.set(PAGE_KEY, page)
  for (const [k, v] of Object.entries(params)) {
    if (k === PAGE_KEY) continue
    if (v != null && v !== '') sp.set(k, String(v))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

function readFromLocation(defaultPage: string): { page: string; params: Record<string, string> } {
  if (typeof window === 'undefined') return { page: defaultPage, params: {} }
  const sp = new URLSearchParams(window.location.search)
  const page = sp.get(PAGE_KEY) || defaultPage
  const params: Record<string, string> = {}
  sp.forEach((v, k) => {
    if (k !== PAGE_KEY) params[k] = v
  })
  return { page, params }
}

function paramsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every(k => a[k] === b[k])
}

function historyDepth(): number {
  const st = typeof window !== 'undefined' ? window.history.state : null
  if (st && typeof st === 'object' && Number.isFinite(Number(st.kakapoDepth))) {
    return Number(st.kakapoDepth)
  }
  return 0
}

/** Синхронизация с URL (?p=...). pushState — системная «назад» возвращает раздел. Без Next router (APK белый экран). */
export function useAppNavigation(defaultPage: string) {
  const [page, setPageState] = useState(() => {
    if (typeof window !== 'undefined') return readFromLocation(defaultPage).page
    return defaultPage
  })
  const [params, setParamsState] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') return readFromLocation(defaultPage).params
    return {}
  })

  useEffect(() => {
    const apply = () => {
      const next = readFromLocation(defaultPage)
      setPageState(prev => (prev === next.page ? prev : next.page))
      setParamsState(prev => (paramsEqual(prev, next.params) ? prev : next.params))
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [defaultPage])

  const navigate = useCallback((nextPage: string, nextParams: NavParams = {}, opts?: { replace?: boolean }) => {
    const nextParamsRecord: Record<string, string> = {}
    for (const [k, v] of Object.entries(nextParams)) {
      if (k !== PAGE_KEY && v != null && v !== '') nextParamsRecord[k] = String(v)
    }

    setPageState(nextPage)
    setParamsState(nextParamsRecord)

    if (typeof window === 'undefined') return
    const qs = buildQuery(defaultPage, nextPage, nextParams)
    const url = `${currentPath()}${qs}`
    const here = `${window.location.pathname}${window.location.search}`
    if (here === url) return

    const depth = historyDepth()
    const state = { kakapoDepth: opts?.replace ? depth : depth + 1 }
    if (opts?.replace) window.history.replaceState(state, '', url)
    else window.history.pushState(state, '', url)
    window.scrollTo(0, 0)
  }, [defaultPage])

  const setPage = useCallback((nextPage: string) => {
    navigate(nextPage)
  }, [navigate])

  return { page, params, navigate, go: navigate, setPage }
}

const SESSION_PREFIX = 'kp_nav_'

export function readSessionFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  try { return sessionStorage.getItem(`${SESSION_PREFIX}${key}`) === '1' } catch { return false }
}

export function writeSessionFlag(key: string, on: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (on) sessionStorage.setItem(`${SESSION_PREFIX}${key}`, '1')
    else sessionStorage.removeItem(`${SESSION_PREFIX}${key}`)
  } catch { /* quota */ }
}
