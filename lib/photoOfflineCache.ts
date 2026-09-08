'use client'
/**
 * Офлайн-кэш фото товаров.
 * Слои (по приоритету чтения):
 *  1) memory object URL
 *  2) Desktop: файлы в userData/photos (переживают clearCache и выключение ПК)
 *  3) Android: бинарные файлы + native HTTP
 *  4) IndexedDB ArrayBuffer (браузер / запас)
 *
 * Каталог хранит только URL — без байтов картинки после cold start офлайн не откроются.
 */
import { useSyncExternalStore } from 'react'
import { getApiUrl, USE_API } from './config'
import { getKakapoDesktop } from './desktopBridge'
import { androidPersist } from './androidPersist'
import type { Product } from './types'

const DB_NAME = 'kakapo_photo_cache'
const DB_VERSION = 2
const STORE = 'blobs'

type PhotoRow = {
  url: string
  /** Предпочтительно — переживает перезапуск Chromium лучше, чем Blob */
  buffer?: ArrayBuffer
  mime?: string
  /** Legacy v1 */
  blob?: Blob
  at: number
}

const objectUrls = new Map<string, string>()
/** URL уже есть на диске/IDB — не качать снова в этой сессии */
const knownCached = new Set<string>()
const inflight = new Map<string, Promise<boolean>>()
let version = 0
const listeners = new Set<() => void>()
let prefetchTimer: ReturnType<typeof setTimeout> | null = null
let prefetchGen = 0
let lastFullPrefetchAt = 0

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

function rowToBlob(row: PhotoRow | undefined): Blob | undefined {
  if (!row) return undefined
  if (row.buffer && row.buffer.byteLength >= 32) {
    return new Blob([row.buffer], { type: row.mime || 'image/webp' })
  }
  if (row.blob && row.blob.size >= 32) return row.blob
  return undefined
}

function b64ToBlob(base64: string, mime?: string): Blob | undefined {
  try {
    const bin = atob(base64)
    const len = bin.length
    if (len < 32) return undefined
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime || 'image/webp' })
  } catch {
    return undefined
  }
}

async function blobToB64(blob: Blob): Promise<{ base64: string; mime: string; buffer: ArrayBuffer }> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    s += String.fromCharCode.apply(null, slice as unknown as number[])
  }
  return {
    base64: btoa(s),
    mime: blob.type || 'image/webp',
    buffer,
  }
}

function androidPhotoKey(url: string): string {
  // короткий стабильный ключ под имя файла
  let h = 0
  const s = String(url)
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `photo_${(h >>> 0).toString(16)}`
}

type AndroidPhotoBridge = {
  photoGet?: (key: string) => string
  photoPut?: (key: string, base64: string, mime: string) => boolean
  httpGetBase64?: (url: string) => string
  spillSlice?: (id: string, off: number, n: number) => string
}

function androidPhotoBridge(): AndroidPhotoBridge | null {
  if (typeof window === 'undefined') return null
  try {
    const b = (window as Window & { KakapoAndroid?: AndroidPhotoBridge }).KakapoAndroid
    if (!b) return null
    return b
  } catch {
    return null
  }
}

async function resolveAndroidSpill(raw: string, bridge: AndroidPhotoBridge): Promise<string> {
  if (!raw || raw === 'null') return ''
  try {
    const parsed = JSON.parse(raw) as { __kakapoSpill?: string; len?: number }
    if (!parsed?.__kakapoSpill || typeof bridge.spillSlice !== 'function') return raw
    const len = Number(parsed.len) || 0
    let s = ''
    const CHUNK = 80000
    for (let i = 0; i < len; i += CHUNK) {
      s += bridge.spillSlice(parsed.__kakapoSpill, i, CHUNK) || ''
    }
    return s
  } catch {
    return raw
  }
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
  knownCached.add(remote)
  bump()
  return obj
}

/** Синхронно: уже разогретый object URL */
export function peekOfflinePhotoUrl(remoteOrPath?: string | null): string | undefined {
  const abs = absolutePhotoUrl(remoteOrPath)
  if (!abs) return undefined
  return objectUrls.get(abs)
}

