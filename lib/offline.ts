// ════════════════════════════════════════════════
// KAKAPO — офлайн-режим кассы
// Локальный кэш каталога + очередь чеков + синхронизация
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import type { Product } from './types'
import type { AdminClient } from './clientCrm'

export type PosSalePayload = Parameters<typeof api.createPosSale>[0]

export interface PendingSale {
  clientRef: string
  payload: PosSalePayload
  createdAtIso: string
  attempts: number
  lastError?: string
  /** true — сервер отклонил чек (не сетевая ошибка), нужен разбор кассиром */
  failed?: boolean
}

// ── Хранилище (IndexedDB с фолбэком на localStorage) ──
const DB_NAME = 'kakapo_offline'
const DB_VERSION = 1
const STORE_KV = 'kv'
const STORE_QUEUE = 'queue'

const KEY_PRODUCTS = 'catalog_products'
const KEY_CLIENTS = 'catalog_clients'
const LS_PREFIX = 'kakapo_offline_'

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV)
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'clientRef' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function idbRun<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }))
}

// ── KV: кэш каталога ──
async function kvSet(key: string, value: unknown): Promise<void> {
  if (hasIndexedDB()) {
    try { await idbRun(STORE_KV, 'readwrite', s => s.put(value as unknown as Record<string, unknown>, key)); return } catch { /* fallback */ }
  }
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch { /* quota */ }
}

async function kvGet<T>(key: string): Promise<T | null> {
  if (hasIndexedDB()) {
    try {
      const v = await idbRun<T | undefined>(STORE_KV, 'readonly', s => s.get(key))
      if (v !== undefined && v !== null) return v as T
    } catch { /* fallback */ }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

export function cacheProducts(products: Product[]): Promise<void> {
  return kvSet(KEY_PRODUCTS, products)
}
export function readCachedProducts(): Promise<Product[] | null> {
  return kvGet<Product[]>(KEY_PRODUCTS)
}
export function cacheClients(clients: AdminClient[]): Promise<void> {
  return kvSet(KEY_CLIENTS, clients)
}
export function readCachedClients(): Promise<AdminClient[] | null> {
  return kvGet<AdminClient[]>(KEY_CLIENTS)
}

// ── Очередь чеков ──
function lsQueueRead(): PendingSale[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX + STORE_QUEUE)
    return raw ? (JSON.parse(raw) as PendingSale[]) : []
  } catch { return [] }
}
function lsQueueWrite(list: PendingSale[]) {
  try { localStorage.setItem(LS_PREFIX + STORE_QUEUE, JSON.stringify(list)) } catch { /* quota */ }
}

export async function getPending(): Promise<PendingSale[]> {
  if (hasIndexedDB()) {
    try {
      const all = await idbRun<PendingSale[]>(STORE_QUEUE, 'readonly', s => s.getAll())
      return (all || []).sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
    } catch { /* fallback */ }
  }
  return lsQueueRead().sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
}

async function putPending(row: PendingSale): Promise<void> {
  if (hasIndexedDB()) {
    try { await idbRun(STORE_QUEUE, 'readwrite', s => s.put(row)); return } catch { /* fallback */ }
  }
  const list = lsQueueRead().filter(r => r.clientRef !== row.clientRef)
  list.push(row)
  lsQueueWrite(list)
}

async function deletePending(clientRef: string): Promise<void> {
  if (hasIndexedDB()) {
    try { await idbRun(STORE_QUEUE, 'readwrite', s => s.delete(clientRef)); return } catch { /* fallback */ }
  }
  lsQueueWrite(lsQueueRead().filter(r => r.clientRef !== clientRef))
}

export function newClientRef(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Кладёт чек в локальную очередь на отправку */
export async function enqueueSale(payload: PosSalePayload): Promise<PendingSale> {
  const clientRef = payload.clientRef || newClientRef()
  const row: PendingSale = {
    clientRef,
    payload: { ...payload, clientRef, createdAtIso: payload.createdAtIso || new Date().toISOString() },
    createdAtIso: payload.createdAtIso || new Date().toISOString(),
    attempts: 0,
  }
  await putPending(row)
  return row
}

// ── Онлайн-детект ──
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

export interface FlushResult {
  sent: number
  failed: number
  stopped: boolean
  remaining: number
}

let flushing = false

/**
 * Отправляет очередь чеков на сервер по порядку (старые первыми).
 * При сетевой ошибке останавливается (интернета нет — ждём).
 * При отказе сервера помечает чек failed и продолжает следующий.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, stopped: true, remaining: (await getPending()).length }
  flushing = true
  let sent = 0
  let failed = 0
  let stopped = false
  try {
    const queue = await getPending()
    for (const row of queue) {
      if (row.failed) continue
      try {
        await api.createPosSale(row.payload)
        await deletePending(row.clientRef)
        sent++
      } catch (e) {
        if (isNetworkError(e)) {
          stopped = true
          break
        }
        row.attempts += 1
        row.lastError = e instanceof Error ? e.message : 'Ошибка отправки'
        row.failed = true
        await putPending(row)
        failed++
      }
    }
  } finally {
    flushing = false
  }
  const remaining = (await getPending()).length
  return { sent, failed, stopped, remaining }
}
