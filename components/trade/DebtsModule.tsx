'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  CARD_STATUS_LABELS,
  cardHasDebtSection,
  cardNumsMatch,
  effectiveDebt,
  type AdminCard,
} from '@/lib/cardCrm'
import { provisionLoyaltyCardSafe } from '@/lib/offlineClientOps'
import { adjustClientDebtSafe } from '@/lib/offlineLoyaltyOps'
import { debtRepaySafe, financeMoveSafe, resolveOpenShift, shiftExpectedCashLocal } from '@/lib/offlinePosOps'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  mergeClientsWithOrders,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { getBoundPosIdSync } from '@/lib/tradeDevice'
import { pushBackHandler } from '@/lib/hardwareBack'
import {
  buildDebtOrderBalances,
  buildSaleDebtStatuses,
  debtBalanceDeltaForHistoryChange,
  debtHistoryTotals,
  debtOrderIdsMatch,
  debtStatusForSale,
  ensureDebtHistoryOrderId,
  isLedgerCashHistoryDebt,
  isManualDebtHistoryEntry,
  loadDebtHistory,
  loadDebtHistoryForClient,
  debtAccountKey,
  recordStoreDebtCharge,
  recordStoreDebtRepayment,
  recordStoreDebtRepaymentFifo,
  removeDebtHistoryEntry,
  saleOpenCreditAmount,
  subscribeDebtHistory,
  syncDebtHistoryFromLedger,
  updateDebtHistoryEntry,
  type DebtHistoryEntry,
  type SaleDebtStatus,
} from '@/lib/clientVipCredit'
import { resolveEffectiveDebtLimit } from '@/lib/loyaltyStatusConfig'
import { hydrateOfflineCaches } from '@/lib/offlineHydrate'
import { softSyncPosAfterSale, usePosStore } from '@/lib/posStore'
import { useOrders } from '@/lib/store'
import type { PosSale } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'
import OfflineNotice from './OfflineNotice'

type EnrichedClient = AdminClient & { lastLabel?: string }
type ListFilter = 'all' | 'with_debt' | 'cleared'
type SortMode = 'debt' | 'name'
type DetailTab = 'history' | 'pos' | 'cash' | 'pay'
type PosViewFilter = 'open' | 'all'

type PayMethod = 'cash' | 'card'
type SaleRepayState = { amount: string; saving: boolean; method: PayMethod }

type HistAddState = {
  open: boolean
  action: 'repay' | 'add'
  amount: string
  desc: string
  saving: boolean
  method: PayMethod
}

function emptyHistAdd(action: 'repay' | 'add' = 'add'): HistAddState {
  return { open: false, action, amount: '', desc: '', saving: false, method: 'cash' }
}

