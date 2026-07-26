// ════════════════════════════════════════════════
// KAKAPO — офлайн-режим кассы
// Локальный кэш каталога + очередь чеков + синхронизация
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import type { Product } from './types'
import type { AdminClient } from './clientCrm'

export type PosSalePayload = Parameters<typeof api.createPosSale>[0]

/** Виды операций кассы, которые умеем откладывать до появления связи */
export type QueueKind =
  | 'sale'
  | 'shift_open'
  | 'shift_close'
  | 'sale_return'
  | 'card_topup'
  | 'debt_repay'
  | 'finance_move'

export const QUEUE_KIND_LABEL: Record<QueueKind, string> = {
  sale: 'Чек',
  shift_open: 'Открытие смены',
  shift_close: 'Закрытие смены',
  sale_return: 'Возврат',
  card_topup: 'Пополнение карты',
  debt_repay: 'Погашение долга',
  finance_move: 'Движение по кассе',
}

export interface PendingOp<P = any> {
  clientRef: string
  kind: QueueKind
  payload: P
  createdAtIso: string
  /** порядковый номер — гарантирует отправку строго в порядке создания */
  seq: number
  attempts: number
  lastError?: string
  /** true — сервер отклонил операцию (не сетевая ошибка), нужен разбор кассиром */
  failed?: boolean
  /**
   * Временный id, под которым операция уже показана в интерфейсе.
   * После отправки сопоставляется с настоящим id с сервера.
   */
  localId?: string
}

/** Старое название — чек в очереди */
export type PendingSale = PendingOp<PosSalePayload>

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

/** Универсальный кэш данных вкладок (клиенты, карты, POS-снимок и т.д.) */
export function cacheData<T>(key: string, data: T): Promise<void> {
  return kvSet(`data_${key}`, data)
}
export function readCachedData<T>(key: string): Promise<T | null> {
  return kvGet<T>(`data_${key}`)
}

// ── Очередь операций ──
const KEY_SEQ = 'queue_seq'
const KEY_IDMAP = 'queue_idmap'

function normalizeRow(row: any): PendingOp {
  return {
    clientRef: String(row?.clientRef || ''),
    kind: (row?.kind || 'sale') as QueueKind,
    payload: row?.payload,
    createdAtIso: String(row?.createdAtIso || new Date(0).toISOString()),
    seq: Number(row?.seq) || 0,
    attempts: Number(row?.attempts) || 0,
    lastError: row?.lastError,
    failed: !!row?.failed,
    localId: row?.localId,
  }
}

function byOrder(a: PendingOp, b: PendingOp) {
  const t = a.createdAtIso.localeCompare(b.createdAtIso)
  return t !== 0 ? t : a.seq - b.seq
}

function lsQueueRead(): PendingOp[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX + STORE_QUEUE)
    return raw ? (JSON.parse(raw) as PendingOp[]).map(normalizeRow) : []
  } catch { return [] }
}
function lsQueueWrite(list: PendingOp[]) {
  try { localStorage.setItem(LS_PREFIX + STORE_QUEUE, JSON.stringify(list)) } catch { /* quota */ }
}

export async function getPending(): Promise<PendingOp[]> {
  if (hasIndexedDB()) {
    try {
      const all = await idbRun<PendingOp[]>(STORE_QUEUE, 'readonly', s => s.getAll())
      return (all || []).map(normalizeRow).sort(byOrder)
    } catch { /* fallback */ }
  }
  return lsQueueRead().sort(byOrder)
}

