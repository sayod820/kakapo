'use client'
/**
 * Офлайн-кэш фото товаров: байты в IndexedDB, в UI — object URL.
 * Каталог хранит только URL; без этого кэша после перезагрузки ПК офлайн
 * картинки не открываются.
 */
import { useSyncExternalStore } from 'react'
import { getApiUrl, USE_API } from './config'
import type { Product } from './types'

const DB_NAME = 'kakapo_photo_cache'
const DB_VERSION = 1
const STORE = 'blobs'

type PhotoRow = {
  url: string
  blob: Blob
  at: number
}

const objectUrls = new Map<string, string>()
const inflight = new Map<string, Promise<boolean>>()
let version = 0
const listeners = new Set<() => void>()
let prefetchTimer: ReturnType<typeof setTimeout> | null = null
let prefetchGen = 0

function bump() {
  version += 1
  listeners.forEach(fn => {
    try { fn() } catch { /* ignore */ }
  })
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  return () => { listeners.delete(onStoreChange) }
}

/** Подписка UI на появление локальных фото после prefetch / warm */
export function useOfflinePhotoCacheVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

function hasIdb() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!hasIdb()) return Promise.reject(new Error('no idb'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

function idbGet(url: string): Promise<PhotoRow | undefined> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(url)
    req.onsuccess = () => resolve(req.result as PhotoRow | undefined)
    req.onerror = () => reject(req.error)
  }))
}

function idbPut(row: PhotoRow): Promise<void> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(row)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

function idbGetAllUrls(): Promise<string[]> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
    req.onerror = () => reject(req.error)
  }))
}

/** Абсолютный http(s) URL фото (ключ кэша) */
export function absolutePhotoUrl(value?: string | null): string | undefined {
  const url = String(value || '').trim()
  if (!url) return undefined
  if (/^data:/i.test(url) || /^blob:/i.test(url)) return undefined
  if (/^https?:\/\//i.test(url)) return url
  const api = getApiUrl().replace(/\/$/, '')
  if (url.startsWith('/api/kakapo/')) {
    if (api.startsWith('http')) {
      const path = url.replace(/^\/api\/kakapo/i, '')
      return `${api}${path.startsWith('/') ? path : `/${path}`}`
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${url}`
    }
    return undefined
  }
  if (url.startsWith('/uploads/')) {
    if (api.startsWith('http')) return `${api}${url}`
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${url}`
    }
  }
  if (url.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${url}`
  }
  return undefined
}

function rememberObjectUrl(remote: string, blob: Blob): string {
  const prev = objectUrls.get(remote)
  if (prev) {
    try { URL.revokeObjectURL(prev) } catch { /* ignore */ }
  }
  const obj = URL.createObjectURL(blob)
  objectUrls.set(remote, obj)
  bump()
  return obj
}

/** Синхронно: уже разогретый object URL */
export function peekOfflinePhotoUrl(remoteOrPath?: string | null): string | undefined {
  const abs = absolutePhotoUrl(remoteOrPath)
  if (!abs) return undefined
  return objectUrls.get(abs)
}

async function ensureObjectUrl(remote: string): Promise<string | undefined> {
  const hit = objectUrls.get(remote)
  if (hit) return hit
  try {
    const row = await idbGet(remote)
    if (!row?.blob) return undefined
    return rememberObjectUrl(remote, row.blob)
  } catch {
    return undefined
  }
}

async function fetchAndStore(remote: string): Promise<boolean> {
  if (!USE_API || typeof window === 'undefined') return false
  if (objectUrls.has(remote)) return true
  const existing = inflight.get(remote)
  if (existing) return existing

  const job = (async () => {
    try {
      const cached = await ensureObjectUrl(remote)
      if (cached) return true
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      const res = await fetch(remote, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
      if (!res.ok) return false
      const blob = await res.blob()
      if (!blob || blob.size < 32) return false
      try {
        await idbPut({ url: remote, blob, at: Date.now() })
      } catch { /* quota — всё равно держим в памяти сессии */ }
      rememberObjectUrl(remote, blob)
      return true
    } catch {
      return false
    } finally {
      inflight.delete(remote)
    }
  })()

  inflight.set(remote, job)
  return job
}

function collectProductPhotoUrls(products: Array<{ photo?: string | null; photoThumb?: string | null }>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of products || []) {
    // Миниатюра приоритетнее — меньше трафика и места
    const raw = p.photoThumb || p.photo
    const abs = absolutePhotoUrl(raw)
    if (!abs || seen.has(abs)) continue
    seen.add(abs)
    out.push(abs)
  }
  return out
}

/** Разогрев object URL из IndexedDB (холодный старт офлайн) */
export async function warmOfflinePhotoCache(
  products?: Array<{ photo?: string | null; photoThumb?: string | null }>,
): Promise<void> {
  if (!USE_API || !hasIdb()) return
  try {
    const urls = products?.length
      ? collectProductPhotoUrls(products)
      : await idbGetAllUrls().catch(() => [] as string[])
    const chunk = 24
    for (let i = 0; i < urls.length; i += chunk) {
      const slice = urls.slice(i, i + chunk)
      await Promise.allSettled(slice.map(u => ensureObjectUrl(u)))
      if (i + chunk < urls.length) {
        await new Promise(r => window.setTimeout(r, 0))
      }
    }
  } catch { /* ignore */ }
}

async function runPool(urls: string[], concurrency: number, gen: number) {
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length && gen === prefetchGen) {
      const url = urls[i++]
      await fetchAndStore(url)
    }
  })
  await Promise.allSettled(workers)
}

/**
 * Фоновая закачка миниатюр в IndexedDB.
 * Вызывать после cacheProducts / успешного fetchProducts.
 */
export function prefetchProductPhotos(
  products: Array<{ photo?: string | null; photoThumb?: string | null }>,
): void {
  if (!USE_API || typeof window === 'undefined' || !hasIdb()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    void warmOfflinePhotoCache(products)
    return
  }
  const urls = collectProductPhotoUrls(products)
  if (!urls.length) return

  if (prefetchTimer) clearTimeout(prefetchTimer)
  const gen = ++prefetchGen
  prefetchTimer = setTimeout(() => {
    void (async () => {
      // Сначала поднять уже сохранённые — касса сразу видит фото офлайн
      await warmOfflinePhotoCache(products)
      const missing = urls.filter(u => !objectUrls.has(u))
      if (!missing.length || gen !== prefetchGen) return
      await runPool(missing, 3, gen)
    })()
  }, 400)
}

export function schedulePhotoPrefetchFromProducts(products: Product[]): void {
  prefetchProductPhotos(products)
}