async function loadFromDesktop(remote: string): Promise<Blob | undefined> {
  const desk = getKakapoDesktop()
  if (!desk?.photoCacheGet) return undefined
  try {
    const row = await desk.photoCacheGet(remote)
    if (!row?.base64) return undefined
    return b64ToBlob(row.base64, row.mime)
  } catch {
    return undefined
  }
}

async function loadFromAndroid(remote: string): Promise<Blob | undefined> {
  const bridge = androidPhotoBridge()
  if (bridge?.photoGet) {
    try {
      const raw0 = bridge.photoGet(androidPhotoKey(remote))
      const raw = await resolveAndroidSpill(raw0, bridge)
      if (raw && raw !== 'null' && raw.length > 40) {
        const nl = raw.indexOf('\n')
        if (nl > 0 && nl < 80) {
          const mime = raw.slice(0, nl)
          const b64 = raw.slice(nl + 1)
          const blob = b64ToBlob(b64, mime)
          if (blob) return blob
        }
        const blob = b64ToBlob(raw)
        if (blob) return blob
      }
    } catch { /* ignore */ }
  }
  // запас: JSON в androidPersist
  const ap = androidPersist()
  if (!ap) return undefined
  try {
    const row = await ap.kvGet(androidPhotoKey(remote)) as { mime?: string; b64?: string } | null
    if (row?.b64) return b64ToBlob(row.b64, row.mime)
  } catch { /* ignore */ }
  return undefined
}

async function loadFromIdb(remote: string): Promise<Blob | undefined> {
  if (!hasIdb()) return undefined
  try {
    return rowToBlob(await idbGet(remote))
  } catch {
    return undefined
  }
}

async function persistEverywhere(remote: string, blob: Blob): Promise<void> {
  let packed: { base64: string; mime: string; buffer: ArrayBuffer } | null = null
  try {
    packed = await blobToB64(blob)
  } catch { /* ignore */ }

  if (packed && hasIdb()) {
    try {
      await idbPut({
        url: remote,
        buffer: packed.buffer,
        mime: packed.mime,
        at: Date.now(),
      })
    } catch { /* quota */ }
  }

  if (packed) {
    const desk = getKakapoDesktop()
    if (desk?.photoCachePut) {
      try { await desk.photoCachePut(remote, packed.base64, packed.mime) } catch { /* ignore */ }
    }
    const bridge = androidPhotoBridge()
    if (bridge?.photoPut) {
      try { bridge.photoPut(androidPhotoKey(remote), packed.base64, packed.mime) } catch { /* ignore */ }
    } else {
      const ap = androidPersist()
      if (ap && packed.base64.length < 120_000) {
        try {
          await ap.kvSet(androidPhotoKey(remote), { url: remote, mime: packed.mime, b64: packed.base64 })
        } catch { /* ignore */ }
      }
    }
  }
}

async function ensureObjectUrl(remote: string): Promise<string | undefined> {
  const hit = objectUrls.get(remote)
  if (hit) return hit

  const fromDesk = await loadFromDesktop(remote)
  if (fromDesk) return rememberObjectUrl(remote, fromDesk)

  const fromAnd = await loadFromAndroid(remote)
  if (fromAnd) return rememberObjectUrl(remote, fromAnd)

  const fromIdb = await loadFromIdb(remote)
  if (fromIdb) {
    // поднимем на диск ПК, если ещё не было
    void persistEverywhere(remote, fromIdb)
    return rememberObjectUrl(remote, fromIdb)
  }
  return undefined
}

async function fetchViaDesktop(remote: string): Promise<Blob | undefined> {
  const desk = getKakapoDesktop()
  if (!desk?.photoFetchAndCache) return undefined
  try {
    const res = await desk.photoFetchAndCache(remote)
    if (!res?.ok || !res.base64) return undefined
    return b64ToBlob(res.base64, res.mime)
  } catch {
    return undefined
  }
}