async function putPending(row: PendingOp): Promise<void> {
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

/** Убирает операцию из очереди (кассир разобрал отклонённую запись) */
export async function dropPending(clientRef: string): Promise<void> {
  await deletePending(clientRef)
}

/** Повторить отклонённую операцию при следующей отправке */
export async function retryPending(clientRef: string): Promise<void> {
  const row = (await getPending()).find(r => r.clientRef === clientRef)
  if (!row) return
  row.failed = false
  row.lastError = ''
  await putPending(row)
}

export function newClientRef(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Временный id для записи, созданной без связи */
export function newLocalId(prefix: string): string {
  return `off-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function isLocalId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('off-')
}

let seqCounter = 0
async function nextSeq(): Promise<number> {
  if (!seqCounter) {
    const stored = await kvGet<number>(KEY_SEQ)
    const queued = await getPending()
    seqCounter = Math.max(Number(stored) || 0, ...queued.map(r => r.seq), 0)
  }
  seqCounter += 1
  void kvSet(KEY_SEQ, seqCounter)
  return seqCounter
}

/** Кладёт операцию в локальную очередь на отправку */
export async function enqueueOp<P>(
  kind: QueueKind,
  payload: P,
  opts: { clientRef?: string; localId?: string; createdAtIso?: string } = {},
): Promise<PendingOp<P>> {
  const clientRef = opts.clientRef || (payload as any)?.clientRef || newClientRef()
  const createdAtIso = opts.createdAtIso || (payload as any)?.createdAtIso || new Date().toISOString()
  const row: PendingOp<P> = {
    clientRef,
    kind,
    payload: { ...(payload as any), clientRef, createdAtIso },
    createdAtIso,
    seq: await nextSeq(),
    attempts: 0,
    localId: opts.localId,
  }
  await putPending(row as PendingOp)
  return row
}

/** Кладёт чек в локальную очередь на отправку */
export function enqueueSale(payload: PosSalePayload): Promise<PendingOp<PosSalePayload>> {
  return enqueueOp('sale', payload, { clientRef: payload.clientRef })
}

// ── Сопоставление временных id с настоящими ──
// Смена, открытая офлайн, получает временный id; чеки и движения кассы
// ссылаются на него. После отправки подменяем на id с сервера.
let idMap: Record<string, string> | null = null

async function getIdMap(): Promise<Record<string, string>> {
  if (!idMap) idMap = (await kvGet<Record<string, string>>(KEY_IDMAP)) || {}
  return idMap
}

async function rememberId(localId: string, serverId: string): Promise<void> {
  const map = await getIdMap()
  map[localId] = serverId
  idMap = map
  await kvSet(KEY_IDMAP, map)
}

/** Настоящий id для временного (или сам id, если он уже настоящий) */
export async function resolveLocalId(id: string | undefined | null): Promise<string> {
  if (!id) return ''
  if (!isLocalId(id)) return id
  const map = await getIdMap()
  return map[id] || ''
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

/** Ошибка «ссылка на операцию, которая не ушла» — дальше повторять бессмысленно */
class BrokenRefError extends Error {}

/**
 * Подставляет настоящие id вместо временных.
 * Если ссылка на локальную запись не разрешилась — предыдущая операция
 * не дошла до сервера, отправлять эту нельзя.
 */
async function resolveRefs(payload: any, fields: string[]): Promise<any> {
  const next = { ...(payload || {}) }
  for (const field of fields) {
    const value = next[field]
    if (!isLocalId(value)) continue
    const real = await resolveLocalId(value)
    if (!real) {
      throw new BrokenRefError('Связанная операция не отправлена — разберите её первой')
    }
    next[field] = real
  }
  return next
}

/** Отправка одной операции. Возвращает id созданной записи, если он есть. */
async function sendOp(row: PendingOp): Promise<string> {
  switch (row.kind) {
    case 'sale': {
      const payload = await resolveRefs(row.payload, ['shiftId'])
      const sale = await api.createPosSale(payload)
      return String((sale as any)?.id || '')
    }
    case 'shift_open': {
      const p = row.payload || {}
      const shift = await api.openPosShift({
        clientRef: p.clientRef,
        cashierId: p.cashierId,
        openingCash: Number(p.openingCash) || 0,
        note: p.note,
        posId: p.posId,
      } as any)
      return String((shift as any)?.id || '')
    }
    case 'shift_close': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const shift = await api.closePosShift(String(p.shiftId), {
        clientRef: p.clientRef,
        closingCash: Number(p.closingCash) || 0,
        note: p.note,
      } as any)
      return String((shift as any)?.id || '')
    }
    case 'sale_return': {
      const p = await resolveRefs(row.payload, ['saleId'])
      const sale = await api.returnPosSale(String(p.saleId), {
        clientRef: p.clientRef,
        note: p.note,
        cashierId: p.cashierId,
        items: p.items,
      } as any)
      return String((sale as any)?.id || '')
    }
    case 'card_topup': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      await api.cashTopupCard(String(p.num), {
        clientRef: p.clientRef,
        cash: Number(p.cash) || 0,
        credit: Number(p.credit) || 0,
        note: p.note,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        shiftId: p.shiftId,
        posId: p.posId,
      } as any)
      return ''
    }
    case 'debt_repay': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      await api.debtRepayCard(String(p.num), {
        clientRef: p.clientRef,
        amount: Number(p.amount) || 0,
        method: p.method,
        note: p.note,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        shiftId: p.shiftId,
        posId: p.posId,
      } as any)
      return ''
    }
    case 'finance_move': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const move = await api.createFinanceMove({
        clientRef: p.clientRef,
        type: p.type,
        amount: Number(p.amount) || 0,
        note: p.note,
        createdBy: p.createdBy,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        shiftId: p.shiftId,
        posId: p.posId,
        supplierId: p.supplierId,
        reason: p.reason,
      } as any)
      return String((move as any)?.id || '')
    }
    default:
      throw new Error(`Неизвестная операция: ${row.kind}`)
  }
}

/**
 * Отправляет очередь на сервер строго по порядку создания.
 * При сетевой ошибке останавливается (интернета нет — ждём).
 * При отказе сервера помечает операцию failed и продолжает следующую.
 */
export async function flushQueue(
  onProgress?: (done: number, total: number) => void,
): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, stopped: true, remaining: (await getPending()).length }
  flushing = true
  let sent = 0
  let failed = 0
  let stopped = false
  try {
    const queue = (await getPending()).filter(r => !r.failed)
    const total = queue.length
    let done = 0
    for (const row of queue) {
      try {
        const serverId = await sendOp(row)
        if (row.localId && serverId) await rememberId(row.localId, serverId)
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
      done++
      onProgress?.(done, total)
    }
  } finally {
    flushing = false
  }
  const remaining = (await getPending()).length
  return { sent, failed, stopped, remaining }
}
