'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  CARD_STATUS_LABELS,
  cardHasDebtSection,
  cardNumsMatch,
  type AdminCard,
} from '@/lib/cardCrm'
import { adjustClientDebtSafe } from '@/lib/offlineLoyaltyOps'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  mergeClientsWithOrders,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import {
  debtBalanceDeltaForHistoryChange,
  debtHistoryTotals,
  isManualDebtHistoryEntry,
  loadDebtHistory,
  removeDebtHistoryEntry,
  subscribeDebtHistory,
  updateDebtHistoryEntry,
  type DebtHistoryEntry,
} from '@/lib/clientVipCredit'
import { resolveEffectiveDebtLimit } from '@/lib/loyaltyStatusConfig'
import { usePosStore } from '@/lib/posStore'
import { useOrders } from '@/lib/store'
import type { Order, PosSale } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

type EnrichedClient = AdminClient & { lastLabel?: string }
type FilterMode = 'with_debt' | 'over_limit' | 'debt_section' | 'all'
type SortMode = 'debt' | 'name' | 'recent' | 'unpaid'
type DetailTab = 'manual' | 'pos'

type HistAddState = {
  open: boolean
  action: 'repay' | 'add'
  amount: string
  desc: string
  saving: boolean
}

function emptyHistAdd(): HistAddState {
  return { open: false, action: 'add', amount: '', desc: '', saving: false }
}

type PosDebtSale = {
  id: string
  number?: number
  dateIso: string
  total: number
  paidCash: number
  paidCard: number
  debtAdded: number
  paymentMethod: string
  itemsCount: number
  note?: string
  partial: boolean
}

type DebtClientRow = EnrichedClient & {
  debtLimit: number
  available: number
  overLimit: boolean
  unpaidCount: number
  borrowed: number
  repaid: number
}

function levelLabel(level: ClientLevel): string {
  return CLIENT_LEVEL_OPTIONS.find(o => o.id === level)?.label || level
}

function cardForClient(client: EnrichedClient, cards: AdminCard[]): AdminCard | undefined {
  if (!client.card) return undefined
  return cards.find(c => cardNumsMatch(c.num, client.card) && c.status !== 'unlinked')
}

function salesFor(client: EnrichedClient, sales: PosSale[]): PosSale[] {
  return sales.filter(s =>
    (s.clientId && s.clientId === client.id)
    || (s.clientPhone && phonesMatch(s.clientPhone, client.phone)),
  )
}

function creditOrdersFor(client: EnrichedClient, orders: Order[]): Order[] {
  return orders.filter(o =>
    (o.payment_method === 'credit' || o.pay === 'credit')
    && phonesMatch(o.client?.phone || '', client.phone),
  )
}

function posDebtSalesFor(client: EnrichedClient, sales: PosSale[]): PosDebtSale[] {
  return salesFor(client, sales)
    .filter(s => s.paymentMethod === 'credit' || Number(s.debtAdded) > 0)
    .map(s => {
      const debtAdded = Number(s.debtAdded) > 0 ? Number(s.debtAdded) : (s.paymentMethod === 'credit' ? Number(s.total) || 0 : 0)
      const paidCash = Number(s.paidCash) || 0
      const paidCard = Number(s.paidCard) || 0
      const partial = debtAdded > 0 && (paidCash > 0 || paidCard > 0)
      return {
        id: s.id,
        number: s.number,
        dateIso: s.createdAtIso,
        total: Number(s.total) || 0,
        paidCash,
        paidCard,
        debtAdded,
        paymentMethod: s.paymentMethod,
        itemsCount: s.items?.length || 0,
        note: s.note,
        partial,
      }
    })
    .filter(s => s.debtAdded > 0)
    .sort((a, b) => String(b.dateIso).localeCompare(String(a.dateIso)))
}

