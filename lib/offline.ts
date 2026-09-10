// ════════════════════════════════════════════════
// KAKAPO — офлайн-режим кассы
// Локальный кэш каталога + очередь чеков + синхронизация
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import type { Product } from './types'
import type { AdminClient } from './clientCrm'
import { browserSaysOffline, recentlyApiOk } from './apiReachability'
import { androidPersist } from './androidPersist'

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
  | 'vault_card_to_cash'
  | 'vault_cash_to_card'
  | 'stock_receipt_create'
  | 'stock_receipt_update'
  | 'stock_receipt_delete'
  | 'stock_writeoff_create'
  | 'stock_writeoff_update'
  | 'stock_writeoff_delete'
  | 'stock_layer_update'
  | 'stock_layer_delete'
  | 'stock_revision_create'
  | 'stock_revision_update'
  | 'stock_revision_delete'
  | 'product_upsert'
  | 'product_delete'
  | 'client_upsert'
  | 'client_delete'
  | 'supplier_upsert'
  | 'supplier_delete'
  | 'supplier_payment_create'
  | 'supplier_payment_delete'
  | 'expense_create'
  | 'expense_delete'
  | 'finance_move_delete'
  | 'category_upsert'
  | 'category_delete'
  | 'category_reorder'
  | 'card_loyalty_patch'
  | 'pos_point_upsert'
  | 'pos_point_delete'
  | 'cashier_upsert'

export const QUEUE_KIND_LABEL: Record<QueueKind, string> = {
  sale: 'Чек',
  shift_open: 'Открытие смены',
  shift_close: 'Закрытие смены',
  sale_return: 'Возврат',
  card_topup: 'Пополнение карты',
  debt_repay: 'Погашение долга',
  finance_move: 'Движение по кассе',
  vault_card_to_cash: 'Карта → нал',
  vault_cash_to_card: 'Нал → карта',
  stock_receipt_create: 'Приход',
  stock_receipt_update: 'Изменение прихода',
  stock_receipt_delete: 'Удаление прихода',
  stock_writeoff_create: 'Списание',
  stock_writeoff_update: 'Изменение списания',
  stock_writeoff_delete: 'Удаление списания',
  stock_layer_update: 'Правка партии',
  stock_layer_delete: 'Удаление партии',
  stock_revision_create: 'Ревизия',
  stock_revision_update: 'Изменение ревизии',
  stock_revision_delete: 'Удаление ревизии',
  product_upsert: 'Товар',
  product_delete: 'Удаление товара',
  client_upsert: 'Клиент',
  client_delete: 'Удаление клиента',
  supplier_upsert: 'Поставщик',
  supplier_delete: 'Удаление поставщика',
  supplier_payment_create: 'Оплата поставщику',
  supplier_payment_delete: 'Отмена оплаты поставщику',
  expense_create: 'Расход',
  expense_delete: 'Удаление расхода',
  finance_move_delete: 'Удаление движения',
  category_upsert: 'Категория',
  category_delete: 'Удаление категории',
  category_reorder: 'Порядок категорий',
  card_loyalty_patch: 'Долг / лояльность',
  pos_point_upsert: 'Точка продаж',
  pos_point_delete: 'Удаление точки',
  cashier_upsert: 'Кассир',
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
  /** true — сервер отклонил; касса повторит отправку, удалять нельзя */
  failed?: boolean
  /** Не слать / не revive до этого времени (мс) — антиспам одной и той же op */
  nextRetryAt?: number
  /**
   * Временный id, под которым операция уже показана в интерфейсе.
   * После отправки сопоставляется с настоящим id с сервера.
   */
  localId?: string
}

/** Пауза перед повтором одной операции (экспонента по attempts). */
export function pendingRetryDelayMs(attempts: number): number {
  const n = Math.max(0, Math.min(Number(attempts) || 0, 8))
  return Math.min(120_000, Math.round(2_500 * (2 ** n)))
}

/** Старое название — чек в очереди */
export type PendingSale = PendingOp<PosSalePayload>

// ── Хранилище (Desktop local DB → IndexedDB → localStorage) ──
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

