'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
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
  earnedAutoLevelForClient,
  loyaltySummaryForClient,
  provisionLoyaltyCardForClient,
  registerClientAccount,
  saveCardLoyalty,
  saveClientProfile,
} from '@/lib/clientCardSync'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  clientProfileFromClient,
  emptyClientProfileForm,
  mergeClientsWithOrders,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import {
  loadDebtHistory,
  subscribeDebtHistory,
  type DebtHistoryEntry,
} from '@/lib/clientVipCredit'
import { inferLevelAssignMode, VIP_PERMANENT_DAYS } from '@/lib/loyaltyAdminLock'
import {
  calcCashDepositBonus,
  cashDepositTierForAmount,
  cashDepositTierLabel,
  getRegistrationWelcomeBonus,
  loadLoyaltyStatusConfig,
  resolveEffectiveDebtLimit,
  subscribeLoyaltyStatusConfig,
} from '@/lib/loyaltyStatusConfig'
import { usePosStore } from '@/lib/posStore'
import { useOrders } from '@/lib/store'
import type { Order, PosSale } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

type SortMode = 'debt' | 'name' | 'spent' | 'recent' | 'bonus'
type FilterMode = 'all' | 'debt' | 'vip' | 'blocked' | 'over_limit' | 'no_card'
type DetailTab = 'overview' | 'loyalty' | 'history'

type EnrichedClient = AdminClient & { lastLabel?: string }

type ClientFormState = ClientProfileForm & {
  open: boolean
  editingId: string | null
  withCard: boolean
  saving: boolean
  msg: string
}

type DebtFormState = {
  open: boolean
  clientId: string
  clientName: string
  action: 'repay' | 'add'
  amount: string
  note: string
  saving: boolean
  msg: string
}

type CashFormState = {
  open: boolean
  clientId: string
  clientName: string
  cashAmount: string
  note: string
  saving: boolean
  msg: string
}

type LoyaltyFormState = {
  open: boolean
  clientId: string
  clientName: string
  levelAssignMode: 'auto' | 'manual'
  level: ClientLevel
  levelTermDays: number
  vip: boolean
  debtEnabled: boolean
  debtLimit: string
  saving: boolean
  msg: string
}

function emptyClientForm(): ClientFormState {
  return { ...emptyClientProfileForm(), open: false, editingId: null, withCard: true, saving: false, msg: '' }
}

function emptyDebtForm(): DebtFormState {
  return { open: false, clientId: '', clientName: '', action: 'repay', amount: '', note: '', saving: false, msg: '' }
}

function emptyCashForm(): CashFormState {
  return { open: false, clientId: '', clientName: '', cashAmount: '', note: '', saving: false, msg: '' }
}

function emptyLoyaltyForm(): LoyaltyFormState {
  return {
    open: false, clientId: '', clientName: '',
    levelAssignMode: 'auto', level: 'basic', levelTermDays: VIP_PERMANENT_DAYS,
    vip: false, debtEnabled: false, debtLimit: '',
    saving: false, msg: '',
  }
}

function levelLabel(level: ClientLevel): string {
  return CLIENT_LEVEL_OPTIONS.find(o => o.id === level)?.label || level
}

function bonusPercentForLevel(level: ClientLevel, vip: boolean): number {
  const cfg = loadLoyaltyStatusConfig()
  if (vip) return cfg.vip.bonusPercent
  if (level === 'basic') return cfg.basic.bonusPercent
  const tier = cfg.tiers.find(t => t.id === level)
  return tier?.bonusPercent ?? cfg.basic.bonusPercent
}

function cardForClient(client: AdminClient, cards: AdminCard[]): AdminCard | undefined {
  if (!client.card) return undefined
  return cards.find(c => cardNumsMatch(c.num, client.card) && c.status !== 'unlinked')
}

type HistoryRow =
  | { kind: 'debt'; id: string; dateIso: string; amount: number; desc: string }
  | { kind: 'pay'; id: string; dateIso: string; amount: number; desc: string }
  | { kind: 'sale'; id: string; dateIso: string; amount: number; desc: string }
  | { kind: 'order'; id: string; dateIso: string; amount: number; desc: string }

function debtEntryDateIso(row: DebtHistoryEntry): string {
  if (row.ts) return new Date(row.ts).toISOString()
  return ''
}

function buildHistory(client: EnrichedClient, debtRows: DebtHistoryEntry[], sales: PosSale[], creditOrders: Order[]): HistoryRow[] {
  const rows: HistoryRow[] = []
  for (const h of debtRows) {
    rows.push({
      kind: h.type === 'pay' ? 'pay' : 'debt',
      id: h.id,
      dateIso: debtEntryDateIso(h),
      amount: Math.abs(h.amount),
      desc: h.desc || (h.type === 'pay' ? 'Погашение' : 'Долг'),
    })
  }
  for (const s of sales) {
    if (s.paymentMethod !== 'credit' && !(Number(s.debtAdded) > 0)) continue
    const amt = Number(s.debtAdded) > 0 ? Number(s.debtAdded) : Number(s.total) || 0
    if (amt <= 0) continue
    rows.push({
      kind: 'sale',
      id: s.id,
      dateIso: s.createdAtIso,
      amount: amt,
      desc: `Продажа в кредит · ${s.items?.length || 0} поз.`,
    })
  }
  for (const o of creditOrders) {
    rows.push({
      kind: 'order',
      id: o.id,
      dateIso: String(o.createdAt || ''),
      amount: Number(o.total) || 0,
      desc: `Заказ в кредит ${o.id}`,
    })
  }
  return rows.sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')))
}

