'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const PAGE_KEY = 'p'

export type NavParams = Record<string, string | number | boolean | null | undefined>

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

/** Синхронизация внутренней страницы с URL (?p=...) — после F5 остаётесь на том же экране */
export function useAppNavigation(defaultPage: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const page = searchParams.get(PAGE_KEY) || defaultPage

  const params = useMemo(() => {
    const out: Record<string, string> = {}
    searchParams.forEach((v, k) => {
      if (k !== PAGE_KEY) out[k] = v
    })
    return out
  }, [searchParams])

  const navigate = useCallback((nextPage: string, nextParams: NavParams = {}) => {
    const qs = buildQuery(defaultPage, nextPage, nextParams)
    router.replace(`${pathname}${qs}`, { scroll: false })
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }, [router, pathname, defaultPage])

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
