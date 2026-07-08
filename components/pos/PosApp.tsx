'use client'
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useProducts, useOrders, USE_API } from '@/lib/store'
import { api } from '@/lib/api'
import type { PosShift } from '@/lib/api'
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
  .btn:disabled{cursor:not-allowed;}
  .card{background:linear-gradient(165deg,#0C1C0F 0%,#091508 100%);border:1px solid #162B1A;border-radius:16px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:12px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:11px 14px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(31,215,96,.5);}
  .inp::placeholder{color:#3D6645;}
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

function money(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function fmtDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

type ModuleId = 'sale' | 'returns' | 'shift'
const MODULES: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'sale', icon: '🧾', label: 'Продажа' },
  { id: 'returns', icon: '↩️', label: 'Возврат' },
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

/* ── Экран «Открыть смену» — блокирует продажу, пока смены нет ── */
function OpenShiftScreen({ cashierName, onOpened }: { cashierName: string; onOpened: (s: PosShift) => void }) {
  const [openingCash, setOpeningCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const cashierId = loadCashierSession()?.cashierId || ''
      const shift = await api.openPosShift({ cashierId, cashierName, openingCash: Number(openingCash) || 0 })
      onOpened(shift)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось открыть смену')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: 28, textAlign: 'center' }}>
        <div style={{ fontSize: 46, marginBottom: 10 }}>🔓</div>
        <div className="ub" style={{ fontSize: 17, fontWeight: 900, marginBottom: 6 }}>Смена не открыта</div>
        <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 20 }}>{cashierName}, укажите сумму наличных в кассе на начало смены</div>
        <input className="inp" type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} placeholder="0" style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, marginBottom: 14 }} autoFocus />
        {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 12 }}>{err}</div>}
        <button className="btn ub" onClick={submit} disabled={busy}
          style={{ width: '100%', padding: 15, borderRadius: 14, fontSize: 14, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)', opacity: busy ? .6 : 1 }}>
          {busy ? 'Открываем...' : '✓ Открыть смену'}
        </button>
      </div>
    </div>
  )
}

