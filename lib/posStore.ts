'use client'

import { create } from 'zustand'
import { api } from './api'
import { USE_API } from './config'
import { mergeAppendById, mergeInboundById, mergeSalesInbound } from './syncConflict'
import type {
  CashVault,
  FinanceMove,
  PosCashier,
  PosExpense,
  PosPoint,
  PosSale,
  PosShift,
  PosSupplier,
  StockReceipt,
  StockRevision,
  StockWriteoff,
} from './types'

const EMPTY_VAULT: CashVault = { cashTotal: 0, cardTotal: 0, transfers: [] }

/** Пока удаление ещё в очереди — входящий sync не должен вернуть строку. */
const inboundDeletedIds = new Set<string>()
const inboundDeletedTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function noteInboundDeletedIds(ids: Array<string | undefined | null>) {
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id) continue
    inboundDeletedIds.add(id)
    const prev = inboundDeletedTimers.get(id)
    if (prev) clearTimeout(prev)
    inboundDeletedTimers.set(id, setTimeout(() => {
      inboundDeletedIds.delete(id)
      inboundDeletedTimers.delete(id)
    }, 60_000))
  }
}

function omitInboundDeleted<T extends { id?: string }>(list: T[]): T[] {
  if (!inboundDeletedIds.size || !list?.length) return list
  return list.filter(row => !inboundDeletedIds.has(String(row?.id || '')))
}

