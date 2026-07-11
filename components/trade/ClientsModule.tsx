'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { useCardStore } from '@/lib/cardStore'
import { cardLoyaltyFromCard } from '@/lib/cardCrm'
import {
  saveCardLoyalty,
  saveClientProfile,
} from '@/lib/clientCardSync'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  clientProfileFromClient,
  emptyClientProfileForm,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import {
  loadDebtHistory,
  recordStoreDebtCharge,
  recordStoreDebtRepayment,
  subscribeDebtHistory,
  type DebtHistoryEntry,
} from '@/lib/clientVipCredit'
import { usePosStore } from '@/lib/posStore'
import type { PosSale } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

type SortMode = 'debt' | 'name' | 'spent' | 'recent'
type FilterMode = 'all' | 'debt' | 'vip' | 'blocked'

type ClientFormState = ClientProfileForm & {
  open: boolean
  editingId: string | null
  saving: boolean
  msg: string
}

function emptyClientForm(): ClientFormState {
  return { ...emptyClientProfileForm(), open: false, editingId: null, saving: false, msg: '' }
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

function emptyDebtForm(): DebtFormState {
  return { open: false, clientId: '', clientName: '', action: 'repay', amount: '', note: '', saving: false, msg: '' }
}

function levelLabel(level: ClientLevel): string {
  return CLIENT_LEVEL_OPTIONS.find(o => o.id === level)?.label || level
}

type HistoryRow =
  | { kind: 'debt'; id: string; dateIso: string; amount: number; desc: string }
  | { kind: 'pay'; id: string; dateIso: string; amount: number; desc: string }
  | { kind: 'sale'; id: string; dateIso: string; amount: number; desc: string }

function debtEntryDateIso(row: DebtHistoryEntry): string {
  if (row.ts) return new Date(row.ts).toISOString()
  return ''
}

function buildHistory(client: AdminClient, debtRows: DebtHistoryEntry[], sales: PosSale[]): HistoryRow[] {
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
  return rows.sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')))
}

type ClientsModuleProps = {
  variant?: 'clients' | 'debts'
}

export default function ClientsModule({ variant = 'clients' }: ClientsModuleProps) {
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const sales = usePosStore(s => s.sales)
  const apiSyncing = useClientStore(s => s.apiSyncing)
  const apiError = useClientStore(s => s.apiError)

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>(variant === 'debts' ? 'debt' : 'name')
  const [filter, setFilter] = useState<FilterMode>(variant === 'debts' ? 'debt' : 'all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState<ClientFormState>(emptyClientForm)
  const [debtForm, setDebtForm] = useState<DebtFormState>(emptyDebtForm)
  const [histTick, setHistTick] = useState(0)

  const refreshAll = useCallback(async () => {
    await syncClientsFromApi()
  }, [])

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), [])

  const stats = useMemo(() => {
    const totalDebt = clients.reduce((s, c) => s + (Number(c.debt) || 0), 0)
    const withDebt = clients.filter(c => (Number(c.debt) || 0) > 0).length
    const vipCount = clients.filter(c => !!c.vip).length
    const withCard = clients.filter(c => !!(c.card || '').trim()).length
    const totalBonus = clients.reduce((s, c) => s + (Number(c.bonus) || 0), 0)
    return { totalDebt, withDebt, vipCount, withCard, totalBonus }
  }, [clients])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = clients
    if (filter === 'debt') list = list.filter(c => (Number(c.debt) || 0) > 0)
    else if (filter === 'vip') list = list.filter(c => !!c.vip)
    else if (filter === 'blocked') list = list.filter(c => !!c.blocked)
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
    else sorted.sort((a, b) => String(b.lastOrderAt || b.createdAt || '').localeCompare(String(a.lastOrderAt || a.createdAt || '')))
    return sorted
  }, [clients, q, sort, filter])

  function salesFor(client: AdminClient): PosSale[] {
    return sales.filter(s =>
      (s.clientId && s.clientId === client.id)
      || (s.clientPhone && phonesMatch(s.clientPhone, client.phone)),
    )
  }

  function historyFor(client: AdminClient): HistoryRow[] {
    const debtRows = client.phone ? loadDebtHistory(client.phone) : []
    return buildHistory(client, debtRows, salesFor(client))
  }

  function openDetail(id: string) {
    setDetailId(id)
  }

  function closeDetail() {
    setDetailId(null)
  }

  function openNewForm() {
    setForm({ ...emptyClientProfileForm(), open: true, editingId: null, saving: false, msg: '' })
  }

  function openEditForm(c: AdminClient) {
    setForm({
      ...clientProfileFromClient(c),
      open: true,
      editingId: c.id,
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
      saveClientProfile(form.editingId, {
        name: form.name,
        phone: form.phone,
        email: form.email,
        addr: form.addr,
        card: form.card,
        blocked: form.blocked,
        note: form.note,
      })
      await refreshAll()
      closeForm()
    } catch (e) {
      setForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка сохранения' }))
    }
  }

  async function removeClient(c: AdminClient) {
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

  function openDebtForm(c: AdminClient, action: 'repay' | 'add' = 'repay') {
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
      const card = cards.find(x => x.num === client.card && x.status !== 'unlinked')
      if (card) {
        const loyaltyForm = { ...cardLoyaltyFromCard(card, client), debt: nextDebt }
        await saveCardLoyalty(card, loyaltyForm, 'edit')
      } else if (USE_API) {
        await api.updateClient(client.id, { debt: nextDebt })
      } else {
        useClientStore.getState().updateClient(client.id, { debt: nextDebt })
      }

      if (client.phone) {
        if (debtForm.action === 'repay') {
          recordStoreDebtRepayment(client.phone, amount)
        } else {
          recordStoreDebtCharge(client.phone, amount, debtForm.note.trim() || 'Начисление через торговлю')
        }
      }

      await refreshAll()
      closeDebtForm()
    } catch (e) {
      setDebtForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка операции' }))
    }
  }

  const debtClient = debtForm.open ? clients.find(c => c.id === debtForm.clientId) : null
  const detailClient = detailId ? clients.find(c => c.id === detailId) || null : null
  const detailHistory = useMemo(() => {
    if (!detailClient) return []
    void histTick
    return historyFor(detailClient)
  }, [detailClient, histTick, sales])

  const isDebtsView = variant === 'debts'

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>{isDebtsView ? '💳 Долги клиентов' : '👥 Клиенты'}</h1>
          <div className="sub">
            {isDebtsView
              ? 'Задолженности и погашения — данные общие с магазином и админкой'
              : 'База клиентов, карты лояльности и долги — данные общие со всеми приложениями KAKAPO'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
          {!isDebtsView && (
            <button type="button" className="k-btn k-btn-g" onClick={openNewForm}>+ Новый клиент</button>
          )}
        </div>
      </div>

      {!USE_API && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a2414', color: 'var(--gold)', border: '1px solid #5a4020' }}>
          Работа с клиентами доступна при подключении к API и в локальном режиме
        </div>
      )}
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
        <div className="k-kpi k-statcard">
          <div className="kl">С картой</div>
          <div className="kv">{stats.withCard}</div>
        </div>
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
          {!isDebtsView && (
            <>
              <button type="button" className={`k-subtab ${filter === 'all' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('all')}>Все</button>
              <button type="button" className={`k-subtab ${filter === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('debt')}>С долгом</button>
              <button type="button" className={`k-subtab ${filter === 'vip' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('vip')}>VIP</button>
              <button type="button" className={`k-subtab ${filter === 'blocked' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFilter('blocked')}>Заблок.</button>
            </>
          )}
          <button type="button" className={`k-subtab ${sort === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('debt')}>По долгу</button>
          <button type="button" className={`k-subtab ${sort === 'name' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('name')}>По имени</button>
          <button type="button" className={`k-subtab ${sort === 'spent' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('spent')}>По покупкам</button>
          <button type="button" className={`k-subtab ${sort === 'recent' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('recent')}>По активности</button>
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
            return (
              <div
                key={c.id}
                className="k-card"
                style={{ marginBottom: 10, overflow: 'hidden', border: debt > 0 ? '1px solid #5a4020' : c.blocked ? '1px solid #5a2030' : undefined }}
              >
                <div
                  style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
                  onClick={() => openDetail(c.id)}
                  title="Открыть карточку клиента"
                >
                  <span style={{ fontSize: 26, flexShrink: 0 }}>{c.vip ? '⭐' : '👤'}</span>

                  <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 900, fontSize: 15 }}>{c.name}</span>
                      <span className="k-badge" style={{ background: `${levelColor}22`, color: levelColor }}>{levelLabel(c.level)}</span>
                      {c.vip && <span className="k-badge" style={{ background: '#2a1a40', color: 'var(--purple)' }}>VIP</span>}
                      {c.blocked && <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>Блок</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {c.phone && <span>📞 {c.phone}</span>}
                      {c.card && <span>💳 {c.card}</span>}
                      {c.lastOrderAt && <span>· последний заказ {c.lastOrderAt}</span>}
                    </div>
                    {c.addr && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>📍 {c.addr}</div>}
                  </div>

                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', flex: '0 0 auto' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Покупки</div>
                      <div style={{ fontWeight: 800 }}>{fmtMoney(c.spent)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Бонусы</div>
                      <div style={{ fontWeight: 800, color: 'var(--gold)' }}>{c.bonus > 0 ? c.bonus.toLocaleString() : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Долг</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {debt > 0 ? fmtMoney(debt) : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignSelf: 'center' }} onClick={e => e.stopPropagation()}>
                    {debt > 0 && (
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openDebtForm(c, 'repay')} title="Погасить долг">💰 Погасить</button>
                    )}
                    {!isDebtsView && (
                      <>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openEditForm(c)} title="Редактировать">✎</button>
                        <button
                          type="button"
                          className="k-btn k-btn-s"
                          style={{ padding: '6px 10px', fontSize: 12, color: debt > 0 ? 'var(--muted)' : 'var(--red)' }}
                          disabled={deletingId === c.id || debt > 0}
                          title={debt > 0 ? 'Сначала погасите долг' : 'Удалить клиента'}
                          onClick={() => void removeClient(c)}
                        >
                          {deletingId === c.id ? '…' : '🗑'}
                        </button>
                      </>
                    )}
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openDetail(c.id)}>
                      Открыть →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {form.open && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{form.editingId ? '✎ Редактирование клиента' : '👤 Новый клиент'}</b>
              <button type="button" onClick={closeForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-field">
                <label>Имя *</label>
                <input className="k-inp" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="ФИО клиента" />
              </div>
              <div className="k-field">
                <label>Телефон *</label>
                <input className="k-inp" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+992 ..." />
              </div>
              <div className="k-field">
                <label>Email</label>
                <input className="k-inp" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="email@example.com" />
              </div>
              <div className="k-field">
                <label>Адрес</label>
                <input className="k-inp" value={form.addr} onChange={e => setForm(prev => ({ ...prev, addr: e.target.value }))} placeholder="Адрес доставки" />
              </div>
              <div className="k-field">
                <label>Карта лояльности</label>
                <input className="k-inp" value={form.card} onChange={e => setForm(prev => ({ ...prev, card: e.target.value.toUpperCase() }))} placeholder="КАКАПО-0001" />
              </div>
              <div className="k-field">
                <label>Заметка</label>
                <input className="k-inp" value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Комментарий для сотрудников" />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.blocked} onChange={e => setForm(prev => ({ ...prev, blocked: e.target.checked }))} />
                Заблокировать клиента
              </label>
              {form.msg && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                  {form.msg}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={form.saving} onClick={() => void submitForm()}>
                {form.saving ? 'Сохранение…' : form.editingId ? 'Сохранить' : 'Добавить клиента'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={form.saving} onClick={closeForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {debtForm.open && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeDebtForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{debtForm.action === 'repay' ? '💰 Погашение долга' : '➕ Начисление долга'}</b>
              <button type="button" onClick={closeDebtForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <b>{debtForm.clientName}</b>
                {debtClient && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Текущий долг: <b style={{ color: (Number(debtClient.debt) || 0) > 0 ? 'var(--red)' : 'var(--text)' }}>{fmtMoney(debtClient.debt)}</b>
                    {debtClient.debtLimit > 0 && (
                      <span> · лимит {fmtMoney(debtClient.debtLimit)}</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button type="button" className={`k-subtab ${debtForm.action === 'repay' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setDebtForm(prev => ({ ...prev, action: 'repay', msg: '' }))}>Погасить</button>
                <button type="button" className={`k-subtab ${debtForm.action === 'add' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setDebtForm(prev => ({ ...prev, action: 'add', msg: '' }))}>Начислить</button>
              </div>
              <div className="k-field">
                <label>Сумма *</label>
                <input
                  className="k-inp"
                  type="text"
                  inputMode="decimal"
                  value={debtForm.amount}
                  onChange={e => setDebtForm(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value) }))}
                  placeholder="0.00"
                />
                {debtForm.action === 'repay' && debtClient && (Number(debtClient.debt) || 0) > 0 && (
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onClick={() => setDebtForm(prev => ({ ...prev, amount: String(debtClient.debt) }))}
                  >
                    Погасить весь долг ({fmtMoney(debtClient.debt)})
                  </button>
                )}
              </div>
              {debtForm.action === 'add' && (
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Комментарий</label>
                  <input className="k-inp" value={debtForm.note} onChange={e => setDebtForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Причина начисления…" />
                </div>
              )}
              {debtForm.msg && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                  {debtForm.msg}
                </div>
              )}
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

      {detailClient && (
        <div className="k-modal-bg" onClick={closeDetail}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>{detailClient.vip ? '⭐' : '👤'}</span>
                <div>
                  <b>{detailClient.name}</b>
                  <span className="k-badge" style={{ marginLeft: 8, background: `${CLIENT_LEVEL_COLORS[detailClient.level]}22`, color: CLIENT_LEVEL_COLORS[detailClient.level] }}>
                    {levelLabel(detailClient.level)}
                  </span>
                  {detailClient.vip && <span className="k-badge" style={{ marginLeft: 6, background: '#2a1a40', color: 'var(--purple)' }}>VIP</span>}
                </div>
              </div>
              <button type="button" onClick={closeDetail}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {detailClient.phone && <span>📞 {detailClient.phone}</span>}
                {detailClient.card && <span>💳 {detailClient.card}</span>}
                {detailClient.email && <span>✉ {detailClient.email}</span>}
                {detailClient.addr && <span>📍 {detailClient.addr}</span>}
                {detailClient.note && <span>💬 {detailClient.note}</span>}
              </div>

              <div className="k-kpis" style={{ marginBottom: 14 }}>
                <div className="k-kpi k-statcard">
                  <div className="kl">Заказов</div>
                  <div className="kv">{detailClient.orders}</div>
                </div>
                <div className="k-kpi k-statcard">
                  <div className="kl">Покупки</div>
                  <div className="kv">{fmtMoney(detailClient.spent)}</div>
                </div>
                <div className="k-kpi k-statcard">
                  <div className="kl">Бонусы</div>
                  <div className="kv" style={{ color: 'var(--gold)' }}>{detailClient.bonus > 0 ? detailClient.bonus.toLocaleString() : '—'}</div>
                </div>
                <div className="k-kpi k-statcard">
                  <div className="kl">Долг</div>
                  <div className="kv" style={{ color: (Number(detailClient.debt) || 0) > 0 ? 'var(--red)' : 'var(--muted)' }}>
                    {(Number(detailClient.debt) || 0) > 0 ? fmtMoney(detailClient.debt) : '—'}
                  </div>
                </div>
                {detailClient.debtLimit > 0 && (
                  <div className="k-kpi k-statcard">
                    <div className="kl">Лимит долга</div>
                    <div className="kv">{fmtMoney(detailClient.debtLimit)}</div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {(Number(detailClient.debt) || 0) > 0 && (
                  <button type="button" className="k-btn k-btn-g" onClick={() => openDebtForm(detailClient, 'repay')}>💰 Погасить долг</button>
                )}
                <button type="button" className="k-btn k-btn-s" onClick={() => openDebtForm(detailClient, 'add')}>➕ Начислить</button>
                {!isDebtsView && (
                  <>
                    <button type="button" className="k-btn k-btn-s" onClick={() => openEditForm(detailClient)}>✎ Редактировать</button>
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ color: (Number(detailClient.debt) || 0) > 0 ? 'var(--muted)' : 'var(--red)' }}
                      disabled={deletingId === detailClient.id || (Number(detailClient.debt) || 0) > 0}
                      onClick={() => void removeClient(detailClient)}
                    >
                      {deletingId === detailClient.id ? 'Удаление…' : '🗑 Удалить'}
                    </button>
                  </>
                )}
              </div>

              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>📜 История: долги и погашения</div>
              {!detailHistory.length ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Пока нет операций по долгу</div>
              ) : (
                <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {detailHistory.map(row => (
                    <div
                      key={`${row.kind}-${row.id}`}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 12 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span>{row.kind === 'pay' ? '💰' : row.kind === 'sale' ? '🛒' : '📋'}</span>
                        <span style={{ color: 'var(--muted)' }}>{row.dateIso ? fmtDateTime(row.dateIso) : '—'}</span>
                        <span style={{ color: 'var(--muted)' }}>· {row.desc}</span>
                      </span>
                      <span style={{ fontWeight: 800, flexShrink: 0, color: row.kind === 'pay' ? 'var(--green)' : row.kind === 'debt' || row.kind === 'sale' ? 'var(--red)' : 'var(--text)' }}>
                        {row.kind === 'pay' ? '+' : row.kind === 'debt' || row.kind === 'sale' ? '−' : ''}{fmtMoney(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