function deskDb() {
  if (typeof window === 'undefined') return null
  const d = window.kakapoDesktop
  if (!d?.isDesktop || !d.localDbKvGet || !d.localDbKvSet) return null
  return d
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

function androidFiles() {
  return androidPersist()
}

// ── KV: кэш каталога ──
async function kvSet(key: string, value: unknown): Promise<void> {
  const files = androidFiles()
  if (files) {
    try { await files.kvSet(key, value) } catch { /* дальше копии */ }
  }
  const desk = deskDb()
  if (desk?.localDbKvSet) {
    try {
      await desk.localDbKvSet(key, value)
      return
    } catch { /* fallback */ }
  }
  if (hasIndexedDB()) {
    try { await idbRun(STORE_KV, 'readwrite', s => s.put(value as unknown as Record<string, unknown>, key)); return } catch { /* fallback */ }
  }
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch { /* quota */ }
}

async function kvGet<T>(key: string): Promise<T | null> {
  const files = androidFiles()
  if (files) {
    try {
      const v = await files.kvGet(key)
      if (v !== undefined && v !== null) return v as T
    } catch { /* fallback */ }
  }
  const desk = deskDb()
  if (desk?.localDbKvGet) {
    try {
      const v = await desk.localDbKvGet(key)
      if (v !== undefined && v !== null) return v as T
    } catch { /* fallback */ }
  }
  if (hasIndexedDB()) {
    try {
      const v = await idbRun<T | undefined>(STORE_KV, 'readonly', s => s.get(key))
      if (v !== undefined && v !== null) {
        if (files) {
          try { await files.kvSet(key, v) } catch { /* ignore */ }
        }
        return v as T
      }
    } catch { /* fallback */ }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

export function cacheProducts(products: Product[]): Promise<void> {
  // Только метаданные + URL. Prefetch байтов фото — отдельно (иначе каждый
  // cacheProducts после дельты/WS гоняет весь каталог по сети).
  const clean = (products || []).map(sanitizeProductForLocalCache)
  return kvSet(KEY_PRODUCTS, clean)
}
export function readCachedProducts(): Promise<Product[] | null> {
  return kvGet<Product[]>(KEY_PRODUCTS)
}

/** Убрать base64/blob из каталога — иначе local-kv раздувается и касса лагает */
export function sanitizeProductForLocalCache(p: Product): Product {
  const clean = (v?: string | null): string | null => {
    const s = String(v || '').trim()
    if (!s) return null
    if (/^data:/i.test(s) || /^blob:/i.test(s)) return null
    // оставляем http(s) и серверные пути /api/kakapo/uploads/...
    return s
  }
  return {
    ...p,
    photo: clean(p.photo),
    photoThumb: clean(p.photoThumb),
  }
}
export function cacheClients(clients: AdminClient[]): Promise<void> {
  return kvSet(KEY_CLIENTS, clients)
}
export function readCachedClients(): Promise<AdminClient[] | null> {
  return kvGet<AdminClient[]>(KEY_CLIENTS)
}

/** Сотрудники для офлайн-входа (пароли только на локальном диске кассы) */
export type CachedEmployeeAuth = {
  id: string
  name: string
  role: string
  roleLabel?: string
  permissions: string[]
  active: boolean
  password?: string
  passwordHash?: string
}

const KEY_EMPLOYEES_AUTH = 'catalog_employees_auth'

export function cacheEmployeesAuth(rows: CachedEmployeeAuth[]): Promise<void> {
  return kvSet(KEY_EMPLOYEES_AUTH, rows)
}
export function readCachedEmployeesAuth(): Promise<CachedEmployeeAuth[] | null> {
  return kvGet<CachedEmployeeAuth[]>(KEY_EMPLOYEES_AUTH)
}

/** Универсальный кэш данных вкладок (клиенты, карты, POS-снимок и т.д.) */
export function cacheData<T>(key: string, data: T): Promise<void> {
  return kvSet(`data_${key}`, data)
}
export function readCachedData<T>(key: string): Promise<T | null> {
  return kvGet<T>(`data_${key}`)
}

export function cacheCategories(categories: unknown[]): Promise<void> {
  return cacheData('categories', categories)
}

export function readCachedCategories<T = unknown>(): Promise<T[] | null> {
  return readCachedData<T[]>('categories')
}

/** Обновить pos_snapshot из текущего Zustand (после локальных правок поставщиков/финансов) */
export async function persistPosSnapshot(): Promise<void> {
  try {
    const { usePosStore } = await import('./posStore')
    const cur = usePosStore.getState()
    await cacheData('pos_snapshot', {
      cashiers: cur.cashiers,
      posPoints: cur.posPoints,
      shifts: cur.shifts,
      sales: cur.sales,
      receipts: cur.receipts,
      writeoffs: cur.writeoffs,
      revisions: cur.revisions,
      suppliers: cur.suppliers,
      expenses: cur.expenses,
      financeMoves: cur.financeMoves,
      cashVault: cur.cashVault,
      expiry: cur.expiry,
      financeSummary: cur.financeSummary,
      report: cur.report,
    })
  } catch { /* ignore */ }
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
    nextRetryAt: Number(row?.nextRetryAt) > 0 ? Number(row.nextRetryAt) : undefined,
    localId: row?.localId,
  }
}

/** Ревизия на отправку — только после чеков и прочих складских операций в очереди */
const REVISION_QUEUE_KINDS = new Set<QueueKind>([
  'stock_revision_create',
  'stock_revision_update',
  'stock_revision_delete',
])

/** Справочники должны уйти раньше прихода/ревизии — иначе «поставщик не найден». */
const CATALOG_FIRST_KINDS = new Set<QueueKind>([
  'supplier_upsert',
  'product_upsert',
  'category_upsert',
  'category_reorder',
  'client_upsert',
])

/** Справочники / склад / деньги / ревизия — порядок flush (меньше = раньше). */
function queueKindPriority(kind: QueueKind): number {
  if (
    CATALOG_FIRST_KINDS.has(kind)
    || kind === 'product_delete'
    || kind === 'category_delete'
    || kind === 'client_delete'
    || kind === 'supplier_delete'
  ) return -50
  if (kind === 'shift_open' || kind === 'pos_point_upsert' || kind === 'cashier_upsert') return -40
  if (
    kind === 'stock_receipt_create'
    || kind === 'stock_receipt_update'
    || kind === 'stock_receipt_delete'
    || kind === 'stock_writeoff_create'
    || kind === 'stock_writeoff_update'
    || kind === 'stock_writeoff_delete'
    || kind === 'stock_layer_update'
    || kind === 'stock_layer_delete'
    || kind === 'supplier_payment_create'
    || kind === 'supplier_payment_delete'
  ) return -20
  if (
    kind === 'sale'
    || kind === 'sale_return'
    || kind === 'debt_repay'
    || kind === 'card_topup'
    || kind === 'card_loyalty_patch'
  ) return 0
  if (
    kind === 'finance_move'
    || kind === 'finance_move_delete'
    || kind === 'expense_create'
    || kind === 'expense_delete'
    || kind === 'vault_card_to_cash'
    || kind === 'vault_cash_to_card'
  ) return 10
  if (kind === 'shift_close' || kind === 'pos_point_delete') return 20
  if (REVISION_QUEUE_KINDS.has(kind)) return 100
  return 0
}

function byOrder(a: PendingOp, b: PendingOp) {
  const prio = queueKindPriority(a.kind) - queueKindPriority(b.kind)
  if (prio !== 0) return prio
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
  const byRef = new Map<string, PendingOp>()

  const files = androidFiles()
  if (files) {
    try {
      for (const raw of (await files.queueAll()) || []) {
        const row = normalizeRow(raw)
        if (row.clientRef) byRef.set(row.clientRef, row)
      }
    } catch { /* fallback */ }
  }

  const desk = deskDb()
  if (desk?.localDbQueueAll) {
    try {
      for (const raw of (await desk.localDbQueueAll()) || []) {
        const row = normalizeRow(raw)
        if (row.clientRef) byRef.set(row.clientRef, row)
      }
    } catch { /* fallback */ }
  }

  let idbOnly = 0
  if (hasIndexedDB()) {
    try {
      for (const raw of (await idbRun<PendingOp[]>(STORE_QUEUE, 'readonly', s => s.getAll())) || []) {
        const row = normalizeRow(raw)
        if (!row.clientRef) continue
        if (!byRef.has(row.clientRef)) {
          byRef.set(row.clientRef, row)
          idbOnly++
        }
      }
    } catch { /* fallback */ }
  }

  if (byRef.size === 0) return lsQueueRead().sort(byOrder)

  // LS может опережать SQLite на долю секунды после мгновенного пробития
  for (const row of lsQueueRead()) {
    if (row.clientRef && !byRef.has(row.clientRef)) byRef.set(row.clientRef, row)
  }

  if (idbOnly > 0) {
    for (const row of byRef.values()) {
      if (files) {
        try { await files.queuePut(row) } catch { /* ignore */ }
      }
      if (desk?.localDbQueuePut) {
        try { await desk.localDbQueuePut(row) } catch { /* ignore */ }
      }
    }
  }

  return [...byRef.values()].sort(byOrder)
}

/** Пока эти операции в очереди — локальное списание/приход ещё не на сервере. */
const STOCK_LAYER_PULL_BLOCK_KINDS = new Set<QueueKind>([
  'sale',
  'sale_return',
  'stock_receipt_create',
  'stock_receipt_update',
  'stock_receipt_delete',
  'stock_writeoff_create',
  'stock_writeoff_update',
  'stock_writeoff_delete',
  'stock_layer_update',
  'stock_layer_delete',
  'stock_revision_create',
  'stock_revision_update',
  'stock_revision_delete',
])

/** true — партии с сервера не подтягиваем (правило 1: стабильный остаток на кассе).
 *  Failed sale/return тоже блокируют: локальный остаток ещё «продан», пока не откатим. */
export async function pendingBlocksStockLayerPull(): Promise<boolean> {
  try {
    const pending = await getPending()
    return pending.some(r => {
      if (!STOCK_LAYER_PULL_BLOCK_KINDS.has(r.kind)) return false
      if (!r.failed) return true
      return r.kind === 'sale' || r.kind === 'sale_return'
    })
  } catch {
    return false
  }
}

async function putPending(row: PendingOp): Promise<void> {
  // Сразу localStorage — пробитие не ждёт SQLite/IDB
  try {
    const list = lsQueueRead().filter(r => r.clientRef !== row.clientRef)
    list.push(row)
    lsQueueWrite(list)
  } catch { /* quota */ }

  const files = androidFiles()
  const desk = deskDb()
  if (desk?.localDbQueuePut) {
    void desk.localDbQueuePut(row)
      .then(() => {
        if (hasIndexedDB()) {
          void idbRun(STORE_QUEUE, 'readwrite', s => s.put(row)).catch(() => {})
        }
      })
      .catch(() => {})
    if (files) void files.queuePut(row).catch(() => {})
    return
  }
  if (files) {
    void files.queuePut(row).catch(() => {})
  }
  if (hasIndexedDB()) {
    void idbRun(STORE_QUEUE, 'readwrite', s => s.put(row)).catch(() => {})
  }
}

async function deletePending(clientRef: string): Promise<void> {
  const files = androidFiles()
  if (files) {
    try { await files.queueDelete(clientRef) } catch { /* ignore */ }
  }
  const desk = deskDb()
  if (desk?.localDbQueueDelete) {
    try {
      await desk.localDbQueueDelete(clientRef)
      if (hasIndexedDB()) {
        try { await idbRun(STORE_QUEUE, 'readwrite', s => s.delete(clientRef)) } catch { /* ignore */ }
      }
      return
    } catch { /* fallback */ }
  }
  if (hasIndexedDB()) {
    try { await idbRun(STORE_QUEUE, 'readwrite', s => s.delete(clientRef)); return } catch { /* fallback */ }
  }
  lsQueueWrite(lsQueueRead().filter(r => r.clientRef !== clientRef))
}

/** Внутреннее: не вызывать из UI кассы — очередь нельзя стирать вручную */
export async function dropPending(clientRef: string): Promise<void> {
  await deletePending(clientRef)
}

/** Стереть всю очередь (браузер online-only / ремонт) */
export async function clearAllPending(): Promise<void> {
  const list = await getPending()
  for (const row of list) {
    try { await deletePending(row.clientRef) } catch { /* ignore */ }
  }
  try { lsQueueWrite([]) } catch { /* ignore */ }
}

/** Повторить отклонённую операцию при следующей отправке */
export async function retryPending(clientRef: string): Promise<void> {
  const row = (await getPending()).find(r => r.clientRef === clientRef)
  if (!row) return
  row.failed = false
  row.lastError = ''
  row.nextRetryAt = undefined
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
    seqCounter = Number(stored) || 0
    // Полный скан очереди — только если счётчика ещё нет (дорого на кассе)
    if (!seqCounter) {
      const queued = await getPending()
      seqCounter = Math.max(0, ...queued.map(r => r.seq), 0)
    }
  }
  seqCounter += 1
  // Не ждём KV на пробитии — пишем в фоне
  void kvSet(KEY_SEQ, seqCounter)
  return seqCounter
}

function sameDebtRepayFingerprint(a: Record<string, unknown>, b: {
  num: string
  amount: number
  shiftId: string
  clientId: string
  method: string
  note: string
}): boolean {
  return String(a?.num || '').trim() === b.num
    && Math.round((Number(a?.amount) || 0) * 100) / 100 === b.amount
    && String(a?.shiftId || '') === b.shiftId
    && String(a?.clientId || '') === b.clientId
    && String(a?.method || 'cash') === b.method
    && String(a?.note || '').trim() === b.note
}

/** Дубль погашения: тот же отпечаток + тот же prevDebt/версия, пока op ещё в очереди (в т.ч. failed).
 * Без лимита 2.5с — иначе повторные клики после синка плодят очередь. */
export async function findDuplicateDebtRepay(payload: {
  num?: string
  amount?: number
  shiftId?: string
  clientRef?: string
  clientId?: string
  method?: string
  note?: string
  prevDebt?: number
  expectedDebtPayVersion?: number
}): Promise<PendingOp | null> {
  const clientRef = String(payload.clientRef || '').trim()
  const num = String(payload.num || '').trim()
  const amount = Math.round((Number(payload.amount) || 0) * 100) / 100
  const shiftId = String(payload.shiftId || '')
  const clientId = String(payload.clientId || '')
  const method = payload.method === 'card' ? 'card' : 'cash'
  const note = String(payload.note || '').trim()
  const prevDebt = payload.prevDebt != null
    ? Math.round((Number(payload.prevDebt) || 0) * 100) / 100
    : null
  const expectedVer = payload.expectedDebtPayVersion != null
    ? Number(payload.expectedDebtPayVersion)
    : null
  const pending = (await getPending()).filter(r => r.kind === 'debt_repay')
  return pending.find(r => {
    const p = (r.payload || {}) as Record<string, unknown>
    if (clientRef && String(p.clientRef || r.clientRef || '') === clientRef) return true
    if (!num || !(amount > 0)) return false
    if (!sameDebtRepayFingerprint(p, { num, amount, shiftId, clientId, method, note })) return false
    // Разный остаток долга до погашения = другое легитимное погашение той же суммы
    if (prevDebt != null && Number.isFinite(prevDebt)) {
      const pPrev = Math.round((Number(p.prevDebt) || 0) * 100) / 100
      if (Math.abs(pPrev - prevDebt) > 0.009) return false
    }
    if (expectedVer != null && Number.isFinite(expectedVer)) {
      const pVer = Number(p.expectedDebtPayVersion)
      if (Number.isFinite(pVer) && pVer !== expectedVer) return false
    }
    return true
  }) || null
}

const CASHIER_DOUBLE_TAP_MS = 2500

function sameCashierOpFingerprint(kind: QueueKind, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (Math.abs((Number(a.amount) || 0) - (Number(b.amount) || 0)) > 0.009) return false
  if (String(a.shiftId || '') !== String(b.shiftId || '')) return false
  if (String(a.note || '').trim() !== String(b.note || '').trim()) return false
  if (kind === 'finance_move' && String(a.type || '') !== String(b.type || '')) return false
  if (kind === 'finance_move' && String(a.payFrom || 'shift') !== String(b.payFrom || 'shift')) return false
  if (kind === 'finance_move' && String(a.method || 'cash') !== String(b.method || 'cash')) return false
  if (kind === 'expense_create' && String(a.category || '') !== String(b.category || '')) return false
  if (kind === 'card_topup' && String(a.num || '') !== String(b.num || '')) return false
  return true
}

async function findDuplicateCashierOp(kind: QueueKind, payload: Record<string, unknown>): Promise<PendingOp | null> {
  const clientRef = String(payload.clientRef || '').trim()
  const now = Date.now()
  const pending = (await getPending()).filter(r => !r.failed && r.kind === kind)
  return pending.find(r => {
    const p = (r.payload || {}) as Record<string, unknown>
    if (clientRef && String(p.clientRef || r.clientRef || '') === clientRef) return true
    if (!sameCashierOpFingerprint(kind, p, payload)) return false
    const ts = Date.parse(r.createdAtIso) || 0
    return ts > 0 && Math.abs(now - ts) < CASHIER_DOUBLE_TAP_MS
  }) || null
}

const SALE_DEDUP_MS = 8000

function saleItemsKey(items: unknown): string {
  if (!Array.isArray(items)) return ''
  return items
    .map((it: any) => `${it?.productId}:${Number(it?.qty) || 0}:${Math.round((Number(it?.lineTotal) || 0) * 100)}`)
    .join('|')
}

function sameSaleFingerprint(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (String(a.shiftId || '') !== String(b.shiftId || '')) return false
  if (String(a.paymentMethod || '') !== String(b.paymentMethod || '')) return false
  if (String(a.clientId || '') !== String(b.clientId || '')) return false
  if (Math.abs((Number(a.paidCash) || 0) - (Number(b.paidCash) || 0)) > 0.009) return false
  if (Math.abs((Number(a.paidCard) || 0) - (Number(b.paidCard) || 0)) > 0.009) return false
  if (Math.abs((Number(a.paidWallet) || 0) - (Number(b.paidWallet) || 0)) > 0.009) return false
  if (Math.abs((Number(a.debtAdded) || 0) - (Number(b.debtAdded) || 0)) > 0.009) return false
  if (Math.abs((Number(a.bonusSpent) || 0) - (Number(b.bonusSpent) || 0)) > 0.009) return false
  return saleItemsKey(a.items) === saleItemsKey(b.items)
}

/** Дубль продажи: тот же clientRef или тот же чек в очереди (дабл-тап / ретрай). */
export async function findDuplicateSale(payload: Record<string, unknown>): Promise<PendingOp | null> {
  const clientRef = String(payload.clientRef || '').trim()
  const now = Date.now()
  const pending = (await getPending()).filter(r => r.kind === 'sale')
  return pending.find(r => {
    const p = (r.payload || {}) as Record<string, unknown>
    if (clientRef && String(p.clientRef || r.clientRef || '') === clientRef) return true
    if (!sameSaleFingerprint(p, payload)) return false
    const ts = Date.parse(r.createdAtIso) || 0
    return ts > 0 && Math.abs(now - ts) < SALE_DEDUP_MS
  }) || null
}

/** Кладёт операцию в локальную очередь на отправку */
export async function enqueueOp<P>(
  kind: QueueKind,
  payload: P,
  opts: { clientRef?: string; localId?: string; createdAtIso?: string } = {},
): Promise<PendingOp<P>> {
  const clientRef = opts.clientRef || (payload as any)?.clientRef || newClientRef()
  const createdAtIso = opts.createdAtIso || (payload as any)?.createdAtIso || new Date().toISOString()
  const queuedOffline = browserSaysOffline()
    || (typeof navigator !== 'undefined' && navigator.onLine === false)
    || !!(payload as any)?.queuedOffline

  if (kind === 'debt_repay') {
    const dup = await findDuplicateDebtRepay(payload as any)
    if (dup) return dup as PendingOp<P>
  }
  if (kind === 'sale') {
    const dup = await findDuplicateSale(payload as any)
    if (dup) return dup as PendingOp<P>
  }
  if (
    kind === 'finance_move'
    || kind === 'expense_create'
    || kind === 'card_topup'
    || kind === 'vault_card_to_cash'
    || kind === 'vault_cash_to_card'
  ) {
    const dup = await findDuplicateCashierOp(kind, payload as any)
    if (dup) return dup as PendingOp<P>
  }

  const row: PendingOp<P> = {
    clientRef,
    kind,
    payload: {
      ...(payload as any),
      clientRef,
      createdAtIso,
      ...(kind === 'sale' && queuedOffline ? { queuedOffline: true, skipStockAfterRevision: true } : {}),
      ...((kind === 'sale' || kind === 'sale_return' || kind === 'debt_repay' || kind === 'card_topup')
        ? { appliedLocal: true, skipBalances: true } : {}),
    },
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

function collapseRemappedIds<T extends { id?: string }>(list: T[], serverId: string): T[] {
  const map = new Map<string, T>()
  for (const row of list) {
    const id = String(row?.id ?? '')
    if (!id) continue
    const prev = map.get(id)
    map.set(id, prev && id === serverId ? { ...prev, ...row, id: serverId } : row)
  }
  return [...map.values()]
}

/** После flush: подменить локальные id на серверные в сторах и кэшах */
async function applyLocalIdRemap(kind: QueueKind, localId: string, serverId: string): Promise<void> {
  if (!localId || !serverId || localId === serverId) return
  try {
    if (kind === 'stock_receipt_create' || kind === 'stock_receipt_update') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        receipts: s.receipts.map(r => (r.id === localId ? { ...r, id: serverId } : r)),
      }))
      const { remapReceiptIdInLayers } = await import('./stockLayersLocal')
      await remapReceiptIdInLayers(localId, serverId)
      void persistPosSnapshot()
    } else if (kind === 'stock_writeoff_create' || kind === 'stock_writeoff_update') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        writeoffs: s.writeoffs.map(w => (w.id === localId ? { ...w, id: serverId } : w)),
      }))
      void persistPosSnapshot()
    } else if (kind === 'stock_revision_create' || kind === 'stock_revision_update') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        revisions: s.revisions.map(r => (r.id === localId ? { ...r, id: serverId } : r)),
      }))
      void persistPosSnapshot()
    } else if (kind === 'shift_open') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        shifts: s.shifts.map(sh => (sh.id === localId ? { ...sh, id: serverId } : sh)),
        sales: s.sales.map(sale => (sale.shiftId === localId ? { ...sale, shiftId: serverId } : sale)),
        cashVault: s.cashVault
          ? {
            ...s.cashVault,
            openingFloats: (s.cashVault.openingFloats || []).filter(f => String(f.shiftId) !== String(localId)),
          }
          : s.cashVault,
      }))
      void persistPosSnapshot()
    } else if (kind === 'finance_move' || kind === 'card_topup') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        financeMoves: collapseRemappedIds(
          s.financeMoves.map(m => (m.id === localId ? { ...m, id: serverId } : m)),
          serverId,
        ),
      }))
      void persistPosSnapshot()
    } else if (kind === 'expense_create') {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        expenses: collapseRemappedIds(
          s.expenses.map(e => (e.id === localId ? { ...e, id: serverId } : e)),
          serverId,
        ),
      }))
      void persistPosSnapshot()
    } else if (kind === 'sale') {
      const { usePosStore } = await import('./posStore')
      const { mergePosSalePreferItems } = await import('./syncConflict')
      usePosStore.setState(s => ({
        sales: s.sales.map(sale => {
          if (String(sale.id) !== String(localId)) return sale
          // Только id: полный ответ сервера может прийти позже через softSync;
          // items локального чека (вес) не затираем.
          return mergePosSalePreferItems(sale as any, {
            ...sale,
            id: serverId,
            _offline: undefined,
          } as any) as typeof sale
        }),
      }))
      void persistPosSnapshot()
    }
  } catch { /* ignore */ }
}

