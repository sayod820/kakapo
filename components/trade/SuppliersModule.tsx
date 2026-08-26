'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { softSyncWarehouse, usePosStore } from '@/lib/posStore'
import { guardMutation, useCanMutate, OFFLINE_BLOCK_MESSAGE } from '@/lib/offlineGuard'
import { isTradeLocalFirst } from '@/lib/offlineV2'
import { deleteSupplierSafe, saveSupplierSafe, createSupplierPaymentSafe, deleteSupplierPaymentSafe } from '@/lib/offlineSupplierOps'
import { pushBackHandler } from '@/lib/hardwareBack'
import type { PosSupplier, SupplierPayment } from '@/lib/types'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

type SortMode = 'debt' | 'name' | 'recent'

type SupplierFormState = {
  open: boolean
  editingId: string | null
  name: string
  category: string
  phone: string
  address: string
  note: string
  saving: boolean
  msg: string
}

function emptySupplierForm(): SupplierFormState {
  return { open: false, editingId: null, name: '', category: '', phone: '', address: '', note: '', saving: false, msg: '' }
}

type PaymentFormState = {
  open: boolean
  supplierId: string
  supplierName: string
  amount: string
  note: string
  /** book = только учёт; shift/vault = с деньгами */
  mode: 'book' | 'shift' | 'vault'
  method: 'cash' | 'card'
  saving: boolean
  msg: string
}

function emptyPaymentForm(): PaymentFormState {
  return {
    open: false,
    supplierId: '',
    supplierName: '',
    amount: '',
    note: '',
    mode: 'book',
    method: 'cash',
    saving: false,
    msg: '',
  }
}