async function pendingDeleteIds(): Promise<Set<string>> {
  try {
    const { getPending } = await import('./offline')
    const pending = await getPending()
    const ids = new Set<string>()
    for (const row of pending) {
      if (row.failed) continue
      if (!String(row.kind || '').includes('delete')) continue
      const p = (row.payload || {}) as Record<string, unknown>
      for (const key of ['id', 'paymentId', 'receiptId']) {
        const v = String(p[key] || '').trim()
        if (v) ids.add(v)
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

function dropDeletedRemote<T extends { id?: string }>(remote: T[], extra: Set<string>): T[] {
  const hide = extra.size || inboundDeletedIds.size
  if (!hide) return remote
  return (remote || []).filter(row => {
    const id = String(row?.id || '')
    if (!id) return false
    if (inboundDeletedIds.has(id) || extra.has(id)) return false
    return true
  })
}

/** Сервер + локальные сдачи, которых ещё нет на сервере */
function mergeCashVault(local: CashVault | undefined, server: CashVault): CashVault {
  const serverTransfers = server.transfers || []
  const serverShiftIds = new Set(serverTransfers.map(t => String(t.shiftId)))
  const localOnly = (local?.transfers || []).filter(t => t.shiftId && !serverShiftIds.has(String(t.shiftId)))
  const localFloats = (local?.openingFloats || []).filter(f => String(f.shiftId || '').startsWith('off-'))
  const vaultVersion = Math.max(
    Number(local?.vaultVersion) || 0,
    Number(server.vaultVersion) || 0,
  )
  const converts = Array.isArray(server.converts) ? server.converts : (local?.converts || [])
  const extraCash = localOnly.reduce((a, t) => a + (Number(t.cashAmount) || 0), 0)
  const extraCard = localOnly.reduce((a, t) => a + (Number(t.cardAmount) || 0), 0)
  const floatCash = localFloats.reduce((a, f) => a + (Number(f.amount) || 0), 0)
  return {
    cashTotal: Math.round(((Number(server.cashTotal) || 0) + extraCash - floatCash) * 100) / 100,
    cardTotal: Math.round(((Number(server.cardTotal) || 0) + extraCard) * 100) / 100,
    vaultVersion,
    transfers: localOnly.length
      ? [...localOnly, ...serverTransfers].sort((a, b) =>
        String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')),
      )
      : serverTransfers,
    converts,
    openingFloats: localFloats,
  }
}

export interface PosStore {
  cashiers: PosCashier[]
  posPoints: PosPoint[]
  shifts: PosShift[]
  sales: PosSale[]
  receipts: StockReceipt[]
  writeoffs: StockWriteoff[]
  revisions: StockRevision[]
  suppliers: PosSupplier[]
  expenses: PosExpense[]
  financeMoves: FinanceMove[]
  cashVault: CashVault
  expiry: Array<{
    receiptId: string
    receiptCreatedAtIso?: string
    productId: number
    productName: string
    qty: number
    costPrice?: number
    retailPrice?: number
    expiryDate: string
    daysLeft: number
  }>
  financeSummary: any
  report: any
  apiReady: boolean
  apiSyncing: boolean
  apiError: string
  fetchFromApi: () => Promise<void>
}

export const usePosStore = create<PosStore>((set) => ({
  cashiers: [],
  posPoints: [],
  shifts: [],
  sales: [],
  receipts: [],
  writeoffs: [],
  revisions: [],
  suppliers: [],
  expenses: [],
  financeMoves: [],
  cashVault: { ...EMPTY_VAULT, transfers: [] },
  expiry: [],
  financeSummary: null,
  report: null,
  apiReady: !USE_API,
  apiSyncing: false,
  apiError: '',
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ apiReady: true, apiSyncing: false, apiError: '' })
      return
    }
    const alreadyReady = usePosStore.getState().apiReady
    if (!alreadyReady) set({ apiSyncing: true, apiError: '' })
    else set({ apiError: '' })
    try {
      const [
        cashiers,
        posPoints,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        financeMoves,
        cashVault,
        expiry,
        financeSummary,
        report,
      ] = await Promise.all([
        api.getCashiers(),
        api.getPosPoints(),
        api.getPosShifts(),
        api.getPosSales(),
        api.getStockReceipts(),
        api.getStockWriteoffs(),
        api.getStockRevisions(),
        api.getSuppliers(),
        api.getExpenses(),
        api.getFinanceMoves(),
        api.getCashVault().catch(() => ({ ...EMPTY_VAULT, transfers: [] as CashVault['transfers'] })),
        api.getStockExpiry(),
        api.getPosFinanceSummary(),
        api.getPosReport(),
      ])
      const snapshot = {
        cashiers,
        posPoints,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        financeMoves,
        cashVault: mergeCashVault(
          usePosStore.getState().cashVault,
          cashVault || { ...EMPTY_VAULT, transfers: [] },
        ),
        expiry,
        financeSummary,
        report,
      }
      const local = usePosStore.getState()
      try {
        const { getPending } = await import('./offline')
        const pending = await getPending()
        const pendingSupplierIds = new Set(
          pending
            .filter(r => !r.failed && r.kind === 'supplier_upsert')
            .map(r => String(r.payload?.localId || r.payload?.supplier?.id || r.payload?.id || ''))
            .filter(Boolean),
        )
        if (pendingSupplierIds.size) {
          const localById = new Map(local.suppliers.map(s => [String(s.id), s]))
          snapshot.suppliers = (snapshot.suppliers || []).map(s => {
            if (!pendingSupplierIds.has(String(s.id))) return s
            const loc = localById.get(String(s.id))
            if (!loc) return s
            return {
              ...s,
              name: loc.name,
              phone: loc.phone,
              address: loc.address,
              note: loc.note,
              category: loc.category,
            }
          })
          for (const loc of local.suppliers) {
            if (!pendingSupplierIds.has(String(loc.id))) continue
            if (!snapshot.suppliers.some(s => String(s.id) === String(loc.id))) {
              snapshot.suppliers.push(loc)
            }
          }
        }
        const pendingCashierIds = new Set(
          pending
            .filter(r => !r.failed && r.kind === 'cashier_upsert')
            .map(r => String(r.payload?.localId || r.payload?.cashier?.id || r.payload?.id || ''))
            .filter(Boolean),
        )
        if (pendingCashierIds.size) {
          const localById = new Map(local.cashiers.map(c => [String(c.id), c]))
          snapshot.cashiers = (snapshot.cashiers || []).map(c => {
            if (!pendingCashierIds.has(String(c.id))) return c
            const loc = localById.get(String(c.id))
            return loc ? { ...c, name: loc.name } : c
          })
          for (const loc of local.cashiers) {
            if (!pendingCashierIds.has(String(loc.id))) continue
            if (!snapshot.cashiers.some(c => String(c.id) === String(loc.id))) {
              snapshot.cashiers.push(loc)
            }
          }
        }
      } catch { /* очередь недоступна */ }
      const delIds = await pendingDeleteIds()
      snapshot.sales = omitInboundDeleted(mergeSalesInbound(local.sales, dropDeletedRemote(snapshot.sales, delIds), { mode: 'full' }))
      snapshot.shifts = mergeInboundById(local.shifts, snapshot.shifts)
      snapshot.receipts = omitInboundDeleted(mergeInboundById(local.receipts, dropDeletedRemote(snapshot.receipts, delIds)))
      snapshot.writeoffs = omitInboundDeleted(mergeInboundById(local.writeoffs, dropDeletedRemote(snapshot.writeoffs, delIds)))
      snapshot.revisions = omitInboundDeleted(mergeInboundById(local.revisions, dropDeletedRemote(snapshot.revisions, delIds)))
      snapshot.expenses = omitInboundDeleted(mergeInboundById(local.expenses, dropDeletedRemote(snapshot.expenses, delIds)))
      snapshot.financeMoves = omitInboundDeleted(mergeInboundById(local.financeMoves, dropDeletedRemote(snapshot.financeMoves, delIds)))
      set({ ...snapshot, apiReady: true, apiSyncing: false, apiError: '' })
      try {
        const { notePosOpSeqFromSales, notePosOpSeqFromPoints } = await import('./posOpSeq')
        notePosOpSeqFromPoints(posPoints)
        notePosOpSeqFromSales(sales)
      } catch { /* ignore */ }
      try {
        const { persistPosSnapshot } = await import('./offline')
        void persistPosSnapshot({ force: true })
      } catch { /* кэш недоступен */ }
    } catch (e) {
      // нет связи — при первом запуске поднимаем данные из офлайн-кэша
      if (!alreadyReady) {
        try {
          const { readCachedData } = await import('./offline')
          const cached = await readCachedData<Partial<PosStore>>('pos_snapshot')
          if (cached) {
            set({
              ...cached,
              cashVault: cached.cashVault || { ...EMPTY_VAULT, transfers: [] },
              apiReady: true,
              apiSyncing: false,
              apiError: '',
            })
            return
          }
        } catch { /* нет кэша */ }
      }
      set({
        apiReady: alreadyReady || true,
        apiSyncing: false,
        // Не пугаем Финансы/Отчёты красной ошибкой — локальные данные уже есть
        apiError: '',
      })
    }
  },
}))