/** Подмена локальных (отрицательных) productId на серверные перед flush склада */
async function remapProductIdsInItems(items: any[]): Promise<any[]> {
  if (!Array.isArray(items) || !items.length) return items || []
  const map = await getIdMap()
  return items.map(it => {
    const pid = Number(it?.productId)
    if (!Number.isFinite(pid)) return it
    const mapped = map[String(pid)]
    if (!mapped) return it
    const next = Number(mapped)
    return { ...it, productId: Number.isFinite(next) ? next : it.productId }
  })
}

/** Настоящий id для временного (или сам id, если он уже настоящий) */
export async function resolveLocalId(id: string | undefined | null): Promise<string> {
  if (!id) return ''
  if (!isLocalId(id)) return id
  const map = await getIdMap()
  return map[id] || ''
}

const sendingSiblingRefs = new Set<string>()

async function completeQueuedRow(row: PendingOp): Promise<string> {
  if (sendingSiblingRefs.has(row.clientRef)) return ''
  sendingSiblingRefs.add(row.clientRef)
  try {
    const serverId = await sendOp(row)
    if (row.localId && serverId) {
      await rememberId(row.localId, serverId)
      await applyLocalIdRemap(row.kind, row.localId, serverId)
    }
    await deletePending(row.clientRef)
    return serverId
  } finally {
    sendingSiblingRefs.delete(row.clientRef)
  }
}

