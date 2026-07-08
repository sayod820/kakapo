'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApiSync } from '@/lib/useApiSync'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { useProducts } from '@/lib/store'
import { useClientStore } from '@/lib/clientStore'
import { useCardStore } from '@/lib/cardStore'
import { usePosStore } from '@/lib/posStore'
import { api } from '@/lib/api'
import type { Product, PosSale } from '@/lib/types'
import type { AdminClient } from '@/lib/clientCrm'
import type { AdminCard } from '@/lib/cardCrm'

/* ══════════════════════════════════════════════════════
   KAKAPO POS / Склад — интерфейс в стиле Odoo
   Светлая ERP-тема: верхняя панель приложения, панель
   управления с хлебными крошками, list/form views.
══════════════════════════════════════════════════════ */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
  .odoo *{box-sizing:border-box}
  .odoo{min-height:100vh;background:#eaeaea;color:#374151;font-family:'Roboto',system-ui,-apple-system,sans-serif;font-size:13px}
  .odoo button{font-family:inherit}

  /* Верхняя панель приложения (app navbar) */
  .odoo-navbar{position:sticky;top:0;z-index:30;background:#714B67;color:#fff;display:flex;align-items:center;gap:4px;padding:0 8px;height:46px;box-shadow:0 1px 4px rgba(0,0,0,.2)}
  .odoo-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:0 12px 0 6px;white-space:nowrap}
  .odoo-brand .dot{width:22px;height:22px;border-radius:5px;background:#fff;color:#714B67;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
  .odoo-menu{display:flex;align-items:center;gap:2px;overflow-x:auto;flex:1}
  .odoo-menu::-webkit-scrollbar{height:0}
  .odoo-menuitem{border:none;background:transparent;color:rgba(255,255,255,.82);cursor:pointer;padding:0 12px;height:46px;font-size:13px;font-weight:500;white-space:nowrap;border-bottom:3px solid transparent}
  .odoo-menuitem:hover{background:rgba(255,255,255,.1);color:#fff}
  .odoo-menuitem.active{color:#fff;background:rgba(255,255,255,.14);border-bottom-color:#fff}
  .odoo-userarea{display:flex;align-items:center;gap:10px;padding-left:8px}
  .odoo-avatar{width:28px;height:28px;border-radius:50%;background:#a186a0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px}

  /* Панель управления (control panel) */
  .odoo-control{background:#fff;border-bottom:1px solid #dcdce0;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .odoo-breadcrumb{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:500;color:#374151}
  .odoo-breadcrumb .crumb-app{color:#714B67;font-weight:500}
  .odoo-breadcrumb .sep{color:#adadad}
  .odoo-cp-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}

  /* Контент */
  .odoo-content{padding:16px}
  .odoo-grid{display:grid;gap:16px}

  /* Карточки / form view */
  .odoo-card{background:#fff;border:1px solid #dcdce0;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
  .odoo-card-head{padding:12px 16px;border-bottom:1px solid #ebebeb;display:flex;align-items:center;justify-content:space-between;gap:12px}
  .odoo-card-title{font-size:15px;font-weight:700;color:#374151}
  .odoo-card-body{padding:16px}

  /* Кнопки */
  .odoo-btn{border:1px solid transparent;cursor:pointer;border-radius:4px;padding:7px 14px;font-size:13px;font-weight:500;transition:background .12s,border-color .12s}
  .odoo-btn:disabled{opacity:.55;cursor:not-allowed}
  .odoo-btn-primary{background:#714B67;color:#fff;border-color:#714B67}
  .odoo-btn-primary:hover:not(:disabled){background:#5c3d54}
  .odoo-btn-secondary{background:#fff;color:#714B67;border-color:#714B67}
  .odoo-btn-secondary:hover:not(:disabled){background:#f3edf2}
  .odoo-btn-success{background:#00A09D;color:#fff;border-color:#00A09D}
  .odoo-btn-success:hover:not(:disabled){background:#008783}
  .odoo-btn-light{background:#fff;color:#495057;border-color:#ced4da}
  .odoo-btn-light:hover:not(:disabled){background:#f6f6f6}

  /* Поля ввода */
  .odoo-field{margin-bottom:12px}
  .odoo-label{display:block;font-size:13px;color:#6b7280;margin-bottom:4px;font-weight:500}
  .odoo-input,.odoo-select,.odoo-textarea{width:100%;border:1px solid #ced4da;border-radius:4px;background:#fff;color:#374151;padding:6px 10px;font-size:13px;outline:none;transition:border-color .12s,box-shadow .12s}
  .odoo-input:focus,.odoo-select:focus,.odoo-textarea:focus{border-color:#714B67;box-shadow:0 0 0 2px rgba(113,75,103,.15)}
  .odoo-textarea{min-height:72px;resize:vertical}

  /* Списки (list view) */
  .odoo-table{width:100%;border-collapse:collapse;background:#fff}
  .odoo-table th{background:#fff;color:#6b7280;font-size:12px;font-weight:700;text-align:left;padding:8px 12px;border-bottom:1px solid #dcdce0;text-transform:none;position:sticky;top:0}
  .odoo-table td{padding:8px 12px;border-bottom:1px solid #ededed;font-size:13px;color:#374151;vertical-align:middle}
  .odoo-table tbody tr:hover{background:#f5f2f4}
  .odoo-table .num{text-align:right;font-variant-numeric:tabular-nums}

  /* KPI-плитки */
  .odoo-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .odoo-kpi{background:#fff;border:1px solid #dcdce0;border-radius:4px;padding:14px 16px}
  .odoo-kpi .k-label{font-size:12px;color:#8f8f8f;font-weight:500}
  .odoo-kpi .k-value{font-size:22px;font-weight:700;color:#374151;margin-top:6px}
  .odoo-kpi .k-sub{font-size:12px;color:#adadad;margin-top:4px}

  /* Чипы статусов */
  .odoo-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:500;background:#f0edf1;color:#714B67;border:1px solid #e0d6de}
  .odoo-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700}
  .odoo-badge-open{background:#e5f6f5;color:#00807d}
  .odoo-badge-closed{background:#efefef;color:#7a7a7a}
  .odoo-badge-warn{background:#fdecea;color:#c0392b}

  .odoo-alert{padding:10px 14px;border-radius:4px;font-size:13px;background:#e5f6f5;color:#00706e;border:1px solid #b8e5e3}
  .odoo-alert-error{background:#fdecea;color:#b93a2b;border-color:#f5c6cb}
  .odoo-empty{padding:28px 16px;text-align:center;color:#9a9a9a;font-size:13px}

  .odoo-row-actions{display:flex;gap:8px;align-items:center}
  .odoo-statusbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}

  @media (max-width:960px){
    .odoo-kpis{grid-template-columns:repeat(2,1fr)}
    .odoo-two{grid-template-columns:1fr !important}
    .odoo-three{grid-template-columns:1fr !important}
  }
`

type PosPage = 'sales' | 'cash' | 'warehouse' | 'revision' | 'expiry' | 'suppliers' | 'debts' | 'finance' | 'reports'

const PAGES: { id: PosPage; label: string }[] = [
  { id: 'sales', label: 'Касса POS' },
  { id: 'cash', label: 'Смены' },
  { id: 'warehouse', label: 'Склад' },
  { id: 'revision', label: 'Ревизия' },
  { id: 'expiry', label: 'Сроки' },
  { id: 'suppliers', label: 'Поставщики' },
  { id: 'debts', label: 'Долги' },
  { id: 'finance', label: 'Финансы' },
  { id: 'reports', label: 'Отчёты' },
]

function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} ЅМ`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmtIso(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU')
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="odoo-kpi">
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  )
}

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="odoo-card">
      <div className="odoo-card-head">
        <div className="odoo-card-title">{title}</div>
        {actions}
      </div>
      <div className="odoo-card-body">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="odoo-field">
      <label className="odoo-label">{label}</label>
      {children}
    </div>
  )
}

function Alert({ text }: { text: string }) {
  if (!text) return null
  const isError = /не удал|ошибк|недостаточно|error/i.test(text)
  return <div className={`odoo-alert ${isError ? 'odoo-alert-error' : ''}`} style={{ marginTop: 12 }}>{text}</div>
}

function ProductPicker({
  products,
  value,
  onChange,
}: {
  products: Product[]
  value: number
  onChange: (id: number) => void
}) {
  return (
    <select className="odoo-select" value={String(value || '')} onChange={e => onChange(Number(e.target.value) || 0)}>
      <option value="">Выберите товар</option>
      {products.map(p => (
        <option key={p.id} value={p.id}>{p.name} · {money(p.price)} · ост: {p.stock}</option>
      ))}
    </select>
  )
}

function PosSalesPanel({
  products,
  clients,
  cards,
  sales,
  openShift,
  reloadAll,
}: {
  products: Product[]
  clients: AdminClient[]
  cards: AdminCard[]
  sales: PosSale[]
  openShift?: { id: string; cashierId: string; cashierName: string }
  reloadAll: () => Promise<void>
}) {
  const [rows, setRows] = useState([{ productId: products[0]?.id || 0, qty: 1 }])
  const [clientId, setClientId] = useState('')
  const [cardNum, setCardNum] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit' | 'mixed'>('cash')
  const [paidCash, setPaidCash] = useState('')
  const [paidCard, setPaidCard] = useState('')
  const [debtAdded, setDebtAdded] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!rows[0]?.productId && products[0]?.id) setRows([{ productId: products[0].id, qty: 1 }])
  }, [products, rows])

  const selectedClient = clients.find(c => c.id === clientId)
  const selectedCard = cards.find(c => c.num === cardNum)
  const total = rows.reduce((sum, row) => {
    const product = products.find(p => p.id === row.productId)
    return sum + (Number(product?.price) || 0) * (Number(row.qty) || 0)
  }, 0)

  async function submitSale() {
    setBusy(true)
    setMsg('')
    try {
      await api.createPosSale({
        cashierId: openShift?.cashierId,
        shiftId: openShift?.id,
        clientId: selectedClient?.id || '',
        clientName: selectedClient?.name || selectedCard?.client || '',
        clientPhone: selectedClient?.phone || selectedCard?.phone || '',
        cardNum: cardNum || selectedClient?.card || '',
        paymentMethod,
        paidCash: Number(paidCash) || (paymentMethod === 'cash' ? total : 0),
        paidCard: Number(paidCard) || (paymentMethod === 'card' ? total : 0),
        debtAdded: Number(debtAdded) || (paymentMethod === 'credit' ? total : 0),
        note,
        items: rows.filter(r => r.productId && r.qty > 0).map(r => ({ productId: r.productId, qty: Number(r.qty) || 0 })),
      })
      setRows([{ productId: products[0]?.id || 0, qty: 1 }])
      setClientId('')
      setCardNum('')
      setPaidCash('')
      setPaidCard('')
      setDebtAdded('')
      setNote('')
      setMsg('Продажа проведена')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось провести продажу')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1.4fr .9fr' }}>
      <Card
        title="Новый чек"
        actions={
          openShift
            ? <span className="odoo-chip">Кассир: {openShift.cashierName}</span>
            : <span className="odoo-badge odoo-badge-warn">Смена не открыта</span>
        }
      >
        <table className="odoo-table" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th style={{ width: '55%' }}>Товар</th><th className="num" style={{ width: '25%' }}>Кол-во</th><th style={{ width: '20%' }} /></tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td><ProductPicker products={products} value={row.productId} onChange={productId => setRows(list => list.map((x, i) => i === idx ? { ...x, productId } : x))} /></td>
                <td><input className="odoo-input" type="number" min="0.01" step="0.01" value={row.qty} onChange={e => setRows(list => list.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) || 0 } : x))} /></td>
                <td><button className="odoo-btn odoo-btn-light" onClick={() => setRows(list => list.length === 1 ? list : list.filter((_, i) => i !== idx))}>Удалить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="odoo-btn odoo-btn-secondary" onClick={() => setRows(list => [...list, { productId: products[0]?.id || 0, qty: 1 }])}>+ Добавить строку</button>

        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <Field label="Клиент">
            <select className="odoo-select" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Без клиента</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
            </select>
          </Field>
          <Field label="Карта лояльности">
            <select className="odoo-select" value={cardNum} onChange={e => setCardNum(e.target.value)}>
              <option value="">Без карты</option>
              {cards.filter(c => c.status === 'active').map(c => <option key={c.num} value={c.num}>{c.num} · {c.client || c.phone}</option>)}
            </select>
          </Field>
        </div>

        <div className="odoo-grid odoo-three" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Способ оплаты">
            <select className="odoo-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'cash' | 'card' | 'credit' | 'mixed')}>
              <option value="cash">Наличные</option>
              <option value="card">Карта</option>
              <option value="credit">В долг</option>
              <option value="mixed">Смешанная</option>
            </select>
          </Field>
          <Field label="Наличными">
            <input className="odoo-input" type="number" step="0.01" value={paidCash} onChange={e => setPaidCash(e.target.value)} />
          </Field>
          <Field label={paymentMethod === 'credit' ? 'В долг' : 'Картой'}>
            <input className="odoo-input" type="number" step="0.01" value={paymentMethod === 'credit' ? debtAdded : paidCard} onChange={e => paymentMethod === 'credit' ? setDebtAdded(e.target.value) : setPaidCard(e.target.value)} />
          </Field>
        </div>

        <Field label="Примечание">
          <textarea className="odoo-textarea" value={note} onChange={e => setNote(e.target.value)} />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid #ededed', paddingTop: 14, marginTop: 4 }}>
          <div>
            <div style={{ fontSize: 12, color: '#8f8f8f' }}>Итого к оплате</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#374151' }}>{money(total)}</div>
          </div>
          <button className="odoo-btn odoo-btn-success" disabled={busy || !rows.some(r => r.productId && r.qty > 0)} onClick={submitSale}>
            {busy ? 'Проведение…' : 'Оплатить и провести'}
          </button>
        </div>
        <Alert text={msg} />
      </Card>

      <Card title="Последние продажи">
        {sales.length ? (
          <table className="odoo-table">
            <thead>
              <tr><th>Чек</th><th className="num">Сумма</th><th>Оплата</th><th>Дата</th></tr>
            </thead>
            <tbody>
              {sales.slice(0, 12).map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td className="num">{money(s.total)}</td>
                  <td>{s.paymentMethod}</td>
                  <td>{fmtIso(s.createdAtIso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="odoo-empty">Продаж пока нет.</div>}
      </Card>
    </div>
  )
}

function CashDeskPanel({
  cashiers,
  shifts,
  reloadAll,
}: {
  cashiers: any[]
  shifts: any[]
  reloadAll: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [cashierId, setCashierId] = useState('')
  const [openingCash, setOpeningCash] = useState('')
  const [closeShiftId, setCloseShiftId] = useState('')
  const [closingCash, setClosingCash] = useState('')
  const [msg, setMsg] = useState('')

  async function createNewCashier() {
    try {
      await api.createCashier({ name, pin })
      setName('')
      setPin('')
      setMsg('Кассир добавлен')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function openShift() {
    try {
      await api.openPosShift({ cashierId, openingCash: Number(openingCash) || 0 })
      setMsg('Смена открыта')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function closeShift() {
    try {
      await api.closePosShift(closeShiftId, { closingCash: Number(closingCash) || 0 })
      setMsg('Смена закрыта')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card title="Кассиры и смены">
        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Имя кассира"><input className="odoo-input" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="PIN"><input className="odoo-input" value={pin} onChange={e => setPin(e.target.value)} /></Field>
        </div>
        <button className="odoo-btn odoo-btn-primary" onClick={createNewCashier}>Добавить кассира</button>

        <div style={{ borderTop: '1px solid #ededed', margin: '18px 0 14px' }} />

        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Кассир для смены">
            <select className="odoo-select" value={cashierId} onChange={e => setCashierId(e.target.value)}>
              <option value="">Выберите кассира</option>
              {cashiers.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Стартовый остаток кассы"><input className="odoo-input" type="number" step="0.01" value={openingCash} onChange={e => setOpeningCash(e.target.value)} /></Field>
        </div>
        <button className="odoo-btn odoo-btn-secondary" onClick={openShift}>Открыть смену</button>

        <div style={{ borderTop: '1px solid #ededed', margin: '18px 0 14px' }} />

        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Открытая смена">
            <select className="odoo-select" value={closeShiftId} onChange={e => setCloseShiftId(e.target.value)}>
              <option value="">Выберите смену</option>
              {shifts.filter(s => s.status === 'open').map(s => <option key={s.id} value={s.id}>{s.cashierName} · {fmtIso(s.openedAtIso)}</option>)}
            </select>
          </Field>
          <Field label="Факт в кассе"><input className="odoo-input" type="number" step="0.01" value={closingCash} onChange={e => setClosingCash(e.target.value)} /></Field>
        </div>
        <button className="odoo-btn odoo-btn-light" onClick={closeShift}>Закрыть смену</button>
        <Alert text={msg} />
      </Card>

      <Card title="Журнал смен">
        {shifts.length ? (
          <table className="odoo-table">
            <thead>
              <tr><th>Кассир</th><th>Статус</th><th className="num">Продажи</th><th className="num">Наличные</th></tr>
            </thead>
            <tbody>
              {shifts.slice(0, 14).map(s => (
                <tr key={s.id}>
                  <td>{s.cashierName}</td>
                  <td><span className={`odoo-badge ${s.status === 'open' ? 'odoo-badge-open' : 'odoo-badge-closed'}`}>{s.status === 'open' ? 'Открыта' : 'Закрыта'}</span></td>
                  <td className="num">{s.salesCount}</td>
                  <td className="num">{money(s.salesCash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="odoo-empty">Смен ещё нет.</div>}
      </Card>
    </div>
  )
}

function WarehousePanel({ products, suppliers, reloadAll }: { products: Product[]; suppliers: any[]; reloadAll: () => Promise<void> }) {
  const [receiptProductId, setReceiptProductId] = useState(products[0]?.id || 0)
  const [receiptQty, setReceiptQty] = useState('')
  const [receiptCost, setReceiptCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [expiryDate, setExpiryDate] = useState(today())
  const [writeoffProductId, setWriteoffProductId] = useState(products[0]?.id || 0)
  const [writeoffQty, setWriteoffQty] = useState('')
  const [reason, setReason] = useState('Списание')
  const [msg, setMsg] = useState('')

  async function addReceipt() {
    try {
      await api.createStockReceipt({
        supplierId,
        createdBy: 'pos',
        items: [{ productId: receiptProductId, qty: Number(receiptQty) || 0, costPrice: Number(receiptCost) || 0, expiryDate }],
      })
      setMsg('Приход сохранён')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function addWriteoff() {
    try {
      await api.createStockWriteoff({
        reason,
        createdBy: 'pos',
        items: [{ productId: writeoffProductId, qty: Number(writeoffQty) || 0 }],
      })
      setMsg('Списание сохранено')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
      <div className="odoo-grid" style={{ gap: 16 }}>
        <Card title="Приход товара">
          <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Товар"><ProductPicker products={products} value={receiptProductId} onChange={setReceiptProductId} /></Field>
            <Field label="Поставщик">
              <select className="odoo-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Без поставщика</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Количество"><input className="odoo-input" type="number" step="0.01" value={receiptQty} onChange={e => setReceiptQty(e.target.value)} /></Field>
            <Field label="Себестоимость"><input className="odoo-input" type="number" step="0.01" value={receiptCost} onChange={e => setReceiptCost(e.target.value)} /></Field>
            <Field label="Срок годности"><input className="odoo-input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></Field>
          </div>
          <button className="odoo-btn odoo-btn-primary" onClick={addReceipt}>Оприходовать</button>
        </Card>

        <Card title="Списание товара">
          <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Товар"><ProductPicker products={products} value={writeoffProductId} onChange={setWriteoffProductId} /></Field>
            <Field label="Количество"><input className="odoo-input" type="number" step="0.01" value={writeoffQty} onChange={e => setWriteoffQty(e.target.value)} /></Field>
          </div>
          <Field label="Причина"><input className="odoo-input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <button className="odoo-btn odoo-btn-light" onClick={addWriteoff}>Провести списание</button>
          <Alert text={msg} />
        </Card>
      </div>

      <Card title="Остатки на складе">
        <table className="odoo-table">
          <thead>
            <tr><th>Товар</th><th className="num">Остаток</th><th className="num">Цена</th><th className="num">Себест.</th></tr>
          </thead>
          <tbody>
            {products.slice(0, 30).map(p => (
              <tr key={p.id}>
                <td>{p.name}{Number(p.stock) <= 5 && <span className="odoo-badge odoo-badge-warn" style={{ marginLeft: 8 }}>мало</span>}</td>
                <td className="num">{p.stock}</td>
                <td className="num">{money(p.price)}</td>
                <td className="num">{money(p.costPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function RevisionPanel({ products, reloadAll }: { products: Product[]; reloadAll: () => Promise<void> }) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState('')
  const list = products.slice(0, 20)

  async function saveRevision() {
    try {
      await api.createStockRevision({
        createdBy: 'pos',
        items: list.map(p => ({ productId: p.id, countedStock: counts[p.id] === undefined ? p.stock : Number(counts[p.id]) || 0 })),
      })
      setMsg('Ревизия сохранена')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <Card title="Инвентаризация / ревизия" actions={<button className="odoo-btn odoo-btn-primary" onClick={saveRevision}>Сохранить ревизию</button>}>
      <table className="odoo-table">
        <thead>
          <tr><th>Товар</th><th className="num">Учётный остаток</th><th className="num">Фактический остаток</th><th className="num">Отклонение</th></tr>
        </thead>
        <tbody>
          {list.map(p => {
            const counted = counts[p.id] === undefined ? p.stock : Number(counts[p.id]) || 0
            const diff = counted - p.stock
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">{p.stock}</td>
                <td className="num"><input className="odoo-input" style={{ maxWidth: 120, marginLeft: 'auto', textAlign: 'right' }} value={counts[p.id] ?? String(p.stock)} onChange={e => setCounts(s => ({ ...s, [p.id]: e.target.value }))} /></td>
                <td className="num" style={{ color: diff === 0 ? '#9a9a9a' : diff > 0 ? '#00807d' : '#c0392b' }}>{diff > 0 ? `+${diff}` : diff}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Alert text={msg} />
    </Card>
  )
}

function ExpiryPanel({ expiry }: { expiry: any[] }) {
  return (
    <Card title="Контроль сроков годности">
      {expiry.length ? (
        <table className="odoo-table">
          <thead>
            <tr><th>Товар</th><th className="num">Остаток партии</th><th>Годен до</th><th className="num">Дней осталось</th></tr>
          </thead>
          <tbody>
            {expiry.map(row => (
              <tr key={`${row.receiptId}-${row.productId}`}>
                <td>{row.productName}</td>
                <td className="num">{row.qty}</td>
                <td>{row.expiryDate}</td>
                <td className="num"><span className={`odoo-badge ${row.daysLeft <= 3 ? 'odoo-badge-warn' : 'odoo-badge-open'}`}>{row.daysLeft}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="odoo-empty">Нет партий с близким сроком годности.</div>}
    </Card>
  )
}

function SuppliersPanel({ suppliers, reloadAll }: { suppliers: any[]; reloadAll: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [msg, setMsg] = useState('')

  async function addSupplier() {
    try {
      await api.createSupplier({ name, phone })
      setName('')
      setPhone('')
      setMsg('Поставщик добавлен')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function paySupplier() {
    try {
      await api.createSupplierPayment(supplierId, { amount: Number(amount) || 0 })
      setAmount('')
      setMsg('Оплата проведена')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
      <Card title="Поставщики и оплаты">
        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Название"><input className="odoo-input" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Телефон"><input className="odoo-input" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        </div>
        <button className="odoo-btn odoo-btn-primary" onClick={addSupplier}>Добавить поставщика</button>

        <div style={{ borderTop: '1px solid #ededed', margin: '18px 0 14px' }} />

        <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Поставщик">
            <select className="odoo-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Выберите</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Сумма оплаты"><input className="odoo-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        </div>
        <button className="odoo-btn odoo-btn-secondary" onClick={paySupplier}>Оплатить поставщику</button>
        <Alert text={msg} />
      </Card>

      <Card title="Баланс поставщиков">
        {suppliers.length ? (
          <table className="odoo-table">
            <thead><tr><th>Поставщик</th><th className="num">Долг</th><th className="num">Поставлено</th><th className="num">Оплачено</th></tr></thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num" style={{ color: Number(s.payableAmount) > 0 ? '#c0392b' : '#9a9a9a' }}>{money(s.payableAmount)}</td>
                  <td className="num">{money(s.totalSupplied)}</td>
                  <td className="num">{money(s.totalPaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="odoo-empty">Поставщиков пока нет.</div>}
      </Card>
    </div>
  )
}

function DebtsPanel({ clients, cards, sales }: { clients: AdminClient[]; cards: AdminCard[]; sales: PosSale[] }) {
  const debtClients = clients.filter(c => Number(c.debt) > 0)
  const debtCards = cards.filter(c => Number(c.debt) > 0)
  const creditSales = sales.filter(s => Number(s.debtAdded) > 0)
  return (
    <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card title="Клиенты с долгами">
        {debtClients.length ? (
          <table className="odoo-table">
            <thead><tr><th>Клиент</th><th>Телефон</th><th className="num">Долг</th></tr></thead>
            <tbody>{debtClients.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="num" style={{ color: '#c0392b' }}>{money(c.debt)}</td></tr>)}</tbody>
          </table>
        ) : <div className="odoo-empty">Клиентских долгов пока нет.</div>}
      </Card>
      <Card title="Карты и продажи в долг">
        {debtCards.length || creditSales.length ? (
          <>
            <table className="odoo-table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Карта</th><th>Клиент</th><th className="num">Долг</th></tr></thead>
              <tbody>{debtCards.map(c => <tr key={c.num}><td>{c.num}</td><td>{c.client}</td><td className="num" style={{ color: '#c0392b' }}>{money(c.debt)}</td></tr>)}</tbody>
            </table>
            <div className="odoo-card-title" style={{ fontSize: 13, marginBottom: 8 }}>Последние продажи в долг</div>
            <table className="odoo-table">
              <thead><tr><th>Чек</th><th>Клиент</th><th className="num">Сумма</th></tr></thead>
              <tbody>{creditSales.slice(0, 10).map(s => <tr key={s.id}><td>{s.id}</td><td>{s.clientName || '—'}</td><td className="num">{money(s.debtAdded)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <div className="odoo-empty">Продаж в долг пока нет.</div>}
      </Card>
    </div>
  )
}

function FinancePanel({ financeSummary, expenses, openShiftId, reloadAll }: { financeSummary: any; expenses: any[]; openShiftId?: string; reloadAll: () => Promise<void> }) {
  const [category, setCategory] = useState('Хозрасход')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')

  async function addExpense() {
    try {
      await api.createExpense({ category, amount: Number(amount) || 0, note, createdBy: 'pos', shiftId: openShiftId })
      setAmount('')
      setNote('')
      setMsg('Расход добавлен')
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="odoo-grid" style={{ gap: 16 }}>
      <div className="odoo-kpis">
        <Kpi label="Выручка" value={money(financeSummary?.revenue)} />
        <Kpi label="Наличные" value={money(financeSummary?.cashRevenue)} />
        <Kpi label="Безнал (карта)" value={money(financeSummary?.cardRevenue)} />
        <Kpi label="Выдано в долг" value={money(financeSummary?.creditIssued)} />
      </div>
      <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
        <Card title="Добавить расход">
          <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Категория"><input className="odoo-input" value={category} onChange={e => setCategory(e.target.value)} /></Field>
            <Field label="Сумма"><input className="odoo-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          </div>
          <Field label="Комментарий"><textarea className="odoo-textarea" value={note} onChange={e => setNote(e.target.value)} /></Field>
          <button className="odoo-btn odoo-btn-primary" onClick={addExpense}>Сохранить расход</button>
          <Alert text={msg} />
        </Card>
        <Card title="Последние расходы">
          {expenses.length ? (
            <table className="odoo-table">
              <thead><tr><th>Категория</th><th className="num">Сумма</th><th>Дата</th></tr></thead>
              <tbody>{expenses.slice(0, 12).map(e => <tr key={e.id}><td>{e.category}</td><td className="num">{money(e.amount)}</td><td>{fmtIso(e.createdAtIso)}</td></tr>)}</tbody>
            </table>
          ) : <div className="odoo-empty">Расходов пока нет.</div>}
        </Card>
      </div>
    </div>
  )
}

function ReportsPanel({ report }: { report: any }) {
  const summary = report?.summary || {}
  return (
    <div className="odoo-grid" style={{ gap: 16 }}>
      <div className="odoo-kpis">
        <Kpi label="Продаж всего" value={String(summary.salesCount || 0)} />
        <Kpi label="Долг клиентов" value={money(summary.clientDebt)} />
        <Kpi label="Долг поставщикам" value={money(summary.supplierDebt)} />
        <Kpi label="Расходы" value={money(summary.expenses)} />
      </div>
      <div className="odoo-grid odoo-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="Топ товаров по выручке">
          {report?.topProducts?.length ? (
            <table className="odoo-table">
              <thead><tr><th>Товар</th><th className="num">Кол-во</th><th className="num">Выручка</th></tr></thead>
              <tbody>{report.topProducts.map((p: any) => <tr key={p.productId}><td>{p.productName}</td><td className="num">{p.qty}</td><td className="num">{money(p.revenue)}</td></tr>)}</tbody>
            </table>
          ) : <div className="odoo-empty">Пока нет данных.</div>}
        </Card>
        <Card title="Последние продажи">
          {report?.recentSales?.length ? (
            <table className="odoo-table">
              <thead><tr><th>Чек</th><th className="num">Сумма</th><th>Дата</th></tr></thead>
              <tbody>{report.recentSales.map((s: PosSale) => <tr key={s.id}><td>{s.id}</td><td className="num">{money(s.total)}</td><td>{fmtIso(s.createdAtIso)}</td></tr>)}</tbody>
            </table>
          ) : <div className="odoo-empty">Продаж пока нет.</div>}
        </Card>
      </div>
    </div>
  )
}

function PosAppInner() {
  useApiSync('pos')
  const { page, setPage } = useAppNavigation('sales')
  const products = useProducts(s => s.products)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const pos = usePosStore()
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    void useProducts.getState().fetchProducts()
    void useClientStore.getState().fetchFromApi()
    void useCardStore.getState().fetchFromApi()
    void usePosStore.getState().fetchFromApi()
    setBooted(true)
  }, [])

  const openShift = useMemo(() => pos.shifts.find(s => s.status === 'open'), [pos.shifts])
  const lowStock = useMemo(() => products.filter(p => Number(p.stock) <= 5).length, [products])

  async function reloadAll() {
    await Promise.all([
      useProducts.getState().fetchProducts(),
      useClientStore.getState().fetchFromApi(),
      useCardStore.getState().fetchFromApi(),
      usePosStore.getState().fetchFromApi(),
    ])
  }

  const currentPage = (PAGES.some(p => p.id === page) ? page : 'sales') as PosPage
  const currentLabel = PAGES.find(p => p.id === currentPage)?.label || 'Касса POS'

  return (
    <div className="odoo">
      <style>{CSS}</style>

      {/* App navbar */}
      <div className="odoo-navbar">
        <div className="odoo-brand"><span className="dot">K</span> KAKAPO POS</div>
        <div className="odoo-menu">
          {PAGES.map(item => (
            <button
              key={item.id}
              className={`odoo-menuitem ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="odoo-userarea">
          <div className="odoo-avatar">{openShift ? openShift.cashierName.slice(0, 1).toUpperCase() : 'A'}</div>
        </div>
      </div>

      {/* Control panel */}
      <div className="odoo-control">
        <div className="odoo-breadcrumb">
          <span className="crumb-app">POS / Склад</span>
          <span className="sep">/</span>
          <span>{currentLabel}</span>
        </div>
        <div className="odoo-statusbar">
          <span className="odoo-chip">Товаров: {products.length}</span>
          <span className="odoo-chip">Низкий остаток: {lowStock}</span>
          <span className={`odoo-badge ${openShift ? 'odoo-badge-open' : 'odoo-badge-closed'}`}>
            {openShift ? `Смена: ${openShift.cashierName}` : 'Смена закрыта'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="odoo-content">
        {!booted ? (
          <div className="odoo-card"><div className="odoo-empty">Загрузка модуля POS…</div></div>
        ) : pos.apiError ? (
          <div className="odoo-card"><div className="odoo-empty">{pos.apiError}</div></div>
        ) : currentPage === 'sales' ? (
          <PosSalesPanel products={products} clients={clients} cards={cards} sales={pos.sales} openShift={openShift} reloadAll={reloadAll} />
        ) : currentPage === 'cash' ? (
          <CashDeskPanel cashiers={pos.cashiers} shifts={pos.shifts} reloadAll={reloadAll} />
        ) : currentPage === 'warehouse' ? (
          <WarehousePanel products={products} suppliers={pos.suppliers} reloadAll={reloadAll} />
        ) : currentPage === 'revision' ? (
          <RevisionPanel products={products} reloadAll={reloadAll} />
        ) : currentPage === 'expiry' ? (
          <ExpiryPanel expiry={pos.expiry} />
        ) : currentPage === 'suppliers' ? (
          <SuppliersPanel suppliers={pos.suppliers} reloadAll={reloadAll} />
        ) : currentPage === 'debts' ? (
          <DebtsPanel clients={clients} cards={cards} sales={pos.sales} />
        ) : currentPage === 'finance' ? (
          <FinancePanel financeSummary={pos.financeSummary} expenses={pos.expenses} openShiftId={openShift?.id} reloadAll={reloadAll} />
        ) : (
          <ReportsPanel report={pos.report} />
        )}
      </div>
    </div>
  )
}

export default function PosApp() {
  return (
    <AppNavigationBoundary>
      <PosAppInner />
    </AppNavigationBoundary>
  )
}
