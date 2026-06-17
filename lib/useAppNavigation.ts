'use client'

import { useCallback, useEffect, useState } from 'react'
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

function readFromSearchParams(
  searchParams: URLSearchParams,
  defaultPage: string,
): { page: string; params: Record<string, string> } {
  const page = searchParams.get(PAGE_KEY) || defaultPage
  const params: Record<string, string> = {}
  searchParams.forEach((v, k) => {
    if (k !== PAGE_KEY) params[k] = v
  })
  return { page, params }
}

/** Синхронизация внутренней страницы с URL (?p=...) — после F5 остаётесь на том же экране */
export function useAppNavigation(defaultPage: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [page, setPageState] = useState(() => {
    if (typeof window !== 'undefined') return readFromLocation(defaultPage).page
    return defaultPage
  })
  const [params, setParamsState] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') return readFromLocation(defaultPage).params
    return {}
  })

  useEffect(() => {
    const fromUrl = readFromSearchParams(searchParams, defaultPage)
    const fromWindow = readFromLocation(defaultPage)
    // replaceState обновляет адрес сразу, searchParams в Next.js — с задержкой
    const windowQs = typeof window !== 'undefined' ? window.location.search : ''
    const urlQs = searchParams.toString()
    const next = windowQs !== urlQs && fromWindow.page !== fromUrl.page ? fromWindow : fromUrl
    setPageState(next.page)
    setParamsState(next.params)
  }, [searchParams, defaultPage])

  const navigate = useCallback((nextPage: string, nextParams: NavParams = {}) => {
    const nextParamsRecord: Record<string, string> = {}
    for (const [k, v] of Object.entries(nextParams)) {
      if (k !== PAGE_KEY && v != null && v !== '') nextParamsRecord[k] = String(v)
    }

    setPageState(nextPage)
    setParamsState(nextParamsRecord)

    const qs = buildQuery(defaultPage, nextPage, nextParams)
    const url = `${pathname}${qs}`

    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', url)
    }

    router.replace(url, { scroll: false })

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