/** Если в очереди ещё лежит создание поставщика — отправить его до прихода. */
async function flushPendingSupplier(localSupplierId: string): Promise<string> {
  const list = await getPending()
  const row = list.find(r => {
    if (r.kind !== 'supplier_upsert') return false
    const p = (r.payload || {}) as Record<string, unknown>
    const sup = (p.supplier || p) as Record<string, unknown>
    return String(p.localId || '') === localSupplierId
      || String(sup.id || '') === localSupplierId
      || String(r.localId || '') === localSupplierId
  })
  if (!row) return ''
  return completeQueuedRow(row)
}

async function ensureSupplierOnServer(
  supplierId: unknown,
  fallbackName?: string,
): Promise<string> {
  const raw = String(supplierId || '').trim()
  if (!raw) return ''
  const mapped = isLocalId(raw) ? await resolveLocalId(raw) : raw
  if (mapped && !isLocalId(mapped)) return mapped

  if (isLocalId(raw)) {
    const fromQueue = await flushPendingSupplier(raw)
    if (fromQueue && !isLocalId(fromQueue)) return fromQueue
    const again = await resolveLocalId(raw)
    if (again && !isLocalId(again)) return again
  }

  const { usePosStore } = await import('./posStore')
  const local = usePosStore.getState().suppliers.find(s => String(s.id) === raw || String(s.id) === mapped)
  const name = String(local?.name || fallbackName || '').trim()
  if (!name) {
    throw new BrokenRefError('Связанная операция не отправлена — разберите её первой')
  }
  const saved = await api.createSupplier({
    name,
    category: local?.category,
    phone: local?.phone,
    address: local?.address,
    note: local?.note,
  } as any)
  const serverId = String((saved as any)?.id || '')
  if (!serverId) throw new Error('Поставщик не найден')
  await rememberId(raw, serverId)
  usePosStore.setState(s => ({
    suppliers: s.suppliers.map(x => (String(x.id) === raw ? { ...x, ...saved, id: serverId } : x)),
  }))
  void persistPosSnapshot()
  return serverId
}

// ── Онлайн-детект ──
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  // navigator.onLine часто врёт в Electron после reconnect —
  // если недавно API отвечал, считаем что связь есть
  if (!browserSaysOffline()) return true
  return recentlyApiOk()
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

async function findOpenServerShift(payload: any): Promise<string> {
  const { usePosStore } = await import('./posStore')
  const shifts = usePosStore.getState().shifts
  const cashierId = String(payload?.cashierId || '')
  const posId = String(payload?.posId || '')
  const open = shifts.find(s =>
    s.status === 'open'
    && !isLocalId(s.id)
    && (!cashierId || s.cashierId === cashierId)
    && (!posId || !s.posId || s.posId === posId),
  ) || shifts.find(s => s.status === 'open' && !isLocalId(s.id))
  return open?.id || ''
}

/** Подставляет shiftId: локальный → серверный, или текущая открытая смена */
async function resolveSalePayload(payload: any): Promise<any> {
  const next = { ...(payload || {}) }
  if (isLocalId(next.shiftId)) {
    const real = await resolveLocalId(next.shiftId)
    if (real) {
      next.shiftId = real
    } else {
      const openId = await findOpenServerShift(next)
      if (!openId) throw new BrokenRefError('Связанная операция не отправлена — разберите её первой')
      await rememberId(String(payload.shiftId), openId)
      next.shiftId = openId
    }
  } else if (next.shiftId) {
    // Закрытая/чужая смена на клиенте ≠ валидна для новых чеков
    const { usePosStore } = await import('./posStore')
    const row = usePosStore.getState().shifts.find(s => s.id === next.shiftId)
    if (!row || row.status !== 'open') {
      const openId = await findOpenServerShift(next)
      if (openId) next.shiftId = openId
    }
  }
  return next
}

/**
 * После конфликта версии долга/бонусов — взять текущие версии с сервера (или локальной карты).
 * Баланс debt/bonus НЕ трогаем: локальный чек уже учёл долг, иначе снова «откат к 16».
 */
async function refreshSalePayVersions(payload: Record<string, unknown>): Promise<boolean> {
  const cardNum = String(payload.cardNum || '').trim()
  if (!cardNum) return false
  const { cardNumsMatch } = await import('./cardCrm')
  let debtVer: number | null = null
  let bonusVer: number | null = null
  try {
    const list = await api.getCards()
    const card = (Array.isArray(list) ? list : []).find((c: { num?: string }) => cardNumsMatch(String(c.num || ''), cardNum))
    if (card) {
      debtVer = Number((card as { debtPayVersion?: number }).debtPayVersion) || 0
      bonusVer = Number((card as { bonusPayVersion?: number }).bonusPayVersion) || 0
    }
  } catch { /* сеть — ниже локальный fallback */ }
  if (debtVer == null) {
    try {
      const { useCardStore } = await import('./cardStore')
      const card = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, cardNum))
      if (!card) return false
      debtVer = Number(card.debtPayVersion) || 0
      bonusVer = Number(card.bonusPayVersion) || 0
    } catch {
      return false
    }
  }
  payload.expectedDebtPayVersion = debtVer
  if (bonusVer != null) payload.expectedBonusPayVersion = bonusVer
  try {
    const { useCardStore } = await import('./cardStore')
    useCardStore.getState().updateCardLoyalty(
      cardNum,
      {
        debtPayVersion: debtVer,
        ...(bonusVer != null ? { bonusPayVersion: bonusVer } : {}),
      } as any,
      { skipApi: true },
    )
  } catch { /* ignore */ }
  return true
}

/**
 * Конфликт версии погашения: взять текущую debtPayVersion карты с сервера.
 * Без этого откат ставит старую версию и погашение не проходит НИКОГДА.
 */