export default function SuppliersModule() {
  const canMutateOnline = useCanMutate()
  const canMutate = canMutateOnline || isTradeLocalFirst()
  // Оплаты: онлайн всегда; офлайн — только при V2
  const canPay = canMutateOnline || isTradeLocalFirst()
  const suppliers = usePosStore(s => s.suppliers)
  const receipts = usePosStore(s => s.receipts)
  const apiSyncing = usePosStore(s => s.apiSyncing)

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('debt')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payments, setPayments] = useState<Record<string, SupplierPayment[]>>({})
  const [paymentsLoading, setPaymentsLoading] = useState<Record<string, boolean>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierFormState>(emptySupplierForm)
  const [payForm, setPayForm] = useState<PaymentFormState>(emptyPaymentForm)

  const refreshAll = useCallback(() => {
    void softSyncWarehouse()
  }, [])

  const loadPayments = useCallback(async (supplierId: string) => {
    const cacheKey = `supplier_payments_${supplierId}`
    try {
      const { readCachedData } = await import('@/lib/offline')
      const cached = await readCachedData<SupplierPayment[]>(cacheKey)
      if (cached?.length) {
        setPayments(prev => ({ ...prev, [supplierId]: cached }))
        setPaymentsLoading(prev => ({ ...prev, [supplierId]: false }))
      } else {
        setPaymentsLoading(prev => ({ ...prev, [supplierId]: true }))
      }
    } catch {
      setPaymentsLoading(prev => ({ ...prev, [supplierId]: true }))
    }
    if (!USE_API) {
      setPaymentsLoading(prev => ({ ...prev, [supplierId]: false }))
      return
    }
    // Сеть в фоне — список не ждёт ответ
    void api.getSupplierPayments(supplierId).then(async rows => {
      setPayments(prev => {
        const localOnly = (prev[supplierId] || []).filter(p => {
          const id = String(p.id || '')
          return id.startsWith('off-')
        })
        const serverIds = new Set(rows.map(r => String(r.id)))
        const keepLocal = localOnly.filter(p => !serverIds.has(String(p.id)))
        return { ...prev, [supplierId]: keepLocal.length ? [...keepLocal, ...rows] : rows }
      })
      try {
        const { cacheData } = await import('@/lib/offline')
        void cacheData(cacheKey, rows)
      } catch { /* ignore */ }
    }).catch(() => {
      setPayments(prev => ({ ...prev, [supplierId]: prev[supplierId] || [] }))
    }).finally(() => {
      setPaymentsLoading(prev => ({ ...prev, [supplierId]: false }))
    })
  }, [])

  function openDetail(id: string) {
    setDetailId(id)
    if (!payments[id]) void loadPayments(id)
  }

  function closeDetail() {
    setDetailId(null)
  }

  const stats = useMemo(() => {
    const totalDebt = suppliers.reduce((s, sup) => s + (Number(sup.payableAmount) || 0), 0)
    const totalPaid = suppliers.reduce((s, sup) => s + (Number(sup.totalPaid) || 0), 0)
    const totalSupplied = suppliers.reduce((s, sup) => s + (Number(sup.totalSupplied) || 0), 0)
    const withDebt = suppliers.filter(sup => (Number(sup.payableAmount) || 0) > 0).length
    return { totalDebt, totalPaid, totalSupplied, withDebt }
  }, [suppliers])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = suppliers
    if (query) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(query)
        || (s.phone || '').toLowerCase().includes(query)
        || (s.category || '').toLowerCase().includes(query),
      )
    }
    const sorted = [...list]
    if (sort === 'debt') sorted.sort((a, b) => (Number(b.payableAmount) || 0) - (Number(a.payableAmount) || 0))
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else sorted.sort((a, b) => String(b.lastDeliveryAtIso || '').localeCompare(String(a.lastDeliveryAtIso || '')))
    return sorted
  }, [suppliers, q, sort])

  function receiptsFor(supplierId: string) {
    return receipts.filter(r => r.supplierId === supplierId)
  }

  type HistoryRow =
    | { kind: 'receipt'; id: string; dateIso: string; totalCost: number; debtAdded: number; itemsCount: number }
    | { kind: 'payment'; id: string; dateIso: string; amount: number; note?: string }

  function historyFor(supplierId: string): HistoryRow[] {
    const rows: HistoryRow[] = []
    for (const r of receiptsFor(supplierId)) {
      rows.push({ kind: 'receipt', id: r.id, dateIso: r.createdAtIso, totalCost: r.totalCost, debtAdded: r.debtAdded, itemsCount: r.items?.length || 0 })
    }
    for (const p of payments[supplierId] || []) {
      rows.push({ kind: 'payment', id: p.id, dateIso: p.paidAtIso, amount: p.amount, note: p.note })
    }
    return rows.sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')))
  }

  function openNewForm() {
    setForm({ ...emptySupplierForm(), open: true })
  }

  function openEditForm(s: PosSupplier) {
    setForm({
      open: true,
      editingId: s.id,
      name: s.name,
      category: s.category || '',
      phone: s.phone || '',
      address: s.address || '',
      note: s.note || '',
      saving: false,
      msg: '',
    })
  }

  function closeForm() {
    setForm(emptySupplierForm())
  }

  useEffect(() => {
    if (!form.open && !detailId) return
    return pushBackHandler(() => {
      if (form.open) {
        closeForm()
        return true
      }
      if (detailId) {
        closeDetail()
        return true
      }
      return false
    })
  }, [form.open, detailId])

  async function submitForm() {
    if (!USE_API && !isTradeLocalFirst()) return
    if (!isTradeLocalFirst() && !guardMutation(msg => setForm(prev => ({ ...prev, msg })))) return
    const name = form.name.trim()
    if (!name) {
      setForm(prev => ({ ...prev, msg: 'Укажите название поставщика' }))
      return
    }
    setForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      const payload = {
        name,
        category: form.category.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        note: form.note.trim() || undefined,
      }
      const res = await saveSupplierSafe(payload, form.editingId)
      if (!res.offline) void refreshAll()
      closeForm()
    } catch (e) {
      setForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка сохранения' }))
    }
  }

  async function removeSupplier(s: PosSupplier) {
    if (!USE_API && !isTradeLocalFirst()) return
    if (!isTradeLocalFirst() && !guardMutation()) return
    if ((Number(s.payableAmount) || 0) > 0) {
      alert('Нельзя удалить поставщика с непогашенным долгом — сначала оплатите задолженность')
      return
    }
    if (!confirm(`Удалить поставщика «${s.name}»?`)) return
    setDeletingId(s.id)
    try {
      const res = await deleteSupplierSafe(s.id)
      if (detailId === s.id) setDetailId(null)
      if (!res.offline) void refreshAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить поставщика')
    } finally {
      setDeletingId(null)
    }
  }

  function openPayForm(s: PosSupplier) {
    setPayForm({
      open: true,
      supplierId: s.id,
      supplierName: s.name,
      amount: '',
      note: '',
      mode: 'book',
      method: 'cash',
      saving: false,
      msg: '',
    })
  }

  function closePayForm() {
    setPayForm(emptyPaymentForm())
  }

  async function submitPayment() {
    if (!USE_API && !isTradeLocalFirst()) return
    if (!isTradeLocalFirst() && !guardMutation(msg => setPayForm(prev => ({ ...prev, msg })))) return
    const amount = Number(payForm.amount)
    if (!(amount > 0)) {
      setPayForm(prev => ({ ...prev, msg: 'Укажите сумму оплаты' }))
      return
    }
    setPayForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      if (payForm.mode === 'book') {
        const res = await createSupplierPaymentSafe(payForm.supplierId, {
          amount,
          note: payForm.note.trim() || undefined,
        })
        if (res.offline) {
          setPayments(prev => {
            const next = [res.data, ...(prev[payForm.supplierId] || [])]
            void import('@/lib/offline').then(({ cacheData }) => {
              void cacheData(`supplier_payments_${payForm.supplierId}`, next)
            })
            return { ...prev, [payForm.supplierId]: next }
          })
        } else {
          void refreshAll()
          void loadPayments(payForm.supplierId)
        }
      } else {
        const { financeMoveSafe } = await import('@/lib/offlinePosOps')
        const res = await financeMoveSafe({
          type: 'withdraw',
          amount,
          supplierId: payForm.supplierId,
          note: payForm.note.trim() || `Оплата · ${payForm.supplierName}`,
          payFrom: payForm.mode,
          method: payForm.method,
          reason: `Оплата поставщику · ${payForm.supplierName}`,
        })
        if (!res.offline) {
          void refreshAll()
          void loadPayments(payForm.supplierId)
        } else {
          void loadPayments(payForm.supplierId)
        }
      }
      closePayForm()
    } catch (e) {
      setPayForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка оплаты' }))
    }
  }

  async function removePayment(supplierId: string, paymentId: string) {
    if (!USE_API && !isTradeLocalFirst()) return
    if (!isTradeLocalFirst() && !guardMutation()) return
    if (!confirm('Удалить этот платёж? Долг поставщику будет восстановлен.')) return
    const amountHint = payments[supplierId]?.find(p => p.id === paymentId)?.amount
    setDeletingPaymentId(paymentId)
    try {
      const res = await deleteSupplierPaymentSafe(supplierId, paymentId, amountHint)
      if (res.offline) {
        setPayments(prev => {
          const next = (prev[supplierId] || []).filter(p => p.id !== paymentId)
          void import('@/lib/offline').then(({ cacheData }) => {
            void cacheData(`supplier_payments_${supplierId}`, next)
          })
          return { ...prev, [supplierId]: next }
        })
      } else {
        void refreshAll()
        void loadPayments(supplierId)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить платёж')
    } finally {
      setDeletingPaymentId(null)
    }
  }

  const payingSupplier = payForm.open ? suppliers.find(s => s.id === payForm.supplierId) : null
  const detailSupplier = detailId ? suppliers.find(s => s.id === detailId) || null : null

  return (
    <div className="k-suppliers-mod">
      {apiSyncing && <div className="k-cli-sync-bar">Обновление…</div>}

      <div className="k-kpis k-sup-kpis k-hide-mob">
        <div className="k-kpi k-statcard">
          <div className="kl">Всего</div>
          <div className="kv">{suppliers.length}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">С долгом</div>
          <div className="kv" style={{ color: stats.withDebt > 0 ? 'var(--gold)' : 'var(--muted)' }}>{stats.withDebt}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Общий долг</div>
          <div className="kv" style={{ color: stats.totalDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>{stats.totalDebt > 0 ? fmtMoney(stats.totalDebt) : '—'}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Оплачено</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(stats.totalPaid)}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Поставлено</div>
          <div className="kv">{fmtMoney(stats.totalSupplied)}</div>
        </div>
      </div>

      <div className="k-sup-meta k-hide-desk">
        <div><span>Всего</span><b>{suppliers.length}</b></div>
        <div><span>Долг</span><b style={{ color: stats.withDebt > 0 ? 'var(--gold)' : 'var(--muted)' }}>{stats.withDebt}</b></div>
        <div><span>Σ долг</span><b style={{ color: stats.totalDebt > 0 ? 'var(--red)' : 'var(--muted)' }}>{stats.totalDebt > 0 ? fmtMoney(stats.totalDebt) : '—'}</b></div>
        <div><span>Оплач.</span><b style={{ color: 'var(--green)' }}>{fmtMoney(stats.totalPaid)}</b></div>
        <div><span>Пост.</span><b>{fmtMoney(stats.totalSupplied)}</b></div>
      </div>

      <div className="k-sup-toolbar">
        <input
          className="k-inp k-sup-search"
          placeholder="Поиск: название, телефон, категория…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="k-subtabs k-sup-chips">
          <button type="button" className={`k-subtab ${sort === 'debt' ? 'active' : ''}`} onClick={() => setSort('debt')}>По долгу</button>
          <button type="button" className={`k-subtab ${sort === 'name' ? 'active' : ''}`} onClick={() => setSort('name')}>По имени</button>
          <button type="button" className={`k-subtab ${sort === 'recent' ? 'active' : ''}`} onClick={() => setSort('recent')}>По поставке</button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {suppliers.length ? 'Ничего не найдено' : 'Поставщиков пока нет — нажмите +'}
        </div>
      ) : (
        <div className="k-sup-list">
          {filtered.map(s => {
            const debt = Number(s.payableAmount) || 0
            return (
              <div key={s.id} className={`k-sup-row${debt > 0 ? ' is-debt' : ''}`}>
                <button type="button" className="k-sup-main" onClick={() => openDetail(s.id)}>
                  <span className="k-sup-emo">🚚</span>
                  <div className="k-sup-txt">
                    <div className="k-sup-name">
                      <b>{s.name}</b>
                      {s.category && <span className="k-badge k-badge-cat">{s.category}</span>}
                    </div>
                    <small>
                      {s.phone && <span>☎ {s.phone}</span>}
                      {s.lastDeliveryAtIso && <span> · {fmtDateTime(s.lastDeliveryAtIso)}</span>}
                    </small>
                  </div>
                  <div className="k-sup-stats">
                    <div><span>Пост.</span><b>{fmtMoney(s.totalSupplied)}</b></div>
                    <div><span>Оплач.</span><b style={{ color: 'var(--green)' }}>{fmtMoney(s.totalPaid)}</b></div>
                    <div><span>Долг</span><b style={{ color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>{debt > 0 ? fmtMoney(debt) : '—'}</b></div>
                  </div>
                </button>
                <div className="k-sup-actions">
                  <button type="button" className="k-btn k-btn-s" disabled={!USE_API && !isTradeLocalFirst()} onClick={() => openPayForm(s)} title="Оплата">💰</button>
                  <button type="button" className="k-btn k-btn-s" disabled={!USE_API && !isTradeLocalFirst()} onClick={() => openEditForm(s)} title="Редактировать">✎</button>
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    style={{ color: debt > 0 ? 'var(--muted)' : 'var(--red)' }}
                    disabled={(!USE_API && !isTradeLocalFirst()) || deletingId === s.id || debt > 0}
                    title={debt > 0 ? 'Сначала погасите долг' : 'Удалить'}
                    onClick={() => void removeSupplier(s)}
                  >
                    {deletingId === s.id ? '…' : '✕'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        className="k-wh-fab k-sup-fab"
        disabled={(!USE_API && !isTradeLocalFirst()) || !canMutate}
        title={canMutate ? 'Новый поставщик' : OFFLINE_BLOCK_MESSAGE}
        aria-label="Новый поставщик"
        onClick={openNewForm}
      >
        +
      </button>

      {form.open && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closeForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>{form.editingId ? '✎ Редактирование поставщика' : '🚚 Новый поставщик'}</b>
              <button type="button" onClick={closeForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-field">
                <label>Название *</label>
                <input className="k-inp" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Например: ОсОО «Свежие продукты»" />
              </div>
              <div className="k-field">
                <label>Категория</label>
                <input className="k-inp" value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Овощи, молочка, напитки…" />
              </div>
              <div className="k-field">
                <label>Телефон</label>
                <input className="k-inp" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+992 ..." />
              </div>
              <div className="k-field">
                <label>Адрес</label>
                <input className="k-inp" value={form.address} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} placeholder="Адрес склада / офиса" />
              </div>
              <div className="k-field" style={{ marginBottom: 0 }}>
                <label>Заметка</label>
                <input className="k-inp" value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Условия оплаты, контактное лицо…" />
              </div>
              {form.msg && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                  {form.msg}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={form.saving} onClick={() => void submitForm()}>
                {form.saving ? 'Сохранение…' : form.editingId ? 'Сохранить' : 'Добавить поставщика'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={form.saving} onClick={closeForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {payForm.open && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={closePayForm}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>💰 Оплата поставщику</b>
              <button type="button" onClick={closePayForm}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <b>{payForm.supplierName}</b>
                {payingSupplier && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Текущий долг: <b style={{ color: (Number(payingSupplier.payableAmount) || 0) > 0 ? 'var(--red)' : 'var(--text)' }}>{fmtMoney(payingSupplier.payableAmount)}</b>
                  </div>
                )}
              </div>
              <div className="k-field">
                <label>Как оплатить</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`k-subtab ${payForm.mode === 'book' ? 'active' : ''}`}
                    onClick={() => setPayForm(prev => ({ ...prev, mode: 'book' }))}
                  >
                    Только учёт
                  </button>
                  <button
                    type="button"
                    className={`k-subtab ${payForm.mode === 'shift' ? 'active' : ''}`}
                    onClick={() => setPayForm(prev => ({ ...prev, mode: 'shift' }))}
                  >
                    Из кассы смены
                  </button>
                  <button
                    type="button"
                    className={`k-subtab ${payForm.mode === 'vault' ? 'active' : ''}`}
                    onClick={() => setPayForm(prev => ({ ...prev, mode: 'vault' }))}
                  >
                    Из основного
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {payForm.mode === 'book'
                    ? 'Долг уменьшится, деньги в ящиках не трогаем'
                    : 'Долг уменьшится и спишем деньги из выбранного ящика'}
                </div>
              </div>
              {payForm.mode !== 'book' && (
                <div className="k-field">
                  <label>Чем</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className={`k-subtab ${payForm.method === 'cash' ? 'active' : ''}`}
                      onClick={() => setPayForm(prev => ({ ...prev, method: 'cash' }))}
                    >
                      Нал
                    </button>
                    <button
                      type="button"
                      className={`k-subtab ${payForm.method === 'card' ? 'active' : ''}`}
                      onClick={() => setPayForm(prev => ({ ...prev, method: 'card' }))}
                    >
                      Карта
                    </button>
                  </div>
                </div>
              )}
              <div className="k-field">
                <label>Сумма оплаты *</label>
                <input
                  className="k-inp"
                  type="text"
                  inputMode="decimal"
                  value={payForm.amount}
                  onChange={e => setPayForm(prev => ({ ...prev, amount: sanitizeDecimalInput(e.target.value) }))}
                  placeholder="0.00"
                />
                {payingSupplier && (Number(payingSupplier.payableAmount) || 0) > 0 && (
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onClick={() => setPayForm(prev => ({ ...prev, amount: String(payingSupplier.payableAmount) }))}
                  >
                    Оплатить весь долг ({fmtMoney(payingSupplier.payableAmount)})
                  </button>
                )}
              </div>
              <div className="k-field" style={{ marginBottom: 0 }}>
                <label>Комментарий</label>
                <input className="k-inp" value={payForm.note} onChange={e => setPayForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Например: наличными, через кассу…" />
              </div>
              {payForm.msg && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                  {payForm.msg}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={payForm.saving} onClick={() => void submitPayment()}>
                {payForm.saving ? 'Сохранение…' : 'Провести оплату'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={payForm.saving} onClick={closePayForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {detailSupplier && (
        <div className="k-modal-bg" onClick={closeDetail}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>🚚</span>
                <div>
                  <b>{detailSupplier.name}</b>
                  {detailSupplier.category && (
                    <span className="k-badge k-badge-cat" style={{ marginLeft: 8 }}>{detailSupplier.category}</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={closeDetail}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              {(detailSupplier.phone || detailSupplier.address || detailSupplier.note) && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {detailSupplier.phone && <span>📞 {detailSupplier.phone}</span>}
                  {detailSupplier.address && <span>📍 {detailSupplier.address}</span>}
                  {detailSupplier.note && <span>💬 {detailSupplier.note}</span>}
                </div>
              )}

              <div className="k-kpis" style={{ marginBottom: 14 }}>
                <div className="k-kpi k-statcard">
                  <div className="kl">Поставлено</div>
                  <div className="kv">{fmtMoney(detailSupplier.totalSupplied)}</div>
                </div>
                <div className="k-kpi k-statcard">
                  <div className="kl">Оплачено</div>
                  <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(detailSupplier.totalPaid)}</div>
                </div>
                <div className="k-kpi k-statcard">
                  <div className="kl">Долг</div>
                  <div className="kv" style={{ color: (Number(detailSupplier.payableAmount) || 0) > 0 ? 'var(--red)' : 'var(--muted)' }}>
                    {(Number(detailSupplier.payableAmount) || 0) > 0 ? fmtMoney(detailSupplier.payableAmount) : '—'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <button type="button" className="k-btn k-btn-g" disabled={!USE_API || !canPay} title={canPay ? undefined : OFFLINE_BLOCK_MESSAGE} onClick={() => openPayForm(detailSupplier)}>💰 Оплатить долг</button>
                <button type="button" className="k-btn k-btn-s" disabled={!USE_API} onClick={() => openEditForm(detailSupplier)}>✎ Редактировать</button>
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ color: (Number(detailSupplier.payableAmount) || 0) > 0 ? 'var(--muted)' : 'var(--red)' }}
                  disabled={!USE_API || deletingId === detailSupplier.id || (Number(detailSupplier.payableAmount) || 0) > 0}
                  title={(Number(detailSupplier.payableAmount) || 0) > 0 ? 'Сначала погасите долг' : 'Удалить поставщика'}
                  onClick={() => void removeSupplier(detailSupplier)}
                >
                  {deletingId === detailSupplier.id ? 'Удаление…' : '🗑 Удалить'}
                </button>
              </div>

              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>📜 История: поставки и платежи</div>
              {paymentsLoading[detailSupplier.id] ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Загрузка…</div>
              ) : !historyFor(detailSupplier.id).length ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Пока нет ни поставок, ни платежей</div>
              ) : (
                <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {historyFor(detailSupplier.id).map(row => (
                    <div
                      key={`${row.kind}-${row.id}`}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 12 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span>{row.kind === 'receipt' ? '📥' : '💰'}</span>
                        <span style={{ color: 'var(--muted)' }}>{fmtDateTime(row.dateIso)}</span>
                        {row.kind === 'receipt' && <span style={{ color: 'var(--muted)' }}>· приход, {row.itemsCount} поз.</span>}
                        {row.kind === 'payment' && row.note && <span style={{ color: 'var(--muted)' }}>· {row.note}</span>}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {row.kind === 'receipt' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>{fmtMoney(row.totalCost)}</span>
                            {row.debtAdded > 0 && <span style={{ color: 'var(--gold)' }}>долг +{fmtMoney(row.debtAdded)}</span>}
                          </>
                        ) : (
                          <>
                            <span style={{ fontWeight: 800, color: 'var(--green)' }}>+{fmtMoney(row.amount)}</span>
                            <button
                              type="button"
                              className="k-btn k-btn-s"
                              style={{ padding: '2px 8px', fontSize: 11, color: 'var(--red)' }}
                              disabled={deletingPaymentId === row.id}
                              onClick={() => void removePayment(detailSupplier.id, row.id)}
                              title="Удалить платёж"
                            >
                              {deletingPaymentId === row.id ? '…' : '✕'}
                            </button>
                          </>
                        )}
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