function LoyaltyMiniCard({ client, cards }: { client: EnrichedClient; cards: AdminCard[] }) {
  const summary = loyaltySummaryForClient(client, cards)
  const color = CLIENT_LEVEL_COLORS[summary.level] || 'var(--green)'
  const debtLimit = resolveEffectiveDebtLimit({
    level: summary.level,
    vip: summary.vip,
    debtLimit: summary.debtLimit,
    debtEnabled: summary.debtEnabled,
  })
  const available = Math.max(0, debtLimit - (Number(summary.debt) || 0))

  return (
    <div style={{
      borderRadius: 16,
      padding: '16px 18px',
      marginBottom: 14,
      background: `linear-gradient(135deg, ${color}18, var(--card))`,
      border: `1px solid ${color}44`,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -20, right: -20, width: 90, height: 90, borderRadius: '50%', background: `${color}15` }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: 1.2, marginBottom: 6 }}>КАРТА KAKAPO</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>{summary.vip ? '⭐' : '💳'}</span>
          <span style={{ fontWeight: 900, fontSize: 16 }}>{summary.card || 'Без карты'}</span>
          <span className="k-badge" style={{ background: `${color}22`, color }}>{levelLabel(summary.level)}</span>
          {summary.vip && <span className="k-badge" style={{ background: '#2a1a40', color: 'var(--purple)' }}>VIP</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Бонусы ⭐</div>
            <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--gold)' }}>{summary.bonus.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Долг</div>
            <div style={{ fontWeight: 900, fontSize: 18, color: summary.debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
              {summary.debt > 0 ? fmtMoney(summary.debt) : '—'}
            </div>
          </div>
          {debtLimit > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Доступно</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>{fmtMoney(available)}</div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Кэшбэк</div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{bonusPercentForLevel(summary.level, summary.vip)}%</div>
          </div>
        </div>
      </div>
    </div>
  )
}

type ClientsModuleProps = {
  variant?: 'clients' | 'debts'
}

export default function ClientsModule({ variant = 'clients' }: ClientsModuleProps) {
  const storedClients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const sales = usePosStore(s => s.sales)
  const orders = useOrders(s => s.orders)
  const apiSyncing = useClientStore(s => s.apiSyncing)
  const apiError = useClientStore(s => s.apiError)

  const clients = useMemo(() => mergeClientsWithOrders(storedClients, orders), [storedClients, orders])

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>(variant === 'debts' ? 'debt' : 'name')
  const [filter, setFilter] = useState<FilterMode>(variant === 'debts' ? 'debt' : 'all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [provisioningId, setProvisioningId] = useState<string | null>(null)
  const [form, setForm] = useState<ClientFormState>(emptyClientForm)
  const [debtForm, setDebtForm] = useState<DebtFormState>(emptyDebtForm)
  const [cashForm, setCashForm] = useState<CashFormState>(emptyCashForm)
  const [loyaltyForm, setLoyaltyForm] = useState<LoyaltyFormState>(emptyLoyaltyForm)
  const [histTick, setHistTick] = useState(0)

  const [loyaltyCfgTick, setLoyaltyCfgTick] = useState(0)

  const welcomeBonus = useMemo(() => getRegistrationWelcomeBonus(), [])
  const unlinkedCards = useMemo(() => cards.filter(c => c.status === 'unlinked'), [cards])

  const refreshAll = useCallback(async () => {
    await Promise.all([syncClientsFromApi(), syncCardsFromApi()])
  }, [])

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), [])
  useEffect(() => subscribeLoyaltyStatusConfig(() => setLoyaltyCfgTick(t => t + 1)), [])

  const stats = useMemo(() => {
    const totalDebt = clients.reduce((s, c) => s + (Number(c.debt) || 0), 0)
    const withDebt = clients.filter(c => (Number(c.debt) || 0) > 0).length
    const vipCount = clients.filter(c => !!c.vip).length
    const withCard = clients.filter(c => !!(c.card || '').trim()).length
    const totalBonus = clients.reduce((s, c) => s + (Number(c.bonus) || 0), 0)
    const overLimit = clients.filter(c => {
      const limit = resolveEffectiveDebtLimit(c)
      return limit > 0 && (Number(c.debt) || 0) > limit
    }).length
    return { totalDebt, withDebt, vipCount, withCard, totalBonus, overLimit }
  }, [clients])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = clients
    if (filter === 'debt') list = list.filter(c => (Number(c.debt) || 0) > 0)
    else if (filter === 'vip') list = list.filter(c => !!c.vip)
    else if (filter === 'blocked') list = list.filter(c => !!c.blocked)
    else if (filter === 'no_card') list = list.filter(c => !(c.card || '').trim())
    else if (filter === 'over_limit') {
      list = list.filter(c => {
        const limit = resolveEffectiveDebtLimit(c)
        return limit > 0 && (Number(c.debt) || 0) > limit
      })
    }
    if (query) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(query)
        || (c.phone || '').replace(/\s/g, '').includes(query.replace(/\s/g, ''))
        || (c.card || '').toLowerCase().includes(query)
        || (c.email || '').toLowerCase().includes(query),
      )
    }
    const sorted = [...list]
    if (sort === 'debt') sorted.sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else if (sort === 'spent') sorted.sort((a, b) => (Number(b.spent) || 0) - (Number(a.spent) || 0))
    else if (sort === 'bonus') sorted.sort((a, b) => (Number(b.bonus) || 0) - (Number(a.bonus) || 0))
    else sorted.sort((a, b) => String(b.lastOrderAt || b.createdAt || '').localeCompare(String(a.lastOrderAt || a.createdAt || '')))
    return sorted
  }, [clients, q, sort, filter])

  const cashBonusPreview = useMemo(() => {
    if (!cashForm.open) return 0
    void loyaltyCfgTick
    const cash = Number(cashForm.cashAmount) || 0
    if (cash <= 0) return 0
    return calcCashDepositBonus(cash)
  }, [cashForm.open, cashForm.cashAmount, loyaltyCfgTick])

  function salesFor(client: EnrichedClient): PosSale[] {
    return sales.filter(s =>
      (s.clientId && s.clientId === client.id)
      || (s.clientPhone && phonesMatch(s.clientPhone, client.phone)),
    )
  }

  function creditOrdersFor(client: EnrichedClient): Order[] {
    return orders.filter(o =>
      (o.payment_method === 'credit' || o.pay === 'credit')
      && phonesMatch(o.client?.phone || '', client.phone),
    )
  }

  function historyFor(client: EnrichedClient): HistoryRow[] {
    const debtRows = client.phone ? loadDebtHistory(client.phone) : []
    return buildHistory(client, debtRows, salesFor(client), creditOrdersFor(client))
  }

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
    setDetailTab('overview')
  }

  function closeDetail() {
    setDetailId(null)
  }

  function openNewForm() {
    setForm({ ...emptyClientProfileForm(), open: true, editingId: null, withCard: true, saving: false, msg: '' })
  }

  function openEditForm(c: EnrichedClient) {
    setForm({
      ...clientProfileFromClient(c),
      open: true,
      editingId: c.id,
      withCard: false,
      saving: false,
      msg: '',
    })
  }

  function closeForm() {
    setForm(emptyClientForm())
  }

  async function submitForm() {
    const name = form.name.trim()
    const phone = form.phone.trim()
    if (!name) {
      setForm(prev => ({ ...prev, msg: 'Укажите имя клиента' }))
      return
    }
    if (!phone) {
      setForm(prev => ({ ...prev, msg: 'Укажите телефон' }))
      return
    }
    setForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      if (!form.editingId && form.withCard) {
        await registerClientAccount({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          addr: form.addr.trim(),
          card: form.card.trim().toUpperCase(),
          level: 'basic',
          debt: 0,
          bonus: 0,
          debtLimit: 0,
          blocked: form.blocked,
          note: form.note.trim(),
        })
      } else {
        saveClientProfile(form.editingId, {
          name: form.name,
          phone: form.phone,
          email: form.email,
          addr: form.addr,
          card: form.card,
          blocked: form.blocked,
          note: form.note,
        })
      }
      await refreshAll()
      closeForm()
    } catch (e) {
      setForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка сохранения' }))
    }
  }

  async function removeClient(c: EnrichedClient) {
    if ((Number(c.debt) || 0) > 0) {
      alert('Нельзя удалить клиента с непогашенным долгом — сначала погасите задолженность')
      return
    }
    if (!confirm(`Удалить клиента «${c.name}»?`)) return
    setDeletingId(c.id)
    try {
      if (USE_API) await api.deleteClient(c.id, c.phone)
      else useClientStore.getState().removeClient(c.id)
      if (detailId === c.id) setDetailId(null)
      await refreshAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить клиента')
    } finally {
      setDeletingId(null)
    }
  }

  async function toggleBlockClient(c: EnrichedClient) {
    useClientStore.getState().toggleBlock(c.id)
    await refreshAll()
  }

  async function provisionCard(c: EnrichedClient) {
    setProvisioningId(c.id)
    try {
      await provisionLoyaltyCardForClient(c)
      await refreshAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось создать карту')
    } finally {
      setProvisioningId(null)
    }
  }

  function openDebtForm(c: EnrichedClient, action: 'repay' | 'add' = 'repay') {
    setDebtForm({
      open: true,
      clientId: c.id,
      clientName: c.name,
      action,
      amount: action === 'repay' && (Number(c.debt) || 0) > 0 ? String(c.debt) : '',
      note: '',
      saving: false,
      msg: '',
    })
  }

  function closeDebtForm() {
    setDebtForm(emptyDebtForm())
  }

  async function submitDebt() {
    const client = clients.find(c => c.id === debtForm.clientId)
    if (!client) return
    const amount = Number(debtForm.amount) || 0
    if (!(amount > 0)) {
      setDebtForm(prev => ({ ...prev, msg: 'Укажите сумму' }))
      return
    }
    const prevDebt = Number(client.debt) || 0
    const nextDebt = debtForm.action === 'repay'
      ? Math.max(0, prevDebt - amount)
      : prevDebt + amount

    setDebtForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      await saveLoyaltyForClient(client, { debt: nextDebt })
      closeDebtForm()
    } catch (e) {
      setDebtForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка операции' }))
    }
  }

  function openCashForm(c: EnrichedClient) {
    setCashForm({
      open: true,
      clientId: c.id,
      clientName: c.name,
      cashAmount: '',
      note: '',
      saving: false,
      msg: '',
    })
  }

  function closeCashForm() {
    setCashForm(emptyCashForm())
  }

  function cashTierHint(cashAmount: string): string {
    void loyaltyCfgTick
    const tier = cashDepositTierForAmount(Number(cashAmount) || 0)
    if (!tier) return 'Порог не достигнут — настройте в админке «Статус карты»'
    return `${cashDepositTierLabel(tier)} → ${tier.bonusPercent}%`
  }

  async function submitCash() {
    const client = clients.find(c => c.id === cashForm.clientId)
    if (!client) return
    const cash = Number(cashForm.cashAmount) || 0
    const bonus = cashBonusPreview
    if (!(cash > 0)) {
      setCashForm(prev => ({ ...prev, msg: 'Укажите сумму наличных' }))
      return
    }
    if (!(bonus > 0)) {
      setCashForm(prev => ({ ...prev, msg: 'Сумма не достигает порога — бонусы не начисляются. Настройте пороги в админке.' }))
      return
    }

    setCashForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      const prevBonus = Number(client.bonus) || 0
      await saveLoyaltyForClient(client, { bonus: prevBonus + bonus })
      closeCashForm()
    } catch (e) {
      setCashForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка пополнения' }))
    }
  }

  function openLoyaltyForm(c: EnrichedClient) {
    const card = cardForClient(c, cards)
    const base = card ? cardLoyaltyFromCard(card, c) : cardLoyaltyFromCard({ num: '', client: c.name, phone: c.phone, status: 'active', level: c.level, bonus: c.bonus, debt: c.debt, debtLimit: c.debtLimit } as AdminCard, c)
    setLoyaltyForm({
      open: true,
      clientId: c.id,
      clientName: c.name,
      levelAssignMode: inferLevelAssignMode(card || {}, c),
      level: base.level,
      levelTermDays: VIP_PERMANENT_DAYS,
      vip: base.vip,
      debtEnabled: base.debtEnabled,
      debtLimit: base.debtLimit > 0 ? String(base.debtLimit) : '',
      saving: false,
      msg: '',
    })
  }

  function closeLoyaltyForm() {
    setLoyaltyForm(emptyLoyaltyForm())
  }

  async function submitLoyalty() {
    const client = clients.find(c => c.id === loyaltyForm.clientId)
    if (!client) return
    setLoyaltyForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      await saveLoyaltyForClient(client, {
        levelAssignMode: loyaltyForm.levelAssignMode,
        level: loyaltyForm.level,
        levelTermDays: loyaltyForm.levelTermDays,
        vip: loyaltyForm.vip,
        debtEnabled: loyaltyForm.debtEnabled,
        debtLimit: Number(loyaltyForm.debtLimit) || 0,
      })
      closeLoyaltyForm()
    } catch (e) {
      setLoyaltyForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка сохранения' }))
    }
  }

  const debtClient = debtForm.open ? clients.find(c => c.id === debtForm.clientId) : null
  const cashClient = cashForm.open ? clients.find(c => c.id === cashForm.clientId) : null
  const loyaltyClient = loyaltyForm.open ? clients.find(c => c.id === loyaltyForm.clientId) : null
  const detailClient = detailId ? clients.find(c => c.id === detailId) || null : null

  const detailHistory = useMemo(() => {
    if (!detailClient) return []
    void histTick
    return historyFor(detailClient)
  }, [detailClient, histTick, sales, orders])

  const autoLevelPreview = useMemo(() => {
    if (!loyaltyClient || loyaltyForm.levelAssignMode !== 'auto') return null
    return earnedAutoLevelForClient(loyaltyClient.phone, loyaltyClient, orders)
  }, [loyaltyClient, loyaltyForm.levelAssignMode, orders])

  const isDebtsView = variant === 'debts'

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>{isDebtsView ? '💳 Долги клиентов' : '👥 Клиенты'}</h1>
          <div className="sub">
            {isDebtsView
              ? 'Задолженности, погашения и лимиты — синхронизация с магазином и админкой'
              : 'Клиенты, бонусы, карты лояльности и VIP-кредит — общие данные со всеми приложениями KAKAPO'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
          {!isDebtsView && (
            <button type="button" className="k-btn k-btn-g" onClick={openNewForm}>+ Новый клиент</button>
          )}
        </div>
      </div>

      {apiError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">Всего клиентов</div>
          <div className="kv">{clients.length}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Бонусы ⭐</div>
          <div className="kv" style={{ color: 'var(--gold)' }}>{stats.totalBonus.toLocaleString()}</div>
        </div>
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
        <div className="k-kpi k-statcard">
          <div className="kl">VIP</div>
          <div className="kv" style={{ color: stats.vipCount > 0 ? 'var(--purple)' : 'var(--muted)' }}>{stats.vipCount}</div>
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
          {!isDebtsView ? (
            <>
              <button type="button" className={`k-subtab ${filter === 'all' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('all')}>Все</button>
              <button type="button" className={`k-subtab ${filter === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('debt')}>С долгом</button>
              <button type="button" className={`k-subtab ${filter === 'vip' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('vip')}>VIP</button>
              <button type="button" className={`k-subtab ${filter === 'no_card' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('no_card')}>Без карты</button>
              <button type="button" className={`k-subtab ${filter === 'blocked' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('blocked')}>Блок</button>
            </>
          ) : (
            <>
              <button type="button" className={`k-subtab ${filter === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('debt')}>С долгом</button>
              <button type="button" className={`k-subtab ${filter === 'over_limit' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('over_limit')}>Превышен лимит</button>
            </>
          )}
          <button type="button" className={`k-subtab ${sort === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('debt')}>По долгу</button>
          <button type="button" className={`k-subtab ${sort === 'bonus' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('bonus')}>По бонусам</button>
          <button type="button" className={`k-subtab ${sort === 'name' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('name')}>По имени</button>
          <button type="button" className={`k-subtab ${sort === 'spent' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('spent')}>По покупкам</button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {clients.length ? 'Ничего не найдено' : 'Клиентов пока нет — нажмите «Новый клиент»'}
        </div>
      ) : (
        <div>
          {filtered.map(c => {
            const debt = Number(c.debt) || 0
            const levelColor = CLIENT_LEVEL_COLORS[c.level] || 'var(--muted)'
            const debtLimit = resolveEffectiveDebtLimit(c)
            const overLimit = debtLimit > 0 && debt > debtLimit
            const card = cardForClient(c, cards)
            const cardStatus = card ? CARD_STATUS_LABELS[card.status] : null

            return (
              <div
                key={c.id}
                className="k-card"
                style={{
                  marginBottom: 10,
                  overflow: 'hidden',
                  border: overLimit ? '1px solid #5a2030' : debt > 0 ? '1px solid #5a4020' : c.blocked ? '1px solid #3a2030' : undefined,
                }}
              >
                <div
                  style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
                  onClick={() => openDetail(c.id)}
                >
                  <span style={{ fontSize: 26, flexShrink: 0 }}>{c.vip ? '⭐' : '👤'}</span>

                  <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 900, fontSize: 15 }}>{c.name}</span>
                      <span className="k-badge" style={{ background: `${levelColor}22`, color: levelColor }}>{levelLabel(c.level)}</span>
                      {c.vip && <span className="k-badge" style={{ background: '#2a1a40', color: 'var(--purple)' }}>VIP</span>}
                      {c.blocked && <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>Блок</span>}
                      {overLimit && <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>⚠ Лимит</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>📞 {c.phone}</a>}
                      {c.card ? <span>💳 {c.card}{cardStatus ? ` · ${cardStatus.l}` : ''}</span> : <span style={{ color: 'var(--gold)' }}>⚠ без карты</span>}
                      {c.lastLabel && <span>· {c.lastLabel}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: '0 0 auto' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Бонусы ⭐</div>
                      <div style={{ fontWeight: 800, color: 'var(--gold)' }}>{c.bonus > 0 ? c.bonus.toLocaleString() : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Покупки</div>
                      <div style={{ fontWeight: 800 }}>{fmtMoney(c.spent)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Долг</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {debt > 0 ? fmtMoney(debt) : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignSelf: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openCashForm(c)} title="Наличные в магазин">💵 Наличные</button>
                    {debt > 0 && (
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openDebtForm(c, 'repay')}>💰 Погасить</button>
                    )}
                    {!c.card && (
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} disabled={provisioningId === c.id} onClick={() => void provisionCard(c)}>
                        {provisioningId === c.id ? '…' : '💳 Карта'}
                      </button>
                    )}
                    {!isDebtsView && (
                      <>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openEditForm(c)}>✎</button>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => void toggleBlockClient(c)} title={c.blocked ? 'Разблокировать' : 'Заблокировать'}>
                          {c.blocked ? '🔓' : '🔒'}
                        </button>
                      </>
                    )}
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openDetail(c.id)}>→</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Новый / редактирование клиента ── */}
      {form.open && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{form.editingId ? '✎ Редактирование клиента' : '👤 Новый клиент'}</b>
              <button type="button" onClick={closeForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              {!form.editingId && (
                <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12, background: '#1a2430', border: '1px solid #2a4060', fontSize: 12 }}>
                  При регистрации автоматически создаётся карта и начисляется <b style={{ color: 'var(--gold)' }}>{welcomeBonus} ⭐</b> приветственных бонусов
                </div>
              )}
              <div className="k-field">
                <label>Имя *</label>
                <input className="k-inp" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="ФИО клиента" />
              </div>
              <div className="k-field">
                <label>Телефон *</label>
                <input className="k-inp" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+992 ..." />
              </div>
              <div className="k-grid2">
                <div className="k-field">
                  <label>Email</label>
                  <input className="k-inp" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} />
                </div>
                <div className="k-field">
                  <label>Адрес</label>
                  <input className="k-inp" value={form.addr} onChange={e => setForm(prev => ({ ...prev, addr: e.target.value }))} />
                </div>
              </div>
              <div className="k-field">
                <label>Карта лояльности</label>
                {unlinkedCards.length > 0 ? (
                  <select className="k-sel" value={form.card} onChange={e => setForm(prev => ({ ...prev, card: e.target.value }))}>
                    <option value="">— Авто (новая карта) —</option>
                    {unlinkedCards.map(card => (
                      <option key={card.num} value={card.num}>{card.num}</option>
                    ))}
                  </select>
                ) : (
                  <input className="k-inp" value={form.card} onChange={e => setForm(prev => ({ ...prev, card: e.target.value.toUpperCase() }))} placeholder="Авто — создастся новая" />
                )}
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input className="k-inp" value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.blocked} onChange={e => setForm(prev => ({ ...prev, blocked: e.target.checked }))} />
                Заблокировать клиента
              </label>
              {form.msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{form.msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={form.saving} onClick={() => void submitForm()}>
                {form.saving ? 'Сохранение…' : form.editingId ? 'Сохранить' : 'Зарегистрировать'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={form.saving} onClick={closeForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Наличные в магазин ── */}
      {cashForm.open && cashClient && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeCashForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>💵 Наличные в магазин</b>
              <button type="button" onClick={closeCashForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12, background: '#1a2a1a', border: '1px solid #2a4032', fontSize: 12 }}>
                Клиент внёс наличные — бонусы считаются по порогам из админки «Статус карты»
                {Number(cashForm.cashAmount) > 0 && (
                  <span> · <b>{cashTierHint(cashForm.cashAmount)}</b></span>
                )}
              </div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <b>{cashForm.clientName}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Баланс: <b style={{ color: 'var(--gold)' }}>{cashClient.bonus.toLocaleString()} ⭐</b>
                </div>
              </div>
              <div className="k-field">
                <label>Сумма наличных (сом) *</label>
                <input
                  className="k-inp"
                  type="text"
                  inputMode="decimal"
                  value={cashForm.cashAmount}
                  onChange={e => setCashForm(prev => ({ ...prev, cashAmount: sanitizeDecimalInput(e.target.value), msg: '' }))}
                  placeholder="0.00"
                />
              </div>
              <div className="k-field">
                <label>Бонусы к начислению ⭐</label>
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--card)',
                  border: `1px solid ${cashBonusPreview > 0 ? 'var(--green)' : 'var(--border)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}>
                  <span style={{ fontWeight: 900, fontSize: 22, color: cashBonusPreview > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                    {cashBonusPreview > 0 ? `+${cashBonusPreview.toLocaleString()} ⭐` : '—'}
                  </span>
                  {Number(cashForm.cashAmount) > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                      {cashTierHint(cashForm.cashAmount)}
                    </span>
                  )}
                </div>
                {Number(cashForm.cashAmount) > 0 && cashBonusPreview <= 0 && (
                  <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 6 }}>
                    Сумма ниже минимального порога — бонусы не начисляются
                  </div>
                )}
              </div>
              <div className="k-field" style={{ marginBottom: 0 }}>
                <label>Комментарий</label>
                <input className="k-inp" value={cashForm.note} onChange={e => setCashForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Например: предоплата, пополнение…" />
              </div>
              {cashForm.msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{cashForm.msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={cashForm.saving || cashBonusPreview <= 0} onClick={() => void submitCash()}>
                {cashForm.saving ? 'Сохранение…' : cashBonusPreview > 0 ? `Начислить +${cashBonusPreview} ⭐` : 'Начислить бонусы'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={cashForm.saving} onClick={closeCashForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Долг ── */}
      {debtForm.open && debtClient && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeDebtForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{debtForm.action === 'repay' ? '💰 Погашение долга' : '➕ Начисление долга'}</b>
              <button type="button" onClick={closeDebtForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <b>{debtForm.clientName}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Долг: <b style={{ color: debtClient.debt > 0 ? 'var(--red)' : 'var(--text)' }}>{fmtMoney(debtClient.debt)}</b>
                  {resolveEffectiveDebtLimit(debtClient) > 0 && (
                    <span> · лимит {fmtMoney(resolveEffectiveDebtLimit(debtClient))}</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button type="button" className={`k-subtab ${debtForm.action === 'repay' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setDebtForm(prev => ({ ...prev, action: 'repay', msg: '' }))}>Погасить</button>
                <button type="button" className={`k-subtab ${debtForm.action === 'add' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setDebtForm(prev => ({ ...prev, action: 'add', msg: '' }))}>Начислить</button>
              </div>
              <div className="k-field">
                <label>Сумма *</label>
                <input className="k-inp" type="text" inputMode="decimal" value={debtForm.amount} onChange={e => setDebtForm(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value) }))} placeholder="0.00" />
                {debtForm.action === 'repay' && debtClient.debt > 0 && (
                  <button type="button" className="k-btn k-btn-s" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setDebtForm(prev => ({ ...prev, amount: String(debtClient.debt) }))}>
                    Погасить весь долг ({fmtMoney(debtClient.debt)})
                  </button>
                )}
              </div>
              {debtForm.action === 'add' && (
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Комментарий</label>
                  <input className="k-inp" value={debtForm.note} onChange={e => setDebtForm(prev => ({ ...prev, note: e.target.value }))} />
                </div>
              )}
              {debtForm.msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{debtForm.msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={debtForm.saving} onClick={() => void submitDebt()}>
                {debtForm.saving ? 'Сохранение…' : debtForm.action === 'repay' ? 'Провести погашение' : 'Начислить долг'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={debtForm.saving} onClick={closeDebtForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Лояльность ── */}
      {loyaltyForm.open && loyaltyClient && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeLoyaltyForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>🏅 Статус и лояльность</b>
              <button type="button" onClick={closeLoyaltyForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 14 }}><b>{loyaltyForm.clientName}</b></div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button type="button" className={`k-subtab ${loyaltyForm.levelAssignMode === 'auto' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setLoyaltyForm(prev => ({ ...prev, levelAssignMode: 'auto' }))}>Авто</button>
                <button type="button" className={`k-subtab ${loyaltyForm.levelAssignMode === 'manual' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setLoyaltyForm(prev => ({ ...prev, levelAssignMode: 'manual' }))}>Вручную</button>
              </div>
              {loyaltyForm.levelAssignMode === 'auto' && autoLevelPreview && (
                <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
                  Авто-уровень по заказам: <b style={{ color: CLIENT_LEVEL_COLORS[autoLevelPreview] }}>{levelLabel(autoLevelPreview)}</b>
                </div>
              )}
              {loyaltyForm.levelAssignMode === 'manual' && (
                <>
                  <div className="k-field">
                    <label>Уровень</label>
                    <select className="k-sel" value={loyaltyForm.level} onChange={e => setLoyaltyForm(prev => ({ ...prev, level: e.target.value as ClientLevel }))}>
                      {CLIENT_LEVEL_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="k-field">
                    <label>Срок действия</label>
                    <select className="k-sel" value={loyaltyForm.levelTermDays} onChange={e => setLoyaltyForm(prev => ({ ...prev, levelTermDays: Number(e.target.value) }))}>
                      <option value={7}>7 дней</option>
                      <option value={30}>30 дней</option>
                      <option value={90}>90 дней</option>
                      <option value={VIP_PERMANENT_DAYS}>Навсегда</option>
                    </select>
                  </div>
                </>
              )}
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>⭐ VIP-статус</span>
                <input type="checkbox" checked={loyaltyForm.vip} onChange={e => setLoyaltyForm(prev => ({ ...prev, vip: e.target.checked }))} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>💳 Раздел долга</span>
                <input type="checkbox" checked={loyaltyForm.debtEnabled} onChange={e => setLoyaltyForm(prev => ({ ...prev, debtEnabled: e.target.checked }))} />
              </label>
              {loyaltyForm.debtEnabled && (
                <div className="k-field" style={{ marginTop: 12 }}>
                  <label>Лимит долга (сом, 0 = из программы)</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={loyaltyForm.debtLimit} onChange={e => setLoyaltyForm(prev => ({ ...prev, debtLimit: sanitizeDecimalInput(e.target.value) }))} placeholder="0" />
                </div>
              )}
              {loyaltyForm.msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{loyaltyForm.msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={loyaltyForm.saving} onClick={() => void submitLoyalty()}>
                {loyaltyForm.saving ? 'Сохранение…' : 'Сохранить статус'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={loyaltyForm.saving} onClick={closeLoyaltyForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Детальная карточка ── */}
      {detailClient && (
        <div className="k-modal-bg" onClick={closeDetail}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22 }}>{detailClient.vip ? '⭐' : '👤'}</span>
                <div>
                  <b>{detailClient.name}</b>
                  <span className="k-badge" style={{ marginLeft: 8, background: `${CLIENT_LEVEL_COLORS[detailClient.level]}22`, color: CLIENT_LEVEL_COLORS[detailClient.level] }}>
                    {levelLabel(detailClient.level)}
                  </span>
                </div>
              </div>
              <button type="button" onClick={closeDetail}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <LoyaltyMiniCard client={detailClient} cards={cards} />

              <div className="k-subtabs" style={{ marginBottom: 14 }}>
                {(['overview', 'loyalty', 'history'] as DetailTab[]).map(tab => (
                  <button key={tab} type="button" className={`k-subtab ${detailTab === tab ? 'active' : ''}`} onClick={() => setDetailTab(tab)}>
                    {tab === 'overview' ? 'Обзор' : tab === 'loyalty' ? 'Лояльность' : 'История'}
                  </button>
                ))}
              </div>

              {detailTab === 'overview' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {detailClient.phone && <a href={`tel:${detailClient.phone.replace(/\s/g, '')}`} style={{ color: 'inherit' }}>📞 {detailClient.phone}</a>}
                    {detailClient.email && <span>✉ {detailClient.email}</span>}
                    {detailClient.addr && <span>📍 {detailClient.addr}</span>}
                    {detailClient.note && <span>💬 {detailClient.note}</span>}
                  </div>
                  <div className="k-kpis" style={{ marginBottom: 14 }}>
                    <div className="k-kpi k-statcard"><div className="kl">Заказов</div><div className="kv">{detailClient.orders}</div></div>
                    <div className="k-kpi k-statcard"><div className="kl">Покупки</div><div className="kv">{fmtMoney(detailClient.spent)}</div></div>
                    <div className="k-kpi k-statcard"><div className="kl">Бонусы</div><div className="kv" style={{ color: 'var(--gold)' }}>{detailClient.bonus > 0 ? detailClient.bonus.toLocaleString() : '—'}</div></div>
                    <div className="k-kpi k-statcard"><div className="kl">Долг</div><div className="kv" style={{ color: detailClient.debt > 0 ? 'var(--red)' : 'var(--muted)' }}>{detailClient.debt > 0 ? fmtMoney(detailClient.debt) : '—'}</div></div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="k-btn k-btn-g" onClick={() => openCashForm(detailClient)}>💵 Наличные</button>
                    {detailClient.debt > 0 && <button type="button" className="k-btn k-btn-s" onClick={() => openDebtForm(detailClient, 'repay')}>💰 Погасить</button>}
                    <button type="button" className="k-btn k-btn-s" onClick={() => openLoyaltyForm(detailClient)}>🏅 Статус</button>
                    {!detailClient.card && <button type="button" className="k-btn k-btn-s" disabled={provisioningId === detailClient.id} onClick={() => void provisionCard(detailClient)}>💳 Создать карту</button>}
                    <button type="button" className="k-btn k-btn-s" onClick={() => openEditForm(detailClient)}>✎ Профиль</button>
                    <button type="button" className="k-btn k-btn-s" onClick={() => void toggleBlockClient(detailClient)}>{detailClient.blocked ? '🔓 Разблок.' : '🔒 Блок'}</button>
                  </div>
                </>
              )}

              {detailTab === 'loyalty' && (
                <>
                  <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
                    {[
                      { l: 'Карта', v: detailClient.card || '—' },
                      { l: 'Уровень', v: levelLabel(detailClient.level) },
                      { l: 'VIP', v: detailClient.vip ? 'Да' : 'Нет' },
                      { l: 'Раздел долга', v: cardHasDebtSection(cardForClient(detailClient, cards) || {}, detailClient) ? 'Включён' : 'Выключен' },
                      { l: 'Лимит долга', v: resolveEffectiveDebtLimit(detailClient) > 0 ? fmtMoney(resolveEffectiveDebtLimit(detailClient)) : '—' },
                      { l: 'Доступно по лимиту', v: resolveEffectiveDebtLimit(detailClient) > 0 ? fmtMoney(Math.max(0, resolveEffectiveDebtLimit(detailClient) - detailClient.debt)) : '—' },
                      { l: 'Кэшбэк', v: `${bonusPercentForLevel(detailClient.level, !!detailClient.vip)}%` },
                      { l: 'Режим уровня', v: inferLevelAssignMode(cardForClient(detailClient, cards) || {}, detailClient) === 'manual' ? 'Вручную' : 'Авто' },
                    ].map(row => (
                      <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>{row.l}</span>
                        <span style={{ fontWeight: 800 }}>{row.v}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="k-btn k-btn-g" onClick={() => openLoyaltyForm(detailClient)}>🏅 Изменить статус</button>
                </>
              )}

              {detailTab === 'history' && (
                <>
                  {!detailHistory.length ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Пока нет операций</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                      {detailHistory.map(row => (
                        <div key={`${row.kind}-${row.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 12 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span>{row.kind === 'pay' ? '💰' : row.kind === 'sale' || row.kind === 'order' ? '🛒' : '📋'}</span>
                            <span style={{ color: 'var(--muted)' }}>{row.dateIso ? fmtDateTime(row.dateIso) : '—'}</span>
                            <span style={{ color: 'var(--muted)' }}>· {row.desc}</span>
                          </span>
                          <span style={{ fontWeight: 800, flexShrink: 0, color: row.kind === 'pay' ? 'var(--green)' : row.kind === 'debt' || row.kind === 'sale' || row.kind === 'order' ? 'var(--red)' : 'var(--text)' }}>
                            {row.kind === 'pay' ? '+' : row.kind === 'debt' || row.kind === 'sale' || row.kind === 'order' ? '−' : ''}{fmtMoney(row.amount)}
                          </span>
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
    </div>
  )
}