async function fetchViaAndroidNative(remote: string): Promise<Blob | undefined> {
  const bridge = androidPhotoBridge()
  if (!bridge?.httpGetBase64) return undefined
  try {
    const raw0 = bridge.httpGetBase64(remote)
    const raw = await resolveAndroidSpill(raw0, bridge)
    if (!raw || raw === 'null' || raw.length < 40) return undefined
    const nl = raw.indexOf('\n')
    if (nl > 0 && nl < 80) {
      return b64ToBlob(raw.slice(nl + 1), raw.slice(0, nl)) || undefined
    }
    return b64ToBlob(raw) || undefined
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

      // Desktop: Electron net — без CORS и сразу на диск
      let blob = await fetchViaDesktop(remote)
      if (!blob) blob = await fetchViaAndroidNative(remote)
      if (!blob) {
        try {
          const res = await fetch(remote, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
          if (!res.ok) return false
          blob = await res.blob()
        } catch {
          return false
        }
      }
      if (!blob || blob.size < 32) return false
      await persistEverywhere(remote, blob)
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
    const raw = p.photoThumb || p.photo
    const abs = absolutePhotoUrl(raw)
    if (!abs || seen.has(abs)) continue
    seen.add(abs)
    out.push(abs)
  }
  return out
}

/** Разогрев object URL из durable-хранилищ (холодный старт офлайн) */
export async function warmOfflinePhotoCache(
  products?: Array<{ photo?: string | null; photoThumb?: string | null }>,
): Promise<void> {
  if (!USE_API || typeof window === 'undefined') return
  try {
    const urls = products?.length
      ? collectProductPhotoUrls(products)
      : await idbGetAllUrls().catch(() => [] as string[])
    const chunk = 16
    for (let i = 0; i < urls.length; i += chunk) {
      const slice = urls.slice(i, i + chunk)
      await Promise.allSettled(slice.map(u => ensureObjectUrl(u)))
      if (i + chunk < urls.length) {
        await new Promise(r => window.setTimeout(r, 0))
      }
    }
  } catch { /* ignore */ }
}

/**
 * Подтянуть одно фото в фоне (если UI уже нарисовался офлайн без peek).
 * Не блокирует resolvePhotoUrl.
 */
export function requestOfflinePhoto(remoteOrPath?: string | null): void {
  const abs = absolutePhotoUrl(remoteOrPath)
  if (!abs || objectUrls.has(abs)) return
  void ensureObjectUrl(abs).then(url => {
    if (!url && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      void fetchAndStore(abs)
    }
  })
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
 * Фоновая закачка миниатюр в durable-кэш.
 * Только недостающие URL; полный каталог — редко и с паузой.
 */
export function prefetchProductPhotos(
  products: Array<{ photo?: string | null; photoThumb?: string | null }>,
): void {
  if (!USE_API || typeof window === 'undefined') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    void warmOfflinePhotoCache(products)
    return
  }
  const urls = collectProductPhotoUrls(products)
  if (!urls.length) return

  const missingProbe = urls.filter(u => !objectUrls.has(u) && !knownCached.has(u))
  if (!missingProbe.length) return

  // Полный проход каталога (>20) — не чаще раза в 2 минуты
  if (urls.length > 20 && Date.now() - lastFullPrefetchAt < 120_000) {
    // Точечные (1–3) всё равно пропускаем
    if (urls.length > 3) return
  }

  if (prefetchTimer) clearTimeout(prefetchTimer)
  const gen = ++prefetchGen
  const delay = urls.length <= 3 ? 80 : 1200
  prefetchTimer = setTimeout(() => {
    void (async () => {
      if (urls.length > 3) lastFullPrefetchAt = Date.now()
      await warmOfflinePhotoCache(products)
      const missing = urls.filter(u => !objectUrls.has(u) && !knownCached.has(u))
      if (!missing.length || gen !== prefetchGen) return
      await runPool(missing, urls.length <= 3 ? 2 : 2, gen)
    })()
  }, delay)
}

export function schedulePhotoPrefetchFromProducts(products: Product[]): void {
  prefetchProductPhotos(products)
}