export async function syncPosFromApi() {
  await usePosStore.getState().fetchFromApi()
}

/** Лёгкое обновление после чека — только продажи и смены, без склада/финансов.
 *  Не затирает локальные правки смены, пока в очереди есть операции, влияющие на кассу. */
const SHIFT_PENDING_KINDS = new Set([
  'sale',
  'sale_return',
  'finance_move',
  'finance_move_delete',
  'expense_create',
  'expense_delete',
  'shift_open',
  'shift_close',
  'debt_repay',
  'vault_card_to_cash',
  'vault_cash_to_card',
])

/** Сигнатура списка — чтобы не дергать React setState без реальных изменений */
function softListSig(rows: {
  id?: string | number
  status?: string
  total?: number
  salesCount?: number
  salesCash?: number
  salesCard?: number
  salesCredit?: number
  expenseTotal?: number
  cashInTotal?: number
  openingCash?: number
  closingCash?: number
  updatedAtIso?: string
  createdAtIso?: string
  closedAtIso?: string
  openedAtIso?: string
  items?: { qty?: number; returnedQty?: number; productId?: number }[]
}[] | undefined) {
  const list = rows || []
  const n = list.length
  if (!n) return '0'
  // Сумма ключевых полей по всем строкам — иначе смена с тем же id/updatedAt
  // и новым salesCash не считается «изменившейся» и UI остаётся со старым налом.
  let money = 0
  let counts = 0
  let itemQty = 0
  for (const r of list) {
    money += (Number(r.total) || 0)
      + (Number(r.salesCash) || 0)
      + (Number(r.salesCard) || 0)
      + (Number(r.salesCredit) || 0)
      + (Number(r.expenseTotal) || 0)
      + (Number(r.cashInTotal) || 0)
      + (Number(r.openingCash) || 0)
      + (Number(r.closingCash) || 0)
    counts += Number(r.salesCount) || 0
    if (Array.isArray(r.items)) {
      for (const it of r.items) {
        itemQty += (Number(it.qty) || 0) + (Number(it.returnedQty) || 0) * 0.001
        itemQty += (Number(it.productId) || 0) * 1e-9
      }
    }
  }
  const a = list[0]
  const c = list[n - 1]
  return `${n}:${a?.id}:${a?.status || ''}:${counts}:${money.toFixed(2)}:${itemQty.toFixed(4)}:${a?.updatedAtIso || a?.openedAtIso || a?.createdAtIso || ''}:${c?.id}:${c?.closedAtIso || c?.updatedAtIso || c?.createdAtIso || ''}`
}

