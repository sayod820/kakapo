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
  /**
   * Временный id, под которым операция уже показана в интерфейсе.
   * После отправки сопоставляется с настоящим id с сервера.
   */
  localId?: string
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
  // В локальную базу кладём только метаданные + URL миниатюр.
  // Сами файлы картинок Electron не сохраняет — как в веб-браузере грузятся по сети.
  return kvSet(KEY_PRODUCTS, (products || []).map(sanitizeProductForLocalCache))
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

async function putPending(row: PendingOp): Promise<void> {
  const files = androidFiles()
  if (files) {
    try { await files.queuePut(row) } catch { /* fallback */ }
  }
  const desk = deskDb()
  if (desk?.localDbQueuePut) {
    try {
      await desk.localDbQueuePut(row)
      if (hasIndexedDB()) {
        try { await idbRun(STORE_QUEUE, 'readwrite', s => s.put(row)) } catch { /* ignore */ }
      }
      return
    } catch { /* fallback */ }
  }
  if (hasIndexedDB()) {
    try { await idbRun(STORE_QUEUE, 'readwrite', s => s.put(row)); return } catch { /* fallback */ }
  }
  const list = lsQueueRead().filter(r => r.clientRef !== row.clientRef)
  list.push(row)
  lsQueueWrite(list)
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
    seqCounter = Number(stored) || 0
    // Полный скан очереди — только если счётчика ещё нет (дорого на кассе)
    if (!seqCounter) {
      const queued = await getPending()
      seqCounter = Math.max(0, ...queued.map(r => r.seq), 0)
    }
  }
  seqCounter += 1
  await kvSet(KEY_SEQ, seqCounter)
  return seqCounter
}

