'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  CARD_STATUS_LABELS,
  cardHasDebtSection,
  cardLoyaltyFromCard,
  cardNumsMatch,
  type AdminCard,
  type CardLoyaltyForm,
} from '@/lib/cardCrm'
import {
  provisionLoyaltyCardForClient,
  saveCardLoyalty,
} from '@/lib/clientCardSync'
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
  buildDebtOrderBalances,
  debtHistoryTotals,
  loadDebtHistory,
  subscribeDebtHistory,
  type DebtHistoryEntry,
  type DebtOrderBalance,
} from '@/lib/clientVipCredit'
import { resolveEffectiveDebtLimit } from '@/lib/loyaltyStatusConfig'
import { usePosStore } from '@/lib/posStore'
import { useOrders } from '@/lib/store'
import type { Order, PosSale } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

type EnrichedClient = AdminClient & { lastLabel?: string }
type FilterMode = 'with_debt' | 'over_limit' | 'debt_section' | 'all'
type SortMode = 'debt' | 'name' | 'recent' | 'unpaid'
type DetailTab = 'history' | 'unpaid' | 'orders' | 'pos'

type DebtFormState = {
  action: 'repay' | 'add'
  amount: string
  saving: boolean
  msg: string
}

function emptyInlineDebt(): DebtFormState {
  return { action: 'repay', amount: '', saving: false, msg: '' }
}

type PosDebtSale = {
  id: string
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
  partialCount: number
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
  const totals = debtHistoryTotals(history)
  const { unpaid } = buildDebtOrderBalances(history)
  return {
    ...client,
    debtLimit,
    available: Math.max(0, debtLimit - debt),
    overLimit: debtLimit > 0 && debt > debtLimit,
    unpaidCount: unpaid.length,
    partialCount: unpaid.filter(u => u.partial).length,
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

function DebtStatusBadge({ overLimit, debt, unpaidCount }: { overLimit: boolean; debt: number; unpaidCount: number }) {
  if (overLimit) return <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>⚠ Превышен лимит</span>
  if (debt > 0 && unpaidCount > 0) return <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)' }}>В долгу · {unpaidCount} зак.</span>
  if (debt > 0) return <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)' }}>В долгу</span>
  return <span className="k-badge" style={{ background: '#122018', color: 'var(--green)' }}>Без долга</span>
}

function PartialBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
        <span>Оплачено {fmtMoney(paid)}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: '#1a241c', overflow: 'hidden' }}>
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
  const [detailTab, setDetailTab] = useState<DetailTab>('history')
  const [inlineDebt, setInlineDebt] = useState<DebtFormState>(emptyInlineDebt)
  const [histTick, setHistTick] = useState(0)
  const [orderDetail, setOrderDetail] = useState<DebtOrderBalance | DebtHistoryEntry | null>(null)

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
      debtSection: debtClients.filter(c => cardHasDebtSection(cardForClient(c, cards) || {}, c)).length,
      totalBorrowed: debtClients.reduce((s, c) => s + c.borrowed, 0),
      totalRepaid: debtClients.reduce((s, c) => s + c.repaid, 0),
      unpaidOrders: debtClients.reduce((s, c) => s + c.unpaidCount, 0),
    }
  }, [debtClients, cards])

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
    else if (sort === 'unpaid') sorted.sort((a, b) => b.unpaidCount - a.unpaidCount || (Number(b.debt) || 0) - (Number(a.debt) || 0))
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else sorted.sort((a, b) => String(b.lastOrderAt || b.createdAt || '').localeCompare(String(a.lastOrderAt || a.createdAt || '')))
    return sorted
  }, [debtClients, cards, q, sort, filter])

  const detailClient = detailId ? debtClients.find(c => c.id === detailId) || null : null

  const detailData = useMemo(() => {
    if (!detailClient) return null
    void histTick
    const history = detailClient.phone ? loadDebtHistory(detailClient.phone).sort((a, b) => (b.ts || 0) - (a.ts || 0)) : []
    const settlement = buildDebtOrderBalances(history)
    const creditOrders = creditOrdersFor(detailClient, orders).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const posSales = posDebtSalesFor(detailClient, sales)
    const totals = debtHistoryTotals(history)
    return { history, settlement, creditOrders, posSales, totals }
  }, [detailClient, histTick, orders, sales])

  async function saveLoyaltyForClient(client: AdminClient, patch: Partial<CardLoyaltyForm>) {
    let card = cardForClient(client, cards)
    if (!card) {
      const updated = await provisionLoyaltyCardForClient(client)
      await refreshAll()
      card = cardForClient(updated, useCardStore.getState().cards)
    }
    if (!card) throw new Error('Не удалось получить карту лояльности')
    const freshClient = useClientStore.getState().clients.find(c => c.id === client.id) || client
    const base = cardLoyaltyFromCard(card, freshClient)
    await saveCardLoyalty(card, { ...base, ...patch }, 'edit')
    await refreshAll()
  }

  function openDetail(id: string) {
    setDetailId(id)
    setDetailTab('history')
    setOrderDetail(null)
    setInlineDebt(emptyInlineDebt())
  }

  function closeDetail() {
    setDetailId(null)
    setOrderDetail(null)
    setInlineDebt(emptyInlineDebt())
  }

  async function submitInlineDebt() {
    if (!detailClient) return
    const amount = Number(inlineDebt.amount) || 0
    if (!(amount > 0)) {
      setInlineDebt(prev => ({ ...prev, msg: 'Укажите сумму' }))
      return
    }
    const prevDebt = Number(detailClient.debt) || 0
    const nextDebt = inlineDebt.action === 'repay'
      ? Math.max(0, prevDebt - amount)
      : prevDebt + amount

    setInlineDebt(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      await saveLoyaltyForClient(detailClient, { debt: nextDebt })
      setInlineDebt(emptyInlineDebt())
    } catch (e) {
      setInlineDebt(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка операции' }))
    }
  }

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>💳 Долги клиентов</h1>
          <div className="sub">
            Нажмите на клиента — откроется история долгов, погашения и управление задолженностью
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
        </div>
      </div>

      {apiError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
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
          <button type="button" className={`k-subtab ${sort === 'unpaid' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('unpaid')}>По заказам</button>
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
                  border: c.overLimit ? '1px solid #5a2030' : debt > 0 ? '1px solid #5a4020' : undefined,
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
                      <DebtStatusBadge overLimit={c.overLimit} debt={debt} unpaidCount={c.unpaidCount} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>📞 {c.phone}</a>}
                      {c.card ? <span>💳 {c.card}{cardStatus ? ` · ${cardStatus.l}` : ''}</span> : <span style={{ color: 'var(--gold)' }}>⚠ без карты</span>}
                    </div>
                    {c.debtLimit > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        Лимит {fmtMoney(c.debtLimit)} · доступно <span style={{ color: 'var(--green)', fontWeight: 800 }}>{fmtMoney(c.available)}</span>
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

      {/* ── Окно клиента: история и управление долгом ── */}
      {detailClient && detailData && (
        <div className="k-modal-bg" onClick={closeDetail}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22 }}>{detailClient.vip ? '⭐' : '💳'}</span>
                <div>
                  <b>{detailClient.name}</b>
                  <DebtStatusBadge overLimit={detailClient.overLimit} debt={detailClient.debt} unpaidCount={detailClient.unpaidCount} />
                </div>
              </div>
              <button type="button" onClick={closeDetail}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{
                borderRadius: 16, padding: '16px 18px', marginBottom: 14,
                background: 'linear-gradient(135deg, #2a1414, var(--card))',
                border: '1px solid #5a3030',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Текущий долг</div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: detailClient.debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                      {detailClient.debt > 0 ? fmtMoney(detailClient.debt) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Лимит</div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{detailClient.debtLimit > 0 ? fmtMoney(detailClient.debtLimit) : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Доступно</div>
                    <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>
                      {detailClient.debtLimit > 0 ? fmtMoney(detailClient.available) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Начислено / Погашено</div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                      <span style={{ color: 'var(--red)' }}>{fmtMoney(detailData.totals.borrowed)}</span>
                      <span style={{ color: 'var(--muted)' }}> / </span>
                      <span style={{ color: 'var(--green)' }}>{fmtMoney(detailData.totals.repaid)}</span>
                    </div>
                  </div>
                </div>
                {detailClient.phone && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                    📞 {detailClient.phone}
                    {detailClient.card && <span> · 💳 {detailClient.card}</span>}
                  </div>
                )}
              </div>

              <div style={{
                padding: '14px 16px', borderRadius: 14, marginBottom: 14,
                background: 'rgba(255,140,0,.06)', border: '1px solid rgba(255,140,0,.2)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--gold)', marginBottom: 10 }}>Изменить долг</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button type="button" className={`k-subtab ${inlineDebt.action === 'repay' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setInlineDebt(prev => ({ ...prev, action: 'repay', msg: '' }))}>Погасить</button>
                  <button type="button" className={`k-subtab ${inlineDebt.action === 'add' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setInlineDebt(prev => ({ ...prev, action: 'add', msg: '' }))}>Начислить</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={{ fontSize: 11 }}>Сумма</label>
                    <input className="k-inp" type="text" inputMode="decimal" value={inlineDebt.amount} onChange={e => setInlineDebt(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value), msg: '' }))} placeholder="0.00" />
                  </div>
                  {inlineDebt.action === 'repay' && detailClient.debt > 0 && (
                    <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12 }} onClick={() => setInlineDebt(prev => ({ ...prev, amount: String(detailClient.debt), msg: '' }))}>
                      Весь долг
                    </button>
                  )}
                  <button type="button" className="k-btn k-btn-g" style={{ fontSize: 12 }} disabled={inlineDebt.saving} onClick={() => void submitInlineDebt()}>
                    {inlineDebt.saving ? '…' : inlineDebt.action === 'repay' ? 'Провести' : 'Начислить'}
                  </button>
                </div>
                {inlineDebt.msg && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{inlineDebt.msg}</div>}
              </div>

              <div className="k-subtabs" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
                {([
                  ['history', 'Вся история'],
                  ['unpaid', `Неоплаченные (${detailData.settlement.unpaid.length})`],
                  ['orders', `Заказы (${detailData.creditOrders.length})`],
                  ['pos', `Касса (${detailData.posSales.length})`],
                ] as [DetailTab, string][]).map(([tab, label]) => (
                  <button key={tab} type="button" className={`k-subtab ${detailTab === tab ? 'active' : ''}`} onClick={() => { setDetailTab(tab); setOrderDetail(null) }}>
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === 'history' && (
                <>
                  {!detailData.history.length ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>История пуста</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                      {detailData.history.map(row => {
                        const isPay = row.type === 'pay'
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => row.orderId && setOrderDetail(row)}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                              padding: '10px 12px', borderRadius: 10,
                              background: isPay ? '#122018' : 'var(--card)',
                              border: `1px solid ${isPay ? '#1e3a28' : 'var(--border)'}`,
                              cursor: row.orderId ? 'pointer' : 'default',
                              textAlign: 'left', color: 'inherit', fontFamily: 'inherit', width: '100%',
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span>{isPay ? '💰' : '🛒'}</span>
                              <span>
                                <div style={{ fontWeight: 800, fontSize: 13 }}>{row.desc || (isPay ? 'Погашение' : 'Заказ в долг')}</div>
                                {row.itemsSummary && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.itemsSummary}</div>}
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.date} · {row.time || '—'}</div>
                              </span>
                            </span>
                            <span style={{ fontWeight: 900, flexShrink: 0, color: isPay ? 'var(--green)' : 'var(--red)' }}>
                              {isPay ? '+' : '−'}{fmtMoney(Math.abs(row.amount))}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {detailTab === 'unpaid' && (
                <>
                  {!detailData.settlement.unpaid.length ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      ✅ Нет неоплаченных заказов в долг
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                      {detailData.settlement.unpaid.map((row, i) => (
                        <button
                          key={row.id || `unpaid-${i}`}
                          type="button"
                          onClick={() => setOrderDetail(row)}
                          style={{
                            textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                            background: row.partial ? 'linear-gradient(135deg, #2a2414, var(--card))' : 'linear-gradient(135deg, #2a1414, var(--card))',
                            border: `1px solid ${row.partial ? '#5a4020' : '#5a3030'}`,
                            color: 'inherit', fontFamily: 'inherit', width: '100%',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                <span style={{ fontWeight: 900, fontSize: 14 }}>{row.orderId || 'Заказ в долг'}</span>
                                <span className="k-badge" style={{
                                  background: row.partial ? '#3a2a10' : '#3a1414',
                                  color: row.partial ? 'var(--gold)' : 'var(--red)',
                                }}>
                                  {row.partial ? 'Частично оплачен' : 'Не оплачен'}
                                </span>
                              </div>
                              {row.itemsSummary && (
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{row.itemsSummary}</div>
                              )}
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.date}{row.time ? ` · ${row.time}` : ''}</div>
                              {row.partial && (
                                <PartialBar paid={row.paidAmount} total={row.originalAmount} />
                              )}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--red)' }}>{fmtMoney(row.remainingAmount)}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{row.partial ? 'осталось' : 'в долг'}</div>
                              {row.partial && (
                                <div style={{ fontSize: 10, color: 'var(--muted)', textDecoration: 'line-through', marginTop: 2 }}>
                                  из {fmtMoney(row.originalAmount)}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {detailTab === 'orders' && (
                <>
                  {!detailData.creditOrders.length ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Заказов в кредит из магазина пока нет</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                      {detailData.creditOrders.map(o => {
                        const creditAmt = Number(o.creditAmount) || Math.max(0, (Number(o.total) || 0) - (Number(o.deliveryFee) || 0))
                        const deliveryFee = Number(o.deliveryFee) || 0
                        const partial = deliveryFee > 0
                        return (
                          <div key={o.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                              <div>
                                <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--green)' }}>{o.id}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{o.createdAt ? fmtDateTime(o.createdAt) : '—'}</div>
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                                  {o.items?.length || 0} поз. · {o.status}
                                </div>
                                {partial && (
                                  <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 6, fontWeight: 700 }}>
                                    Товары в долг · доставка наличными {fmtMoney(deliveryFee)}
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--red)' }}>{fmtMoney(creditAmt)}</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>в долг</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>итого {fmtMoney(o.total)}</div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {detailTab === 'pos' && (
                <>
                  {!detailData.posSales.length ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Продаж в долг через кассу пока нет</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                      {detailData.posSales.map(s => (
                        <div key={s.id} style={{
                          padding: '12px 14px', borderRadius: 12,
                          background: s.partial ? 'linear-gradient(135deg, #2a2414, var(--card))' : 'var(--card)',
                          border: `1px solid ${s.partial ? '#5a4020' : 'var(--border)'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 900 }}>Чек {s.number ? `№${s.number}` : s.id.slice(-6)}</span>
                                <span className="k-badge" style={{ background: s.partial ? '#3a2a10' : '#1a241c', color: s.partial ? 'var(--gold)' : 'var(--muted)' }}>
                                  {paymentMethodLabel(s.paymentMethod, s.partial)}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                                {s.dateIso ? fmtDateTime(s.dateIso) : '—'} · {s.itemsCount} поз.
                              </div>
                              {s.partial && (
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                                  Оплачено: {s.paidCash > 0 && `нал. ${fmtMoney(s.paidCash)}`}
                                  {s.paidCash > 0 && s.paidCard > 0 && ' + '}
                                  {s.paidCard > 0 && `карта ${fmtMoney(s.paidCard)}`}
                                </div>
                              )}
                              {s.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{s.note}</div>}
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--red)' }}>{fmtMoney(s.debtAdded)}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>в долг</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>чек {fmtMoney(s.total)}</div>
                            </div>
                          </div>
                          {s.partial && (
                            <PartialBar paid={s.paidCash + s.paidCard} total={s.total} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ── Детали заказа в долг ── */}
      {orderDetail && detailClient && (
        <div className="k-modal-bg" style={{ zIndex: 80 }} onClick={() => setOrderDetail(null)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>🛒 {('orderId' in orderDetail && orderDetail.orderId) || 'Заказ в долг'}</b>
              <button type="button" onClick={() => setOrderDetail(null)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              {'itemsSummary' in orderDetail && orderDetail.itemsSummary && (
                <div style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.45 }}>{orderDetail.itemsSummary}</div>
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Дата</span>
                  <span style={{ fontWeight: 800 }}>{orderDetail.date}{orderDetail.time ? ` · ${orderDetail.time}` : ''}</span>
                </div>
                {'originalAmount' in orderDetail && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--muted)' }}>Сумма заказа</span>
                      <span style={{ fontWeight: 800 }}>{fmtMoney(orderDetail.originalAmount)}</span>
                    </div>
                    {orderDetail.partial && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--muted)' }}>Оплачено</span>
                          <span style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(orderDetail.paidAmount)}</span>
                        </div>
                        <PartialBar paid={orderDetail.paidAmount} total={orderDetail.originalAmount} />
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--muted)' }}>Остаток в долг</span>
                      <span style={{ fontWeight: 900, color: 'var(--red)' }}>{fmtMoney(orderDetail.remainingAmount)}</span>
                    </div>
                  </>
                )}
                {!('originalAmount' in orderDetail) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)' }}>Сумма в долг</span>
                    <span style={{ fontWeight: 900, color: 'var(--red)' }}>{fmtMoney(Math.abs(orderDetail.amount))}</span>
                  </div>
                )}
              </div>
              {detailClient.debt > 0 && (
                <button type="button" className="k-btn k-btn-g" style={{ width: '100%', marginTop: 16 }} onClick={() => {
                  setOrderDetail(null)
                  setInlineDebt({ action: 'repay', amount: String(detailClient.debt), saving: false, msg: '' })
                }}>
                  💰 Погасить долг клиента
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