let posSoftSyncInFlight: Promise<void> | null = null
let posSoftSyncLastAt = 0
/** Пока идёт GET — новый вызов (WS / браузер→ПК) не должен теряться */
let posSoftSyncDirty = false
let posSoftSyncDirtyForce = false
/** Таймеры не долбят чаще 4с; force=true — WS / после чека / syncNow */
const POS_SOFT_MIN_GAP_MS = 4000

export async function softSyncPosAfterSale(opts?: { force?: boolean }) {
  const wantForce = !!opts?.force
  if (posSoftSyncInFlight) {
    // Снимок GET уже ушёл — после него нужен ещё один pull, иначе чек с браузера не приедет
    posSoftSyncDirty = true
    if (wantForce) posSoftSyncDirtyForce = true
    return posSoftSyncInFlight
  }
  if (!wantForce && Date.now() - posSoftSyncLastAt < POS_SOFT_MIN_GAP_MS) return

  try {
    const { perfSoftSync } = await import('./devTelemetry')
    perfSoftSync('pos', { force: wantForce })
  } catch { /* ignore */ }

  posSoftSyncInFlight = (async () => {
    try {
      const { getPosLiteSyncCursor, setPosLiteSyncCursor } = await import('./localEntities')
      const since = await getPosLiteSyncCursor()
      let sales: import('./types').PosSale[] = []
      let shifts: import('./types').PosShift[] = []
      let deltaClients: unknown[] | null = null
      let deltaCards: unknown[] | null = null
      let usedDelta = false

      let nextLiteCursor = ''
      let deleteIds: string[] = []
      let crmDeleteClients: string[] = []
      let crmDeleteCards: string[] = []
      try {
        const delta = await api.getSyncChanges(since || undefined, { scope: 'pos-lite' })
        usedDelta = true
        sales = (delta.pos?.sales || []) as import('./types').PosSale[]
        shifts = (delta.pos?.shifts || []) as import('./types').PosShift[]
        if (Array.isArray(delta.clients) && delta.clients.length) deltaClients = delta.clients
        if (Array.isArray(delta.cards) && delta.cards.length) deltaCards = delta.cards
        const dels = Array.isArray(delta.deletes) ? delta.deletes : []
        deleteIds = dels
          .filter((d: { kind?: string }) => d.kind === 'sale' || d.kind === 'shift')
          .map((d: { id?: string }) => String(d.id || ''))
          .filter(Boolean)
        crmDeleteClients = dels
          .filter((d: { kind?: string }) => d.kind === 'client')
          .map((d: { id?: string }) => String(d.id || ''))
          .filter(Boolean)
        crmDeleteCards = dels
          .filter((d: { kind?: string }) => d.kind === 'card')
          .map((d: { id?: string }) => String(d.id || ''))
          .filter(Boolean)
        nextLiteCursor = String(delta.cursor || '')
        // Пустая дельта (и без deletes) — только курсор
        if (
          !sales.length
          && !shifts.length
          && !deltaClients
          && !deltaCards
          && !deleteIds.length
          && !crmDeleteClients.length
          && !crmDeleteCards.length
        ) {
          if (nextLiteCursor) await setPosLiteSyncCursor(nextLiteCursor)
          return
        }
      } catch {
        // Старый сервер / сбой дельты — полный список как раньше
        usedDelta = false
        ;[sales, shifts] = await Promise.all([
          api.getPosSales(),
          api.getPosShifts(),
        ])
      }

      const { getPending } = await import('./offline')
      const pending = await getPending()
      const protectShifts = pending.some(r => !r.failed && SHIFT_PENDING_KINDS.has(r.kind))

      // Состояние читаем после await — иначе потеряем чеки, пробитые во время запроса
      const localSales = usePosStore.getState().sales
      // Дельта = append; полный GET = prune. Иначе один новый чек стирал всю историю.
      let mergedSales = (usedDelta
        ? (sales.length
          ? mergeSalesInbound(localSales, sales as any, { mode: 'delta' })
          : localSales)
        : mergeSalesInbound(localSales, sales as any, { mode: 'full' })) as typeof localSales
      if (deleteIds.length) {
        const del = new Set(deleteIds)
        mergedSales = mergedSales.filter(s => !del.has(String(s.id)))
      }

      const prevIds = new Set(localSales.map(s => String(s.id)))
      const hasNewFromServer = (sales || []).some(s => !prevIds.has(String(s.id)))
      const keptLocal = mergedSales.some(s => String(s.id || '').startsWith('off-'))

      const localShifts = usePosStore.getState().shifts
      const isGenericCashier = (n?: string) => {
        const t = String(n || '').trim()
        return !t || /^кассир$/i.test(t)
      }
      const enrichedShifts = (shifts || []).map(sh => {
        const local = localShifts.find(x => String(x.id) === String(sh.id))
          || (sh.clientRef
            ? localShifts.find(x => String(x.clientRef || '') === String(sh.clientRef))
            : undefined)
        if (!local) return sh
        let next = { ...sh }
        if (isGenericCashier(sh.cashierName) && !isGenericCashier(local.cashierName)) {
          next = { ...next, cashierName: local.cashierName }
        }
        if (local.openedAtIso && (!sh.openedAtIso || local.openedAtIso < sh.openedAtIso)) {
          next = { ...next, openedAtIso: local.openedAtIso }
        }
        if (local.closedAtIso && (!sh.closedAtIso || String(local.closedAtIso) < String(sh.closedAtIso))) {
          next = { ...next, closedAtIso: local.closedAtIso }
        }
        if (local.clientRef && !next.clientRef) next = { ...next, clientRef: local.clientRef }
        // Открытая смена: счётчики с сервера не должны «залипать» на старом локальном налу
        if (String(next.status || sh.status) === 'open' || String(local.status) === 'open') {
          const srvCount = Number(sh.salesCount) || 0
          const locCount = Number(local.salesCount) || 0
          if (srvCount >= locCount) {
            next = {
              ...next,
              salesCount: srvCount,
              salesCash: Number(sh.salesCash) || 0,
              salesCard: Number(sh.salesCard) || 0,
              salesCredit: Number(sh.salesCredit) || 0,
              expenseTotal: Number(sh.expenseTotal) || 0,
              cashInTotal: Number(sh.cashInTotal) || 0,
              openingCash: Number(sh.openingCash) || 0,
            } as typeof next
          } else {
            next = {
              ...next,
              salesCount: locCount,
              salesCash: Math.max(Number(sh.salesCash) || 0, Number(local.salesCash) || 0),
              salesCard: Math.max(Number(sh.salesCard) || 0, Number(local.salesCard) || 0),
              salesCredit: Math.max(Number(sh.salesCredit) || 0, Number(local.salesCredit) || 0),
              expenseTotal: Math.max(Number(sh.expenseTotal) || 0, Number(local.expenseTotal) || 0),
              cashInTotal: Math.max(Number(sh.cashInTotal) || 0, Number(local.cashInTotal) || 0),
            }
          }
        }
        return next
      })
      // Дельта смен — только append (как продажи). Полный GET — prune.
      let mergedShifts = protectShifts
        ? localShifts
        : usedDelta
          ? (enrichedShifts.length ? mergeAppendById(localShifts, enrichedShifts) : localShifts)
          : mergeInboundById(localShifts, enrichedShifts)
      if (deleteIds.length && !protectShifts) {
        const del = new Set(deleteIds)
        mergedShifts = mergedShifts.filter(sh => !del.has(String(sh.id)))
      }

      const salesChanged = softListSig(mergedSales) !== softListSig(localSales)
        || hasNewFromServer
        || keptLocal
        || mergedSales.length !== localSales.length
      const shiftsChanged = !protectShifts && softListSig(mergedShifts) !== softListSig(localShifts)

      if (salesChanged || shiftsChanged) {
        if (protectShifts) {
          // Сервер ещё без queued ops — оставляем локальные смены (ожидаемый нал / expenseTotal)
          if (salesChanged) usePosStore.setState({ sales: mergedSales })
        } else {
          usePosStore.setState({
            ...(salesChanged ? { sales: mergedSales } : {}),
            ...(shiftsChanged ? { shifts: mergedShifts } : {}),
          })
        }
      }

      // CRM из той же дельты — долг/бонусы без отдельного полного getClients
      if (deltaClients?.length || crmDeleteClients.length) {
        try {
          const { useClientStore } = await import('./clientStore')
          const { mergeClientLoyaltyIfRecent } = await import('./loyaltySaveGuard')
          const { mergeByIdLww } = await import('./syncConflict')
          const local = useClientStore.getState().clients || []
          let merged = local
          if (deltaClients?.length) {
            const incoming = mergeByIdLww(local as any, deltaClients as any)
            merged = incoming.map((row: any) => {
              const prev = local.find(x => String(x.id) === String(row.id))
              return mergeClientLoyaltyIfRecent(row, prev)
            })
          }
          if (crmDeleteClients.length) {
            const s = new Set(crmDeleteClients)
            merged = merged.filter((row: { id?: string | number }) => !s.has(String(row.id)))
          }
          useClientStore.setState({ clients: merged })
        } catch { /* ignore */ }
      }
      if (deltaCards?.length || crmDeleteCards.length) {
        try {
          const { useCardStore } = await import('./cardStore')
          const { mergeCardLoyaltyIfRecent, findLocalCard } = await import('./loyaltySaveGuard')
          const { mergeByIdLww } = await import('./syncConflict')
          const local = useCardStore.getState().cards || []
          let merged = local
          if (deltaCards?.length) {
            const incoming = mergeByIdLww(local as any, deltaCards as any) as typeof local
            merged = incoming.map(row => mergeCardLoyaltyIfRecent(row, findLocalCard(local, row.num)))
          }
          if (crmDeleteCards.length) {
            const s = new Set(crmDeleteCards)
            merged = merged.filter(row => !s.has(String(row.num)) && !s.has(String((row as any).id || '')))
          }
          useCardStore.setState({ cards: merged })
        } catch { /* ignore */ }
      }

      // Сохраняем и при обновлении смены (нал/продажи), иначе телефон после reload
      // поднимает старый кэш с другим salesCash, чем касса.
      if (salesChanged || shiftsChanged) {
        await persistSoftPosSnapshot()
      }
      if (nextLiteCursor) await setPosLiteSyncCursor(nextLiteCursor)

      // Server→Desktop: shift counters can advance while sale rows were skipped by
      // pos-lite cursor. Repair is projection-only (no stock/finance/outbox).
      try {
        const { maybeRepairPosSalesInboundAfterMerge } = await import('./posSalesInboundRepair')
        await maybeRepairPosSalesInboundAfterMerge({ reason: 'soft_sync_pos' })
      } catch { /* ignore */ }
    } catch { /* нет связи — локальный чек уже на экране */ }
    finally {
      posSoftSyncLastAt = Date.now()
      posSoftSyncInFlight = null
      if (posSoftSyncDirty) {
        const againForce = posSoftSyncDirtyForce
        posSoftSyncDirty = false
        posSoftSyncDirtyForce = false
        // Сразу ещё один pull — чек, который появился на сервере во время прошлого GET
        void softSyncPosAfterSale({ force: againForce || true })
      }
    }
  })()
  return posSoftSyncInFlight
}

