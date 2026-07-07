'use client'
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useProducts, USE_API } from '@/lib/store'
import { api } from '@/lib/api'
import type { Supplier, StockReceipt, WriteOff, Expense } from '@/lib/api'
import type { Product, Order } from '@/lib/types'
import type { AdminClient } from '@/lib/clientCrm'
import { useClients, hydrateClientStore } from '@/lib/clientStore'
import { phonesMatch } from '@/lib/clientCrm'
import { getBonusUsable } from '@/lib/clientVipCredit'
import {
  isWeighted,
  nextCartQty,
  calcLineTotal,
  formatCartQty,
  formatPriceLabel,
  orderItemFromProduct,
} from '@/lib/productWeight'
import { useCashierTeam, hydrateCashierTeamStore } from '@/lib/cashierTeamStore'
import { loadCashierSession, saveCashierSession, clearCashierSession, type CashierSession } from '@/lib/cashierSession'
import PosLoginPage from '@/components/pos/PosLoginPage'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.96);}
  .card{background:linear-gradient(165deg,#0C1C0F 0%,#091508 100%);border:1px solid #162B1A;border-radius:16px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:12px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:11px 14px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(31,215,96,.5);}
  .inp::placeholder{color:#3D6645;}
  select.inp{appearance:none;}
  @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  ::-webkit-scrollbar{width:6px;height:6px;}
  ::-webkit-scrollbar-thumb{background:#162B1A;border-radius:6px;}

  .pos-shell{min-height:100dvh;display:flex;background:#030B05;max-width:1400px;margin:0 auto;}
  .pos-sidebar{width:222px;flex-shrink:0;background:#050F07;border-right:1px solid #162B1A;display:flex;flex-direction:column;padding:16px 12px;gap:14px;}
  .pos-nav-item{display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:13px;font-size:13px;font-weight:700;color:#8FB897;background:none;text-align:left;width:100%;}
  .pos-nav-item.active{background:linear-gradient(135deg,rgba(23,179,78,.2),rgba(31,215,96,.06));color:#1FD760;border:1px solid rgba(31,215,96,.3);box-shadow:0 4px 16px rgba(31,215,96,.12);}
  .pos-nav-item:not(.active){border:1px solid transparent;}
  .pos-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:100dvh;}
  .pos-bottombar{display:none;}
  .pos-sale-grid{display:grid;grid-template-columns:1.5fr 1fr;flex:1;min-height:0;}
  @media (max-width:860px){
    .pos-sidebar{display:none;}
    .pos-bottombar{display:flex;position:fixed;bottom:0;left:0;right:0;background:rgba(5,15,7,.97);backdrop-filter:blur(20px);border-top:1px solid #162B1A;padding:8px 4px calc(8px + env(safe-area-inset-bottom,0px));justify-content:space-around;z-index:50;}
    .pos-main{padding-bottom:72px;}
    .pos-sale-grid{grid-template-columns:1fr;}
    .pos-content{padding:12px !important;}
  }
  .pos-bottom-item{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 8px;border-radius:11px;font-size:9px;font-weight:700;color:#8FB897;background:none;flex:1;}
  .pos-bottom-item.active{color:#1FD760;background:rgba(31,215,96,.1);}
`

const LEVEL_LABEL: Record<string, string> = {
  basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина',
}
const LEVEL_COLOR: Record<string, string> = {
  basic: '#8FB897', bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', platinum: '#B9F2FF',
}
const WRITE_OFF_REASONS = ['Порча', 'Просрочка', 'Недостача', 'Другое']
const EXPENSE_CATEGORIES = ['Аренда', 'Зарплата', 'Коммунальные', 'Транспорт', 'Другое']

function money(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

type ModuleId = 'sale' | 'receipts' | 'writeoffs' | 'expenses' | 'suppliers' | 'shift'
const MODULES: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'sale', icon: '🧾', label: 'Продажа' },
  { id: 'receipts', icon: '📥', label: 'Приход' },
  { id: 'writeoffs', icon: '🗑', label: 'Списание' },
  { id: 'expenses', icon: '💸', label: 'Расходы' },
  { id: 'suppliers', icon: '🚚', label: 'Поставщики' },
  { id: 'shift', icon: '📊', label: 'Смена' },
]

interface TicketState {
  cart: Record<number, number>
  selectedClient: AdminClient | null
  bonusToApply: number
  paymentMethod: 'cash' | 'card' | 'credit'
}
function emptyTicket(): TicketState {
  return { cart: {}, selectedClient: null, bonusToApply: 0, paymentMethod: 'cash' }
}

function PosSessionBoot() {
  return <div style={{ minHeight: '100dvh', background: '#030B05' }} />
}

function PosAppInner() {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const clients = useClients()
  const cashiers = useCashierTeam()

  const [session, setSession] = useState<CashierSession | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  useLayoutEffect(() => {
    setSession(loadCashierSession())
    setSessionReady(true)
    hydrateCashierTeamStore()
    hydrateClientStore()
    void fetchProducts()
  }, [fetchProducts])

  const cashierProfile = useMemo(() => {
    if (!session) return null
    return cashiers.find(c => c.id === session.cashierId) || cashiers.find(c => c.name === session.name) || null
  }, [cashiers, session])

  const [module, setModule] = useState<ModuleId>('sale')

  // ── Множественные открытые чеки ──
  const ticketSeq = useRef(1)
  const [tickets, setTickets] = useState<Record<string, TicketState>>({ T1: emptyTicket() })
  const [ticketOrder, setTicketOrder] = useState<string[]>(['T1'])
  const [activeTicketId, setActiveTicketId] = useState('T1')

  const newTicket = () => {
    ticketSeq.current += 1
    const id = `T${ticketSeq.current}`
    setTickets(t => ({ ...t, [id]: emptyTicket() }))
    setTicketOrder(o => [...o, id])
    setActiveTicketId(id)
  }
  const closeTicket = (id: string) => {
    setTicketOrder(o => {
      const next = o.filter(x => x !== id)
      if (next.length === 0) {
        ticketSeq.current += 1
        const freshId = `T${ticketSeq.current}`
        setTickets({ [freshId]: emptyTicket() })
        setActiveTicketId(freshId)
        return [freshId]
      }
      setTickets(t => { const n = { ...t }; delete n[id]; return n })
      if (activeTicketId === id) setActiveTicketId(next[0])
      return next
    })
  }
  const patchTicket = (id: string, patch: Partial<TicketState> | ((t: TicketState) => Partial<TicketState>)) => {
    setTickets(t => ({ ...t, [id]: { ...t[id], ...(typeof patch === 'function' ? patch(t[id]) : patch) } }))
  }
  const activeTicket = tickets[activeTicketId] || emptyTicket()
  const patchActive = (patch: Partial<TicketState> | ((t: TicketState) => Partial<TicketState>)) => patchTicket(activeTicketId, patch)

  const [search, setSearch] = useState('')
  const [catFlt, setCatFlt] = useState('all')
  const [scanValue, setScanValue] = useState('')
  const [scanErr, setScanErr] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)

  const [clientQuery, setClientQuery] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [receipt, setReceipt] = useState<{ order: Order; loyalty: { earned: number; bonus: number } } | null>(null)
  const [shiftSales, setShiftSales] = useState<Order[]>([])
  const [shiftReceipts, setShiftReceipts] = useState<StockReceipt[]>([])
  const [shiftWriteOffs, setShiftWriteOffs] = useState<WriteOff[]>([])
  const [shiftExpenses, setShiftExpenses] = useState<Expense[]>([])

  // ── Склад: поставщики / приход / списания / расходы ──
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [receipts, setReceipts] = useState<StockReceipt[]>([])
  const [writeOffs, setWriteOffs] = useState<WriteOff[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [invBusy, setInvBusy] = useState(false)
  const [invErr, setInvErr] = useState('')

  const reloadInventory = async () => {
    if (!USE_API) return
    const [s, r, w, e] = await Promise.all([
      api.getSuppliers().catch(() => []),
      api.getStockReceipts().catch(() => []),
      api.getWriteOffs().catch(() => []),
      api.getExpenses().catch(() => []),
    ])
    setSuppliers(s); setReceipts(r); setWriteOffs(w); setExpenses(e)
  }
  useEffect(() => { void reloadInventory() }, [])

  const cats = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products) if (p.catId) map.set(p.catId, p.cat || p.catId)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      const matchC = catFlt === 'all' || p.catId === catFlt
      const matchQ = !q || p.name.toLowerCase().includes(q) || (p.art || '').toLowerCase().includes(q)
      return matchC && matchQ
    })
  }, [products, search, catFlt])

  const cartLines = useMemo(() => {
    return Object.entries(activeTicket.cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ product: products.find(p => p.id === Number(id))!, qty }))
      .filter(l => l.product)
  }, [activeTicket.cart, products])

  const goodsTotal = useMemo(
    () => Math.round(cartLines.reduce((s, l) => s + calcLineTotal(l.product, l.qty), 0) * 100) / 100,
    [cartLines],
  )

  const selectedClient = activeTicket.selectedClient
  const bonusUsable = selectedClient ? getBonusUsable({ bonus: selectedClient.bonus }, goodsTotal) : 0
  const payable = Math.max(0, Math.round((goodsTotal - Math.min(activeTicket.bonusToApply, bonusUsable)) * 100) / 100)

  const addToCart = (p: Product, qty?: number) => {
    patchActive(t => {
      const current = t.cart[p.id] || 0
      const next = qty != null ? current + qty : nextCartQty(p, current, true)
      return { cart: { ...t.cart, [p.id]: next } }
    })
  }
  const decFromCart = (p: Product) => {
    patchActive(t => ({ cart: { ...t.cart, [p.id]: nextCartQty(p, t.cart[p.id] || 0, false) } }))
  }
  const removeFromCart = (id: number) => patchActive(t => { const n = { ...t.cart }; delete n[id]; return { cart: n } })

  const handleScan = () => {
    const code = scanValue.trim()
    if (!code) return
    const product = products.find(p => p.art?.toLowerCase() === code.toLowerCase() || p.barcode === code)
    if (!product) {
      setScanErr(`Товар не найден: ${code}`)
      setScanValue('')
      return
    }
    setScanErr('')
    addToCart(product, isWeighted(product) ? undefined : 1)
    setScanValue('')
  }

  const clientResults = useMemo(() => {
    const q = clientQuery.trim()
    if (!q) return []
    const digits = q.replace(/\D/g, '')
    return clients.filter(c => {
      if (digits.length >= 3 && (phonesMatch(c.phone, q) || c.phone.replace(/\D/g, '').includes(digits))) return true
      if (c.card && c.card.toLowerCase().replace(/\s/g, '').includes(q.toLowerCase().replace(/\s/g, ''))) return true
      return c.name.toLowerCase().includes(q.toLowerCase())
    }).slice(0, 8)
  }, [clients, clientQuery])

  const pickClient = (c: AdminClient) => {
    patchActive(t => ({ selectedClient: c, bonusToApply: 0, paymentMethod: t.paymentMethod === 'credit' && !c.vip ? 'cash' : t.paymentMethod }))
    setClientQuery('')
  }
  const clearClient = () => patchActive(t => ({ selectedClient: null, bonusToApply: 0, paymentMethod: t.paymentMethod === 'credit' ? 'cash' : t.paymentMethod }))

  const checkout = async () => {
    if (!cartLines.length || busy) return
    setBusy(true)
    setErr('')
    try {
      if (!USE_API) throw new Error('Касса работает только в режиме сервера (USE_API)')
      const items = cartLines.map(l => {
        const oi = orderItemFromProduct(l.product, l.qty)
        return { productId: l.product.id, qty: oi.qty, price: oi.price, unit: oi.unit }
      })
      const result = await api.createPosSale({
        items,
        clientPhone: selectedClient?.phone,
        bonusSpent: Math.min(activeTicket.bonusToApply, bonusUsable),
        paymentMethod: activeTicket.paymentMethod,
        cashierId: cashierProfile?.id,
        cashierName: cashierProfile?.name,
      })
      setReceipt({ order: result.order, loyalty: result.loyalty })
      setShiftSales(s => [result.order, ...s])
      closeTicket(activeTicketId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести продажу')
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    clearCashierSession()
    setSession(null)
  }

  if (!sessionReady) return <><style>{CSS}</style><PosSessionBoot /></>

  if (!session || !cashierProfile || cashierProfile.blocked) {
    if (session && cashierProfile?.blocked) clearCashierSession()
    return (
      <>
        <style>{CSS}</style>
        <PosLoginPage
          cashiers={cashiers}
          onSuccess={c => {
            const next = { cashierId: c.id, name: c.name }
            saveCashierSession(next)
            setSession(next)
          }}
        />
      </>
    )
  }

  return (
    <div className="pos-shell">
      <style>{CSS}</style>

      {/* Sidebar (desktop) */}
      <aside className="pos-sidebar">
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, padding: '6px 10px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🧾</span> KAKAPO POS
        </div>
        {MODULES.map(m => (
          <button key={m.id} className={`btn pos-nav-item ${module === m.id ? 'active' : ''}`} onClick={() => setModule(m.id)}>
            <span style={{ fontSize: 16 }}>{m.icon}</span> {m.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #162B1A' }}>
          <div style={{ fontSize: 12, fontWeight: 800, padding: '0 4px' }}>{cashierProfile.name}</div>
          <div style={{ fontSize: 10, color: '#3D6645', padding: '2px 4px 10px' }}>Сегодня: {money(cashierProfile.salesToday)} ЅМ</div>
          <Link href="/" className="btn" style={{ display: 'block', textAlign: 'center', padding: '8px', borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 11, textDecoration: 'none', marginBottom: 6 }}>← На главную</Link>
          <button onClick={logout} className="btn" style={{ width: '100%', padding: 8, borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', color: '#FF6969', fontSize: 11, fontWeight: 700 }}>Выйти</button>
        </div>
      </aside>

      <div className="pos-main">
        {/* Топбар мобильный/общий */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #162B1A' }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900 }}>{MODULES.find(m => m.id === module)?.icon} {MODULES.find(m => m.id === module)?.label}</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#8FB897' }}>{cashierProfile.name}</div>
        </div>

        <div className="pos-content" style={{ flex: 1, padding: 18, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {module === 'sale' && (
            <>
              {/* Вкладки чеков */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
                {ticketOrder.map((id, i) => {
                  const t = tickets[id]
                  const count = Object.values(t?.cart || {}).filter(q => q > 0).length
                  return (
                    <button key={id} className="btn ub" onClick={() => setActiveTicketId(id)}
                      style={{
                        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 12, fontSize: 12, fontWeight: 800,
                        background: id === activeTicketId ? 'rgba(31,215,96,.14)' : '#0C1C0F',
                        color: id === activeTicketId ? '#1FD760' : '#8FB897',
                        border: `1.5px solid ${id === activeTicketId ? 'rgba(31,215,96,.4)' : '#162B1A'}`,
                      }}>
                      Чек {i + 1}{count > 0 ? ` (${count})` : ''}
                      {ticketOrder.length > 1 && (
                        <span onClick={e => { e.stopPropagation(); closeTicket(id) }} style={{ color: '#FF6969', fontSize: 13 }}>✕</span>
                      )}
                    </button>
                  )
                })}
                <button className="btn ub" onClick={newTicket} style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 12, fontSize: 12, fontWeight: 800, background: 'rgba(31,215,96,.08)', color: '#1FD760', border: '1.5px dashed rgba(31,215,96,.3)' }}>+ Чек</button>
              </div>

              <div className="pos-sale-grid card" style={{ overflow: 'hidden' }}>
                {/* Товары */}
                <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #162B1A', minHeight: 0 }}>
                  <div style={{ padding: 14, borderBottom: '1px solid #162B1A' }}>
                    <input
                      ref={scanRef}
                      className="inp"
                      value={scanValue}
                      onChange={e => { setScanValue(e.target.value); setScanErr('') }}
                      onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
                      placeholder="📷 Штрихкод / артикул — сканер или Enter"
                      style={{ marginBottom: 8, borderColor: scanErr ? 'rgba(255,69,69,.5)' : undefined }}
                      autoFocus
                    />
                    {scanErr && <div style={{ fontSize: 11, color: '#FF6969', marginBottom: 8 }}>{scanErr}</div>}
                    <input className="inp" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск по названию..." />
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
                      <button className="btn" onClick={() => setCatFlt('all')} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: catFlt === 'all' ? 'rgba(31,215,96,.14)' : '#0C1C0F', color: catFlt === 'all' ? '#1FD760' : '#8FB897', border: `1px solid ${catFlt === 'all' ? 'rgba(31,215,96,.35)' : '#162B1A'}` }}>Все</button>
                      {cats.map(c => (
                        <button key={c.id} className="btn" onClick={() => setCatFlt(c.id)} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: catFlt === c.id ? 'rgba(31,215,96,.14)' : '#0C1C0F', color: catFlt === c.id ? '#1FD760' : '#8FB897', border: `1px solid ${catFlt === c.id ? 'rgba(31,215,96,.35)' : '#162B1A'}` }}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, alignContent: 'start' }}>
                    {filteredProducts.map(p => (
                      <button key={p.id} className="btn card" onClick={() => addToCart(p, isWeighted(p) ? undefined : 1)}
                        style={{ padding: 12, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, opacity: p.stock <= 0 && !isWeighted(p) ? .45 : 1 }}>
                        <div style={{ fontSize: 26 }}>{p.e}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3, minHeight: 32 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#1FD760', fontWeight: 800 }}>{formatPriceLabel(p)}</div>
                        {!isWeighted(p) && <div style={{ fontSize: 10, color: p.stock > 3 ? '#3D6645' : p.stock > 0 ? '#FFB800' : '#FF6969' }}>Остаток: {p.stock}</div>}
                      </button>
                    ))}
                    {filteredProducts.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#3D6645', padding: 30 }}>Ничего не найдено</div>}
                  </div>
                </div>

                {/* Корзина + клиент + оплата */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                    <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ЧЕК ({cartLines.length})</div>
                    {cartLines.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 20 }}>Отсканируйте или выберите товар</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                      {cartLines.map(({ product, qty }) => (
                        <div key={product.id} className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 20 }}>{product.e}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</div>
                            <div style={{ fontSize: 11, color: '#8FB897' }}>{formatCartQty(product, qty)} {isWeighted(product) ? '' : product.unit} · {money(calcLineTotal(product, qty))} ЅМ</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button className="btn" onClick={() => decFromCart(product)} style={{ width: 26, height: 26, borderRadius: 8, background: '#0C1C0F', border: '1px solid #162B1A', color: '#EBF5ED' }}>−</button>
                            <button className="btn" onClick={() => addToCart(product, isWeighted(product) ? undefined : 1)} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(31,215,96,.12)', border: '1px solid rgba(31,215,96,.3)', color: '#1FD760' }}>+</button>
                            <button className="btn" onClick={() => removeFromCart(product.id)} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.2)', color: '#FF6969', fontSize: 11 }}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>КЛИЕНТ</div>
                    {selectedClient ? (
                      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 800 }}>{selectedClient.name}</div>
                            <div style={{ fontSize: 11, color: '#8FB897' }}>{selectedClient.phone}</div>
                          </div>
                          <button className="btn" onClick={clearClient} style={{ fontSize: 11, color: '#FF6969', background: 'none' }}>Убрать</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: `${LEVEL_COLOR[selectedClient.level] || '#8FB897'}22`, color: LEVEL_COLOR[selectedClient.level] || '#8FB897' }}>
                            {selectedClient.vip ? '👑 VIP' : LEVEL_LABEL[selectedClient.level] || selectedClient.level}
                          </span>
                          <span style={{ fontSize: 11, color: '#FFB800', fontWeight: 700 }}>💰 {money(selectedClient.bonus)} ЅМ бонуса</span>
                        </div>
                        {bonusUsable > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Списать бонус (доступно {money(bonusUsable)} ЅМ)</div>
                            <input type="number" className="inp" value={activeTicket.bonusToApply || ''} min={0} max={bonusUsable}
                              onChange={e => patchActive({ bonusToApply: Math.max(0, Math.min(bonusUsable, Number(e.target.value) || 0)) })}
                              placeholder="0" style={{ padding: '8px 12px', fontSize: 13 }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 14 }}>
                        <input className="inp" value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Телефон, карта или имя..." />
                        {clientResults.length > 0 && (
                          <div className="card" style={{ marginTop: 6, overflow: 'hidden' }}>
                            {clientResults.map(c => (
                              <button key={c.id} className="btn" onClick={() => pickClient(c)} style={{ width: '100%', padding: '9px 12px', textAlign: 'left', background: 'none', borderBottom: '1px solid #162B1A', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</span>
                                <span style={{ fontSize: 11, color: '#8FB897' }}>{c.phone}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ОПЛАТА</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(['cash', 'card', 'credit'] as const).map(m => (
                        <button key={m} className="btn ub" disabled={m === 'credit' && !selectedClient?.vip}
                          onClick={() => patchActive({ paymentMethod: m })}
                          style={{
                            flex: 1, padding: '10px 8px', borderRadius: 11, fontSize: 12, fontWeight: 700,
                            background: activeTicket.paymentMethod === m ? 'rgba(31,215,96,.14)' : '#0C1C0F',
                            color: activeTicket.paymentMethod === m ? '#1FD760' : '#8FB897',
                            border: `1.5px solid ${activeTicket.paymentMethod === m ? 'rgba(31,215,96,.4)' : '#162B1A'}`,
                            opacity: m === 'credit' && !selectedClient?.vip ? .4 : 1,
                          }}>
                          {m === 'cash' ? '💵 Наличные' : m === 'card' ? '💳 Карта' : '📋 В долг'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #162B1A', padding: 16 }}>
                    {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10, textAlign: 'center' }}>{err}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#8FB897' }}>
                      <span>Товары</span><span>{money(goodsTotal)} ЅМ</span>
                    </div>
                    {activeTicket.bonusToApply > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#FFB800' }}>
                        <span>Бонус</span><span>−{money(Math.min(activeTicket.bonusToApply, bonusUsable))} ЅМ</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span className="ub" style={{ fontSize: 15, fontWeight: 900 }}>К оплате</span>
                      <span className="ub" style={{ fontSize: 20, fontWeight: 900, color: '#1FD760' }}>{money(payable)} ЅМ</span>
                    </div>
                    <button className="btn ub" onClick={checkout} disabled={!cartLines.length || busy}
                      style={{
                        width: '100%', padding: 16, borderRadius: 16, fontSize: 15, fontWeight: 900, color: 'white',
                        background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                        opacity: !cartLines.length || busy ? .5 : 1,
                      }}>
                      {busy ? 'Проводим...' : '✓ Оплатить'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {module === 'receipts' && (
            <ReceiptsModule products={products} suppliers={suppliers} receipts={receipts}
              busy={invBusy} err={invErr} setErr={setInvErr}
              cashierName={cashierProfile.name}
              onCreated={r => { setReceipts(rs => [r, ...rs]); setShiftReceipts(rs => [r, ...rs]); void reloadInventory() }}
              setBusy={setInvBusy} />
          )}

          {module === 'writeoffs' && (
            <WriteOffsModule products={products} writeOffs={writeOffs}
              busy={invBusy} err={invErr} setErr={setInvErr}
              cashierName={cashierProfile.name}
              onCreated={w => { setWriteOffs(ws => [w, ...ws]); setShiftWriteOffs(ws => [w, ...ws]) }}
              setBusy={setInvBusy} />
          )}

          {module === 'expenses' && (
            <ExpensesModule expenses={expenses}
              busy={invBusy} err={invErr} setErr={setInvErr}
              cashierName={cashierProfile.name}
              onCreated={e => { setExpenses(es => [e, ...es]); setShiftExpenses(es => [e, ...es]) }}
              setBusy={setInvBusy} />
          )}

          {module === 'suppliers' && (
            <SuppliersModule suppliers={suppliers} busy={invBusy} err={invErr} setErr={setInvErr} setBusy={setInvBusy}
              onChanged={s => setSuppliers(list => {
                const i = list.findIndex(x => x.id === s.id)
                if (i === -1) return [...list, s]
                const next = [...list]; next[i] = s; return next
              })} />
          )}

          {module === 'shift' && (
            <ShiftModule sales={shiftSales} receipts={shiftReceipts} writeOffs={shiftWriteOffs} expenses={shiftExpenses} />
          )}
        </div>
      </div>

      {/* Нижняя панель (мобильный) */}
      <nav className="pos-bottombar">
        {MODULES.map(m => (
          <button key={m.id} className={`btn pos-bottom-item ${module === m.id ? 'active' : ''}`} onClick={() => setModule(m.id)}>
            <span style={{ fontSize: 17 }}>{m.icon}</span>{m.label}
          </button>
        ))}
      </nav>

      {receipt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, animation: 'fadeIn .2s ease' }}>
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 24, animation: 'fadeUp .3s ease' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
              <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>Продажа проведена</div>
              <div style={{ fontSize: 11, color: '#3D6645' }}>{receipt.order.id}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
              {(receipt.order.items || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8FB897' }}>{it.e} {it.name} × {it.qty}</span>
                  <span style={{ fontWeight: 700 }}>{money(it.price * it.qty)} ЅМ</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #162B1A', paddingTop: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="ub" style={{ fontSize: 14, fontWeight: 800 }}>Итого</span>
                <span className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760' }}>{money(Number(receipt.order.total) || 0)} ЅМ</span>
              </div>
              {receipt.loyalty.earned > 0 && (
                <div style={{ fontSize: 12, color: '#FFB800' }}>+{money(receipt.loyalty.earned)} ЅМ бонуса начислено · баланс {money(receipt.loyalty.bonus)} ЅМ</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ub" onClick={() => window.print()} style={{ flex: 1, padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 700, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>🖨 Печать</button>
              <button className="btn ub" onClick={() => setReceipt(null)} style={{ flex: 2, padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>Новая продажа</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Модуль «Приход» ── */
function ReceiptsModule({ products, suppliers, receipts, busy, err, setErr, setBusy, onCreated, cashierName }: {
  products: Product[]; suppliers: Supplier[]; receipts: StockReceipt[]
  busy: boolean; err: string; setErr: (s: string) => void; setBusy: (b: boolean) => void
  onCreated: (r: StockReceipt) => void; cashierName: string
}) {
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<{ productId: number; qty: string; costPrice: string }[]>([])
  const [productPick, setProductPick] = useState('')
  const [paidNow, setPaidNow] = useState('')

  const addLine = (productId: number) => {
    if (lines.some(l => l.productId === productId)) return
    const p = products.find(x => x.id === productId)
    setLines(ls => [...ls, { productId, qty: '1', costPrice: String(p?.costPrice || '') }])
    setProductPick('')
  }
  const setLine = (productId: number, patch: Partial<{ qty: string; costPrice: string }>) =>
    setLines(ls => ls.map(l => l.productId === productId ? { ...l, ...patch } : l))
  const removeLine = (productId: number) => setLines(ls => ls.filter(l => l.productId !== productId))

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.costPrice) || 0), 0)

  const submit = async () => {
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      const receipt = await api.createStockReceipt({
        supplierId: supplierId || undefined,
        items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0, costPrice: Number(l.costPrice) || 0 })),
        paidNow: Number(paidNow) || 0,
        createdBy: cashierName,
      })
      onCreated(receipt)
      setLines([]); setPaidNow(''); setSupplierId('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести приход')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>📥 Новый приход</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Поставщик</div>
          <select className="inp" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Без поставщика</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Добавить товар</div>
          <select className="inp" value={productPick} onChange={e => { const id = Number(e.target.value); if (id) addLine(id) }}>
            <option value="">Выберите товар...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.e} {p.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {lines.map(l => {
            const p = products.find(x => x.id === l.productId)
            return (
              <div key={l.productId} className="card" style={{ padding: 10, display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr auto', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
                <input className="inp" type="number" value={l.qty} onChange={e => setLine(l.productId, { qty: e.target.value })} placeholder="Кол-во" style={{ padding: '7px 10px', fontSize: 12 }} />
                <input className="inp" type="number" value={l.costPrice} onChange={e => setLine(l.productId, { costPrice: e.target.value })} placeholder="Цена закупки" style={{ padding: '7px 10px', fontSize: 12 }} />
                <button className="btn" onClick={() => removeLine(l.productId)} style={{ color: '#FF6969', fontSize: 13 }}>✕</button>
              </div>
            )
          })}
          {lines.length === 0 && <div style={{ fontSize: 12, color: '#3D6645', textAlign: 'center', padding: 10 }}>Список пуст</div>}
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Оплачено сейчас (остальное — в долг поставщику)</div>
          <input className="inp" type="number" value={paidNow} onChange={e => setPaidNow(e.target.value)} placeholder="0" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="ub" style={{ fontSize: 13, fontWeight: 800 }}>Сумма прихода</span>
          <span className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760' }}>{money(total)} ЅМ</span>
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10 }}>{err}</div>}
        <button className="btn ub" onClick={submit} disabled={busy || !lines.length}
          style={{ width: '100%', padding: 14, borderRadius: 14, fontSize: 14, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)', opacity: busy || !lines.length ? .5 : 1 }}>
          {busy ? 'Проводим...' : '✓ Провести приход'}
        </button>
      </div>

      <div>
        <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ПОСЛЕДНИЕ ПРИХОДЫ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {receipts.slice(0, 20).map(r => (
            <div key={r.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{r.id}</span>
                <span className="ub" style={{ fontSize: 13, fontWeight: 800, color: '#1FD760' }}>{money(r.totalCost)} ЅМ</span>
              </div>
              <div style={{ fontSize: 11, color: '#8FB897' }}>{fmtDate(r.createdAtIso)} · {r.supplierName || 'без поставщика'} · {r.items.length} поз.</div>
              {r.debtDelta > 0 && <div style={{ fontSize: 11, color: '#FFB800', marginTop: 2 }}>В долг: {money(r.debtDelta)} ЅМ</div>}
            </div>
          ))}
          {receipts.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 20 }}>Приходов пока не было</div>}
        </div>
      </div>
    </div>
  )
}

/* ── Модуль «Списание» ── */
function WriteOffsModule({ products, writeOffs, busy, err, setErr, setBusy, onCreated, cashierName }: {
  products: Product[]; writeOffs: WriteOff[]
  busy: boolean; err: string; setErr: (s: string) => void; setBusy: (b: boolean) => void
  onCreated: (w: WriteOff) => void; cashierName: string
}) {
  const [lines, setLines] = useState<{ productId: number; qty: string }[]>([])
  const [productPick, setProductPick] = useState('')
  const [reason, setReason] = useState(WRITE_OFF_REASONS[0])

  const addLine = (productId: number) => {
    if (lines.some(l => l.productId === productId)) return
    setLines(ls => [...ls, { productId, qty: '1' }])
    setProductPick('')
  }
  const setLine = (productId: number, qty: string) => setLines(ls => ls.map(l => l.productId === productId ? { ...l, qty } : l))
  const removeLine = (productId: number) => setLines(ls => ls.filter(l => l.productId !== productId))

  const submit = async () => {
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      const writeOff = await api.createWriteOff({
        items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
        reason,
        createdBy: cashierName,
      })
      onCreated(writeOff)
      setLines([])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести списание')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>🗑 Новое списание</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Товар</div>
          <select className="inp" value={productPick} onChange={e => { const id = Number(e.target.value); if (id) addLine(id) }}>
            <option value="">Выберите товар...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.e} {p.name} (остаток {p.stock})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {lines.map(l => {
            const p = products.find(x => x.id === l.productId)
            return (
              <div key={l.productId} className="card" style={{ padding: 10, display: 'grid', gridTemplateColumns: '1.6fr .8fr auto', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
                <input className="inp" type="number" value={l.qty} onChange={e => setLine(l.productId, e.target.value)} placeholder="Кол-во" style={{ padding: '7px 10px', fontSize: 12 }} />
                <button className="btn" onClick={() => removeLine(l.productId)} style={{ color: '#FF6969', fontSize: 13 }}>✕</button>
              </div>
            )
          })}
          {lines.length === 0 && <div style={{ fontSize: 12, color: '#3D6645', textAlign: 'center', padding: 10 }}>Список пуст</div>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Причина</div>
          <select className="inp" value={reason} onChange={e => setReason(e.target.value)}>
            {WRITE_OFF_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10 }}>{err}</div>}
        <button className="btn ub" onClick={submit} disabled={busy || !lines.length}
          style={{ width: '100%', padding: 14, borderRadius: 14, fontSize: 14, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#E24C4C,#FF6969)', opacity: busy || !lines.length ? .5 : 1 }}>
          {busy ? 'Списываем...' : '✓ Списать'}
        </button>
      </div>

      <div>
        <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ПОСЛЕДНИЕ СПИСАНИЯ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {writeOffs.slice(0, 20).map(w => (
            <div key={w.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{w.id}</span>
                <span className="ub" style={{ fontSize: 13, fontWeight: 800, color: '#FF6969' }}>{money(w.totalCost)} ЅМ</span>
              </div>
              <div style={{ fontSize: 11, color: '#8FB897' }}>{fmtDate(w.createdAtIso)} · {w.reason} · {w.items.length} поз.</div>
            </div>
          ))}
          {writeOffs.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 20 }}>Списаний пока не было</div>}
        </div>
      </div>
    </div>
  )
}

/* ── Модуль «Расходы» ── */
function ExpensesModule({ expenses, busy, err, setErr, setBusy, onCreated, cashierName }: {
  expenses: Expense[]
  busy: boolean; err: string; setErr: (s: string) => void; setBusy: (b: boolean) => void
  onCreated: (e: Expense) => void; cashierName: string
}) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const submit = async () => {
    if (!Number(amount) || Number(amount) <= 0) { setErr('Укажите сумму'); return }
    setBusy(true); setErr('')
    try {
      const expense = await api.createExpense({ category, amount: Number(amount), note, createdBy: cashierName })
      onCreated(expense)
      setAmount(''); setNote('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось добавить расход')
    } finally { setBusy(false) }
  }

  const todayTotal = expenses
    .filter(e => new Date(e.createdAtIso).toDateString() === new Date().toDateString())
    .reduce((s, e) => s + e.amount, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>💸 Новый расход</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Категория</div>
          <select className="inp" value={category} onChange={e => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Сумма</div>
          <input className="inp" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Заметка</div>
          <input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder="Необязательно" />
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10 }}>{err}</div>}
        <button className="btn ub" onClick={submit} disabled={busy}
          style={{ width: '100%', padding: 14, borderRadius: 14, fontSize: 14, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)', opacity: busy ? .5 : 1 }}>
          {busy ? 'Сохраняем...' : '✓ Добавить расход'}
        </button>
      </div>

      <div>
        <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#8FB897' }}>Расходы сегодня</span>
          <span className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#FF6969' }}>{money(todayTotal)} ЅМ</span>
        </div>
        <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ПОСЛЕДНИЕ РАСХОДЫ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expenses.slice(0, 20).map(e => (
            <div key={e.id} className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{e.category}</div>
                <div style={{ fontSize: 11, color: '#3D6645' }}>{fmtDate(e.createdAtIso)}{e.note ? ` · ${e.note}` : ''}</div>
              </div>
              <span className="ub" style={{ fontSize: 13, fontWeight: 800, color: '#FF6969' }}>−{money(e.amount)} ЅМ</span>
            </div>
          ))}
          {expenses.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 20 }}>Расходов пока не было</div>}
        </div>
      </div>
    </div>
  )
}

/* ── Модуль «Поставщики» ── */
function SuppliersModule({ suppliers, busy, err, setErr, setBusy, onChanged }: {
  suppliers: Supplier[]
  busy: boolean; err: string; setErr: (s: string) => void; setBusy: (b: boolean) => void
  onChanged: (s: Supplier) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [payAmount, setPayAmount] = useState<Record<string, string>>({})

  const addSupplier = async () => {
    if (!name.trim()) { setErr('Укажите название'); return }
    setBusy(true); setErr('')
    try {
      const s = await api.createSupplier({ name: name.trim(), phone: phone.trim() })
      onChanged(s)
      setName(''); setPhone(''); setShowAdd(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось добавить поставщика')
    } finally { setBusy(false) }
  }

  const pay = async (s: Supplier) => {
    const amount = Number(payAmount[s.id]) || 0
    if (amount <= 0) return
    setBusy(true); setErr('')
    try {
      await api.paySupplierDebt(s.id, { amount })
      onChanged({ ...s, debt: Math.round((s.debt - amount) * 100) / 100 })
      setPayAmount(p => ({ ...p, [s.id]: '' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось погасить долг')
    } finally { setBusy(false) }
  }

  const totalDebt = suppliers.reduce((s, x) => s + x.debt, 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Поставщиков</div>
          <div className="ub" style={{ fontSize: 20, fontWeight: 900 }}>{suppliers.length}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Долг перед поставщиками</div>
          <div className="ub" style={{ fontSize: 20, fontWeight: 900, color: totalDebt > 0 ? '#FFB800' : '#1FD760' }}>{money(totalDebt)} ЅМ</div>
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn ub" onClick={() => setShowAdd(v => !v)} style={{ padding: '9px 16px', borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>+ Поставщик</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Название *</div>
            <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="ООО Ромашка" />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Телефон</div>
            <input className="inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+992 __ ___ __ __" />
          </div>
          <button className="btn ub" onClick={addSupplier} disabled={busy} style={{ padding: '11px 18px', borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>Добавить</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suppliers.map(s => (
          <div key={s.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: '#8FB897' }}>{s.phone || '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#3D6645' }}>Долг</div>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: s.debt > 0 ? '#FFB800' : '#1FD760' }}>{money(s.debt)} ЅМ</div>
            </div>
            {s.debt > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="inp" type="number" value={payAmount[s.id] || ''} onChange={e => setPayAmount(p => ({ ...p, [s.id]: e.target.value }))} placeholder="Сумма" style={{ width: 100, padding: '7px 10px', fontSize: 12 }} />
                <button className="btn" onClick={() => pay(s)} disabled={busy} style={{ padding: '7px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: 'rgba(31,215,96,.12)', border: '1px solid rgba(31,215,96,.3)', color: '#1FD760' }}>Погасить</button>
              </div>
            )}
          </div>
        ))}
        {suppliers.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 30 }}>Поставщиков пока нет</div>}
      </div>
    </div>
  )
}

/* ── Модуль «Смена» ── */
function ShiftModule({ sales, receipts, writeOffs, expenses }: {
  sales: Order[]; receipts: StockReceipt[]; writeOffs: WriteOff[]; expenses: Expense[]
}) {
  const salesTotal = sales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const receiptsTotal = receipts.reduce((s, r) => s + r.totalCost, 0)
  const writeOffsTotal = writeOffs.reduce((s, w) => s + w.totalCost, 0)
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Продажи</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#1FD760' }}>{sales.length} · {money(salesTotal)} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Приход</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>{receipts.length} · {money(receiptsTotal)} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Списания</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#FF6969' }}>{writeOffs.length} · {money(writeOffsTotal)} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Расходы</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#FF6969' }}>{expenses.length} · {money(expensesTotal)} ЅМ</div>
        </div>
      </div>
      {sales.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 13, marginTop: 30 }}>Продаж за смену пока не было</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sales.map(o => (
          <div key={o.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{o.id}</div>
              <div style={{ fontSize: 11, color: '#3D6645' }}>{o.deliveredAt} · {o.client?.name || 'Розница'} · {(o.items || []).length} поз.</div>
            </div>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{money(Number(o.goodsTotal) || 0)} ЅМ</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PosApp() {
  return <PosAppInner />
}
