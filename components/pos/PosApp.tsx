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

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap');
  *{box-sizing:border-box}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',system-ui,sans-serif}
  .pos-shell{min-height:100vh;background:#030B05;color:#EBF5ED}
  .pos-wrap{max-width:1280px;margin:0 auto;padding:20px}
  .pos-card{background:#091508;border:1px solid #18321E;border-radius:18px}
  .pos-grid{display:grid;gap:16px}
  .pos-nav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
  .pos-btn{border:none;cursor:pointer;border-radius:12px;padding:10px 14px;font:700 13px 'Nunito',system-ui,sans-serif}
  .pos-btn-main{background:#1FD760;color:#05210D}
  .pos-btn-soft{background:#122315;color:#A9D9B4;border:1px solid #203A25}
  .pos-chip{padding:8px 12px;border-radius:999px;background:#102113;border:1px solid #1D3622;color:#8FB897;font-size:12px;font-weight:800}
  .pos-input,.pos-select,.pos-textarea{width:100%;border-radius:12px;border:1px solid #203A25;background:#061109;color:#EBF5ED;padding:10px 12px;font:600 14px 'Nunito',system-ui,sans-serif}
  .pos-textarea{min-height:84px;resize:vertical}
  .pos-label{font-size:11px;color:#8FB897;margin-bottom:6px;font-weight:800}
  .pos-table{width:100%;border-collapse:collapse}
  .pos-table th,.pos-table td{padding:10px 8px;border-bottom:1px solid #17311D;text-align:left;font-size:13px;vertical-align:top}
  .pos-table th{font-size:11px;color:#8FB897;text-transform:uppercase;letter-spacing:.04em}
  .pos-kpi{padding:16px;border-radius:16px;background:#0D1A10;border:1px solid #1A3320}
  .pos-kpi b{display:block;font-size:24px;margin-top:8px}
  .pos-empty{padding:18px;border-radius:14px;background:#0A1510;border:1px dashed #214128;color:#7EA889}
  @media (max-width: 900px){.pos-two{grid-template-columns:1fr !important}.pos-three{grid-template-columns:1fr !important}}
`

type PosPage = 'sales' | 'cash' | 'warehouse' | 'revision' | 'expiry' | 'suppliers' | 'debts' | 'finance' | 'reports'

const PAGES: { id: PosPage; label: string }[] = [
  { id: 'sales', label: 'POS' },
  { id: 'cash', label: 'Касса' },
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="pos-kpi">
      <div style={{ fontSize: 11, color: '#8FB897', fontWeight: 800 }}>{label}</div>
      <b>{value}</b>
      {sub && <div style={{ marginTop: 6, fontSize: 12, color: '#6F9D79' }}>{sub}</div>}
    </div>
  )
}

function SectionCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="pos-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
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
    <select className="pos-select" value={String(value || '')} onChange={e => onChange(Number(e.target.value) || 0)}>
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
  cashiers,
  openShift,
  reloadAll,
}: {
  products: Product[]
  clients: AdminClient[]
  cards: AdminCard[]
  sales: PosSale[]
  cashiers: Array<{ id: string; name: string }>
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
    <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1.3fr .9fr' }}>
      <SectionCard title="Новая POS-продажа" right={<div className="pos-chip">{openShift ? `Смена: ${openShift.cashierName}` : 'Смена не открыта'}</div>}>
        <div className="pos-grid" style={{ gap: 12 }}>
          {rows.map((row, idx) => (
            <div key={idx} className="pos-grid pos-three" style={{ gridTemplateColumns: '2fr .6fr auto' }}>
              <div>
                <div className="pos-label">Товар</div>
                <ProductPicker products={products} value={row.productId} onChange={productId => setRows(list => list.map((x, i) => i === idx ? { ...x, productId } : x))} />
              </div>
              <div>
                <div className="pos-label">Кол-во</div>
                <input className="pos-input" type="number" min="0.01" step="0.01" value={row.qty} onChange={e => setRows(list => list.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) || 0 } : x))} />
              </div>
              <button className="pos-btn pos-btn-soft" style={{ alignSelf: 'end' }} onClick={() => setRows(list => list.length === 1 ? list : list.filter((_, i) => i !== idx))}>Удалить</button>
            </div>
          ))}
          <button className="pos-btn pos-btn-soft" onClick={() => setRows(list => [...list, { productId: products[0]?.id || 0, qty: 1 }])}>Добавить строку</button>

          <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="pos-label">Клиент</div>
              <select className="pos-select" value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">Без клиента</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </div>
            <div>
              <div className="pos-label">Карта</div>
              <select className="pos-select" value={cardNum} onChange={e => setCardNum(e.target.value)}>
                <option value="">Без карты</option>
                {cards.filter(c => c.status === 'active').map(c => <option key={c.num} value={c.num}>{c.num} · {c.client || c.phone}</option>)}
              </select>
            </div>
          </div>

          <div className="pos-grid pos-three" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div>
              <div className="pos-label">Оплата</div>
              <select className="pos-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'cash' | 'card' | 'credit' | 'mixed')}>
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="credit">В долг</option>
                <option value="mixed">Смешанная</option>
              </select>
            </div>
            <div>
              <div className="pos-label">Наличные</div>
              <input className="pos-input" type="number" step="0.01" value={paidCash} onChange={e => setPaidCash(e.target.value)} />
            </div>
            <div>
              <div className="pos-label">Карта / долг</div>
              <input className="pos-input" type="number" step="0.01" value={paymentMethod === 'credit' ? debtAdded : paidCard} onChange={e => paymentMethod === 'credit' ? setDebtAdded(e.target.value) : setPaidCard(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="pos-label">Комментарий</div>
            <textarea className="pos-textarea" value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: '#8FB897' }}>Итог</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>{money(total)}</div>
            </div>
            <button className="pos-btn pos-btn-main" disabled={busy || !rows.some(r => r.productId && r.qty > 0)} onClick={submitSale}>
              {busy ? 'Проведение...' : 'Провести продажу'}
            </button>
          </div>
          {msg && <div className="pos-empty">{msg}</div>}
        </div>
      </SectionCard>

      <SectionCard title="Последние продажи">
        {sales.length ? (
          <table className="pos-table">
            <thead>
              <tr><th>ID</th><th>Сумма</th><th>Оплата</th><th>Когда</th></tr>
            </thead>
            <tbody>
              {sales.slice(0, 10).map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{money(s.total)}</td>
                  <td>{s.paymentMethod}</td>
                  <td>{fmtIso(s.createdAtIso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="pos-empty">Продаж пока нет.</div>}
      </SectionCard>
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
    <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <SectionCard title="Кассиры и смены">
        <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="pos-label">Имя кассира</div>
            <input className="pos-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <div className="pos-label">PIN</div>
            <input className="pos-input" value={pin} onChange={e => setPin(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="pos-btn pos-btn-main" onClick={createNewCashier}>Добавить кассира</button>
        </div>

        <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
          <div>
            <div className="pos-label">Открыть смену</div>
            <select className="pos-select" value={cashierId} onChange={e => setCashierId(e.target.value)}>
              <option value="">Выберите кассира</option>
              {cashiers.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="pos-label">Стартовый остаток</div>
            <input className="pos-input" type="number" step="0.01" value={openingCash} onChange={e => setOpeningCash(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="pos-btn pos-btn-soft" onClick={openShift}>Открыть смену</button>
        </div>

        <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
          <div>
            <div className="pos-label">Закрыть смену</div>
            <select className="pos-select" value={closeShiftId} onChange={e => setCloseShiftId(e.target.value)}>
              <option value="">Выберите смену</option>
              {shifts.filter(s => s.status === 'open').map(s => <option key={s.id} value={s.id}>{s.cashierName} · {fmtIso(s.openedAtIso)}</option>)}
            </select>
          </div>
          <div>
            <div className="pos-label">Факт в кассе</div>
            <input className="pos-input" type="number" step="0.01" value={closingCash} onChange={e => setClosingCash(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="pos-btn pos-btn-soft" onClick={closeShift}>Закрыть смену</button>
        </div>
        {msg && <div className="pos-empty" style={{ marginTop: 14 }}>{msg}</div>}
      </SectionCard>

      <SectionCard title="Список смен">
        {shifts.length ? (
          <table className="pos-table">
            <thead>
              <tr><th>Кассир</th><th>Статус</th><th>Продажи</th><th>Наличные</th></tr>
            </thead>
            <tbody>
              {shifts.slice(0, 12).map(s => (
                <tr key={s.id}>
                  <td>{s.cashierName}</td>
                  <td>{s.status}</td>
                  <td>{s.salesCount}</td>
                  <td>{money(s.salesCash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="pos-empty">Смен ещё нет.</div>}
      </SectionCard>
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
    <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <SectionCard title="Складские операции">
        <div className="pos-grid" style={{ gap: 18 }}>
          <div className="pos-card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 12 }}>Приход</div>
            <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><div className="pos-label">Товар</div><ProductPicker products={products} value={receiptProductId} onChange={setReceiptProductId} /></div>
              <div><div className="pos-label">Поставщик</div><select className="pos-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Без поставщика</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><div className="pos-label">Количество</div><input className="pos-input" type="number" step="0.01" value={receiptQty} onChange={e => setReceiptQty(e.target.value)} /></div>
              <div><div className="pos-label">Себестоимость</div><input className="pos-input" type="number" step="0.01" value={receiptCost} onChange={e => setReceiptCost(e.target.value)} /></div>
              <div><div className="pos-label">Срок годности</div><input className="pos-input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 12 }}><button className="pos-btn pos-btn-main" onClick={addReceipt}>Сохранить приход</button></div>
          </div>

          <div className="pos-card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 12 }}>Списание</div>
            <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><div className="pos-label">Товар</div><ProductPicker products={products} value={writeoffProductId} onChange={setWriteoffProductId} /></div>
              <div><div className="pos-label">Количество</div><input className="pos-input" type="number" step="0.01" value={writeoffQty} onChange={e => setWriteoffQty(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="pos-label">Причина</div>
              <input className="pos-input" value={reason} onChange={e => setReason(e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}><button className="pos-btn pos-btn-soft" onClick={addWriteoff}>Провести списание</button></div>
          </div>

          {msg && <div className="pos-empty">{msg}</div>}
        </div>
      </SectionCard>

      <SectionCard title="Текущие остатки">
        <table className="pos-table">
          <thead>
            <tr><th>Товар</th><th>Остаток</th><th>Цена</th><th>Себестоимость</th></tr>
          </thead>
          <tbody>
            {products.slice(0, 20).map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.stock}</td>
                <td>{money(p.price)}</td>
                <td>{money(p.costPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )
}

function RevisionPanel({ products, reloadAll }: { products: Product[]; reloadAll: () => Promise<void> }) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState('')
  const list = products.slice(0, 15)

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
    <SectionCard title="Ревизия остатков">
      <table className="pos-table">
        <thead>
          <tr><th>Товар</th><th>Системный остаток</th><th>Фактический остаток</th></tr>
        </thead>
        <tbody>
          {list.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.stock}</td>
              <td><input className="pos-input" value={counts[p.id] ?? String(p.stock)} onChange={e => setCounts(s => ({ ...s, [p.id]: e.target.value }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="pos-btn pos-btn-main" onClick={saveRevision}>Сохранить ревизию</button>
        {msg && <span className="pos-empty" style={{ padding: '10px 12px' }}>{msg}</span>}
      </div>
    </SectionCard>
  )
}

function ExpiryPanel({ expiry }: { expiry: any[] }) {
  return (
    <SectionCard title="Товары со сроком">
      {expiry.length ? (
        <table className="pos-table">
          <thead>
            <tr><th>Товар</th><th>Остаток</th><th>Срок</th><th>Дней осталось</th></tr>
          </thead>
          <tbody>
            {expiry.map(row => (
              <tr key={`${row.receiptId}-${row.productId}`}>
                <td>{row.productName}</td>
                <td>{row.qty}</td>
                <td>{row.expiryDate}</td>
                <td>{row.daysLeft}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="pos-empty">Нет партий с близким сроком годности.</div>}
    </SectionCard>
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
    <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <SectionCard title="Поставщики">
        <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div><div className="pos-label">Название</div><input className="pos-input" value={name} onChange={e => setName(e.target.value)} /></div>
          <div><div className="pos-label">Телефон</div><input className="pos-input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button className="pos-btn pos-btn-main" onClick={addSupplier}>Добавить поставщика</button></div>
        <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
          <div><div className="pos-label">Поставщик</div><select className="pos-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Выберите</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><div className="pos-label">Сумма оплаты</div><input className="pos-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button className="pos-btn pos-btn-soft" onClick={paySupplier}>Оплатить поставщику</button></div>
        {msg && <div className="pos-empty" style={{ marginTop: 14 }}>{msg}</div>}
      </SectionCard>
      <SectionCard title="Баланс поставщиков">
        <table className="pos-table">
          <thead><tr><th>Поставщик</th><th>Долг</th><th>Поставлено</th><th>Оплачено</th></tr></thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{money(s.payableAmount)}</td>
                <td>{money(s.totalSupplied)}</td>
                <td>{money(s.totalPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )
}

function DebtsPanel({ clients, cards, sales }: { clients: AdminClient[]; cards: AdminCard[]; sales: PosSale[] }) {
  const debtClients = clients.filter(c => Number(c.debt) > 0)
  const debtCards = cards.filter(c => Number(c.debt) > 0)
  const creditSales = sales.filter(s => Number(s.debtAdded) > 0)
  return (
    <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <SectionCard title="Клиенты с долгами">
        {debtClients.length ? (
          <table className="pos-table">
            <thead><tr><th>Клиент</th><th>Телефон</th><th>Долг</th></tr></thead>
            <tbody>{debtClients.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td>{money(c.debt)}</td></tr>)}</tbody>
          </table>
        ) : <div className="pos-empty">Клиентских долгов пока нет.</div>}
      </SectionCard>
      <SectionCard title="Карты и продажи в долг">
        {debtCards.length || creditSales.length ? (
          <>
            <table className="pos-table">
              <thead><tr><th>Карта</th><th>Клиент</th><th>Долг</th></tr></thead>
              <tbody>{debtCards.map(c => <tr key={c.num}><td>{c.num}</td><td>{c.client}</td><td>{money(c.debt)}</td></tr>)}</tbody>
            </table>
            <div style={{ marginTop: 16, fontWeight: 900 }}>Последние продажи в долг</div>
            <table className="pos-table">
              <thead><tr><th>ID</th><th>Клиент</th><th>Сумма</th></tr></thead>
              <tbody>{creditSales.slice(0, 8).map(s => <tr key={s.id}><td>{s.id}</td><td>{s.clientName || '—'}</td><td>{money(s.debtAdded)}</td></tr>)}</tbody>
            </table>
          </>
        ) : <div className="pos-empty">Продаж в долг пока нет.</div>}
      </SectionCard>
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
    <div className="pos-grid" style={{ gap: 16 }}>
      <div className="pos-grid pos-three" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Выручка" value={money(financeSummary?.revenue)} />
        <Stat label="Наличные" value={money(financeSummary?.cashRevenue)} />
        <Stat label="Карта" value={money(financeSummary?.cardRevenue)} />
        <Stat label="Выдано в долг" value={money(financeSummary?.creditIssued)} />
      </div>
      <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <SectionCard title="Добавить расход">
          <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><div className="pos-label">Категория</div><input className="pos-input" value={category} onChange={e => setCategory(e.target.value)} /></div>
            <div><div className="pos-label">Сумма</div><input className="pos-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 12 }}><div className="pos-label">Комментарий</div><textarea className="pos-textarea" value={note} onChange={e => setNote(e.target.value)} /></div>
          <div style={{ marginTop: 12 }}><button className="pos-btn pos-btn-main" onClick={addExpense}>Сохранить расход</button></div>
          {msg && <div className="pos-empty" style={{ marginTop: 14 }}>{msg}</div>}
        </SectionCard>
        <SectionCard title="Последние расходы">
          {expenses.length ? (
            <table className="pos-table">
              <thead><tr><th>Категория</th><th>Сумма</th><th>Когда</th></tr></thead>
              <tbody>{expenses.slice(0, 10).map(e => <tr key={e.id}><td>{e.category}</td><td>{money(e.amount)}</td><td>{fmtIso(e.createdAtIso)}</td></tr>)}</tbody>
            </table>
          ) : <div className="pos-empty">Расходов пока нет.</div>}
        </SectionCard>
      </div>
    </div>
  )
}

function ReportsPanel({ report }: { report: any }) {
  const summary = report?.summary || {}
  return (
    <div className="pos-grid" style={{ gap: 16 }}>
      <div className="pos-grid pos-three" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Продаж" value={String(summary.salesCount || 0)} />
        <Stat label="Долг клиентов" value={money(summary.clientDebt)} />
        <Stat label="Долг поставщикам" value={money(summary.supplierDebt)} />
        <Stat label="Расходы" value={money(summary.expenses)} />
      </div>
      <div className="pos-grid pos-two" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <SectionCard title="Топ товаров">
          {report?.topProducts?.length ? (
            <table className="pos-table">
              <thead><tr><th>Товар</th><th>Кол-во</th><th>Выручка</th></tr></thead>
              <tbody>{report.topProducts.map((p: any) => <tr key={p.productId}><td>{p.productName}</td><td>{p.qty}</td><td>{money(p.revenue)}</td></tr>)}</tbody>
            </table>
          ) : <div className="pos-empty">Пока нет данных.</div>}
        </SectionCard>
        <SectionCard title="Последние продажи">
          {report?.recentSales?.length ? (
            <table className="pos-table">
              <thead><tr><th>ID</th><th>Сумма</th><th>Когда</th></tr></thead>
              <tbody>{report.recentSales.map((s: PosSale) => <tr key={s.id}><td>{s.id}</td><td>{money(s.total)}</td><td>{fmtIso(s.createdAtIso)}</td></tr>)}</tbody>
            </table>
          ) : <div className="pos-empty">Продаж пока нет.</div>}
        </SectionCard>
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

  return (
    <div className="pos-shell">
      <style>{CSS}</style>
      <div className="pos-wrap">
        <div className="pos-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: '#8FB897', fontWeight: 900 }}>6-е приложение KAKAPO</div>
              <div style={{ fontSize: 32, fontWeight: 900 }}>POS / Касса / Склад</div>
              <div style={{ marginTop: 6, color: '#6F9D79' }}>Один общий источник данных для товаров, клиентов, карт, долгов и складских остатков.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="pos-chip">Товаров: {products.length}</div>
              <div className="pos-chip">Низкий остаток: {lowStock}</div>
              <div className="pos-chip">Открытая смена: {openShift ? openShift.cashierName : 'нет'}</div>
            </div>
          </div>
          <div className="pos-nav">
            {PAGES.map(item => (
              <button key={item.id} className={`pos-btn ${currentPage === item.id ? 'pos-btn-main' : 'pos-btn-soft'}`} onClick={() => setPage(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {!booted ? (
            <div className="pos-empty">Загрузка POS-модуля...</div>
          ) : pos.apiError ? (
            <div className="pos-empty">{pos.apiError}</div>
          ) : currentPage === 'sales' ? (
            <PosSalesPanel products={products} clients={clients} cards={cards} sales={pos.sales} cashiers={pos.cashiers} openShift={openShift} reloadAll={reloadAll} />
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