function enrichDebtClient(client: EnrichedClient, cards: AdminCard[]): DebtClientRow {
  const debt = Number(client.debt) || 0
  const debtLimit = resolveEffectiveDebtLimit(client)
  const history = client.phone ? loadDebtHistory(client.phone) : []
  const manual = history.filter(isManualDebtHistoryEntry)
  const totals = debtHistoryTotals(manual)
  return {
    ...client,
    debtLimit,
    available: Math.max(0, debtLimit - debt),
    overLimit: debtLimit > 0 && debt > debtLimit,
    unpaidCount: 0,
    borrowed: totals.borrowed,
    repaid: totals.repaid,
  }
}

function paymentMethodLabel(method: string, partial: boolean): string {
  if (partial) return 'Частично'
  if (method === 'credit') return 'В долг'
  if (method === 'mixed') return 'Смешанная'
  if (method === 'cash') return 'Наличные'
  if (method === 'card') return 'Карта'
  return method || '—'
}

function DebtStatusBadge({ overLimit, debt }: { overLimit: boolean; debt: number }) {
  if (overLimit) return <span className="k-badge" style={{ background: 'var(--badge-warn-bg)', color: 'var(--red)' }}>⚠ Превышен лимит</span>
  if (debt > 0) return <span className="k-badge" style={{ background: 'var(--badge-debt-bg)', color: 'var(--gold)' }}>В долгу</span>
  return <span className="k-badge" style={{ background: 'var(--badge-debt-ok)', color: 'var(--green)' }}>Без долга</span>
}

function PartialBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
        <span>Оплачено {fmtMoney(paid)}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--card2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--green), #14b24f)' }} />
      </div>
    </div>
  )
}