export async function findDuplicateDebtRepay(payload: {
  num?: string
  amount?: number
  shiftId?: string
}): Promise<PendingOp | null> {
  const num = String(payload.num || '').trim()
  const amount = Math.round((Number(payload.amount) || 0) * 100) / 100
  const shiftId = String(payload.shiftId || '')
  const now = Date.now()
  const pending = (await getPending()).filter(r => !r.failed && r.kind === 'debt_repay')
  return pending.find(r => {
    const p = r.payload as any
    return String(p?.num || '').trim() === num
      && Math.round((Number(p?.amount) || 0) * 100) / 100 === amount
      && String(p?.shiftId || '') === shiftId
      && Math.abs(now - Date.parse(r.createdAtIso)) < 120_000
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

  if (kind === 'debt_repay') {
    const dup = await findDuplicateDebtRepay(payload as any)
    if (dup) return dup as PendingOp<P>
  }

  const row: PendingOp<P> = {
    clientRef,
    kind,
    payload: {
      ...(payload as any),
      clientRef,
      createdAtIso,
      ...(kind === 'sale' && queuedOffline ? { queuedOffline: true } : {}),
      ...((kind === 'sale' || kind === 'sale_return' || kind === 'debt_repay' || kind === 'card_topup')
        ? { appliedLocal: true, skipBalances: true } : {}),
      ...((kind === 'sale_return') ? { skipStock: true } : {}),
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

/** Отправка одной операции. Возвращает id созданной записи, если он есть. */
async function sendOp(row: PendingOp): Promise<string> {
  switch (row.kind) {
    case 'sale': {
      let payload = await resolveSalePayload(row.payload)
      try {
        const sale = await api.createPosSale(payload, { mode: 'sync' })
        return String((sale as any)?.id || '')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/смена не найдена/i.test(msg)) {
          const openId = await findOpenServerShift(payload)
          if (!openId) throw e
          if (isLocalId((row.payload as any)?.shiftId)) {
            await rememberId(String((row.payload as any).shiftId), openId)
          }
          payload = { ...payload, shiftId: openId }
          const sale = await api.createPosSale(payload, { mode: 'sync' })
          return String((sale as any)?.id || '')
        }
        throw e
      }
    }
    case 'shift_open': {
      const p = await resolveRefs(row.payload || {}, ['cashierId', 'posId'])
      const shift = await api.openPosShift({
        clientRef: p.clientRef,
        cashierId: p.cashierId,
        cashierName: p.cashierName,
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
        appliedLocal: true,
        skipStock: true,
        skipBalances: true,
        queuedOffline: !!p.queuedOffline,
        clientDebtAfter: p.clientDebtAfter,
        cutDebt: p.cutDebt,
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
        appliedLocal: true,
        skipBalances: true,
        bonusAfter: p.bonusAfter,
        posCashBonusAfter: p.posCashBonusAfter,
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
        appliedLocal: true,
        skipBalances: true,
        nextDebt: p.nextDebt,
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
    case 'vault_card_to_cash': {
      const p = row.payload || {}
      const rowOut = await api.convertVaultCardToCash({
        clientRef: p.clientRef,
        amount: Number(p.amount) || 0,
        note: p.note,
      })
      return String((rowOut as any)?.id || '')
    }
    case 'vault_cash_to_card': {
      const p = row.payload || {}
      const rowOut = await api.convertVaultCashToCard({
        clientRef: p.clientRef,
        amount: Number(p.amount) || 0,
        note: p.note,
      })
      return String((rowOut as any)?.id || '')
    }
    case 'stock_receipt_create': {
      const p = row.payload || {}
      const items = await remapProductIdsInItems(p.items || [])
      const receipt = await api.createStockReceipt({
        clientRef: p.clientRef,
        supplierId: p.supplierId,
        createdBy: p.createdBy,
        paidNow: Number(p.paidNow) || 0,
        items,
        createdAtIso: p.createdAtIso,
      } as any)
      return String((receipt as any)?.id || '')
    }
    case 'stock_receipt_update': {
      const p = await resolveRefs(row.payload, ['id'])
      const items = await remapProductIdsInItems(p.items || [])
      const receipt = await api.updateStockReceipt(String(p.id), {
        clientRef: p.clientRef,
        supplierId: p.supplierId,
        paidNow: Number(p.paidNow) || 0,
        items,
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
      const rev = await api.createStockRevision({
        clientRef: p.clientRef,
        createdBy: p.createdBy,
        note: p.note,
        items: items.map((it: any) => ({
          productId: it.productId,
          countedStock: Number(it.countedStock),
          ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: Number(it.systemStock) } : {}),
        })),
      } as any)
      return String((rev as any)?.id || '')
    }
    case 'stock_revision_update': {
      const p = await resolveRefs(row.payload, ['id'])
      const items = await remapProductIdsInItems(p.items || [])
      const rev = await api.updateStockRevision(String(p.id), {
        clientRef: p.clientRef,
        createdBy: p.createdBy,
        note: p.note,
        items: items.map((it: any) => ({
          productId: it.productId,
          countedStock: Number(it.countedStock),
          ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: Number(it.systemStock) } : {}),
        })),
      } as any)
      return String((rev as any)?.id || '')
    }
    case 'stock_revision_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      await api.deleteStockRevision(String(p.id), { clientRef: p.clientRef })
      return String(p.id || '')
    }
    case 'supplier_payment_create': {
      const p = await resolveRefs(row.payload, ['supplierId'])
      const pay = await api.createSupplierPayment(String(p.supplierId), {
        amount: Number(p.amount) || 0,
        note: p.note,
        clientRef: p.clientRef,
      } as any)
      return String((pay as any)?.id || '')
    }
    case 'supplier_payment_delete': {
      const p = await resolveRefs(row.payload, ['supplierId', 'paymentId'])
      const paymentId = String(p.paymentId || p.id || '')
      if (paymentId && !isLocalId(paymentId)) {
        await api.deleteSupplierPayment(String(p.supplierId), paymentId, { clientRef: p.clientRef })
      }
      return paymentId
    }
    case 'product_upsert': {
      const p = row.payload || {}
      const localId = p.localId != null ? String(p.localId) : ''
      const body = { ...(p.product || p) }
      delete body.localId
      delete body.clientRef
      const rawId = Number(body.id)
      const isLocal = !Number.isFinite(rawId) || rawId <= 0
      let saved: any
      if (isLocal) {
        const { id: _drop, ...createBody } = body
        saved = await api.createProduct({ ...createBody, clientRef: p.clientRef })
      } else {
        saved = await api.updateProduct(rawId, { ...body, clientRef: p.clientRef })
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
      const rawId = String(body.id || '')
      const isLocal = !rawId || isLocalId(rawId)
      let saved: any
      if (isLocal) {
        const { id: _drop, ...createBody } = body
        saved = await api.createClient({ ...createBody, clientRef: p.clientRef })
      } else {
        saved = await api.updateClient(rawId, { ...body, clientRef: p.clientRef })
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
        clientRef: p.clientRef,
      } as any)
      return String((exp as any)?.id || '')
    }
    case 'expense_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      const id = String(p.id || '')
      if (id && !isLocalId(id)) {
        await api.deleteExpense(id, { clientRef: p.clientRef })
      }
      return id
    }
    case 'finance_move_delete': {
      const p = await resolveRefs(row.payload, ['id'])
      const id = String(p.id || '')
      if (id && !isLocalId(id)) {
        await api.deleteFinanceMove(id, { clientRef: p.clientRef })
      }
      return id
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
        if (row.localId && serverId) {
          await rememberId(row.localId, serverId)
          await applyLocalIdRemap(row.kind, row.localId, serverId)
        }
        await deletePending(row.clientRef)
        if (
          row.kind === 'sale'
          || row.kind === 'sale_return'
          || row.kind === 'debt_repay'
          || row.kind === 'card_topup'
        ) {
          const p = (row.payload || {}) as Record<string, unknown>
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
          clearMoneyPendingFromOp(row.kind, p)
        }
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