export async function refreshCardDebtPayVersion(cardNum: string): Promise<number | null> {
  const num = String(cardNum || '').trim()
  if (!num) return null
  const { cardNumsMatch } = await import('./cardCrm')
  try {
    const list = await api.getCards()
    const card = (Array.isArray(list) ? list : []).find(
      (c: { num?: string }) => cardNumsMatch(String(c.num || ''), num),
    )
    if (!card) return null
    const ver = Math.max(0, Number((card as { debtPayVersion?: number }).debtPayVersion) || 0)
    try {
      const { useCardStore } = await import('./cardStore')
      useCardStore.getState().updateCardLoyalty(num, { debtPayVersion: ver } as any, { skipApi: true })
    } catch { /* ignore */ }
    return ver
  } catch {
    return null
  }
}

/** Отправка одной операции. Возвращает id созданной записи, если он есть. */
async function sendOp(row: PendingOp): Promise<string> {
  switch (row.kind) {
    case 'sale': {
      let payload = await resolveSalePayload(row.payload)
      // Служебные поля только для локального отката — на сервер не шлём
      const revertSnap = payload && typeof payload === 'object' && '_revert' in payload
        ? (payload as Record<string, unknown>)._revert
        : undefined
      if (payload && typeof payload === 'object' && '_revert' in payload) {
        const { _revert: _drop, ...rest } = payload as Record<string, unknown>
        payload = rest
      }
      const applySaleRow = async (sale: Record<string, unknown>) => {
        const serverId = String(sale?.id || '')
        if (row.localId && serverId) {
          await rememberId(row.localId, serverId)
          try {
            const { usePosStore } = await import('./posStore')
            const { mergePosSalePreferItems } = await import('./syncConflict')
            usePosStore.setState(s => ({
              sales: s.sales.map(local => {
                if (String(local.id) !== String(row.localId)
                  && !(row.clientRef && String(local.clientRef || '') === String(row.clientRef))) {
                  return local
                }
                return mergePosSalePreferItems(local as any, {
                  ...sale,
                  id: serverId,
                  clientRef: sale.clientRef || local.clientRef || row.clientRef,
                } as any) as typeof local
              }),
            }))
            void persistPosSnapshot()
          } catch { /* softSync догонит */ }
        }
        return serverId
      }
      try {
        const sale = await api.createPosSale(payload, { mode: 'sync' }) as Record<string, unknown>
        return await applySaleRow(sale)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/смена не найдена/i.test(msg)) {
          const openId = await findOpenServerShift(payload)
          if (!openId) throw e
          if (isLocalId((row.payload as any)?.shiftId)) {
            await rememberId(String((row.payload as any).shiftId), openId)
          }
          payload = { ...payload, shiftId: openId }
          const sale = await api.createPosSale(payload, { mode: 'sync' }) as Record<string, unknown>
          return await applySaleRow(sale)
        }
        // Конфликт версии долга/бонусов: подтянуть актуальную версию и повторить 1 раз
        // (раньше чек стирался → у клиента долг откатывался, чек на 91 пропадал)
        if (/долг клиента уже меняли|бонусы уже меняли|верси.*ожидали/i.test(msg)) {
          const refreshed = await refreshSalePayVersions(payload)
          if (refreshed) {
            // Обновить и в очереди (для следующих попыток / отката)
            try {
              const livePayload = { ...(row.payload as Record<string, unknown>), ...payload }
              if (revertSnap) livePayload._revert = revertSnap
              row.payload = livePayload as PendingOp['payload']
              await putPending(row)
            } catch { /* ignore */ }
            const sale = await api.createPosSale(payload, { mode: 'sync' }) as Record<string, unknown>
            return await applySaleRow(sale)
          }
        }
        throw e
      }
    }
    case 'shift_open': {
      const p = await resolveRefs(row.payload || {}, ['cashierId', 'posId'])
      let openedAtIso = String(p.openedAtIso || '').trim()
      if (!openedAtIso && row.localId) {
        try {
          const { usePosStore } = await import('./posStore')
          openedAtIso = usePosStore.getState().shifts.find(s => s.id === row.localId)?.openedAtIso || ''
        } catch { /* ignore */ }
      }
      const shift = await api.openPosShift({
        clientRef: p.clientRef,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        openingCash: Number(p.openingCash) || 0,
        note: p.note,
        posId: p.posId,
        openedAtIso: openedAtIso || undefined,
      } as any)
      return String((shift as any)?.id || '')
    }
    case 'shift_close': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      let closedAtIso = String(p.closedAtIso || '').trim()
      if (!closedAtIso) {
        try {
          const { usePosStore } = await import('./posStore')
          closedAtIso = usePosStore.getState().shifts.find(s => s.id === p.shiftId)?.closedAtIso || ''
        } catch { /* ignore */ }
      }
      const shift = await api.closePosShift(String(p.shiftId), {
        clientRef: p.clientRef,
        closingCash: Number(p.closingCash) || 0,
        closingCard: p.closingCard != null ? Number(p.closingCard) : undefined,
        note: p.note,
        closedAtIso: closedAtIso || undefined,
      } as any)
      return String((shift as any)?.id || '')
    }
    case 'sale_return': {
      const p = await resolveRefs(row.payload, ['saleId'])
      const { _revert: _drop, ...rest } = (p || {}) as Record<string, unknown>
      const sale = await api.returnPosSale(String(rest.saleId), {
        clientRef: rest.clientRef,
        note: rest.note,
        cashierId: rest.cashierId,
        items: rest.items,
        appliedLocal: true,
        skipBalances: true,
        queuedOffline: !!rest.queuedOffline,
        cutDebt: rest.cutDebt,
        expectedDebtPayVersion: rest.expectedDebtPayVersion != null ? Number(rest.expectedDebtPayVersion) : undefined,
        expectedBonusPayVersion: rest.expectedBonusPayVersion != null ? Number(rest.expectedBonusPayVersion) : undefined,
      } as any)
      return String((sale as any)?.id || '')
    }
    case 'card_topup': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const res = await api.cashTopupCard(String(p.num), {
        clientRef: p.clientRef,
        cash: Number(p.cash) || 0,
        credit: Number(p.credit) || 0,
        note: p.note,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        shiftId: p.shiftId,
        posId: p.posId,
        createdAtIso: p.createdAtIso,
        appliedLocal: true,
        skipBalances: true,
        expectedBonusPayVersion: p.expectedBonusPayVersion != null ? Number(p.expectedBonusPayVersion) : undefined,
      } as any)
      return String((res as any)?.financeMove?.id || '')
    }
    case 'debt_repay': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const send = (ver: unknown) => api.debtRepayCard(String(p.num), {
        clientRef: p.clientRef,
        amount: Number(p.amount) || 0,
        method: p.method,
        note: p.note,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
        shiftId: p.shiftId,
        posId: p.posId,
        appliedLocal: true,
        skipBalances: true,
        nextDebt: p.nextDebt,
        orderId: p.orderId,
        expectedDebtPayVersion: ver != null ? Number(ver) : undefined,
      } as any)
      try {
        await send(p.expectedDebtPayVersion)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Долг уже погашали на другой кассе — взять актуальную версию и повторить 1 раз
        if (!/уже погашали|уже меняли|верси.*ожидали/i.test(msg)) throw e
        const ver = await refreshCardDebtPayVersion(String(p.num))
        if (ver == null) throw e
        try {
          const live = { ...(row.payload as Record<string, unknown>), expectedDebtPayVersion: ver }
          row.payload = live as PendingOp['payload']
          await putPending(row)
        } catch { /* ignore */ }
        await send(ver)
      }
      return ''
    }
    case 'finance_move': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const { _revert: _omitRevert, ...fields } = p as Record<string, unknown>
      const move = await api.createFinanceMove({
        clientRef: fields.clientRef,
        type: fields.type,
        amount: Number(fields.amount) || 0,
        note: fields.note,
        createdBy: fields.createdBy,
        cashierId: fields.cashierId,
        cashierName: fields.cashierName,
        shiftId: fields.shiftId,
        posId: fields.posId,
        supplierId: fields.supplierId,
        expectedPayVersion: fields.expectedPayVersion != null ? Number(fields.expectedPayVersion) : undefined,
        expectedVaultVersion: fields.expectedVaultVersion != null ? Number(fields.expectedVaultVersion) : undefined,
        reason: fields.reason,
        createdAtIso: fields.createdAtIso,
        payFrom: fields.payFrom,
        method: fields.method,
      } as any)
      return String((move as any)?.id || '')
    }
    case 'vault_card_to_cash': {
      const p = row.payload || {}
      const { _revert: _omitRevert, ...fields } = p as Record<string, unknown>
      const rowOut = await api.convertVaultCardToCash({
        clientRef: fields.clientRef,
        amount: Number(fields.amount) || 0,
        note: fields.note as string | undefined,
        expectedVaultVersion: fields.expectedVaultVersion != null ? Number(fields.expectedVaultVersion) : undefined,
      })
      return String((rowOut as any)?.id || '')
    }
    case 'vault_cash_to_card': {
      const p = row.payload || {}
      const { _revert: _omitRevert, ...fields } = p as Record<string, unknown>
      const rowOut = await api.convertVaultCashToCard({
        clientRef: fields.clientRef,
        amount: Number(fields.amount) || 0,
        note: fields.note as string | undefined,
        expectedVaultVersion: fields.expectedVaultVersion != null ? Number(fields.expectedVaultVersion) : undefined,
      })
      return String((rowOut as any)?.id || '')
    }
    case 'stock_receipt_create': {
      const p = row.payload || {}
      const supplierId = await ensureSupplierOnServer(p.supplierId, p.supplierName)
      const items = await remapProductIdsInItems(p.items || [])
      const receipt = await api.createStockReceipt({
        clientRef: p.clientRef,
        supplierId: supplierId || undefined,
        createdBy: p.createdBy,
        paidNow: Number(p.paidNow) || 0,
        payFrom: p.payFrom,
        method: p.method,
        items,
        createdAtIso: p.createdAtIso,
        expectedSupplyVersion: p.expectedSupplyVersion != null ? Number(p.expectedSupplyVersion) : undefined,
      } as any)
      return String((receipt as any)?.id || '')
    }
    case 'stock_receipt_update': {
      const p = await resolveRefs(row.payload, ['id'])
      const supplierId = await ensureSupplierOnServer(p.supplierId, p.supplierName)
      const items = await remapProductIdsInItems(p.items || [])
      const receipt = await api.updateStockReceipt(String(p.id), {
        clientRef: p.clientRef,
        supplierId: supplierId || undefined,
        paidNow: Number(p.paidNow) || 0,
        payFrom: p.payFrom,
        method: p.method,
        items,
        expectedSupplyVersion: p.expectedSupplyVersion != null ? Number(p.expectedSupplyVersion) : undefined,
      } as any)
      return String((receipt as any)?.id || '')
    }
    case 'stock_receipt_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      await api.deleteStockReceipt(String(p.id), { clientRef: p.clientRef } as any)
      return String(p.id || '')
    }
    case 'stock_writeoff_create': {
      const p = row.payload || {}
      const items = await remapProductIdsInItems(p.items || [])
      const w = await api.createStockWriteoff({
        clientRef: p.clientRef,
        reason: p.reason,
        note: p.note,
        createdBy: p.createdBy,
        items,
        createdAtIso: p.createdAtIso,
      } as any)
      return String((w as any)?.id || '')
    }
    case 'stock_writeoff_update': {
      const p = await resolveRefs(row.payload, ['id'])
      const items = await remapProductIdsInItems(p.items || [])
      const w = await api.updateStockWriteoff(String(p.id), {
        clientRef: p.clientRef,
        reason: p.reason,
        note: p.note,
        createdBy: p.createdBy,
        items,
      } as any)
      return String((w as any)?.id || '')
    }
    case 'stock_writeoff_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      await api.deleteStockWriteoff(String(p.id), { clientRef: p.clientRef } as any)
      return String(p.id || '')
    }
    case 'stock_layer_update': {
      const p = await resolveRefs(row.payload, ['receiptId'])
      await api.updateProductStockLayer(String(p.receiptId), Number(p.productId), {
        costPrice: p.costPrice,
        retailPrice: p.retailPrice,
        bulkPricing: p.bulkPricing,
        expiryDate: p.expiryDate,
        clientRef: p.clientRef,
      } as any)
      return String(p.receiptId || '')
    }
    case 'stock_layer_delete': {
      const p = await resolveRefs(row.payload, ['receiptId'])
      await api.deleteProductStockLayer(String(p.receiptId), Number(p.productId), {
        clientRef: p.clientRef,
      })
      return String(p.receiptId || '')
    }
    case 'stock_revision_create': {
      const p = row.payload || {}
      const items = await remapProductIdsInItems(p.items || [])
      const { revisionApiFieldsFromPayload } = await import('./revisionMeta')
      const rev = await api.createStockRevision({
        ...revisionApiFieldsFromPayload(p as Record<string, unknown>),
        items: items.map((it: any) => ({
          productId: it.productId,
          countedStock: Number(it.countedStock),
          ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: Number(it.systemStock) } : {}),
        })),
      })
      return String((rev as any)?.id || '')
    }
    case 'stock_revision_update': {
      const p = await resolveRefs(row.payload, ['id'])
      const items = await remapProductIdsInItems(p.items || [])
      const { revisionApiFieldsFromPayload } = await import('./revisionMeta')
      const rev = await api.updateStockRevision(String(p.id), {
        ...revisionApiFieldsFromPayload(p as Record<string, unknown>),
        items: items.map((it: any) => ({
          productId: it.productId,
          countedStock: Number(it.countedStock),
          ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: Number(it.systemStock) } : {}),
        })),
      })
      return String((rev as any)?.id || '')
    }
    case 'stock_revision_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      try {
        await api.deleteStockRevision(String(p.id), { clientRef: p.clientRef })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Ревизия уже снята / товар из строк пропал с сервера — локально удаление уже применено
        if (/не найден/i.test(msg)) return String(p.id || '')
        throw e
      }
      return String(p.id || '')
    }
    case 'supplier_payment_create': {
      const p = row.payload || {}
      const supplierId = await ensureSupplierOnServer(p.supplierId)
      const pay = await api.createSupplierPayment(String(supplierId), {
        amount: Number(p.amount) || 0,
        note: p.note,
        clientRef: p.clientRef,
        expectedPayVersion: p.expectedPayVersion != null ? Number(p.expectedPayVersion) : undefined,
      })
      return String((pay as any)?.id || '')
    }
    case 'supplier_payment_delete': {
      const p = await resolveRefs(row.payload, ['supplierId', 'paymentId'])
      const paymentId = String(p.paymentId || p.id || '')
      if (paymentId && !isLocalId(paymentId)) {
        await api.deleteSupplierPayment(String(p.supplierId), paymentId, {
          clientRef: p.clientRef,
          expectedPayVersion: p.expectedPayVersion != null ? Number(p.expectedPayVersion) : undefined,
        })
      }
      return paymentId
    }
    case 'product_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : ''
      const body = { ...(p.product || p) }
      delete body.localId
      delete body.clientRef
      delete body._prev
      const rawId = Number(body.id)
      const isLocal = !Number.isFinite(rawId) || rawId <= 0
      let saved: any
      if (isLocal) {
        const { id: _drop, docVersion: _dv, ...createBody } = body
        saved = await api.createProduct({ ...createBody, clientRef: p.clientRef })
      } else {
        saved = await api.updateProduct(rawId, {
          ...body,
          clientRef: p.clientRef,
          expectedDocVersion: p.expectedDocVersion != null
            ? Number(p.expectedDocVersion)
            : (body.docVersion != null ? Number(body.docVersion) - 1 : undefined),
        })
      }
      const serverId = String(saved?.id || '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { useProducts } = await import('./store')
          useProducts.setState(s => ({
            products: s.products.map(x => (
              String(x.id) === localId ? { ...saved, old: null, discount: 0 } : x
            )),
          }))
          void cacheProducts(useProducts.getState().products)
        } catch { /* ignore */ }
      }
      return serverId
    }
    case 'product_delete': {
      const p = row.payload || {}
      let id = String(p.id || '')
      const map = await getIdMap()
      if (map[id]) id = map[id]
      const num = Number(id)
      if (Number.isFinite(num) && num > 0) {
        await api.deleteProduct(num, { clientRef: p.clientRef })
      }
      return id
    }
    case 'client_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : ''
      const body = { ...(p.client || p) }
      delete body.localId
      delete body.clientRef
      delete body._prev
      const rawId = String(body.id || '')
      const isLocal = !rawId || isLocalId(rawId)
      let saved: any
      if (isLocal) {
        const { id: _drop, docVersion: _dv, ...createBody } = body
        saved = await api.createClient({ ...createBody, clientRef: p.clientRef })
      } else {
        saved = await api.updateClient(rawId, {
          ...body,
          clientRef: p.clientRef,
          expectedDocVersion: p.expectedDocVersion != null
            ? Number(p.expectedDocVersion)
            : (body.docVersion != null ? Number(body.docVersion) - 1 : undefined),
        } as any)
      }
      const serverId = String(saved?.id || '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { useClientStore } = await import('./clientStore')
          const { normalizeClient } = await import('./clientCrm')
          useClientStore.setState(s => ({
            clients: s.clients.map(c => (
              String(c.id) === localId ? normalizeClient({ ...c, ...saved, id: serverId }) : c
            )),
          }))
          void cacheData('clients', useClientStore.getState().clients)
        } catch { /* ignore */ }
      }
      return serverId
    }
    case 'client_delete': {
      const p = row.payload || {}
      let id = String(p.id || '')
      const map = await getIdMap()
      if (map[id]) id = map[id]
      if (id && !isLocalId(id)) {
        await api.deleteClient(id, p.phone, { clientRef: p.clientRef })
      }
      return id
    }
    case 'supplier_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : ''
      const body = { ...(p.supplier || p) }
      delete body.localId
      delete body.clientRef
      delete body.payableAmount
      delete body.totalSupplied
      delete body.totalPaid
      delete body.payVersion
      delete body.supplyVersion
      delete body.debtVersion
      delete body.lastDeliveryAtIso
      const rawId = String(body.id || '')
      const isLocal = !rawId || isLocalId(rawId)
      let saved: any
      if (isLocal) {
        const { id: _drop, ...createBody } = body
        saved = await api.createSupplier({ ...createBody, clientRef: p.clientRef } as any)
      } else {
        saved = await api.updateSupplier(rawId, { ...body, clientRef: p.clientRef } as any)
      }
      const serverId = String(saved?.id || '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { usePosStore } = await import('./posStore')
          usePosStore.setState(s => ({
            suppliers: s.suppliers.map(x => (String(x.id) === localId ? { ...saved } : x)),
          }))
          void persistPosSnapshot()
        } catch { /* ignore */ }
      }
      return serverId
    }
    case 'supplier_delete': {
      const p = row.payload || {}
      let id = String(p.id || '')
      const map = await getIdMap()
      if (map[id]) id = map[id]
      if (id && !isLocalId(id)) {
        await api.deleteSupplier(id, { clientRef: p.clientRef })
      }
      return id
    }
    case 'expense_create': {
      const p = await resolveRefs(row.payload, ['shiftId'])
      const exp = await api.createExpense({
        category: p.category,
        amount: Number(p.amount) || 0,
        note: p.note,
        createdBy: p.createdBy,
        shiftId: p.shiftId,
        posId: p.posId,
        payFrom: p.payFrom,
        method: p.method,
        expectedVaultVersion: p.expectedVaultVersion,
        clientRef: p.clientRef,
        createdAtIso: p.createdAtIso,
      } as any)
      return String((exp as any)?.id || '')
    }
    case 'expense_delete': {
      const rawId = String((row.payload as any)?.id || '')
      const mapped = isLocalId(rawId) ? await resolveLocalId(rawId) : rawId
      if (!mapped || isLocalId(mapped)) return rawId
      try {
        await api.deleteExpense(mapped, { clientRef: (row.payload as any)?.clientRef })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/не найден/i.test(msg)) return mapped
        throw e
      }
      return mapped
    }
    case 'finance_move_delete': {
      const rawId = String((row.payload as any)?.id || '')
      const mapped = isLocalId(rawId) ? await resolveLocalId(rawId) : rawId
      if (!mapped || isLocalId(mapped)) return rawId
      try {
        await api.deleteFinanceMove(mapped, { clientRef: (row.payload as any)?.clientRef })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/не найден/i.test(msg)) return mapped
        throw e
      }
      return mapped
    }
    case 'category_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : ''
      const body = { ...(p.category || p) }
      delete body.localId
      delete body.clientRef
      const rawId = Number(body.id)
      const isLocal = !Number.isFinite(rawId) || rawId <= 0
      let saved: any
      if (isLocal) {
        const { id: _drop, ...createBody } = body
        if (createBody.parent_id != null) {
          const map = await getIdMap()
          const pid = String(createBody.parent_id)
          if (map[pid]) createBody.parent_id = Number(map[pid])
          else if (Number(createBody.parent_id) <= 0) createBody.parent_id = null
        }
        saved = await api.createCategory({ ...createBody, clientRef: p.clientRef })
      } else {
        saved = await api.updateCategory(rawId, { ...body, clientRef: p.clientRef })
      }
      const serverId = String(saved?.id ?? '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { peekCategories, applyCategoriesLocal } = await import('./useCategories')
          const lid = Number(localId)
          applyCategoriesLocal(peekCategories().map(c => (
            Number(c.id) === lid
              ? { ...c, ...saved, id: Number(saved.id), slug: saved.slug || c.slug }
              : (Number(c.parent_id) === lid ? { ...c, parent_id: Number(saved.id) } : c)
          )))
        } catch { /* ignore */ }
      }
      return serverId
    }
    case 'category_delete': {
      const p = row.payload || {}
      const ids: number[] = Array.isArray(p.ids) ? p.ids.map(Number) : [Number(p.id)]
      const map = await getIdMap()
      const serverIds = ids
        .map(id => {
          const mapped = map[String(id)]
          return mapped != null ? Number(mapped) : id
        })
        .filter(id => Number.isFinite(id) && id > 0)
      if (serverIds.length > 1) {
        await api.deleteCategories(serverIds, { clientRef: p.clientRef })
      } else if (serverIds.length === 1) {
        await api.deleteCategory(serverIds[0], { clientRef: p.clientRef })
      }
      return serverIds.join(',')
    }
    case 'category_reorder': {
      const p = row.payload || {}
      const map = await getIdMap()
      const items = (p.items || []).map((it: { id: number; order: number }) => {
        const mapped = map[String(it.id)]
        const id = mapped != null ? Number(mapped) : Number(it.id)
        return { id, order: Number(it.order) || 0 }
      }).filter((it: { id: number }) => Number.isFinite(it.id) && it.id > 0)
      if (items.length) await api.reorderCategories(items, { clientRef: p.clientRef })
      return String(items.length)
    }
    case 'card_loyalty_patch': {
      const p = row.payload || {}
      const num = String(p.num || '')
      if (!num) return ''
      const cardPatch = p.cardPatch || {
        debt: p.debt,
        debtEnabled: p.debtEnabled,
        debtLimit: p.debtLimit,
        bonus: p.bonus,
        level: p.level,
        vip: p.vip,
        allowBonusDecrease: true,
      }
      await api.updateCard(num, { ...cardPatch, clientRef: p.clientRef })
      if (p.clientId) {
        let clientId = String(p.clientId)
        const map = await getIdMap()
        if (map[clientId]) clientId = map[clientId]
        if (clientId && !isLocalId(clientId)) {
          await api.updateClient(clientId, p.clientPatch || {
            debt: p.debt,
            debtEnabled: p.debtEnabled,
            debtLimit: p.debtLimit,
            bonus: p.bonus,
            level: p.level,
            vip: p.vip,
          })
        }
      }
      return num
    }
    case 'pos_point_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : String(p.id || '')
      const body = { ...(p.point || p) }
      delete body.localId
      delete body.clientRef
      const rawId = String(body.id || localId || '')
      const isLocal = !rawId || isLocalId(rawId)
      let saved: any
      if (isLocal) {
        const { id: _drop, ...createBody } = body
        saved = await api.createPosPoint({
          name: String(createBody.name || ''),
          code: createBody.code,
          note: createBody.note,
          receiptPhone: createBody.receiptPhone,
          clientRef: p.clientRef,
        } as any)
      } else {
        saved = await api.updatePosPoint(rawId, {
          name: body.name,
          code: body.code,
          note: body.note,
          receiptPhone: body.receiptPhone,
          active: body.active,
          clientRef: p.clientRef,
        } as any)
      }
      const serverId = String(saved?.id || '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { usePosStore } = await import('./posStore')
          usePosStore.setState(s => ({
            posPoints: s.posPoints.map(x => (
              String(x.id) === localId ? { ...x, ...saved, id: serverId } : x
            )),
          }))
          void persistPosSnapshot()
        } catch { /* ignore */ }
      }
      return serverId
    }
    case 'pos_point_delete': {
      const p = row.payload || {}
      let id = String(p.id || '')
      const map = await getIdMap()
      if (map[id]) id = map[id]
      if (id && !isLocalId(id)) {
        await api.deletePosPoint(id)
      }
      return id
    }
    case 'cashier_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : String(p.id || '')
      const body = { ...(p.cashier || p) }
      delete body.localId
      delete body.clientRef
      const rawId = String(body.id || localId || '')
      const isLocal = !rawId || isLocalId(rawId)
      let saved: any
      if (isLocal) {
        saved = await api.createCashier({
          name: String(body.name || 'Кассир'),
          pin: String(body.pin || '0000'),
          clientRef: p.clientRef,
        } as any)
      } else {
        // обновление кассира на сервере не критично — имя уже локально
        return rawId
      }
      const serverId = String(saved?.id || '')
      if (localId && serverId && localId !== serverId) {
        await rememberId(localId, serverId)
        try {
          const { usePosStore } = await import('./posStore')
          usePosStore.setState(s => ({
            cashiers: s.cashiers.map(x => (
              String(x.id) === localId ? { ...x, ...saved, id: serverId } : x
            )),
          }))
          void persistPosSnapshot()
        } catch { /* ignore */ }
      }
      return serverId
    }
    default:
      throw new Error(`Неизвестная операция: ${row.kind}`)
  }
}

