'use client'
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import Link from 'next/link'
import { useProducts, USE_API } from '@/lib/store'
import { api } from '@/lib/api'
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
  .card{background:#091508;border:1px solid #162B1A;border-radius:18px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:13px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:12px 15px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(31,215,96,.5);}
  .inp::placeholder{color:#3D6645;}
  @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  ::-webkit-scrollbar{width:6px;height:6px;}
  ::-webkit-scrollbar-thumb{background:#162B1A;border-radius:6px;}
`

const LEVEL_LABEL: Record<string, string> = {
  basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина',
}
const LEVEL_COLOR: Record<string, string> = {
  basic: '#8FB897', bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', platinum: '#B9F2FF',
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
}

function PosSessionBoot() {
  return <div style={{ minHeight: '100dvh', background: '#030B05', maxWidth: 1100, margin: '0 auto' }} />
}

interface CartLine { product: Product; qty: number }

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

  const [cart, setCart] = useState<Record<number, number>>({})
  const [search, setSearch] = useState('')
  const [catFlt, setCatFlt] = useState('all')
  const [scanValue, setScanValue] = useState('')
  const [scanErr, setScanErr] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)

  const [clientQuery, setClientQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<AdminClient | null>(null)
  const [bonusToApply, setBonusToApply] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('cash')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [receipt, setReceipt] = useState<{ order: Order; loyalty: { earned: number; bonus: number } } | null>(null)
  const [shiftSales, setShiftSales] = useState<Order[]>([])
  const [tab, setTab] = useState<'sale' | 'shift'>('sale')

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

  const cartLines: CartLine[] = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ product: products.find(p => p.id === Number(id))!, qty }))
      .filter(l => l.product)
  }, [cart, products])

  const goodsTotal = useMemo(
    () => Math.round(cartLines.reduce((s, l) => s + calcLineTotal(l.product, l.qty), 0) * 100) / 100,
    [cartLines],
  )

  const bonusUsable = selectedClient ? getBonusUsable({ bonus: selectedClient.bonus }, goodsTotal) : 0
  const payable = Math.max(0, Math.round((goodsTotal - Math.min(bonusToApply, bonusUsable)) * 100) / 100)

  const addToCart = (p: Product, qty?: number) => {
    setCart(c => {
      const current = c[p.id] || 0
      const next = qty != null ? current + qty : nextCartQty(p, current, true)
      return { ...c, [p.id]: next }
    })
  }
  const decFromCart = (p: Product) => {
    setCart(c => ({ ...c, [p.id]: nextCartQty(p, c[p.id] || 0, false) }))
  }
  const removeFromCart = (id: number) => setCart(c => { const n = { ...c }; delete n[id]; return n })
  const clearCart = () => setCart({})

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
    setSelectedClient(c)
    setClientQuery('')
    setBonusToApply(0)
    if (paymentMethod === 'credit' && !c.vip) setPaymentMethod('cash')
  }
  const clearClient = () => {
    setSelectedClient(null)
    setBonusToApply(0)
    if (paymentMethod === 'credit') setPaymentMethod('cash')
  }

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
        bonusSpent: Math.min(bonusToApply, bonusUsable),
        paymentMethod,
        cashierId: cashierProfile?.id,
        cashierName: cashierProfile?.name,
      })
      setReceipt({ order: result.order, loyalty: result.loyalty })
      setShiftSales(s => [result.order, ...s])
      clearCart()
      clearClient()
      setPaymentMethod('cash')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести продажу')
    } finally {
      setBusy(false)
    }
  }

  const newSale = () => setReceipt(null)

  const logout = () => {
    clearCashierSession()
    setSession(null)
  }

  const shiftTotal = shiftSales.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)

  if (!sessionReady) {
    return <><style>{CSS}</style><PosSessionBoot /></>
  }

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
    <div style={{ minHeight: '100dvh', background: '#030B05', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #162B1A' }}>
        <Link href="/" className="btn" style={{ width: 38, height: 38, borderRadius: 12, background: '#091508', border: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8FB897', textDecoration: 'none' }}>←</Link>
        <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>🧾 Касса</div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          <button className="btn ub" onClick={() => setTab('sale')} style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: tab === 'sale' ? 'rgba(31,215,96,.14)' : '#091508', color: tab === 'sale' ? '#1FD760' : '#8FB897', border: `1px solid ${tab === 'sale' ? 'rgba(31,215,96,.35)' : '#162B1A'}` }}>Продажа</button>
          <button className="btn ub" onClick={() => setTab('shift')} style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: tab === 'shift' ? 'rgba(31,215,96,.14)' : '#091508', color: tab === 'shift' ? '#1FD760' : '#8FB897', border: `1px solid ${tab === 'shift' ? 'rgba(31,215,96,.35)' : '#162B1A'}` }}>Смена ({shiftSales.length})</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{cashierProfile.name}</div>
            <div style={{ fontSize: 10, color: '#3D6645' }}>Сегодня: {money(cashierProfile.salesToday)} ЅМ</div>
          </div>
          <button onClick={logout} className="btn" style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', color: '#FF6969', fontSize: 15 }}>⏻</button>
        </div>
      </div>

      {tab === 'shift' ? (
        <div style={{ padding: 18, flex: 1, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: '#8FB897' }}>Продаж за смену</div>
            <div className="ub" style={{ fontSize: 18, fontWeight: 900, color: '#1FD760' }}>{shiftSales.length} · {money(shiftTotal)} ЅМ</div>
          </div>
          {shiftSales.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', fontSize: 13, marginTop: 40 }}>Продаж пока не было</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shiftSales.map(o => (
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
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 0, minHeight: 0 }}>
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
                      <input type="number" className="inp" value={bonusToApply || ''} min={0} max={bonusUsable}
                        onChange={e => setBonusToApply(Math.max(0, Math.min(bonusUsable, Number(e.target.value) || 0)))}
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
                    onClick={() => setPaymentMethod(m)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 11, fontSize: 12, fontWeight: 700,
                      background: paymentMethod === m ? 'rgba(31,215,96,.14)' : '#0C1C0F',
                      color: paymentMethod === m ? '#1FD760' : '#8FB897',
                      border: `1.5px solid ${paymentMethod === m ? 'rgba(31,215,96,.4)' : '#162B1A'}`,
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
              {bonusToApply > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#FFB800' }}>
                  <span>Бонус</span><span>−{money(Math.min(bonusToApply, bonusUsable))} ЅМ</span>
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
      )}

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
              <button className="btn ub" onClick={newSale} style={{ flex: 2, padding: 13, borderRadius: 13, fontSize: 13, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>Новая продажа</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PosApp() {
  return <PosAppInner />
}