async function persistSoftPosSnapshot() {
  try {
    const { persistPosSnapshot } = await import('./offline')
    // Phase 8: coalesce with other snapshot writers (not a second full IPC path)
    void persistPosSnapshot()
  } catch { /* ignore */ }
}

/**
 * Лёгкое обновление склада (приходы / списания / ревизии / поставщики / сроки).
 * Локальные off-* не затираются и склеиваются с сервером по clientRef.
 *
 * НЕ вызывать из critical register entry — тянет pullSyncChanges + layers + bumpProducts.
 * Для кассы: WS posWarehouse / модуль Склад / отложенный фон (если нужен).
 */
let warehouseSoftSyncInFlight: Promise<void> | null = null

export async function softSyncWarehouse(opts?: { expiryDays?: number }) {
  if (warehouseSoftSyncInFlight) return warehouseSoftSyncInFlight
  try {
    const { perfSoftSync } = await import('./devTelemetry')
    perfSoftSync('warehouse', { expiryDays: opts?.expiryDays })
  } catch { /* ignore */ }
  warehouseSoftSyncInFlight = (async () => {
    try {
      // Только дельта /sync/changes — не полные getStockReceipts/…
      const { pullSyncChanges } = await import('./syncPull')
      const res = await pullSyncChanges({ forceFull: false })
      if (res.skipped === 'pending') return

      const days = opts?.expiryDays ?? 14
      try {
        const expiry = await api.getStockExpiry(days)
        usePosStore.setState({ expiry, apiReady: true, apiError: '' })
        await persistSoftPosSnapshot()
      } catch { /* expiry опционален */ }

      try {
        const { pullStockLayersFromServer } = await import('./stockLayersLocal')
        await pullStockLayersFromServer({ bumpProducts: true })
      } catch { /* ignore */ }
    } catch { /* нет связи — оставляем локальный снимок */ }
    finally {
      warehouseSoftSyncInFlight = null
    }
  })()
  return warehouseSoftSyncInFlight
}