/**
 * Отправляет очередь на сервер строго по порядку:
 * справочники (поставщик/товар) → чеки/склад → ревизия в конце.
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
    const all = await getPending()
    const now = Date.now()
    // Не шлём ops на cooldown — иначе одни и те же 6 строк крутятся без паузы
    const queue = all
      .filter(r => !r.failed && !(Number(r.nextRetryAt) > now))
      .sort(byOrder)
    const total = queue.length
    let done = 0
    let lastProgressAt = 0
    const reportProgress = (force = false) => {
      const t = Date.now()
      if (!force && t - lastProgressAt < 280 && done < total) return
      lastProgressAt = t
      onProgress?.(done, total)
    }
    // Снимок id → row; не читаем getPending на каждую строку (тормозит UI)
    const liveByRef = new Map(all.map(r => [r.clientRef, r]))
    for (const row of queue) {
      const live = liveByRef.get(row.clientRef)
      if (!live || live.failed) {
        done++
        reportProgress()
        continue
      }
      if (Number(live.nextRetryAt) > Date.now()) {
        done++
        reportProgress()
        continue
      }
      try {
        const serverId = await sendOp(live)
        if (live.localId && serverId) {
          await rememberId(live.localId, serverId)
          await applyLocalIdRemap(live.kind, live.localId, serverId)
        }
        await deletePending(live.clientRef)
        liveByRef.delete(live.clientRef)
        if (
          live.kind === 'sale'
          || live.kind === 'sale_return'
          || live.kind === 'debt_repay'
          || live.kind === 'card_topup'
        ) {
          const p = (live.payload || {}) as Record<string, unknown>
          if (row.kind === 'sale_return' && !p.clientId) {
            try {
              const { usePosStore } = await import('./posStore')
              const sale = usePosStore.getState().sales.find(s => s.id === p.saleId)
              if (sale) {
                p.clientId = (sale as any).clientId
                p.cardNum = (sale as any).cardNum
              }
            } catch { /* ignore */ }
          }
          const { clearMoneyPendingFromOp } = await import('./loyaltySaveGuard')
          clearMoneyPendingFromOp(live.kind, p)
        }
        sent++
      } catch (e) {
        if (isNetworkError(e)) {
          stopped = true
          break
        }
        live.attempts += 1
        live.lastError = e instanceof Error ? e.message : 'Ошибка отправки'
        live.failed = true
        live.nextRetryAt = Date.now() + pendingRetryDelayMs(live.attempts)
        // Конфликт версии / нет остатка / нет денег — откатить локально, чтобы UI не врал
        const rejectRe = /уже меняли|уже изменился|уже погашали|не приняли|верси.*ожидали|недостаточно остатка|недостаточно средств|недостаточно бонусов|недостаточно наличных|по партиям|осталось \d|уже полностью возвращён|можно вернуть не больше|нечего возвращать|чек не найден|позиция для возврата|в основном ящике|на карте только|наличных только|смена уже закрыта|смена не найдена|сначала дождитесь|партия уже израсходована|поставщик не найден|товар #|укажите фактическое|дождитесь|уже открыта сессия|уже открыта смена|нельзя удалить|со складом/i
        if (rejectRe.test(live.lastError)) {
          try {
            if (live.kind === 'supplier_payment_create') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalSupplierPaymentOnReject } = await import('./offlineSupplierOps')
              revertLocalSupplierPaymentOnReject(String(p.supplierId || ''), Number(p.amount) || 0)
            } else if (live.kind === 'supplier_payment_delete') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalSupplierPaymentDeleteOnReject } = await import('./offlineSupplierOps')
              revertLocalSupplierPaymentDeleteOnReject(
                String(p.supplierId || ''),
                Number(p.amount) || Number((p.payment as any)?.amount) || 0,
                (p.payment as any) || null,
              )
            } else if (live.kind === 'debt_repay') {
              const p = (live.payload || {}) as Record<string, unknown>
              if (!p.clientRef) p.clientRef = live.clientRef
              const { revertLocalDebtRepayOnReject } = await import('./offlinePosOps')
              revertLocalDebtRepayOnReject(p as any)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'card_topup') {
              const p = (live.payload || {}) as Record<string, unknown>
              if (!p.clientRef) p.clientRef = live.clientRef
              const { revertLocalCardTopupOnReject } = await import('./offlinePosOps')
              revertLocalCardTopupOnReject(p as any)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'sale') {
              const p = (live.payload || {}) as Record<string, unknown>
              const err = String(live.lastError || '')
              // Конфликт версии долга/бонусов — обновим версии, но оставим failed + cooldown
              // (раньше failed=false → бесконечный flush тех же 6 ops)
              if (/долг клиента уже меняли|бонусы уже меняли|верси.*ожидали/i.test(err)) {
                const verTries = Number((p as any)._verRefreshTries) || 0
                if (verTries < 2) {
                  let refreshed = false
                  try {
                    refreshed = await refreshSalePayVersions(p)
                  } catch { /* оставить failed */ }
                  live.payload = { ...p, _verRefreshTries: verTries + 1 }
                  // Версии обновлены → чек снова готов к отправке, но с паузой
                  // (failed=true оставлять нельзя: он в hard-валидации и не оживёт сам)
                  live.failed = !refreshed
                  live.lastError = refreshed ? '' : err
                  live.nextRetryAt = Date.now() + pendingRetryDelayMs(verTries + 1)
                  await putPending(live)
                  liveByRef.set(live.clientRef, live)
                  failed++
                  done++
                  reportProgress()
                  continue
                }
                // После 2 обновлений версий — паркуем до ручного forceSync
                live.failed = true
                live.nextRetryAt = Date.now() + 120_000
                await putPending(live)
                liveByRef.set(live.clientRef, live)
                failed++
                done++
                reportProgress()
                continue
              }
              const { revertLocalSaleOnReject } = await import('./offlinePosOps')
              revertLocalSaleOnReject(p, live.localId)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'sale_return') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalSaleReturnOnReject } = await import('./offlinePosOps')
              revertLocalSaleReturnOnReject(p)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'finance_move') {
              const { revertLocalFinanceMoveOnReject } = await import('./offlinePosOps')
              const id = String(live.localId || '')
              if (id) revertLocalFinanceMoveOnReject(id)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'vault_card_to_cash' || live.kind === 'vault_cash_to_card') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalVaultConvertOnReject } = await import('./offlinePosOps')
              revertLocalVaultConvertOnReject(p)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'expense_create') {
              const { revertLocalExpenseOnReject } = await import('./offlinePosOps')
              const id = String(live.localId || '')
              if (id) revertLocalExpenseOnReject(id)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'stock_receipt_create') {
              const { revertLocalStockReceiptCreateOnReject } = await import('./offlineWarehouseOps')
              const id = String(live.localId || '')
              if (id) await revertLocalStockReceiptCreateOnReject(id)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'stock_writeoff_create') {
              const { revertLocalStockWriteoffCreateOnReject } = await import('./offlineWarehouseOps')
              const id = String(live.localId || '')
              if (id) await revertLocalStockWriteoffCreateOnReject(id)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'stock_revision_create') {
              const { revertLocalStockRevisionCreateOnReject } = await import('./offlineWarehouseOps')
              const id = String(live.localId || '')
              if (id) await revertLocalStockRevisionCreateOnReject(id)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'product_upsert') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalProductUpsertOnReject } = await import('./offlineProductOps')
              revertLocalProductUpsertOnReject(p)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'client_upsert') {
              const p = (live.payload || {}) as Record<string, unknown>
              const { revertLocalClientUpsertOnReject } = await import('./offlineClientOps')
              revertLocalClientUpsertOnReject(p)
              void persistPosSnapshot()
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            } else if (live.kind === 'shift_open') {
              // Сервер: уже есть открытая смена — убрать локальный дубль и вернуть размен
              const localId = String(live.localId || '')
              if (localId) {
                const { usePosStore } = await import('./posStore')
                const { revertLocalOpeningFloat } = await import('./offlinePosOps')
                revertLocalOpeningFloat(localId)
                usePosStore.setState(s => ({
                  shifts: s.shifts.filter(sh => sh.id !== localId),
                }))
                void persistPosSnapshot()
              }
              await deletePending(live.clientRef)
              liveByRef.delete(live.clientRef)
              failed++
              done++
              reportProgress()
              continue
            }
            void persistPosSnapshot()
          } catch { /* ignore */ }
        }
        await putPending(live)
        liveByRef.set(live.clientRef, live)
        failed++
      }
      done++
      reportProgress()
    }
    reportProgress(true)
  } finally {
    flushing = false
  }
  const remaining = (await getPending()).length
  return { sent, failed, stopped, remaining }
}