export default function DebtsModule() {
  const storedClients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const sales = usePosStore(s => s.sales)
  const orders = useOrders(s => s.orders)
  const apiSyncing = useClientStore(s => s.apiSyncing)
  const apiError = useClientStore(s => s.apiError)

  const clients = useMemo(() => mergeClientsWithOrders(storedClients, orders), [storedClients, orders])

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('debt')
  const [filter, setFilter] = useState<FilterMode>('with_debt')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('manual')
  const [histAdd, setHistAdd] = useState<HistAddState>(emptyHistAdd)
  const [histMsg, setHistMsg] = useState('')
  const [histTick, setHistTick] = useState(0)
  const [histEdit, setHistEdit] = useState<{ id: string; amount: string; desc: string; saving: boolean } | null>(null)

  const refreshAll = useCallback(async () => {
    await Promise.all([syncClientsFromApi(), syncCardsFromApi()])
  }, [])

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), [])

  const debtClients = useMemo(() => {
    void histTick
    return clients.map(c => enrichDebtClient(c, cards))
  }, [clients, cards, histTick])

  const stats = useMemo(() => {
    const withDebt = debtClients.filter(c => (Number(c.debt) || 0) > 0)
    return {
      totalDebt: withDebt.reduce((s, c) => s + (Number(c.debt) || 0), 0),
      withDebt: withDebt.length,
      overLimit: debtClients.filter(c => c.overLimit).length,
    }
  }, [debtClients])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = debtClients
    if (filter === 'with_debt') list = list.filter(c => (Number(c.debt) || 0) > 0)
    else if (filter === 'over_limit') list = list.filter(c => c.overLimit)
    else if (filter === 'debt_section') list = list.filter(c => cardHasDebtSection(cardForClient(c, cards) || {}, c))
    if (query) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(query)
        || (c.phone || '').replace(/\s/g, '').includes(query.replace(/\s/g, ''))
        || (c.card || '').toLowerCase().includes(query),
      )
    }
    const sorted = [...list]
    if (sort === 'debt') sorted.sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    else if (sort === 'unpaid') sorted.sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else sorted.sort((a, b) => String(b.lastOrderAt || b.createdAt || '').localeCompare(String(a.lastOrderAt || a.createdAt || '')))
    return sorted
  }, [debtClients, cards, q, sort, filter])

  const detailClient = detailId ? debtClients.find(c => c.id === detailId) || null : null

  const detailData = useMemo(() => {
    if (!detailClient) return null
    void histTick
    const history = detailClient.phone
      ? loadDebtHistory(detailClient.phone).sort((a, b) => (b.ts || 0) - (a.ts || 0))
      : []
    const manual = history.filter(isManualDebtHistoryEntry)
    const posSales = posDebtSalesFor(detailClient, sales)
    const creditOrders = creditOrdersFor(detailClient, orders)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const manualTotals = debtHistoryTotals(manual)
    const posSum = Math.round(posSales.reduce((s, x) => s + (Number(x.debtAdded) || 0), 0) * 100) / 100
    return { history, manual, posSales, creditOrders, manualTotals, posSum }
  }, [detailClient, histTick, orders, sales])

  function openDetail(id: string) {
    setDetailId(id)
    setDetailTab('manual')
    setHistAdd(emptyHistAdd())
    setHistMsg('')
    setHistEdit(null)
  }

  function closeDetail() {
    setDetailId(null)
    setHistAdd(emptyHistAdd())
    setHistMsg('')
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
      const res = await adjustClientDebtSafe(detailClient, {
        action: histAdd.action === 'repay' ? 'repay' : 'charge',
        amount,
      })
      const desc = histAdd.desc.trim()
      if (desc && detailClient.phone) {
        const latest = loadDebtHistory(detailClient.phone).find(isManualDebtHistoryEntry)
        if (latest) updateDebtHistoryEntry(detailClient.phone, latest.id, { desc })
      }
      setHistAdd(emptyHistAdd())
      setHistMsg(histAdd.action === 'repay'
        ? `Добавлено погашение ${fmtMoney(amount)}`
        : `Добавлено начисление ${fmtMoney(amount)}`)
      if (!res.offline) await refreshAll()
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

  async function fixCardDebtFromPosChecks() {
    if (!detailClient || !detailData) return
    const fromPos = detailData.posSum
    const current = Math.max(0, Number(detailClient.debt) || 0)
    if (Math.abs(fromPos - current) < 0.005) {
      setHistMsg('Долг на карте уже совпадает с чеками')
      return
    }
    if (!window.confirm(
      `Исправить долг на карте?\n\nСейчас на карте: ${fmtMoney(current)}\nПо чекам кассы: ${fmtMoney(fromPos)}\n\nЧеки не удаляются — меняется только число на карте.`,
    )) return
    setHistMsg('')
    try {
      const res = await adjustClientDebtSafe(detailClient, {
        action: 'repay',
        amount: 0,
        absoluteDebt: fromPos,
        skipDebtHistory: true,
      })
      setHistMsg(res.offline
        ? `Долг на карте: ${fmtMoney(fromPos)} (локально)`
        : `Долг на карте исправлен: ${fmtMoney(fromPos)}`)
      if (!res.offline) await refreshAll()
    } catch (e) {
      setHistMsg(e instanceof Error ? e.message : 'Не удалось исправить')
    }
  }

  async function deleteManualHistory(row: DebtHistoryEntry) {
    if (!detailClient?.phone || !isManualDebtHistoryEntry(row)) return
    const abs = Math.abs(Number(row.amount) || 0)
    const label = row.type === 'pay' ? 'погашение' : 'начисление'
    if (!window.confirm(
      `Удалить ручное ${label} ${fmtMoney(abs)}?\n\nЧеки кассы не затрагиваются. Долг на карте пересчитается.`,
    )) return
    const removed = removeDebtHistoryEntry(detailClient.phone, row.id)
    if (!removed) {
      setHistMsg('Эту запись нельзя удалить')
      return
    }
    setHistEdit(null)
    try {
      await applyDebtDeltaFromHistory(debtBalanceDeltaForHistoryChange(removed, null))
      setHistMsg(`Удалено: ${label} ${fmtMoney(abs)}`)
      await refreshAll()
    } catch (e) {
      setHistMsg(e instanceof Error ? e.message : 'Не удалось обновить баланс')
    }
  }

  async function saveManualHistoryEdit() {
    if (!detailClient?.phone || !histEdit) return
    const before = loadDebtHistory(detailClient.phone).find(r => r.id === histEdit.id)
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
      const after = updateDebtHistoryEntry(detailClient.phone, histEdit.id, {
        amountAbs,
        desc: histEdit.desc,
      })
      if (!after) throw new Error('Не удалось сохранить запись')
      await applyDebtDeltaFromHistory(debtBalanceDeltaForHistoryChange(before, after))
      setHistEdit(null)
      setHistMsg(`Запись обновлена: ${fmtMoney(amountAbs)}`)
      await refreshAll()
    } catch (e) {
      setHistEdit(prev => prev ? { ...prev, saving: false } : prev)
      setHistMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    }
  }

  // ── Полный экран клиента ──
  if (detailClient && detailData) {
    const cardDebt = Math.max(0, Number(detailClient.debt) || 0)
    const mismatch = Math.abs(cardDebt - detailData.posSum) > 1
    const msgOk = /Удалено|обновлена|Добавлено|исправлен|Долг на карте/i.test(histMsg)

    return (
      <div>
        <div className="k-page-h" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
            <button
              type="button"
              className="k-btn k-btn-s"
              style={{ fontSize: 13, flexShrink: 0, marginTop: 2 }}
              onClick={closeDetail}
            >
              ← Назад
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0 }}>{detailClient.name}</h1>
                <DebtStatusBadge overLimit={detailClient.overLimit} debt={cardDebt} />
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {detailClient.phone && <span>☎ {detailClient.phone}</span>}
                {detailClient.card && <span> · 💳 {detailClient.card}</span>}
                {detailClient.debtLimit > 0 && (
                  <span> · лимит {fmtMoney(detailClient.debtLimit)}</span>
                )}
              </div>
            </div>
          </div>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
        </div>

        <div className="k-kpis" style={{ marginBottom: 14 }}>
          <div className="k-kpi k-statcard">
            <div className="kl">Долг на карте</div>
            <div className="kv" style={{ color: cardDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>
              {cardDebt > 0 ? fmtMoney(cardDebt) : '—'}
            </div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Ручные (начисл. − погаш.)</div>
            <div className="kv" style={{ fontSize: 16 }}>
              <span style={{ color: 'var(--red)' }}>{fmtMoney(detailData.manualTotals.borrowed)}</span>
              <span style={{ color: 'var(--muted)' }}> / </span>
              <span style={{ color: 'var(--green)' }}>{fmtMoney(detailData.manualTotals.repaid)}</span>
            </div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Чеки кассы</div>
            <div className="kv" style={{ color: detailData.posSum > 0 ? 'var(--gold)' : 'var(--muted)' }}>
              {detailData.posSum > 0 ? fmtMoney(detailData.posSum) : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              {detailData.posSales.length} чек.
            </div>
          </div>
        </div>

        {mismatch && (
          <div style={{
            marginBottom: 14, padding: '12px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.45,
            background: 'rgba(255,180,0,.12)', border: '1px solid rgba(255,180,0,.35)', color: 'var(--gold)',
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>
              Долг на карте ({fmtMoney(cardDebt)}) не совпадает с чеками ({fmtMoney(detailData.posSum)}).
            </span>
            <button
              type="button"
              className="k-btn k-btn-g"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={() => void fixCardDebtFromPosChecks()}
            >
              Поставить = сумма чеков
            </button>
          </div>
        )}

        {histMsg && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13,
            background: msgOk ? 'rgba(20,178,79,.12)' : 'var(--alert-error-bg)',
            color: msgOk ? 'var(--green)' : 'var(--red)',
            border: '1px solid var(--alert-error-border)',
          }}>
            {histMsg}
          </div>
        )}

        <div className="k-subtabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`k-subtab ${detailTab === 'manual' ? 'active' : ''}`}
            onClick={() => { setDetailTab('manual'); setHistEdit(null) }}
          >
            Ручные ({detailData.manual.length})
          </button>
          <button
            type="button"
            className={`k-subtab ${detailTab === 'pos' ? 'active' : ''}`}
            onClick={() => { setDetailTab('pos'); setHistAdd(emptyHistAdd()); setHistEdit(null) }}
          >
            Чеки кассы ({detailData.posSales.length})
          </button>
        </div>

        {detailTab === 'manual' && (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
              marginBottom: 14, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, maxWidth: 480 }}>
                Записи из Trade или Admin. Можно добавить, изменить или удалить — долг на карте пересчитается.
              </div>
              <button
                type="button"
                className="k-btn k-btn-g"
                style={{ fontSize: 13 }}
                onClick={() => setHistAdd(prev => ({
                  ...emptyHistAdd(),
                  open: !prev.open,
                  action: 'add',
                }))}
              >
                {histAdd.open ? 'Скрыть форму' : '+ Добавить'}
              </button>
            </div>

            {histAdd.open && (
              <div style={{
                padding: '14px 16px', borderRadius: 14, marginBottom: 14,
                background: 'rgba(255,140,0,.06)', border: '1px solid rgba(255,140,0,.2)',
              }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`k-subtab ${histAdd.action === 'add' ? 'active' : ''}`}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => setHistAdd(prev => ({ ...prev, action: 'add' }))}
                  >
                    Начислить
                  </button>
                  <button
                    type="button"
                    className={`k-subtab ${histAdd.action === 'repay' ? 'active' : ''}`}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => setHistAdd(prev => ({ ...prev, action: 'repay' }))}
                  >
                    Погасить
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ fontSize: 11 }}>Сумма</label>
                    <input
                      className="k-inp"
                      type="text"
                      inputMode="decimal"
                      value={histAdd.amount}
                      disabled={histAdd.saving}
                      onChange={e => setHistAdd(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div style={{ flex: '2 1 180px' }}>
                    <label style={{ fontSize: 11 }}>Описание</label>
                    <input
                      className="k-inp"
                      type="text"
                      value={histAdd.desc}
                      disabled={histAdd.saving}
                      onChange={e => setHistAdd(prev => ({ ...prev, desc: e.target.value }))}
                      placeholder={histAdd.action === 'repay' ? 'Погашение долга' : 'Ручное начисление'}
                    />
                  </div>
                  {histAdd.action === 'repay' && cardDebt > 0 && (
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ fontSize: 12 }}
                      onClick={() => setHistAdd(prev => ({ ...prev, amount: String(cardDebt) }))}
                    >
                      Весь долг
                    </button>
                  )}
                  <button
                    type="button"
                    className="k-btn k-btn-g"
                    style={{ fontSize: 13 }}
                    disabled={histAdd.saving}
                    onClick={() => void submitHistoryAdd()}
                  >
                    {histAdd.saving ? '…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            )}

            {!detailData.manual.length ? (
              <div className="k-empty" style={{ padding: 28 }}>
                Пока нет ручных записей — нажмите «+ Добавить»
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {detailData.manual.map(row => {
                  const isPay = row.type === 'pay'
                  const editing = histEdit?.id === row.id
                  return (
                    <div
                      key={row.id}
                      style={{
                        padding: '14px 16px', borderRadius: 12,
                        background: isPay ? '#122018' : 'var(--card)',
                        border: `1px solid ${isPay ? '#1e3a28' : 'var(--border)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: 14 }}>
                              {row.desc || (isPay ? 'Погашение' : 'Ручное начисление')}
                            </span>
                            <span className="k-badge" style={{ fontSize: 10, background: 'var(--card2)', color: 'var(--muted)' }}>
                              {isPay ? 'погашение' : 'начисление'} · вручную
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {row.date} · {row.time || '—'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 16, color: isPay ? 'var(--green)' : 'var(--red)' }}>
                            {isPay ? '+' : '−'}{fmtMoney(Math.abs(row.amount))}
                          </div>
                          {!editing && (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                              <button
                                type="button"
                                className="k-btn k-btn-s"
                                style={{ fontSize: 12, padding: '5px 10px' }}
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
                                style={{ fontSize: 12, padding: '5px 10px', color: 'var(--red)' }}
                                onClick={() => void deleteManualHistory(row)}
                              >
                                Удалить
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {editing && histEdit && (
                        <div style={{
                          marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
                          display: 'grid', gap: 10,
                        }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 120px' }}>
                              <label style={{ fontSize: 11 }}>Сумма</label>
                              <input
                                className="k-inp"
                                type="text"
                                inputMode="decimal"
                                value={histEdit.amount}
                                disabled={histEdit.saving}
                                onChange={e => setHistEdit(prev => prev ? { ...prev, amount: sanitizeDecimalInput(e.target.value) } : prev)}
                              />
                            </div>
                            <div style={{ flex: '2 1 180px' }}>
                              <label style={{ fontSize: 11 }}>Описание</label>
                              <input
                                className="k-inp"
                                type="text"
                                value={histEdit.desc}
                                disabled={histEdit.saving}
                                onChange={e => setHistEdit(prev => prev ? { ...prev, desc: e.target.value } : prev)}
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="k-btn k-btn-g"
                              style={{ fontSize: 12 }}
                              disabled={histEdit.saving}
                              onClick={() => void saveManualHistoryEdit()}
                            >
                              {histEdit.saving ? '…' : 'Сохранить'}
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn-s"
                              style={{ fontSize: 12 }}
                              disabled={histEdit.saving}
                              onClick={() => setHistEdit(null)}
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {detailTab === 'pos' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.45 }}>
              Чеки из кассы в долг. Только просмотр — править или удалять нельзя.
            </div>
            {!detailData.posSales.length ? (
              <div className="k-empty" style={{ padding: 28 }}>
                Нет чеков кассы в долг
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {detailData.posSales.map(s => (
                  <div
                    key={s.id}
                    style={{
                      padding: '14px 16px', borderRadius: 12,
                      background: s.partial ? 'linear-gradient(135deg, #2a2414, var(--card))' : 'var(--card)',
                      border: `1px solid ${s.partial ? '#5a4020' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 900, fontSize: 14 }}>
                            Чек {s.number ? `№${s.number}` : s.id.slice(-6)}
                          </span>
                          <span className="k-badge" style={{
                            background: s.partial ? '#3a2a10' : '#1a241c',
                            color: s.partial ? 'var(--gold)' : 'var(--muted)',
                          }}>
                            {paymentMethodLabel(s.paymentMethod, s.partial)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          {s.dateIso ? fmtDateTime(s.dateIso) : '—'} · {s.itemsCount} поз.
                        </div>
                        {s.partial && (
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                            Оплачено:
                            {s.paidCash > 0 && ` нал. ${fmtMoney(s.paidCash)}`}
                            {s.paidCash > 0 && s.paidCard > 0 && ' +'}
                            {s.paidCard > 0 && ` карта ${fmtMoney(s.paidCard)}`}
                          </div>
                        )}
                        {s.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.note}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--red)' }}>{fmtMoney(s.debtAdded)}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>в долг</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>чек {fmtMoney(s.total)}</div>
                      </div>
                    </div>
                    {s.partial && <PartialBar paid={s.paidCash + s.paidCard} total={s.total} />}
                  </div>
                ))}
              </div>
            )}

            {detailData.creditOrders.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: 'var(--muted)' }}>
                  Заказы магазина в долг ({detailData.creditOrders.length})
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {detailData.creditOrders.map(o => {
                    const creditAmt = Number(o.creditAmount) || Math.max(0, (Number(o.total) || 0) - (Number(o.deliveryFee) || 0))
                    return (
                      <div key={o.id} style={{
                        padding: '12px 14px', borderRadius: 12,
                        background: 'var(--card)', border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{o.id}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                              {o.createdAt ? fmtDateTime(o.createdAt) : '—'} · {o.items?.length || 0} поз.
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 900, color: 'var(--red)' }}>{fmtMoney(creditAmt)}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>в долг</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Список клиентов ──
  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>💳 Долги клиентов</h1>
          <div className="sub">
            Откройте клиента — ручные записи и чеки кассы на отдельных вкладках
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
        </div>
      </div>

      {apiError && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13,
          background: 'var(--alert-error-bg)', color: 'var(--red)', border: '1px solid var(--alert-error-border)',
        }}>
          {apiError}
        </div>
      )}

      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">С долгом</div>
          <div className="kv" style={{ color: stats.withDebt > 0 ? 'var(--gold)' : 'var(--muted)' }}>{stats.withDebt}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Общий долг</div>
          <div className="kv" style={{ color: stats.totalDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>
            {stats.totalDebt > 0 ? fmtMoney(stats.totalDebt) : '—'}
          </div>
        </div>
        {stats.overLimit > 0 && (
          <div className="k-kpi k-statcard" style={{ borderColor: '#5a2030' }}>
            <div className="kl">Превышен лимит</div>
            <div className="kv" style={{ color: 'var(--red)' }}>{stats.overLimit}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          className="k-inp"
          style={{ flex: '1 1 220px', maxWidth: 360 }}
          placeholder="Поиск: имя, телефон, карта…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`k-subtab ${filter === 'with_debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('with_debt')}>С долгом</button>
          <button type="button" className={`k-subtab ${filter === 'over_limit' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('over_limit')}>Превышен лимит</button>
          <button type="button" className={`k-subtab ${filter === 'debt_section' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('debt_section')}>С разделом долга</button>
          <button type="button" className={`k-subtab ${filter === 'all' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('all')}>Все</button>
          <button type="button" className={`k-subtab ${sort === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('debt')}>По долгу</button>
          <button type="button" className={`k-subtab ${sort === 'name' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('name')}>По имени</button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {debtClients.length ? 'Ничего не найдено по фильтру' : 'Клиентов пока нет'}
        </div>
      ) : (
        <div>
          {filtered.map(c => {
            const debt = Number(c.debt) || 0
            const levelColor = CLIENT_LEVEL_COLORS[c.level] || 'var(--muted)'
            const card = cardForClient(c, cards)
            const cardStatus = card ? CARD_STATUS_LABELS[card.status] : null

            return (
              <div
                key={c.id}
                className="k-card"
                style={{
                  marginBottom: 10,
                  overflow: 'hidden',
                  border: c.overLimit ? '1px solid var(--border-debt-over)' : debt > 0 ? '1px solid var(--border-debt)' : undefined,
                }}
              >
                <div
                  style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
                  onClick={() => openDetail(c.id)}
                >
                  <span style={{ fontSize: 26, flexShrink: 0 }}>{c.vip ? '⭐' : '💳'}</span>
                  <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 900, fontSize: 15 }}>{c.name}</span>
                      <span className="k-badge" style={{ background: `${levelColor}22`, color: levelColor }}>{levelLabel(c.level)}</span>
                      <DebtStatusBadge overLimit={c.overLimit} debt={debt} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {c.phone && (
                        <a
                          href={`tel:${c.phone.replace(/\s/g, '')}`}
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          ☎ {c.phone}
                        </a>
                      )}
                      {c.card
                        ? <span>💳 {c.card}{cardStatus ? ` · ${cardStatus.l}` : ''}</span>
                        : <span style={{ color: 'var(--gold)' }}>⚠ без карты</span>}
                    </div>
                    {c.debtLimit > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        Лимит {fmtMoney(c.debtLimit)} · доступно{' '}
                        <span style={{ color: 'var(--green)', fontWeight: 800 }}>{fmtMoney(c.available)}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Долг</div>
                      <div style={{ fontWeight: 900, fontSize: 17, color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {debt > 0 ? fmtMoney(debt) : '—'}
                      </div>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--muted)' }}>→</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