function PayMethodToggle({
  value,
  disabled,
  onChange,
}: {
  value: PayMethod
  disabled?: boolean
  onChange: (m: PayMethod) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {([
        ['cash', 'Нал'],
        ['card', 'Карта'],
      ] as [PayMethod, string][]).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`k-btn k-btn-s${value === id ? ' k-btn-g' : ''}`}
          disabled={disabled}
          style={{ fontSize: 12, minHeight: 0, padding: '6px 10px' }}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

type PosDebtSale = {
  id: string
  number?: number
  orderId?: string
  dateIso: string
  total: number
  paidCash: number
  paidCard: number
  debtAdded: number
  paymentMethod: string
  itemsCount: number
  note?: string
  partial: boolean
  cashierName?: string
  items: { name: string; qty: number; unit?: string; price: number; lineTotal: number }[]
}

type DebtClientRow = EnrichedClient & {
  debtLimit: number
  available: number
  overLimit: boolean
  goodsDebt: number
  cashDebt: number
  borrowed: number
  repaid: number
}

type FeedRow = {
  key: string
  ts: number
  dateLabel: string
  kind: 'pos' | 'cash' | 'pay'
  title: string
  desc: string
  amount: number
  editable?: DebtHistoryEntry
  saleId?: string
}

function levelLabel(level: ClientLevel): string {
  return CLIENT_LEVEL_OPTIONS.find(o => o.id === level)?.label || level
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function saleLabel(s: { number?: number; orderId?: string; id: string }): string {
  if (s.number != null && Number(s.number) > 0) return `Чек №${s.number}`
  const oid = String(s.orderId || '').trim()
  if (oid) {
    const m = oid.match(/(\d+)\s*$/)
    if (m) return `Заказ №${m[1]}`
    return `Заказ ${oid}`
  }
  return `Чек ${s.id.slice(-6)}`
}

function cardForClient(client: EnrichedClient, cards: AdminCard[]): AdminCard | undefined {
  if (!client.card) return undefined
  return cards.find(c => cardNumsMatch(c.num, client.card) && c.status !== 'unlinked')
}

async function repayDebtIntoOpenShift(
  client: EnrichedClient,
  amount: number,
  opts: { method: PayMethod; note?: string },
) {
  const shift = resolveOpenShift(getBoundPosIdSync())
  if (!shift) {
    throw new Error('Откройте смену, чтобы принять погашение в кассу')
  }
  let card = cardForClient(client, useCardStore.getState().cards)
  if (!card) {
    const provisioned = await provisionLoyaltyCardSafe(client)
    card = cardForClient(provisioned.data, useCardStore.getState().cards)
    client = { ...client, ...provisioned.data }
  }
  if (!card) throw new Error('Не удалось получить карту лояльности')
  const fresh = useClientStore.getState().clients.find(c => c.id === client.id) || client
  const prevDebt = Math.max(0, Number(fresh.debt) || 0, Number(card.debt) || 0)
  if (amount > prevDebt + 0.009) {
    throw new Error(`Долг клиента ${fmtMoney(prevDebt)}`)
  }
  return debtRepaySafe(card.num, {
    amount,
    method: opts.method,
    note: opts.note,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    shiftId: shift.id,
    posId: shift.posId,
    clientId: client.id,
    prevDebt,
  })
}

async function chargeCashDebtFromOpenShift(
  client: EnrichedClient,
  amount: number,
  opts: { note?: string },
) {
  const shift = resolveOpenShift(getBoundPosIdSync())
  if (!shift) {
    throw new Error('Откройте смену, чтобы выдать наличные из кассы')
  }
  const expected = shiftExpectedCashLocal(shift)
  if (amount > expected + 0.009) {
    throw new Error(`В кассе недостаточно наличных (доступно ${fmtMoney(expected)})`)
  }
  const note = opts.note || `Выдача наличных · ${client.name}`
  await financeMoveSafe({
    type: 'withdraw',
    amount,
    note,
    shiftId: shift.id,
    posId: shift.posId,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    createdBy: shift.cashierName,
  })
  try {
    return await adjustClientDebtSafe(client, { action: 'charge', amount })
  } catch (e) {
    await financeMoveSafe({
      type: 'deposit',
      amount,
      note: `Отмена выдачи наличных · ${client.name}`,
      shiftId: shift.id,
      posId: shift.posId,
      cashierId: shift.cashierId,
      cashierName: shift.cashierName,
      createdBy: shift.cashierName,
    }).catch(() => { /* долг не записался — ящик вернём отдельно */ })
    throw e
  }
}

function salesFor(client: EnrichedClient, sales: PosSale[]): PosSale[] {
  return sales.filter(s =>
    (s.clientId && s.clientId === client.id)
    || (s.clientPhone && phonesMatch(s.clientPhone, client.phone)),
  )
}

function posDebtSalesFor(client: EnrichedClient, sales: PosSale[]): PosDebtSale[] {
  return salesFor(client, sales)
    .map(s => {
      const debtAdded = saleOpenCreditAmount(s)
      const paidCash = Number(s.paidCash) || 0
      const paidCard = Number(s.paidCard) || 0
      const partial = debtAdded > 0 && (paidCash > 0 || paidCard > 0)
      return {
        id: s.id,
        number: s.number,
        orderId: s.orderId,
        dateIso: s.createdAtIso,
        total: Number(s.total) || 0,
        paidCash,
        paidCard,
        debtAdded,
        paymentMethod: s.paymentMethod,
        itemsCount: s.items?.length || 0,
        note: s.note,
        partial,
        cashierName: s.cashierName,
        items: (s.items || []).map(it => ({
          name: it.productName || `#${it.productId}`,
          qty: Number(it.qty) || 0,
          unit: it.unit,
          price: Number(it.price) || 0,
          lineTotal: Number(it.lineTotal) || 0,
        })),
      }
    })
    .filter(s => s.debtAdded > 0.001)
    .sort((a, b) => String(b.dateIso).localeCompare(String(a.dateIso)))
}

function paymentMethodLabel(method: string, partial: boolean): string {
  if (partial) return 'Частично'
  if (method === 'credit') return 'В долг'
  if (method === 'mixed') return 'Смешанная'
  if (method === 'cash') return 'Наличные'
  if (method === 'card') return 'Карта'
  return method || '—'
}

function saleOrderKeys(s: { id: string; orderId?: string }): string[] {
  return [s.id, s.orderId, s.id ? `sale-${s.id}` : '', s.orderId ? `sale-${s.orderId}` : '']
    .map(k => String(k || '').trim())
    .filter(Boolean)
}

function enrichDebtClient(client: EnrichedClient, cards: AdminCard[], sales: PosSale[]): DebtClientRow {
  const card = cardForClient(client, cards)
  const debt = effectiveDebt(client, card)
  const debtLimit = resolveEffectiveDebtLimit(client)
  const history = loadDebtHistoryForClient(client)
  const manual = history.filter(isManualDebtHistoryEntry)
  const totals = debtHistoryTotals(manual)
  const posSales = posDebtSalesFor(client, sales)
  const { posRemain, cashOnCard } = buildSaleDebtStatuses(posSales, history, debt)
  return {
    ...client,
    debt,
    debtLimit,
    available: Math.max(0, debtLimit - debt),
    overLimit: debtLimit > 0 && debt > debtLimit,
    goodsDebt: posRemain,
    cashDebt: cashOnCard,
    borrowed: totals.borrowed,
    repaid: totals.repaid,
  }
}

function DebtStatusBadge({ overLimit, debt }: { overLimit: boolean; debt: number }) {
  if (overLimit) return <span className="k-badge" style={{ background: 'var(--badge-warn-bg)', color: 'var(--red)' }}>⚠ Превышен лимит</span>
  if (debt > 0) return <span className="k-badge" style={{ background: 'var(--badge-debt-bg)', color: 'var(--gold)' }}>В долгу</span>
  return <span className="k-badge" style={{ background: 'var(--badge-debt-ok)', color: 'var(--green)' }}>Без долга</span>
}

function kindMeta(kind: FeedRow['kind']) {
  if (kind === 'pos') return { label: 'Чек в долг', color: 'var(--blue)', icon: '🧾' }
  if (kind === 'cash') return { label: 'Наличные', color: 'var(--gold)', icon: '💵' }
  return { label: 'Оплата', color: 'var(--green)', icon: '✅' }
}

function buildFeed(
  manual: DebtHistoryEntry[],
  posSales: PosDebtSale[],
  residualCash = 0,
  checkPays: DebtHistoryEntry[] = [],
  saleStatus: Record<string, SaleDebtStatus> = {},
): FeedRow[] {
  const rows: FeedRow[] = [
    ...manual.map(row => {
      const isPay = row.type === 'pay'
      const dueNote = row.overdue
        ? ' · просрочен'
        : row.dueDate
          ? ` · до ${row.dueDate}`
          : ''
      return {
        key: `h-${row.id}`,
        ts: Number(row.ts) || 0,
        dateLabel: `${row.date}${row.time ? ` · ${row.time}` : ''}`,
        kind: (isPay ? 'pay' : 'cash') as FeedRow['kind'],
        title: isPay ? 'Оплата' : 'Наличные',
        desc: `${row.desc || (isPay ? 'Погашение долга' : 'Ручное начисление')}${dueNote}`,
        amount: isPay ? -Math.abs(Number(row.amount) || 0) : Math.abs(Number(row.amount) || 0),
        editable: isManualDebtHistoryEntry(row) ? row : undefined,
      }
    }),
    ...checkPays.map(row => ({
      key: `cp-${row.id}`,
      ts: Number(row.ts) || 0,
      dateLabel: `${row.date}${row.time ? ` · ${row.time}` : ''}`,
      kind: 'pay' as const,
      title: 'Оплата',
      desc: row.desc || 'Погашение чека',
      amount: -Math.abs(Number(row.amount) || 0),
      saleId: row.orderId?.replace(/^sale-/, '') || undefined,
    })),
    ...posSales.map(s => {
      const st = saleStatus[s.id]
      const statusNote = !st
        ? ''
        : st.status === 'paid'
          ? ' · погашен'
          : st.status === 'partial'
            ? ` · остаток ${fmtMoney(st.remain)}`
            : ` · к оплате ${fmtMoney(st.remain)}`
      return {
        key: `p-${s.id}`,
        ts: Date.parse(s.dateIso) || 0,
        dateLabel: s.dateIso ? fmtDateTime(s.dateIso) : '—',
        kind: 'pos' as const,
        title: 'Чек в долг',
        desc: `${saleLabel(s)}${statusNote}${s.items.length ? ` · ${s.items.slice(0, 2).map(i => i.name).join(', ')}${s.items.length > 2 ? '…' : ''}` : ''}`,
        // В истории сумма чека = исходный долг; погашения идут отдельными строками «Оплата»
        amount: Math.abs(Number(s.debtAdded) || 0),
        saleId: s.id,
      }
    }),
  ]
  if (residualCash > 0.005) {
    rows.push({
      key: 'residual-cash',
      ts: 1,
      dateLabel: 'раньше',
      kind: 'cash',
      title: 'Наличные',
      desc: 'Ручной долг на карте (без записи в истории)',
      amount: residualCash,
    })
  }
  return rows.sort((a, b) => b.ts - a.ts)
}

function withRunningBalance(feed: FeedRow[]): (FeedRow & { balance: number })[] {
  const chronological = [...feed].sort((a, b) => a.ts - b.ts)
  let bal = 0
  const withBal = chronological.map(row => {
    bal = Math.round((bal + row.amount) * 100) / 100
    return { ...row, balance: Math.max(0, bal) }
  })
  return withBal.reverse()
}

export default function DebtsModule({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const storedClients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const sales = usePosStore(s => s.sales)
  const shifts = usePosStore(s => s.shifts)
  const orders = useOrders(s => s.orders)
  const apiError = useClientStore(s => s.apiError)
  const openShift = useMemo(() => resolveOpenShift(getBoundPosIdSync()), [shifts])

  const clients = useMemo(() => mergeClientsWithOrders(storedClients, orders), [storedClients, orders])

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('debt')
  const [filter, setFilter] = useState<ListFilter>('with_debt')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('history')
  const [histAdd, setHistAdd] = useState<HistAddState>(emptyHistAdd)
  const [histMsg, setHistMsg] = useState('')
  const [histTick, setHistTick] = useState(0)
  const [histEdit, setHistEdit] = useState<{ id: string; amount: string; desc: string; saving: boolean } | null>(null)
  const [saleDetailId, setSaleDetailId] = useState<string | null>(null)
  const [saleRepay, setSaleRepay] = useState<SaleRepayState | null>(null)
  const [posView, setPosView] = useState<PosViewFilter>('open')

  const refreshAll = useCallback(() => {
    void Promise.all([
      hydrateOfflineCaches(),
      softSyncPosAfterSale(),
      syncClientsFromApi(),
      syncCardsFromApi(),
    ])
  }, [])

  useEffect(() => { refreshAll() }, [refreshAll])

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), [])

  const debtClients = useMemo(() => {
    void histTick
    return clients
      .filter(c => cardHasDebtSection(cardForClient(c, cards) || {}, c) || (Number(c.debt) || 0) > 0)
      .map(c => enrichDebtClient(c, cards, sales))
  }, [clients, cards, sales, histTick])

  const counts = useMemo(() => ({
    all: debtClients.length,
    withDebt: debtClients.filter(c => (Number(c.debt) || 0) > 0).length,
    cleared: debtClients.filter(c => !(Number(c.debt) > 0)).length,
    totalDebt: debtClients.reduce((s, c) => s + (Number(c.debt) || 0), 0),
  }), [debtClients])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = debtClients
    if (filter === 'with_debt') list = list.filter(c => (Number(c.debt) || 0) > 0)
    else if (filter === 'cleared') list = list.filter(c => !(Number(c.debt) > 0))
    if (query) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(query)
        || (c.phone || '').replace(/\s/g, '').includes(query.replace(/\s/g, ''))
        || (c.card || '').toLowerCase().includes(query),
      )
    }
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else sorted.sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    return sorted
  }, [debtClients, q, sort, filter])

  // Автовыбор первого клиента на десктопе
  useEffect(() => {
    if (detailId) return
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) return
    if (filtered[0]) setDetailId(filtered[0].id)
  }, [filtered, detailId])

  const detailClient = detailId ? debtClients.find(c => c.id === detailId) || null : null

  useEffect(() => {
    const phone = detailClient?.phone
    if (!phone) return
    void syncDebtHistoryFromLedger(phone)
  }, [detailClient?.phone])

  const detailData = useMemo(() => {
    if (!detailClient) return null
    void histTick
    const history = loadDebtHistoryForClient(detailClient).sort((a, b) => (b.ts || 0) - (a.ts || 0))
    const posSalesForCash = posDebtSalesFor(detailClient, sales)
    const manual = history.filter(isManualDebtHistoryEntry)
    const cash = history.filter(r => isLedgerCashHistoryDebt(r, posSalesForCash))
    const pays = manual.filter(r => r.type === 'pay')
    const checkPays = history.filter(r => r.type === 'pay' && !isManualDebtHistoryEntry(r))
    const posSales = posSalesForCash
    const manualTotals = debtHistoryTotals(manual)
    const cardDebt = Math.max(0, Number(detailClient.debt) || 0)
    const { saleStatus, posOriginal, posRemain, cashOnCard } = buildSaleDebtStatuses(
      posSales,
      history,
      cardDebt,
    )
    const cashChargeSum = Math.round(
      cash.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) * 100,
    ) / 100
    const residualCash = Math.max(0, Math.round((cashOnCard - cashChargeSum) * 100) / 100)

    const allPaySum = Math.round(
      history.filter(r => r.type === 'pay').reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) * 100,
    ) / 100
    const payRows = [...checkPays]
    const feed = buildFeed([...cash, ...pays], posSales, residualCash, payRows, saleStatus)
    return {
      history,
      manual,
      cash,
      pays,
      checkPays: payRows,
      posSales,
      manualTotals,
      posSum: posRemain,
      posOriginal,
      cashOnCard,
      residualCash,
      feed,
      historyFeed: withRunningBalance(feed),
      saleStatus,
      openChecks: posSales.filter(s => (saleStatus[s.id]?.remain || 0) > 0.001).length,
      repaidTotal: allPaySum,
      bonus: Math.max(
        0,
        Number(detailClient.bonus) || 0,
        Number(cardForClient(detailClient, cards)?.bonus) || 0,
      ),
    }
  }, [detailClient, histTick, sales, cards])

  useEffect(() => {
    if (!saleDetailId && !detailId) return
    return pushBackHandler(() => {
      if (saleDetailId) {
        setSaleDetailId(null)
        setSaleRepay(null)
        return true
      }
      if (detailId) {
        setDetailId(null)
        return true
      }
      return false
    })
  }, [saleDetailId, detailId])

  function selectClient(id: string) {
    setDetailId(id)
    setDetailTab('history')
    setHistAdd(emptyHistAdd())
    setHistMsg('')
    setHistEdit(null)
    setSaleDetailId(null)
    setSaleRepay(null)
  }

  function openSaleDetail(saleId: string) {
    setSaleDetailId(saleId)
    const st = detailData?.saleStatus[saleId]
    const cardDebt = Math.max(0, Number(detailClient?.debt) || 0)
    const remain = Math.min(st?.remain ?? 0, cardDebt)
    setSaleRepay(remain > 0.001 ? { amount: String(remain), saving: false, method: 'cash' } : null)
  }

  async function submitSaleRepay() {
    if (!detailClient || !saleDetailId || !saleRepay || !detailData) return
    const histKey = debtAccountKey(detailClient)
    if (!histKey) return
    const s = detailData.posSales.find(x => x.id === saleDetailId)
    if (!s) return
    const st = detailData.saleStatus[s.id]
    const cardDebt = Math.max(0, Number(detailClient.debt) || 0)
    const maxPay = Math.min(st?.remain ?? 0, cardDebt)
    const amount = Math.round(Math.min(Number(saleRepay.amount) || 0, maxPay) * 100) / 100
    if (!(amount > 0.001)) {
      setHistMsg('Укажите сумму погашения')
      return
    }
    if (!(maxPay > 0.001)) {
      setHistMsg('По этому чеку погашать нечего')
      return
    }
    // Привязка к записи долга в истории (orderId чека или найденный долг)
    const keys = [s.id, s.orderId, s.id ? `sale-${s.id}` : '', s.orderId ? `sale-${s.orderId}` : '']
      .map(k => String(k || '').trim())
      .filter(Boolean)
    const { unpaid } = buildDebtOrderBalances(detailData.history)
    const linked = unpaid.find(d => keys.some(k => debtOrderIdsMatch(d.orderId, k)))
      || unpaid.find(d =>
        Math.abs(Math.abs(Number(d.amount) || 0) - Number(s.debtAdded)) < 0.02
        && Math.abs((d.ts || 0) - (Date.parse(s.dateIso) || 0)) < 10 * 60 * 1000,
      )
    const linkOrderId = linked?.orderId || s.orderId || s.id
    if (linked && !linked.orderId) {
      ensureDebtHistoryOrderId(histKey, linked.id, linkOrderId)
    }

    setSaleRepay(prev => prev ? { ...prev, saving: true } : prev)
    setHistMsg('')
    try {
      const method = saleRepay.method || 'cash'
      const repaid = await repayDebtIntoOpenShift(detailClient, amount, {
        method,
        note: `Погашение · ${saleLabel(s)} · ${detailClient.name}`,
      })
      if (repaid.data.duplicate) {
        setHistMsg('Это погашение уже записано')
        setSaleRepay(prev => prev ? { ...prev, saving: false } : prev)
        return
      }
      recordStoreDebtRepayment(histKey, amount, {
        desc: `Погашение · ${saleLabel(s)}`,
        orderId: linkOrderId,
        method,
      })
      const nextRemain = Math.round((maxPay - amount) * 100) / 100
      setHistMsg(`Погашено по ${saleLabel(s)}: ${fmtMoney(amount)} · ${method === 'card' ? 'карта' : 'нал'} · в кассу`)
      void refreshAll()
      if (nextRemain > 0.001) {
        setSaleRepay({ amount: String(nextRemain), saving: false, method })
      } else {
        setSaleRepay(null)
      }
    } catch (e) {
      setSaleRepay(prev => prev ? { ...prev, saving: false } : prev)
      setHistMsg(e instanceof Error ? e.message : 'Не удалось погасить')
    }
  }

  function openAdd(action: 'repay' | 'add') {
    setDetailTab(action === 'repay' ? 'pay' : 'cash')
    setHistAdd({
      open: true,
      action,
      amount: action === 'repay' && detailClient ? String(Number(detailClient.debt) || '') : '',
      desc: '',
      saving: false,
      method: 'cash',
    })
    setHistEdit(null)
  }

  async function submitHistoryAdd() {
    if (!detailClient) return
    const amount = Number(histAdd.amount) || 0
    if (!(amount > 0)) {
      setHistMsg('Укажите сумму')
      return
    }
    setHistAdd(prev => ({ ...prev, saving: true }))
    setHistMsg('')
    try {
      if (histAdd.action === 'repay') {
        const debtNow = Math.max(0, Number(detailClient.debt) || 0)
        if (amount > debtNow + 0.009) {
          setHistAdd(prev => ({ ...prev, saving: false }))
          setHistMsg(`Долг клиента ${fmtMoney(debtNow)}`)
          return
        }
        const method = histAdd.method || 'cash'
        const res = await repayDebtIntoOpenShift(detailClient, amount, {
          method,
          note: `Погашение долга · ${detailClient.name}`,
        })
        if (res.data.duplicate) {
          setHistAdd(prev => ({ ...prev, saving: false }))
          setHistMsg('Это погашение уже записано')
          return
        }
        const histKey = debtAccountKey(detailClient)
        if (histKey) {
          const openChecks = (detailData?.posSales || [])
            .map(s => ({
              orderId: s.orderId || s.id,
              remain: Number(detailData?.saleStatus[s.id]?.remain) || 0,
              label: saleLabel(s),
              ts: Date.parse(s.dateIso) || 0,
            }))
            .filter(t => t.remain > 0.001)
            .sort((a, b) => a.ts - b.ts)
          if (openChecks.length) {
            recordStoreDebtRepaymentFifo(histKey, amount, openChecks, {
              method,
              source: 'cashier',
              desc: histAdd.desc.trim() || undefined,
            })
          } else {
            recordStoreDebtRepayment(histKey, amount, {
              method,
              desc: histAdd.desc.trim() || undefined,
            })
          }
        }
        setHistAdd(emptyHistAdd('repay'))
        setHistMsg(`Оплата записана: ${fmtMoney(amount)} · ${method === 'card' ? 'карта' : 'нал'} · в кассу`)
        if (!res.offline) void refreshAll()
        return
      }
      const res = await chargeCashDebtFromOpenShift(detailClient, amount, {
        note: histAdd.desc.trim() || `Выдача наличных · ${detailClient.name}`,
      })
      const desc = histAdd.desc.trim()
      const histKey = debtAccountKey(detailClient)
      if (desc && histKey) {
        const latest = loadDebtHistory(histKey).find(isManualDebtHistoryEntry)
        if (latest) updateDebtHistoryEntry(histKey, latest.id, { desc })
      }
      setHistAdd(emptyHistAdd(histAdd.action))
      setHistMsg(`Выдано наличными: ${fmtMoney(amount)} · из кассы`)
      if (!res.offline) void refreshAll()
    } catch (e) {
      setHistAdd(prev => ({ ...prev, saving: false }))
      setHistMsg(e instanceof Error ? e.message : 'Ошибка операции')
    }
  }

  async function applyDebtDeltaFromHistory(delta: number) {
    if (!detailClient || Math.abs(delta) < 0.005) return
    const current = Math.max(0, Number(detailClient.debt) || 0)
    const next = Math.max(0, Math.round((current + delta) * 100) / 100)
    await adjustClientDebtSafe(detailClient, {
      action: 'repay',
      amount: 0,
      absoluteDebt: next,
      skipDebtHistory: true,
    })
  }

  async function documentResidualCash() {
    const histKey = debtAccountKey(detailClient)
    if (!histKey || !detailData || detailData.residualCash < 0.005) return
    const amt = detailData.residualCash
    if (!window.confirm(
      `Записать ${fmtMoney(amt)} в «Наличные»?\n\nДолг на карте не изменится — появится строка в истории.`,
    )) return
    recordStoreDebtCharge(histKey, amt, 'Ручное начисление (раньше на карте)', { source: 'manual' })
    setHistMsg(`Записано в наличные: ${fmtMoney(amt)}`)
    setHistTick(t => t + 1)
  }

  async function clearResidualCashFromCard() {
    if (!detailClient || !detailData || detailData.residualCash < 0.005) return
    const amt = detailData.residualCash
    const next = Math.max(0, Math.round((Number(detailClient.debt) - amt) * 100) / 100)
    if (!window.confirm(
      `Убрать с карты ${fmtMoney(amt)}?\n\nОстанется долг ${fmtMoney(next)} (чеки + записанные наличные).`,
    )) return
    try {
      await adjustClientDebtSafe(detailClient, {
        action: 'repay',
        amount: 0,
        absoluteDebt: next,
        skipDebtHistory: true,
      })
      setHistMsg(`С карты убрано: ${fmtMoney(amt)}`)
      void refreshAll()
    } catch (e) {
      setHistMsg(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  async function deleteManualHistory(row: DebtHistoryEntry) {
    const histKey = debtAccountKey(detailClient)
    if (!histKey || !isManualDebtHistoryEntry(row)) return
    const abs = Math.abs(Number(row.amount) || 0)
    const label = row.type === 'pay' ? 'оплату' : 'начисление'
    if (!window.confirm(`Удалить ${label} ${fmtMoney(abs)}? Чеки не затрагиваются.`)) return
    const removed = removeDebtHistoryEntry(histKey, row.id)
    if (!removed) {
      setHistMsg('Эту запись нельзя удалить')
      return
    }
    setHistEdit(null)
    try {
      await applyDebtDeltaFromHistory(debtBalanceDeltaForHistoryChange(removed, null))
      setHistMsg(`Удалено: ${fmtMoney(abs)}`)
      void refreshAll()
    } catch (e) {
      setHistMsg(e instanceof Error ? e.message : 'Не удалось обновить баланс')
    }
  }

  async function saveManualHistoryEdit() {
    const histKey = debtAccountKey(detailClient)
    if (!histKey || !histEdit) return
    const before = loadDebtHistory(histKey).find(r => r.id === histEdit.id)
    if (!before || !isManualDebtHistoryEntry(before)) {
      setHistEdit(null)
      return
    }
    const amountAbs = Number(histEdit.amount) || 0
    if (!(amountAbs > 0)) {
      setHistMsg('Укажите сумму больше 0')
      return
    }
    setHistEdit(prev => prev ? { ...prev, saving: true } : prev)
    try {
      const after = updateDebtHistoryEntry(histKey, histEdit.id, {
        amountAbs,
        desc: histEdit.desc,
      })
      if (!after) throw new Error('Не удалось сохранить')
      await applyDebtDeltaFromHistory(debtBalanceDeltaForHistoryChange(before, after))
      setHistEdit(null)
      setHistMsg(`Запись обновлена: ${fmtMoney(amountAbs)}`)
      void refreshAll()
    } catch (e) {
      setHistEdit(prev => prev ? { ...prev, saving: false } : prev)
      setHistMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    }
  }

  function renderEditableRow(row: DebtHistoryEntry) {
    const isPay = row.type === 'pay'
    const editing = histEdit?.id === row.id
  return (
      <div
        key={row.id}
        style={{
          padding: '12px 14px', borderRadius: 12, marginBottom: 8,
          background: isPay ? 'rgba(31,215,96,.06)' : 'var(--card2)',
          border: `1px solid ${isPay ? 'rgba(31,215,96,.25)' : 'var(--border)'}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {row.desc || (isPay ? 'Погашение долга' : 'Ручное начисление')}
          </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              {row.date} · {row.time || '—'}
        </div>
        </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 900, color: isPay ? 'var(--green)' : 'var(--gold)' }}>
              {isPay ? '−' : '+'}{fmtMoney(Math.abs(row.amount))}
      </div>
            {!editing && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ fontSize: 12, padding: '4px 10px', minHeight: 0 }}
                  onClick={() => setHistEdit({
                    id: row.id,
                    amount: String(Math.abs(Number(row.amount) || 0)),
                    desc: row.desc || '',
                    saving: false,
                  })}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ fontSize: 12, padding: '4px 10px', minHeight: 0, color: 'var(--red)' }}
                  onClick={() => void deleteManualHistory(row)}
                >
                  Удалить
                </button>
        </div>
      )}
        </div>
          </div>
        {editing && histEdit && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 110px' }}>
                <label style={{ fontSize: 11 }}>Сумма</label>
                <input
                  className="k-inp"
                  value={histEdit.amount}
                  disabled={histEdit.saving}
                  onChange={e => setHistEdit(prev => prev ? { ...prev, amount: sanitizeDecimalInput(e.target.value) } : prev)}
                />
        </div>
              <div style={{ flex: '2 1 160px' }}>
                <label style={{ fontSize: 11 }}>Описание</label>
                <input
                  className="k-inp"
                  value={histEdit.desc}
                  disabled={histEdit.saving}
                  onChange={e => setHistEdit(prev => prev ? { ...prev, desc: e.target.value } : prev)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ fontSize: 12 }} disabled={histEdit.saving} onClick={() => void saveManualHistoryEdit()}>
                {histEdit.saving ? '…' : 'Сохранить'}
              </button>
              <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12 }} disabled={histEdit.saving} onClick={() => setHistEdit(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderAddForm() {
    if (!histAdd.open) return null
    return (
      <div style={{
        padding: '12px 14px', borderRadius: 12, marginBottom: 12,
        background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.25)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: 'var(--gold)' }}>
          {histAdd.action === 'repay' ? 'Погашение долга' : 'Выдать наличные в долг'}
        </div>
        {(histAdd.action === 'repay' || histAdd.action === 'add') && (
          <div style={{ fontSize: 12, marginBottom: 8, color: openShift ? 'var(--muted)' : 'var(--red)', fontWeight: 700 }}>
            {histAdd.action === 'repay'
              ? (openShift
                ? `В кассу · ${openShift.cashierName || 'смена открыта'} · ${histAdd.method === 'card' ? 'карта' : 'нал'}`
                : 'Смена закрыта — откройте смену, чтобы принять оплату')
              : (openShift
                ? `Из кассы · ${openShift.cashierName || 'смена открыта'} · нал · в ящике ${fmtMoney(shiftExpectedCashLocal(openShift))}`
                : 'Смена закрыта — откройте смену, чтобы выдать наличные')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {histAdd.action === 'repay' && (
            <div>
              <label style={{ fontSize: 11 }}>Оплата</label>
              <PayMethodToggle
                value={histAdd.method}
                disabled={histAdd.saving}
                onChange={m => setHistAdd(prev => ({ ...prev, method: m }))}
              />
            </div>
          )}
          <div style={{ flex: '1 1 110px' }}>
            <label style={{ fontSize: 11 }}>Сумма</label>
        <input
          className="k-inp"
              value={histAdd.amount}
              disabled={histAdd.saving}
              onChange={e => setHistAdd(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value) }))}
              placeholder="0.00"
            />
          </div>
          <div style={{ flex: '2 1 160px' }}>
            <label style={{ fontSize: 11 }}>Описание</label>
            <input
              className="k-inp"
              value={histAdd.desc}
              disabled={histAdd.saving}
              onChange={e => setHistAdd(prev => ({ ...prev, desc: e.target.value }))}
              placeholder={histAdd.action === 'repay' ? 'Погашение долга' : 'Выдано наличными'}
            />
          </div>
          {histAdd.action === 'repay' && detailClient && Number(detailClient.debt) > 0 && (
            <button
              type="button"
              className="k-btn k-btn-s"
              style={{ fontSize: 12 }}
              onClick={() => setHistAdd(prev => ({ ...prev, amount: String(detailClient.debt) }))}
            >
              Весь долг
            </button>
          )}
          <button type="button" className="k-btn k-btn-g" style={{ fontSize: 13 }} disabled={histAdd.saving || !openShift} onClick={() => void submitHistoryAdd()}>
            {histAdd.saving ? '…' : 'Сохранить'}
          </button>
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 13 }} disabled={histAdd.saving} onClick={() => setHistAdd(emptyHistAdd())}>
            Отмена
          </button>
        </div>
      </div>
    )
  }

  const msgOk = /Удалено|обновлена|Оплата|Выдано|Записано|С карты|исправлен|Долг на карте|Погашено/i.test(histMsg)
  const cardDebt = detailClient ? Math.max(0, Number(detailClient.debt) || 0) : 0

  return (
    <div className="k-debts-page">
      <OfflineNotice section="долги" />
      {apiError && (
        <div className="k-trade-banner" style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12, flexShrink: 0,
          background: 'var(--alert-error-bg)', color: 'var(--red)', border: '1px solid var(--alert-error-border)',
        }}>
          {apiError}
        </div>
      )}

      <div className={`k-debts-layout ${detailClient ? 'detail-open' : ''}`}>
        {/* ── Список ── */}
        <aside className="k-debts-list">
          <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div className="k-subtabs" style={{ marginBottom: 6, gap: 4 }}>
              {([
                ['all', `Все (${counts.all})`],
                ['with_debt', `Долг (${counts.withDebt})`],
                ['cleared', `0 (${counts.cleared})`],
              ] as [ListFilter, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`k-subtab ${filter === id ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11 }}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="k-inp"
                style={{ flex: 1, minHeight: 34, padding: '6px 8px', fontSize: 13 }}
                placeholder="Поиск…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
              <select
                className="k-sel"
                style={{ width: 110, minHeight: 34, padding: '6px 8px', fontSize: 12 }}
                value={sort}
                onChange={e => setSort(e.target.value as SortMode)}
              >
                <option value="debt">По сумме</option>
                <option value="name">По имени</option>
              </select>
        </div>
      </div>

          <div className="k-debts-list-b">
      {!filtered.length ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                Никого не найдено
        </div>
            ) : filtered.map(c => {
            const debt = Number(c.debt) || 0
              const active = c.id === detailId
            return (
                <button
                key={c.id}
                  type="button"
                  className={`k-debts-row ${active ? 'active' : ''}`}
                  onClick={() => selectClient(c.id)}
                  style={{ width: '100%', textAlign: 'left', color: 'inherit', fontFamily: 'inherit' }}
                >
                  <div className="k-debts-av">{initials(c.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{c.phone || '—'}</div>
                    <div style={{ fontSize: 10, marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--blue)' }}>Т: {fmtMoney(c.goodsDebt)}</span>
                      <span style={{ color: 'var(--gold)' }}>Н: {fmtMoney(c.cashDebt)}</span>
                    </div>
                      </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {debt > 0 ? fmtMoney(debt) : '—'}
                      </div>
                    </div>
                </button>
            )
          })}
        </div>

          <div className="k-debts-foot">
            <span style={{ color: 'var(--muted)' }}>Всего долг</span>
            <span style={{ color: counts.totalDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>
              {counts.totalDebt > 0 ? fmtMoney(counts.totalDebt) : '—'}
            </span>
                </div>
        </aside>

        {/* ── Деталь ── */}
        <section className="k-debts-detail">
          {!detailClient || !detailData ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              Выберите клиента слева
              </div>
          ) : (
            <>
              <div className="k-debts-head">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    style={{ display: 'none', fontSize: 11, padding: '4px 8px', minHeight: 0 }}
                    onClick={() => setDetailId(null)}
                    id="k-debts-back"
                  >
                    ←
                  </button>
                  <style>{`@media (max-width:900px){#k-debts-back{display:inline-flex!important}}`}</style>
                  <div className="k-debts-av">{initials(detailClient.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14 }}>{detailClient.name}</b>
                      <DebtStatusBadge overLimit={detailClient.overLimit} debt={cardDebt} />
                      {detailClient.debtCreditBlocked && (
                        <span className="k-badge" style={{ background: 'var(--badge-warn-bg)', color: 'var(--red)' }}>
                          Новый долг закрыт
                        </span>
                      )}
                      <span className="k-badge" style={{
                        fontSize: 10,
                        background: `${CLIENT_LEVEL_COLORS[detailClient.level] || 'var(--muted)'}22`,
                        color: CLIENT_LEVEL_COLORS[detailClient.level] || 'var(--muted)',
                      }}>
                        {levelLabel(detailClient.level)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {detailClient.phone && <span>☎ {detailClient.phone}</span>}
                      {detailClient.card && (
                        <span>
                          {' · '}💳 {detailClient.card}
                          {(() => {
                            const card = cardForClient(detailClient, cards)
                            return card ? ` · ${CARD_STATUS_LABELS[card.status].l}` : ''
                          })()}
                        </span>
                      )}
                      {(() => {
                        const overdueN = detailData.history.filter(r => r.type === 'debt' && r.overdue).length
                        if (overdueN > 0) {
                          return <span style={{ color: 'var(--red)' }}>{' · '}просрочено: {overdueN}</span>
                        }
                        const nextDue = [...detailData.history]
                          .filter(r => r.type === 'debt' && r.dueDate && (r.daysLeft == null || r.daysLeft >= 0))
                          .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))[0]
                        return nextDue?.dueDate
                          ? <span>{' · '}срок {nextDue.dueDate}</span>
                          : null
                      })()}
                  </div>
                  </div>
                    </div>

                <div className="k-debts-metrics">
                  <div className="k-debts-metric">
                    <div className="kl">Товары</div>
                    <div className="kv" style={{ color: 'var(--blue)' }}>{fmtMoney(detailData.posSum)}</div>
                    {detailData.posOriginal > detailData.posSum + 0.05 && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        из {fmtMoney(detailData.posOriginal)}
                  </div>
                )}
              </div>
                  <div className="k-debts-metric">
                    <div className="kl">Наличные</div>
                    <div className="kv" style={{ color: 'var(--gold)' }}>{fmtMoney(detailData.cashOnCard)}</div>
                </div>
                  <div className="k-debts-metric">
                    <div className="kl">Итого</div>
                    <div className="kv" style={{ color: cardDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                      {cardDebt > 0 ? fmtMoney(cardDebt) : '—'}
                  </div>
                </div>
                </div>
              </div>

              <div style={{ padding: '6px 8px 0', flexShrink: 0 }}>
                <div className="k-subtabs" style={{ marginBottom: 6, gap: 4 }}>
                  {([
                    ['history', 'История'],
                    ['pos', `Чеки (${detailData.openChecks}/${detailData.posSales.length})`],
                    ['cash', `Нал. (${detailData.cash.length + (detailData.residualCash > 0.005 ? 1 : 0)})`],
                    ['pay', `Оплаты (${detailData.pays.length + detailData.checkPays.length})`],
                  ] as [DetailTab, string][]).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`k-subtab ${detailTab === id ? 'active' : ''}`}
                      style={{ padding: '5px 10px', fontSize: 11 }}
                      onClick={() => {
                        setDetailTab(id)
                        setHistEdit(null)
                        if (id !== 'cash' && id !== 'pay') setHistAdd(emptyHistAdd())
                      }}
                    >
                    {label}
                  </button>
                ))}
              </div>

                {histMsg && (
                  <div style={{
                    marginBottom: 6, padding: '5px 8px', borderRadius: 6, fontSize: 11,
                    background: msgOk ? 'rgba(20,178,79,.12)' : 'var(--alert-error-bg)',
                    color: msgOk ? 'var(--green)' : 'var(--red)',
                    border: '1px solid var(--alert-error-border)',
                  }}>
                    {histMsg}
                  </div>
                )}
              </div>

              <div className="k-debts-detail-b">
              {detailTab === 'history' && (
                  !detailData.historyFeed.length ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      Пока нет движений
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="k-debts-table">
                        <thead>
                          <tr>
                            <th>Дата</th>
                            <th>Тип</th>
                            <th>Описание</th>
                            <th style={{ textAlign: 'right' }}>Сумма</th>
                            <th style={{ textAlign: 'right' }}>Остаток</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.historyFeed.map(row => {
                            const meta = kindMeta(row.kind)
                            const clickable = row.kind === 'pos' && row.saleId
                        return (
                              <tr
                                key={row.key}
                                onClick={() => clickable && openSaleDetail(row.saleId!)}
                                style={{ cursor: clickable ? 'pointer' : undefined }}
                                title={clickable ? 'Открыть детали заказа' : undefined}
                              >
                                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{row.dateLabel}</td>
                                <td>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: meta.color, fontSize: 12 }}>
                                    <span>{meta.icon}</span> {meta.label}
                              </span>
                                </td>
                                <td style={{ fontSize: 13 }}>
                                  {row.desc}
                                  {clickable && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · открыть</span>}
                                </td>
                                <td style={{
                                  textAlign: 'right', fontWeight: 900, whiteSpace: 'nowrap',
                                  color: row.amount < 0 ? 'var(--green)' : 'var(--gold)',
                                }}>
                                  {row.amount < 0 ? '−' : '+'}{fmtMoney(Math.abs(row.amount))}
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>
                                  {fmtMoney(row.balance)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {detailTab === 'pos' && (
                  !detailData.posSales.length ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      Нет чеков кассы в долг
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          К оплате: <b style={{ color: 'var(--blue)' }}>{detailData.openChecks}</b>
                          {' · '}всего {detailData.posSales.length}
                          {' · '}остаток <b style={{ color: 'var(--blue)' }}>{fmtMoney(detailData.posSum)}</b>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {([
                            ['open', 'К оплате'],
                            ['all', 'Все'],
                          ] as [PosViewFilter, string][]).map(([id, label]) => (
                        <button
                              key={id}
                          type="button"
                              className={`k-subtab ${posView === id ? 'active' : ''}`}
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => setPosView(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(() => {
                        const rows = detailData.posSales.filter(s => {
                          if (posView === 'all') return true
                          return (detailData.saleStatus[s.id]?.remain || 0) > 0.001
                        })
                        if (!rows.length) {
                          return (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                              {posView === 'open' ? 'Все чеки погашены' : 'Нет чеков'}
                            </div>
                          )
                        }
                        return (
                          <div style={{ overflowX: 'auto' }}>
                            <table className="k-debts-table">
                              <thead>
                                <tr>
                                  <th>Дата</th>
                                  <th>Статус</th>
                                  <th>Чек / состав</th>
                                  <th style={{ textAlign: 'right' }}>В долг</th>
                                  <th style={{ textAlign: 'right' }}>Остаток</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(s => {
                                  const st = detailData.saleStatus[s.id] || {
                                    status: 'open' as const,
                                    paid: 0,
                                    remain: s.debtAdded,
                                  }
                                  const statusLabel = st.status === 'paid'
                                    ? 'Погашен'
                                    : st.status === 'partial'
                                      ? 'Частично'
                                      : 'К оплате'
                                  const statusColor = st.status === 'paid'
                                    ? 'var(--green)'
                                    : st.status === 'partial'
                                      ? 'var(--gold)'
                                      : 'var(--blue)'
                                  const items = s.items.length
                                    ? s.items.slice(0, 2).map(i => i.name).join(', ') + (s.items.length > 2 ? '…' : '')
                                    : ''
                                  return (
                                    <tr
                                      key={s.id}
                                      onClick={() => openSaleDetail(s.id)}
                                      style={{ cursor: 'pointer' }}
                                      title="Открыть детали и погасить"
                                    >
                                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
                                        {s.dateIso ? fmtDateTime(s.dateIso) : '—'}
                                      </td>
                                      <td>
                                        <span style={{
                                          display: 'inline-flex', alignItems: 'center', gap: 6,
                                          fontWeight: 700, color: statusColor, fontSize: 12,
                                        }}>
                                          <span>{st.status === 'paid' ? '✅' : st.status === 'partial' ? '◐' : '🧾'}</span>
                                          {statusLabel}
                                </span>
                                      </td>
                                      <td style={{ fontSize: 13 }}>
                                        <span style={{ fontWeight: 700 }}>{saleLabel(s)}</span>
                                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                                          {' · '}{s.itemsCount} поз. · открыть
                                        </span>
                                        {items && (
                                          <div style={{
                                            fontSize: 11, color: 'var(--muted)', marginTop: 2,
                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
                                          }}>
                                            {items}
                              </div>
                                        )}
                                      </td>
                                      <td style={{
                                        textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap',
                                        color: 'var(--muted)', fontSize: 12,
                                      }}>
                                        {fmtMoney(s.debtAdded)}
                                      </td>
                                      <td style={{
                                        textAlign: 'right', fontWeight: 900, whiteSpace: 'nowrap',
                                        color: statusColor,
                                      }}>
                                        {st.status === 'paid' ? '—' : fmtMoney(st.remain)}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      })()}
                    </>
                  )
                )}

                {detailTab === 'cash' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Наличные = долг на карте минус чеки. Старый ручной ввод тоже здесь.
                            </div>
                      <button type="button" className="k-btn k-btn-g" style={{ fontSize: 12, minHeight: 0, padding: '6px 12px' }} onClick={() => openAdd('add')}>
                        + Выдать
                      </button>
                                </div>
                    {renderAddForm()}
                    {detailData.residualCash > 0.005 && (
                      <div style={{
                        padding: '12px 14px', borderRadius: 12, marginBottom: 8,
                        background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.3)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--gold)' }}>
                              Ручной долг на карте
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                              Раньше ввели вручную, в истории строки не было — учитываем как наличные
                          </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontWeight: 900, color: 'var(--gold)' }}>
                              +{fmtMoney(detailData.residualCash)}
                            </div>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="k-btn k-btn-s"
                                style={{ fontSize: 12, padding: '4px 10px', minHeight: 0 }}
                                onClick={() => void documentResidualCash()}
                              >
                                Записать в историю
                        </button>
                              <button
                                type="button"
                                className="k-btn k-btn-s"
                                style={{ fontSize: 12, padding: '4px 10px', minHeight: 0, color: 'var(--red)' }}
                                onClick={() => void clearResidualCashFromCard()}
                              >
                                Убрать с карты
                              </button>
                            </div>
                          </div>
                        </div>
                    </div>
                  )}
                    {!detailData.cash.length && detailData.residualCash < 0.005 && !histAdd.open ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                        Нет выдач наличными
                      </div>
                    ) : detailData.cash.map(renderEditableRow)}
                </>
              )}

                {detailTab === 'pay' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Погашения по чекам и ручные оплаты.
                      </div>
                      <button type="button" className="k-btn k-btn-g" style={{ fontSize: 12, minHeight: 0, padding: '6px 12px' }} onClick={() => openAdd('repay')}>
                        + Оплата
                      </button>
                    </div>
                    {renderAddForm()}
                    {!detailData.pays.length && !detailData.checkPays.length && !histAdd.open ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                        Нет оплат
                      </div>
                    ) : (
                      <>
                        {[...detailData.checkPays]
                          .sort((a, b) => (b.ts || 0) - (a.ts || 0))
                          .map(row => {
                            const isGap = row.id === 'gap-pay'
                            const sale = !isGap
                              ? detailData.posSales.find(s =>
                                debtOrderIdsMatch(s.id, row.orderId)
                                || debtOrderIdsMatch(s.orderId, row.orderId),
                              )
                              : undefined
                        return (
                              <div
                                key={row.id}
                                style={{
                                  padding: '12px 14px', borderRadius: 12, marginBottom: 8,
                                  background: 'rgba(31,215,96,.06)',
                                  border: '1px solid rgba(31,215,96,.25)',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                                      {row.desc || (sale ? `Погашение · ${saleLabel(sale)}` : 'Погашение чека')}
                                </div>
                                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                                      {row.date}{row.time ? ` · ${row.time}` : ''}
                                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                                        {isGap ? ' · сводка' : ' · по чеку'}
                                      </span>
                                  </div>
                              </div>
                                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontWeight: 900, color: 'var(--green)' }}>
                                      −{fmtMoney(Math.abs(row.amount))}
                                    </div>
                                    {sale && (
                                      <button
                                        type="button"
                                        className="k-btn k-btn-s"
                                        style={{ fontSize: 12, padding: '4px 10px', minHeight: 0, marginTop: 8 }}
                                        onClick={() => openSaleDetail(sale.id)}
                                      >
                                        Открыть чек
                                      </button>
                                    )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                        {detailData.pays.map(renderEditableRow)}
                      </>
                  )}
                </>
              )}
              </div>

              <div className="k-debts-actions">
                <button
                  type="button"
                  className="k-btn k-btn-g"
                  disabled={!(cardDebt > 0)}
                  onClick={() => openAdd('repay')}
                >
                  ✓ Погасить долг
                </button>
                <button type="button" className="k-btn k-btn-s" onClick={() => openAdd('add')}>
                  Выдать наличные
                </button>
                              </div>
            </>
          )}
        </section>
                              </div>

      {saleDetailId && detailData && (() => {
        const s = detailData.posSales.find(x => x.id === saleDetailId)
        if (!s) return null
        const st = detailData.saleStatus[s.id] || { status: 'open' as const, paid: 0, remain: s.debtAdded }
        const cardDebt = Math.max(0, Number(detailClient?.debt) || 0)
        const maxPay = Math.min(st.remain, cardDebt)
        const canRepay = maxPay > 0.001
        return (
          <div className="k-modal-bg" style={{ zIndex: 80 }} onClick={() => { setSaleDetailId(null); setSaleRepay(null) }}>
            <div className="k-modal" onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '100%' }}>
              <div className="k-modal-h">
                <b>{saleLabel(s)}</b>
                <button type="button" onClick={() => { setSaleDetailId(null); setSaleRepay(null) }}>✕</button>
                                </div>
              <div className="k-modal-b" style={{ padding: 14 }}>
                <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: 'var(--muted)' }}>Дата</span>
                    <span style={{ fontWeight: 700 }}>{s.dateIso ? fmtDateTime(s.dateIso) : '—'}</span>
                            </div>
                  {s.orderId && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>Номер заказа</span>
                      <span style={{ fontWeight: 800 }}>{s.orderId}</span>
                            </div>
                  )}
                  {s.number != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>Номер чека</span>
                      <span style={{ fontWeight: 800 }}>№{s.number}</span>
                          </div>
                          )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: 'var(--muted)' }}>Оплата</span>
                    <span style={{ fontWeight: 700 }}>{paymentMethodLabel(s.paymentMethod, s.partial)}</span>
                        </div>
                  {s.cashierName && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>Кассир</span>
                      <span style={{ fontWeight: 700 }}>{s.cashierName}</span>
                    </div>
                  )}
                  {s.note && (
                    <div>
                      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>Описание / заметка</div>
                      <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{s.note}</div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Состав ({s.items.length})
            </div>
                {!s.items.length ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Позиции не сохранены</div>
                ) : (
                  <div style={{ display: 'grid', gap: 4, marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
                    {s.items.map((it, i) => (
                      <div
                        key={`${it.name}-${i}`}
                        style={{
                          display: 'flex', justifyContent: 'space-between', gap: 8,
                          padding: '7px 8px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--border)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>{it.name}</div>
                          <div style={{ color: 'var(--muted)', marginTop: 1 }}>
                            {it.qty}{it.unit ? ` ${it.unit}` : ''} × {fmtMoney(it.price)}
          </div>
                        </div>
                        <div style={{ fontWeight: 800, flexShrink: 0 }}>{fmtMoney(it.lineTotal)}</div>
                      </div>
                    ))}
        </div>
      )}

                <div style={{ display: 'grid', gap: 6, fontSize: 13, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Сумма чека</span>
                    <span style={{ fontWeight: 800 }}>{fmtMoney(s.total)}</span>
            </div>
                  {(s.paidCash > 0 || s.paidCard > 0) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--muted)' }}>Оплачено при продаже</span>
                      <span style={{ fontWeight: 700 }}>
                        {s.paidCash > 0 ? `нал. ${fmtMoney(s.paidCash)}` : ''}
                        {s.paidCash > 0 && s.paidCard > 0 ? ' + ' : ''}
                        {s.paidCard > 0 ? `карта ${fmtMoney(s.paidCard)}` : ''}
                      </span>
                </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>В долг</span>
                    <span style={{ fontWeight: 900, color: 'var(--blue)' }}>{fmtMoney(s.debtAdded)}</span>
                    </div>
                  {st.paid > 0.001 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--muted)' }}>Уже погашено</span>
                      <span style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(st.paid)}</span>
                  </div>
                )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>Остаток по чеку</span>
                    <span style={{
                      fontWeight: 900,
                      color: st.status === 'paid' ? 'var(--green)' : 'var(--gold)',
                    }}>
                      {st.status === 'paid' ? 'Погашен' : fmtMoney(st.remain)}
                    </span>
              </div>
                </div>

                {canRepay ? (
                  <div style={{
                    marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
                    display: 'grid', gap: 8,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase' }}>
                      Погасить этот чек
                    </div>
                    <div style={{ fontSize: 12, color: openShift ? 'var(--muted)' : 'var(--red)', fontWeight: 700 }}>
                      {openShift
                        ? `В кассу · ${openShift.cashierName || 'смена открыта'}`
                        : 'Смена закрыта — откройте смену, чтобы принять оплату'}
                    </div>
                    <PayMethodToggle
                      value={saleRepay?.method || 'cash'}
                      disabled={!!saleRepay?.saving || !openShift}
                      onChange={m => setSaleRepay(prev => ({
                        amount: prev?.amount ?? String(maxPay),
                        saving: false,
                        method: m,
                      }))}
                    />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                      <input
                        className="k-inp"
                        inputMode="decimal"
                        value={saleRepay?.amount ?? String(maxPay)}
                        onChange={e => setSaleRepay(prev => ({
                          amount: sanitizeDecimalInput(e.target.value),
                          saving: false,
                          method: prev?.method || 'cash',
                        }))}
                        placeholder={String(maxPay)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="k-btn k-btn-g"
                        disabled={!!saleRepay?.saving || !openShift}
                        onClick={() => void submitSaleRepay()}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {saleRepay?.saving ? '…' : 'Погасить'}
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Макс. {fmtMoney(maxPay)} · спишется только с этого чека · {(saleRepay?.method || 'cash') === 'card' ? 'карта' : 'нал'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[maxPay, Math.round(maxPay / 2 * 100) / 100].filter((v, i, a) => v > 0.001 && a.indexOf(v) === i).map(v => (
                        <button
                          key={v}
                          type="button"
                          className="k-btn"
                          style={{ fontSize: 11, minHeight: 0, padding: '4px 10px' }}
                          onClick={() => setSaleRepay(prev => ({
                            amount: String(v),
                            saving: false,
                            method: prev?.method || 'cash',
                          }))}
                        >
                          {fmtMoney(v)}
                        </button>
                      ))}
        </div>
                  </div>
                ) : st.status === 'paid' ? (
                  <div style={{
                    marginTop: 14, padding: '10px 12px', borderRadius: 8,
                    background: 'rgba(34, 160, 90, 0.12)', color: 'var(--green)',
                    fontWeight: 700, fontSize: 13, textAlign: 'center',
                  }}>
                    Чек полностью погашен
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