function PosAppInner() {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const clients = useClients()
  const cashiers = useCashierTeam()
  const allOrders = useOrders(s => s.orders)
  const fetchOrders = useOrders(s => s.fetchOrders)

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

  // ── Смена ──
  const [shift, setShift] = useState<PosShift | null | undefined>(undefined) // undefined = ещё не загружено
  useEffect(() => {
    if (!cashierProfile) return
    if (!USE_API) { setShift(null); return }
    void api.getCurrentPosShift(cashierProfile.id).then(setShift).catch(() => setShift(null))
  }, [cashierProfile])

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
  const [receiptView, setReceiptView] = useState<{ order: Order; loyalty: { earned: number; bonus: number } } | null>(null)
  const [shiftSales, setShiftSales] = useState<Order[]>([])

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
      setReceiptView({ order: result.order, loyalty: result.loyalty })
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

  if (shift === undefined) return <><style>{CSS}</style><PosSessionBoot /></>

  if (!shift) {
    return (
      <>
        <style>{CSS}</style>
        <OpenShiftScreen cashierName={cashierProfile.name} onOpened={s => setShift(s)} />
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
          <div style={{ fontSize: 10, color: '#3D6645', padding: '2px 4px 10px' }}>Смена открыта · {money(shift.openingCash)} ЅМ на старте</div>
          <Link href="/" className="btn" style={{ display: 'block', textAlign: 'center', padding: '8px', borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 11, textDecoration: 'none', marginBottom: 6 }}>← На главную</Link>
          <button onClick={logout} className="btn" style={{ width: '100%', padding: 8, borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', color: '#FF6969', fontSize: 11, fontWeight: 700 }}>Выйти</button>
        </div>
      </aside>

      <div className="pos-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #162B1A' }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900 }}>{MODULES.find(m => m.id === module)?.icon} {MODULES.find(m => m.id === module)?.label}</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#8FB897' }}>{cashierProfile.name}</div>
        </div>

        <div className="pos-content" style={{ flex: 1, padding: 18, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {module === 'sale' && (
            <>
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

          {module === 'returns' && (
            <ReturnsModule shiftSales={shiftSales} allOrders={allOrders} fetchOrders={fetchOrders}
              onReturned={(orderId) => setShiftSales(s => s.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o))} />
          )}

          {module === 'shift' && (
            <ShiftModule shift={shift} sales={shiftSales} cashierId={cashierProfile.id}
              onClosed={() => setShift(null)} />
          )}
        </div>
      </div>

      <nav className="pos-bottombar">
        {MODULES.map(m => (
          <button key={m.id} className={`btn pos-bottom-item ${module === m.id ? 'active' : ''}`} onClick={() => setModule(m.id)}>
            <span style={{ fontSize: 17 }}>{m.icon}</span>{m.label}
          </button>
        ))}
      </nav>

      {receiptView && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20, animation: 'fadeIn .2s ease' }}>
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 24, animation: 'fadeUp .3s ease' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
              <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>Продажа проведена</div>
              <div style={{ fontSize: 11, color: '#3D6645' }}>{receiptView.order.id}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
              {(receiptView.order.items || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8FB897' }}>{it.e} {it.name} × {it.qty}</span>
                  <span style={{ fontWeight: 700 }}>{money(it.price * it.qty)} ЅМ</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #162B1A', paddingTop: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="ub" style={{ fontSize: 14, fontWeight: 800 }}>Итого</span>
                <span className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760' }}>{money(Number(receiptView.order.total) || 0)} ЅМ</span>
              </div>
              {receiptView.loyalty.earned > 0 && (
                <div style={{ fontSize: 12, color: '#FFB800' }}>+{money(receiptView.loyalty.earned)} ЅМ бонуса начислено · баланс {money(receiptView.loyalty.bonus)} ЅМ</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ub" onClick={() => window.print()} style={{ flex: 1, padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 700, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>🖨 Печать</button>
              <button className="btn ub" onClick={() => setReceiptView(null)} style={{ flex: 2, padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>Новая продажа</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Модуль «Возврат» — только целиком, по номеру заказа ── */
function ReturnsModule({ shiftSales, allOrders, fetchOrders, onReturned }: {
  shiftSales: Order[]; allOrders: Order[]; fetchOrders: () => Promise<void>
  onReturned: (orderId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Order | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => { void fetchOrders() }, [fetchOrders])

  const search = () => {
    const id = query.trim().toUpperCase()
    setErr(''); setDone(null)
    if (!id) return
    const order = allOrders.find(o => o.id.toUpperCase() === id) || shiftSales.find(o => o.id.toUpperCase() === id) || null
    if (!order) { setErr('Заказ не найден'); setFound(null); return }
    if (order.source !== 'pos') { setErr('Возврат в кассе доступен только для продаж из кассы'); setFound(null); return }
    if (order.status === 'cancelled') { setErr('Этот заказ уже возвращён/отменён'); setFound(null); return }
    setFound(order)
  }

  const doReturn = async () => {
    if (!found) return
    setBusy(true); setErr('')
    try {
      await api.createPosReturn({ orderId: found.id })
      setDone(found.id)
      onReturned(found.id)
      setFound(null)
      setQuery('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось оформить возврат')
    } finally { setBusy(false) }
  }

  const todaySales = shiftSales.filter(o => o.status === 'delivered')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>↩️ Возврат чека</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input className="inp" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Номер заказа, напр. POS-00012" />
          <button className="btn ub" onClick={search} style={{ padding: '0 16px', borderRadius: 12, fontSize: 12, fontWeight: 800, background: 'rgba(31,215,96,.12)', color: '#1FD760', border: '1px solid rgba(31,215,96,.3)' }}>Найти</button>
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 12 }}>{err}</div>}
        {done && <div style={{ fontSize: 12, color: '#1FD760', marginBottom: 12 }}>✓ Заказ {done} возвращён</div>}
        {found && (
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{found.id}</span>
              <span className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#1FD760' }}>{money(Number(found.goodsTotal) || 0)} ЅМ</span>
            </div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 8 }}>{found.client?.name || 'Розница'} · {fmtDateTime(found.deliveredAtIso || found.createdAtIso || '')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {(found.items || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8FB897' }}>
                  <span>{it.e} {it.name} × {it.qty}</span>
                  <span>{money(it.price * it.qty)} ЅМ</span>
                </div>
              ))}
            </div>
            <button className="btn ub" onClick={doReturn} disabled={busy}
              style={{ width: '100%', padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#E24C4C,#FF6969)', opacity: busy ? .6 : 1 }}>
              {busy ? 'Оформляем...' : '✓ Оформить возврат (весь чек)'}
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', marginBottom: 10 }}>ПРОДАЖИ ЭТОЙ СМЕНЫ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {todaySales.map(o => (
            <button key={o.id} className="btn card" onClick={() => { setQuery(o.id); setFound(o); setErr(''); setDone(null) }}
              style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{o.id}</div>
                <div style={{ fontSize: 11, color: '#3D6645' }}>{o.deliveredAt} · {o.client?.name || 'Розница'}</div>
              </div>
              <span className="ub" style={{ fontSize: 13, fontWeight: 800 }}>{money(Number(o.goodsTotal) || 0)} ЅМ</span>
            </button>
          ))}
          {todaySales.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 12, padding: 20 }}>Продаж за смену пока нет</div>}
        </div>
      </div>
    </div>
  )
}

/* ── Модуль «Смена» — статус + закрытие с подсчётом наличности ── */
function ShiftModule({ shift, sales, cashierId, onClosed }: {
  shift: PosShift; sales: Order[]; cashierId: string; onClosed: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [closingCash, setClosingCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<PosShift | null>(null)

  const delivered = sales.filter(o => o.status === 'delivered')
  const cashSales = delivered.filter(o => o.payment_method === 'cash')
  const cardSales = delivered.filter(o => o.payment_method === 'card')
  const creditSales = delivered.filter(o => o.payment_method === 'credit')
  const total = delivered.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const cashTotal = cashSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)

  const submitClose = async () => {
    setBusy(true); setErr('')
    try {
      const closed = await api.closePosShift({ cashierId, closingCashDeclared: Number(closingCash) || 0 })
      setResult(closed)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось закрыть смену')
    } finally { setBusy(false) }
  }

  if (result) {
    const diff = Number(result.difference) || 0
    return (
      <div className="card" style={{ padding: 24, maxWidth: 420, margin: '20px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>{diff === 0 ? '✅' : diff > 0 ? '📈' : '📉'}</div>
        <div className="ub" style={{ fontSize: 16, fontWeight: 900, marginBottom: 16 }}>Смена закрыта</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8FB897' }}><span>Ожидалось</span><span>{money(result.expectedCash || 0)} ЅМ</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8FB897' }}><span>Заявлено фактически</span><span>{money(result.closingCashDeclared || 0)} ЅМ</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800 }}>
            <span>Расхождение</span>
            <span style={{ color: diff === 0 ? '#1FD760' : diff > 0 ? '#FFB800' : '#FF6969' }}>{diff > 0 ? '+' : ''}{money(diff)} ЅМ</span>
          </div>
        </div>
        <button className="btn ub" onClick={onClosed} style={{ width: '100%', padding: 14, borderRadius: 14, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>Открыть новую смену</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Продаж</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#1FD760' }}>{delivered.length} · {money(total)} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Наличные</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>{cashSales.length} · {money(cashTotal)} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>Карта</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>{cardSales.length} · {money(cardSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0))} ЅМ</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>В долг</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>{creditSales.length} · {money(creditSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0))} ЅМ</div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#3D6645', marginBottom: 16 }}>Смена открыта {fmtDateTime(shift.openedAtIso)} · старт наличных {money(shift.openingCash)} ЅМ</div>

      {!closing ? (
        <button className="btn ub" onClick={() => setClosing(true)} style={{ padding: '13px 22px', borderRadius: 14, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#E24C4C,#FF6969)' }}>🔒 Закрыть смену</button>
      ) : (
        <div className="card" style={{ padding: 18, maxWidth: 380 }}>
          <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Закрытие смены</div>
          <div style={{ fontSize: 11, color: '#3D6645', marginBottom: 10 }}>Ожидаемая сумма наличных: {money(shift.openingCash + cashTotal)} ЅМ</div>
          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4 }}>Фактически наличных в кассе</div>
          <input className="inp" type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)} placeholder="0" style={{ marginBottom: 12 }} autoFocus />
          {err && <div style={{ fontSize: 12, color: '#FF6969', marginBottom: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setClosing(false)} style={{ flex: 1, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 700, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>Отмена</button>
            <button className="btn ub" onClick={submitClose} disabled={busy} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#E24C4C,#FF6969)', opacity: busy ? .6 : 1 }}>
              {busy ? 'Закрываем...' : '✓ Подтвердить закрытие'}
            </button>
          </div>
        </div>
      )}

      {delivered.length > 0 && (
        <>
          <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#8FB897', margin: '22px 0 10px' }}>ПРОДАЖИ СМЕНЫ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delivered.map(o => (
              <div key={o.id} className="card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{o.id}</div>
                  <div style={{ fontSize: 11, color: '#3D6645' }}>{o.deliveredAt} · {o.client?.name || 'Розница'}</div>
                </div>
                <span className="ub" style={{ fontSize: 13, fontWeight: 800 }}>{money(Number(o.goodsTotal) || 0)} ЅМ</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function PosApp() {
  return <PosAppInner />
}