/** Только сроки годности (бейдж колокольчика). Без pullSync / layers / catalog bump. */
let expirySoftSyncInFlight: Promise<void> | null = null
let expirySoftSyncLastAt = 0
const EXPIRY_SOFT_MIN_GAP_MS = 30_000

export async function softSyncExpiry(opts?: { expiryDays?: number; force?: boolean }) {
  const force = !!opts?.force
  if (expirySoftSyncInFlight) return expirySoftSyncInFlight
  if (!force && Date.now() - expirySoftSyncLastAt < EXPIRY_SOFT_MIN_GAP_MS) return
  try {
    const { perfSoftSync } = await import('./devTelemetry')
    perfSoftSync('other', { kind: 'expiry', expiryDays: opts?.expiryDays })
  } catch { /* ignore */ }
  expirySoftSyncInFlight = (async () => {
    try {
      const days = opts?.expiryDays ?? 14
      const expiry = await api.getStockExpiry(days)
      usePosStore.setState({ expiry, apiReady: true, apiError: '' })
      expirySoftSyncLastAt = Date.now()
      try {
        await persistSoftPosSnapshot()
      } catch { /* ignore */ }
    } catch { /* offline — оставляем кэш expiry */ }
    finally {
      expirySoftSyncInFlight = null
    }
  })()
  return expirySoftSyncInFlight
}

/** Вклады / расходы / ящик с другого аппарата — без полного POS-снимка. */
let financeSoftSyncInFlight: Promise<void> | null = null

export async function softSyncFinance() {
  if (financeSoftSyncInFlight) return financeSoftSyncInFlight
  try {
    const { perfSoftSync } = await import('./devTelemetry')
    perfSoftSync('finance')
  } catch { /* ignore */ }
  financeSoftSyncInFlight = (async () => {
    try {
      const { pullSyncChanges } = await import('./syncPull')
      const res = await pullSyncChanges({ forceFull: false })
      if (res.skipped === 'pending') return

      // cashVault нет в /sync/changes — точечный GET
      const cashVault = await api.getCashVault().catch(() => null)
      if (cashVault) {
        const cur = usePosStore.getState()
        usePosStore.setState({
          cashVault: mergeCashVault(cur.cashVault, cashVault),
          apiReady: true,
          apiError: '',
        })
        await persistSoftPosSnapshot()
      } else {
        usePosStore.setState({ apiReady: true, apiError: '' })
      }
    } catch { /* нет связи */ }
    finally {
      financeSoftSyncInFlight = null
    }
  })()
  return financeSoftSyncInFlight
}
