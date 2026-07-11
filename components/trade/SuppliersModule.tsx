'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import type { PosSupplier, SupplierPayment } from '@/lib/types'
import { fmtDateTime, fmtMoney } from './warehouse/warehouseShared'

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
  saving: boolean
  msg: string
}

function emptyPaymentForm(): PaymentFormState {
  return { open: false, supplierId: '', supplierName: '', amount: '', note: '', saving: false, msg: '' }
}

export default function SuppliersModule() {
  const suppliers = usePosStore(s => s.suppliers)
  const receipts = usePosStore(s => s.receipts)
  const apiSyncing = usePosStore(s => s.apiSyncing)
  const apiError = usePosStore(s => s.apiError)

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortMode>('debt')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payments, setPayments] = useState<Record<string, SupplierPayment[]>>({})
  const [paymentsLoading, setPaymentsLoading] = useState<Record<string, boolean>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierFormState>(emptySupplierForm)
  const [payForm, setPayForm] = useState<PaymentFormState>(emptyPaymentForm)

  const refreshAll = useCallback(() => syncPosFromApi(), [])

  const loadPayments = useCallback(async (supplierId: string) => {
    if (!USE_API) return
    setPaymentsLoading(prev => ({ ...prev, [supplierId]: true }))
    try {
      const rows = await api.getSupplierPayments(supplierId)
      setPayments(prev => ({ ...prev, [supplierId]: rows }))
    } catch {
      setPayments(prev => ({ ...prev, [supplierId]: [] }))
    } finally {
      setPaymentsLoading(prev => ({ ...prev, [supplierId]: false }))
    }
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

  async function submitForm() {
    if (!USE_API) return
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
      if (form.editingId) {
        await api.updateSupplier(form.editingId, payload)
      } else {
        await api.createSupplier(payload)
      }
      await refreshAll()
      closeForm()
    } catch (e) {
      setForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка сохранения' }))
    }
  }

  async function removeSupplier(s: PosSupplier) {
    if (!USE_API) return
    if ((Number(s.payableAmount) || 0) > 0) {
      alert('Нельзя удалить поставщика с непогашенным долгом — сначала оплатите задолженность')
      return
    }
    if (!confirm(`Удалить поставщика «${s.name}»?`)) return
    setDeletingId(s.id)
    try {
      await api.deleteSupplier(s.id)
      if (detailId === s.id) setDetailId(null)
      await refreshAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить поставщика')
    } finally {
      setDeletingId(null)
    }
  }

  function openPayForm(s: PosSupplier) {
    setPayForm({ open: true, supplierId: s.id, supplierName: s.name, amount: '', note: '', saving: false, msg: '' })
  }

  function closePayForm() {
    setPayForm(emptyPaymentForm())
  }

  async function submitPayment() {
    if (!USE_API) return
    const amount = Number(payForm.amount)
    if (!(amount > 0)) {
      setPayForm(prev => ({ ...prev, msg: 'Укажите сумму оплаты' }))
      return
    }
    setPayForm(prev => ({ ...prev, saving: true, msg: '' }))
    try {
      await api.createSupplierPayment(payForm.supplierId, { amount, note: payForm.note.trim() || undefined })
      await Promise.all([refreshAll(), loadPayments(payForm.supplierId)])
      closePayForm()
    } catch (e) {
      setPayForm(prev => ({ ...prev, saving: false, msg: e instanceof Error ? e.message : 'Ошибка оплаты' }))
    }
  }

  async function removePayment(supplierId: string, paymentId: string) {
    if (!USE_API) return
    if (!confirm('Удалить этот платёж? Долг поставщику будет восстановлен.')) return
    setDeletingPaymentId(paymentId)
    try {
      await api.deleteSupplierPayment(supplierId, paymentId)
      await Promise.all([refreshAll(), loadPayments(supplierId)])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить платёж')
    } finally {
      setDeletingPaymentId(null)
    }
  }

  const payingSupplier = payForm.open ? suppliers.find(s => s.id === payForm.supplierId) : null
  const detailSupplier = detailId ? suppliers.find(s => s.id === detailId) || null : null

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>🚚 Поставщики</h1>
          <div className="sub">Контакты, поставки и долги — данные общие со всеми приложениями KAKAPO</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {apiSyncing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Обновление…</span>}
          <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openNewForm}>+ Новый поставщик</button>
        </div>
      </div>

      {!USE_API && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a2414', color: 'var(--gold)', border: '1px solid #5a4020' }}>
          Работа с поставщиками доступна только при подключении к API
        </div>
      )}
      {apiError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
          {apiError}
        </div>
      )}

      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">Всего поставщиков</div>
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
          <div className="kl">Оплачено всего</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(stats.totalPaid)}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Поставлено всего</div>
          <div className="kv">{fmtMoney(stats.totalSupplied)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          className="k-inp"
          style={{ flex: '1 1 220px', maxWidth: 360 }}
          placeholder="Поиск: название, телефон, категория…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`k-subtab ${sort === 'debt' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('debt')}>По долгу</button>
          <button type="button" className={`k-subtab ${sort === 'name' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('name')}>По имени</button>
          <button type="button" className={`k-subtab ${sort === 'recent' ? 'active' : ''}`} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setSort('recent')}>По поставке</button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {suppliers.length ? 'Ничего не найдено' : 'Поставщиков пока нет — нажмите «Новый поставщик»'}
        </div>
      ) : (
        <div>
          {filtered.map(s => {
            const debt = Number(s.payableAmount) || 0
            return (
              <div
                key={s.id}
                className="k-card"
                style={{ marginBottom: 10, overflow: 'hidden', border: debt > 0 ? '1px solid #5a4020' : undefined }}
              >
                <div
                  style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
                  onClick={() => openDetail(s.id)}
                  title="Открыть карточку поставщика"
                >
                  <span style={{ fontSize: 26, flexShrink: 0 }}>🚚</span>

                  <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 900, fontSize: 15 }}>{s.name}</span>
                      {s.category && (
                        <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>{s.category}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {s.phone && <span>📞 {s.phone}</span>}
                      {s.address && <span>📍 {s.address}</span>}
                      {s.lastDeliveryAtIso && <span>· последняя поставка {fmtDateTime(s.lastDeliveryAtIso)}</span>}
                    </div>
                    {s.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>💬 {s.note}</div>}
                  </div>

                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', flex: '0 0 auto' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Поставлено</div>
                      <div style={{ fontWeight: 800 }}>{fmtMoney(s.totalSupplied)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Оплачено</div>
                      <div style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(s.totalPaid)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Долг</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: debt > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {debt > 0 ? fmtMoney(debt) : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignSelf: 'center' }} onClick={e => e.stopPropagation()}>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} disabled={!USE_API} onClick={() => openPayForm(s)} title="Провести оплату">💰 Оплата</button>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} disabled={!USE_API} onClick={() => openEditForm(s)} title="Редактировать">✎</button>
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ padding: '6px 10px', fontSize: 12, color: debt > 0 ? 'var(--muted)' : 'var(--red)' }}
                      disabled={!USE_API || deletingId === s.id || debt > 0}
                      title={debt > 0 ? 'Сначала погасите долг' : 'Удалить поставщика'}
                      onClick={() => void removeSupplier(s)}
                    >
                      {deletingId === s.id ? '…' : '🗑'}
                    </button>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openDetail(s.id)}>
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
        <div className="k-modal-bg" onClick={closeForm}>
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
        <div className="k-modal-bg" onClick={closePayForm}>
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
                <label>Сумма оплаты *</label>
                <input
                  className="k-inp"
                  type="number"
                  min="0"
                  step="any"
                  value={payForm.amount}
                  onChange={e => setPayForm(prev => ({ ...prev, amount: e.target.value }))}
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
                    <span className="k-badge" style={{ marginLeft: 8, background: '#1a2430', color: 'var(--blue)' }}>{detailSupplier.category}</span>
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
                <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={() => openPayForm(detailSupplier)}>💰 Оплатить долг</button>
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
