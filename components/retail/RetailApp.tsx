'use client'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useProducts, useOrders } from '@/lib/store'
import { api } from '@/lib/api'
import type { RetailLocation, StockBatch } from '@/lib/api'
import type { Product, Order } from '@/lib/types'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .mono{font-family:'JetBrains Mono',monospace;font-weight:700;}
  .btn{cursor:pointer;border:none;transition:all .15s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.97);}
  .btn:disabled{cursor:not-allowed;opacity:.5;}
  .card{background:linear-gradient(165deg,#0C1C0F 0%,#091508 100%);border:1px solid #162B1A;border-radius:16px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:11px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:13px;outline:none;padding:9px 12px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(31,215,96,.5);}
  .inp::placeholder{color:#3D6645;}
  ::-webkit-scrollbar{width:7px;height:7px;}
  ::-webkit-scrollbar-thumb{background:#162B1A;border-radius:7px;}
  table{width:100%;border-collapse:collapse;}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#3D6645;font-weight:800;padding:10px 14px;border-bottom:1px solid #162B1A;}
  td{padding:11px 14px;border-bottom:1px solid #0C1C0F;font-size:13px;vertical-align:middle;}
  tr:hover td{background:rgba(31,215,96,.03);}
  .rt-shell{min-height:100vh;display:flex;background:#030B05;}
  .rt-sidebar{width:216px;flex-shrink:0;background:#050F07;border-right:1px solid #162B1A;display:flex;flex-direction:column;padding:16px 12px;gap:6px;}
  .rt-nav-item{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:12px;font-size:13px;font-weight:700;color:#8FB897;background:none;text-align:left;width:100%;}
  .rt-nav-item.active{background:linear-gradient(135deg,rgba(23,179,78,.2),rgba(31,215,96,.06));color:#1FD760;border:1px solid rgba(31,215,96,.3);}
  .rt-nav-item:not(.active){border:1px solid transparent;}
  .rt-main{flex:1;display:flex;flex-direction:column;min-width:0;}
  .rt-topbar{display:flex;align-items:center;gap:14px;padding:14px 24px;border-bottom:1px solid #162B1A;}
  .loc-switch{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:11px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:13px;font-weight:700;padding:9px 14px;outline:none;cursor:pointer;}
  .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;}
  .modal-box{background:linear-gradient(165deg,#0C1C0F 0%,#091508 100%);border:1px solid #162B1A;border-radius:18px;padding:24px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;}
`

type ModuleId = 'locations' | 'warehouse'
const MODULES: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'locations', icon: '🏪', label: 'Точки продаж' },
  { id: 'warehouse', icon: '📦', label: 'Склад' },
]

const CONNECTED_APPS = [
  { icon: '🛒', name: 'Магазин', desc: 'Читает каталог, цены и остатки' },
  { icon: '🍽', name: 'Кабинет ресторана', desc: 'Читает меню и цены' },
  { icon: '📦', name: 'Сборщик', desc: 'Читает остатки при сборке заказа' },
  { icon: '🛵', name: 'Курьер', desc: 'Читает состав заказа' },
  { icon: '⚙️', name: 'Админ-панель', desc: 'Управление товарами и категориями' },
]

function money(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}
function expiryBadge(dateStr: string | null) {
  const days = daysUntil(dateStr)
  if (days == null) return null
  const color = days < 3 ? '#FF4545' : days <= 7 ? '#FFB800' : '#1FD760'
  const label = days < 0 ? 'просрочено' : `${days} дн.`
  return <span className="mono" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 7, background: `${color}1a`, color }}>{label}</span>
}

function stockForLocation(product: Product, locationId: string, locationsCount: number): number {
  const map = product.stockByLocation
  if (map && locationId in map) return Number(map[locationId]) || 0
  if (locationsCount <= 1) return Number(product.stock) || 0
  return 0
}

function NI({ lbl, val, set, ph, type = 'text' }: { lbl: string; val: string; set: (v: string) => void; ph?: string; type?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>{lbl}</div>
      <input className="inp" type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph} />
    </div>
  )
}

function StatCard({ l, v, c }: { l: string; v: string | number; c?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>{l}</div>
      <div className="mono" style={{ fontSize: 22, color: c || '#EBF5ED' }}>{v}</div>
    </div>
  )
}

export default function RetailApp() {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const allOrders = useOrders(s => s.orders)
  const fetchOrders = useOrders(s => s.fetchOrders)

  const [module, setModule] = useState<ModuleId>('locations')
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [activeLocationId, setActiveLocationId] = useState<string>('all')
  const [loaded, setLoaded] = useState(false)

  const reloadLocations = () => { void api.getLocations().then(setLocations).catch(() => {}) }
  const reloadBatches = () => { void api.getStockBatches().then(setBatches).catch(() => {}) }

  useEffect(() => {
    void fetchProducts()
    void fetchOrders()
    reloadLocations()
    reloadBatches()
    setLoaded(true)
  }, [fetchProducts, fetchOrders])

  const locationsCount = locations.length

  const totalStockOf = (p: Product) =>
    activeLocationId === 'all' ? Number(p.stock) || 0 : stockForLocation(p, activeLocationId, locationsCount)

  return (
    <div className="rt-shell">
      <style>{CSS}</style>

      <aside className="rt-sidebar">
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, padding: '6px 10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🏷</span> KAKAPO Ритейл
        </div>
        {MODULES.map(m => (
          <button key={m.id} className={`btn rt-nav-item ${module === m.id ? 'active' : ''}`} onClick={() => setModule(m.id)}>
            <span style={{ fontSize: 16 }}>{m.icon}</span> {m.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #162B1A' }}>
          <Link href="/" className="btn" style={{ display: 'block', textAlign: 'center', padding: 9, borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 11, textDecoration: 'none' }}>← На главную</Link>
        </div>
      </aside>

      <div className="rt-main">
        <div className="rt-topbar">
          <div className="ub" style={{ fontSize: 15, fontWeight: 900 }}>{MODULES.find(m => m.id === module)?.icon} {MODULES.find(m => m.id === module)?.label}</div>
          <select className="loc-switch" style={{ marginLeft: 'auto' }} value={activeLocationId} onChange={e => setActiveLocationId(e.target.value)}>
            <option value="all">🏪 Все точки</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.type === 'warehouse' ? '📦' : '🏪'} {l.name}</option>)}
          </select>
        </div>

        <div style={{ flex: 1, padding: 24, minHeight: 0 }}>
          {!loaded ? null : module === 'locations' && (
            <LocationsModule
              locations={locations}
              products={products}
              orders={allOrders}
              batches={batches}
              onReload={reloadLocations}
            />
          )}
          {loaded && module === 'warehouse' && (
            <WarehouseModule
              products={products}
              locations={locations}
              batches={batches}
              activeLocationId={activeLocationId}
              onReloadProducts={() => void fetchProducts()}
              onReloadBatches={reloadBatches}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════ ТОЧКИ ПРОДАЖ ══════════ */
function LocationsModule({ locations, products, orders, batches, onReload }: {
  locations: RetailLocation[]; products: Product[]; orders: Order[]
  batches: StockBatch[]; onReload: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [type, setType] = useState<'shop' | 'warehouse'>('shop')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!name.trim()) { setErr('Укажите название точки'); return }
    setBusy(true); setErr('')
    try {
      await api.createLocation({ name: name.trim(), address: address.trim(), type })
      setName(''); setAddress(''); setType('shop'); setShowAdd(false)
      onReload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать точку')
    } finally { setBusy(false) }
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const lowStockCount = (locId: string) => products.filter(p => {
    const stock = stockForLocation(p, locId, locations.length)
    return p.minStock != null && stock <= p.minStock
  }).length
  const expiringCount = (locId: string) => batches.filter(b => b.locationId === locId && daysUntil(b.expiryDate) != null && (daysUntil(b.expiryDate) as number) <= 7).length
  // Заказы пока не привязаны к точке (locationId) — появится вместе с продажами по точкам на следующем этапе
  const ordersAtLocation = (_locId: string) => [] as typeof orders
  const revenueToday = (locId: string) => ordersAtLocation(locId)
    .filter(o => o.status === 'delivered' && (o.deliveredAtIso || '').slice(0, 10) === todayStr)
    .reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const checksToday = (locId: string) => ordersAtLocation(locId)
    .filter(o => o.status === 'delivered' && (o.deliveredAtIso || '').slice(0, 10) === todayStr)
    .length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn ub" onClick={() => setShowAdd(true)} style={{ padding: '10px 18px', borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>+ Новая точка</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14, marginBottom: 30 }}>
        {locations.map(loc => {
          const alerts = lowStockCount(loc.id) + expiringCount(loc.id)
          return (
            <div key={loc.id} className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{loc.type === 'warehouse' ? '📦' : '🏪'} {loc.name}</div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginTop: 3 }}>{loc.address || 'Адрес не указан'}</div>
                </div>
                {alerts > 0 && <span className="mono" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 7, background: 'rgba(255,140,0,.14)', color: '#FF8C00' }}>⚠ {alerts}</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 3 }}>Выручка сегодня</div>
                  <div className="mono" style={{ fontSize: 16, color: '#1FD760' }}>{money(revenueToday(loc.id))} ЅМ</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 3 }}>Чеков сегодня</div>
                  <div className="mono" style={{ fontSize: 16 }}>{checksToday(loc.id)}</div>
                </div>
              </div>
            </div>
          )
        })}
        {locations.length === 0 && (
          <div className="card" style={{ padding: 30, textAlign: 'center', color: '#3D6645', gridColumn: '1/-1' }}>
            Точек продаж пока нет — добавьте первую
          </div>
        )}
      </div>

      <div className="ub" style={{ fontSize: 13, fontWeight: 800, color: '#8FB897', marginBottom: 12 }}>🔌 КТО ЧИТАЕТ ЭТИ ДАННЫЕ</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
        {CONNECTED_APPS.map(a => (
          <div key={a.name} className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 20 }}>{a.icon}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{a.name}</div>
              <div style={{ fontSize: 11, color: '#3D6645' }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="modal-bg" onClick={() => setShowAdd(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>Новая точка</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <NI lbl="Название *" val={name} set={setName} ph="Магазин на Рудаки" />
              <NI lbl="Адрес" val={address} set={setAddress} ph="ул. Рудаки, 10" />
              <div>
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Тип</div>
                <select className="inp" value={type} onChange={e => setType(e.target.value as 'shop' | 'warehouse')}>
                  <option value="shop">🏪 Магазин / точка продаж</option>
                  <option value="warehouse">📦 Склад</option>
                </select>
              </div>
              {err && <div style={{ fontSize: 12, color: '#FF4545', fontWeight: 700 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowAdd(false)} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>Отмена</button>
                <button className="btn ub" onClick={submit} disabled={busy} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>
                  {busy ? 'Создаём...' : '✓ Создать точку'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════ СКЛАД ══════════ */
type WarehouseModal = null | 'income' | 'writeoff' | 'inventory' | 'transfer'

function WarehouseModule({ products, locations, batches, activeLocationId, onReloadProducts, onReloadBatches }: {
  products: Product[]; locations: RetailLocation[]; batches: StockBatch[]; activeLocationId: string
  onReloadProducts: () => void; onReloadBatches: () => void
}) {
  const [search, setSearch] = useState('')
  const [catFlt, setCatFlt] = useState('all')
  const [modal, setModal] = useState<WarehouseModal>(null)

  const cats = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products) if (p.catId) map.set(p.catId, p.cat || p.catId)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      const matchC = catFlt === 'all' || p.catId === catFlt
      const matchQ = !q || p.name.toLowerCase().includes(q) || p.art.toLowerCase().includes(q)
      return matchC && matchQ
    })
  }, [products, search, catFlt])

  const batchFor = (productId: number) => batches
    .filter(b => b.productId === productId && (activeLocationId === 'all' || b.locationId === activeLocationId))
    .sort((a, b) => (a.expiryDate || '9999') < (b.expiryDate || '9999') ? -1 : 1)[0]

  const lowStockTotal = products.filter(p => {
    const stock = activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locations.length)
    return p.minStock != null && stock <= p.minStock
  }).length
  const expiringTotal = batches.filter(b => (activeLocationId === 'all' || b.locationId === activeLocationId) && daysUntil(b.expiryDate) != null && (daysUntil(b.expiryDate) as number) <= 7).length

  const closeAndReload = () => { setModal(null); onReloadProducts(); onReloadBatches() }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Товаров" v={products.length} />
        <StatCard l="Ниже минимального остатка" v={lowStockTotal} c={lowStockTotal > 0 ? '#FF8C00' : '#1FD760'} />
        <StatCard l="Истекает срок (≤7 дн.)" v={expiringTotal} c={expiringTotal > 0 ? '#FF4545' : '#1FD760'} />
        <StatCard l="Точек" v={locations.length} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="inp" style={{ maxWidth: 260 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск по названию/артикулу..." />
        <select className="inp" style={{ maxWidth: 200 }} value={catFlt} onChange={e => setCatFlt(e.target.value)}>
          <option value="all">Все категории</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn ub" onClick={() => setModal('income')} style={{ padding: '9px 14px', borderRadius: 11, fontSize: 12, fontWeight: 800, background: 'rgba(31,215,96,.12)', color: '#1FD760', border: '1px solid rgba(31,215,96,.3)' }}>📥 Приход</button>
          <button className="btn ub" onClick={() => setModal('writeoff')} style={{ padding: '9px 14px', borderRadius: 11, fontSize: 12, fontWeight: 800, background: 'rgba(255,69,69,.1)', color: '#FF4545', border: '1px solid rgba(255,69,69,.25)' }}>🗑 Списание</button>
          <button className="btn ub" onClick={() => setModal('transfer')} style={{ padding: '9px 14px', borderRadius: 11, fontSize: 12, fontWeight: 800, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.25)' }}>🔀 Перемещение</button>
          <button className="btn ub" onClick={() => setModal('inventory')} style={{ padding: '9px 14px', borderRadius: 11, fontSize: 12, fontWeight: 800, background: 'rgba(155,109,255,.1)', color: '#9B6DFF', border: '1px solid rgba(155,109,255,.25)' }}>📋 Инвентаризация</button>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Артикул</th><th>Товар</th><th>Остаток</th><th>Мин.</th><th>Срок годности</th><th>Закупка</th><th>Розница</th></tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const stock = activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locations.length)
              const low = p.minStock != null && stock <= p.minStock
              const batch = batchFor(p.id)
              return (
                <tr key={p.id}>
                  <td style={{ color: '#8FB897', fontSize: 11 }}>{p.art}</td>
                  <td style={{ fontWeight: 600 }}>{p.e} {p.name}</td>
                  <td><span className="mono" style={{ fontSize: 14, color: low ? '#FF8C00' : '#EBF5ED' }}>{stock}</span></td>
                  <td style={{ color: '#3D6645' }}>{p.minStock ?? '—'}</td>
                  <td>{batch ? expiryBadge(batch.expiryDate) : <span style={{ color: '#3D6645' }}>—</span>}</td>
                  <td><span className="mono" style={{ fontSize: 13, color: '#8FB897' }}>{p.costPrice ? money(p.costPrice) : '—'}</span></td>
                  <td><span className="mono" style={{ fontSize: 14, color: '#FFB800' }}>{money(p.price)} ЅМ</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: 'center', color: '#3D6645', padding: 30 }}>Ничего не найдено</div>}
      </div>

      {modal === 'income' && <IncomeModal products={products} locations={locations} defaultLocationId={activeLocationId} onClose={() => setModal(null)} onDone={closeAndReload} />}
      {modal === 'writeoff' && <WriteoffModal products={products} locations={locations} defaultLocationId={activeLocationId} onClose={() => setModal(null)} onDone={closeAndReload} />}
      {modal === 'transfer' && <TransferModal products={products} locations={locations} onClose={() => setModal(null)} onDone={closeAndReload} />}
      {modal === 'inventory' && <InventoryModal products={products} locations={locations} defaultLocationId={activeLocationId} onClose={() => setModal(null)} onDone={closeAndReload} />}
    </div>
  )
}

function useProductLines() {
  const [lines, setLines] = useState<{ productId: number; qty: string; extra: string }[]>([])
  const addLine = (productId: number) => {
    if (lines.some(l => l.productId === productId)) return
    setLines(ls => [...ls, { productId, qty: '1', extra: '' }])
  }
  const setLine = (productId: number, patch: Partial<{ qty: string; extra: string }>) =>
    setLines(ls => ls.map(l => l.productId === productId ? { ...l, ...patch } : l))
  const removeLine = (productId: number) => setLines(ls => ls.filter(l => l.productId !== productId))
  return { lines, addLine, setLine, removeLine, clear: () => setLines([]) }
}

function ProductPicker({ products, onPick }: { products: Product[]; onPick: (id: number) => void }) {
  const [val, setVal] = useState('')
  return (
    <select className="inp" value={val} onChange={e => { const id = Number(e.target.value); if (id) { onPick(id); setVal('') } }}>
      <option value="">Выберите товар...</option>
      {products.map(p => <option key={p.id} value={p.id}>{p.e} {p.name} ({p.art})</option>)}
    </select>
  )
}

function IncomeModal({ products, locations, defaultLocationId, onClose, onDone }: {
  products: Product[]; locations: RetailLocation[]; defaultLocationId: string; onClose: () => void; onDone: () => void
}) {
  const { lines, addLine, setLine, removeLine } = useProductLines()
  const [locationId, setLocationId] = useState(defaultLocationId !== 'all' ? defaultLocationId : (locations[0]?.id || ''))
  const [expiryDate, setExpiryDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!locationId) { setErr('Выберите точку'); return }
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      await api.stockIncome({
        locationId,
        items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0, costPrice: Number(l.extra) || 0, expiryDate: expiryDate || null })),
        createdBy: 'retail',
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести приход')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>📥 Приход товара</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Точка назначения</div>
            <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Выберите точку...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <NI lbl="Срок годности партии (необязательно)" val={expiryDate} set={setExpiryDate} type="date" />
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Добавить товар</div>
            <ProductPicker products={products} onPick={addLine} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {lines.map(l => {
            const p = products.find(x => x.id === l.productId)
            return (
              <div key={l.productId} style={{ display: 'grid', gridTemplateColumns: '1.5fr .7fr .8fr auto', gap: 8, alignItems: 'center', padding: 9, background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A' }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
                <input className="inp" type="number" value={l.qty} onChange={e => setLine(l.productId, { qty: e.target.value })} placeholder="Кол-во" style={{ padding: '6px 9px', fontSize: 12 }} />
                <input className="inp" type="number" value={l.extra} onChange={e => setLine(l.productId, { extra: e.target.value })} placeholder="Цена закупки" style={{ padding: '6px 9px', fontSize: 12 }} />
                <button className="btn" onClick={() => removeLine(l.productId)} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,69,69,.1)', color: '#FF4545', fontSize: 11 }}>✕</button>
              </div>
            )
          })}
          {lines.length === 0 && <div style={{ fontSize: 12, color: '#3D6645', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF4545', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>Отмена</button>
          <button className="btn ub" onClick={submit} disabled={busy || !lines.length} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#17B34E,#1FD760)' }}>
            {busy ? 'Проводим...' : '✓ Провести приход'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WriteoffModal({ products, locations, defaultLocationId, onClose, onDone }: {
  products: Product[]; locations: RetailLocation[]; defaultLocationId: string; onClose: () => void; onDone: () => void
}) {
  const { lines, addLine, setLine, removeLine } = useProductLines()
  const [locationId, setLocationId] = useState(defaultLocationId !== 'all' ? defaultLocationId : (locations[0]?.id || ''))
  const [reason, setReason] = useState('Истёк срок')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!locationId) { setErr('Выберите точку'); return }
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      await api.stockWriteoff({ locationId, items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })), reason, createdBy: 'retail' })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести списание')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>🗑 Списание товара</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Точка</div>
            <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Выберите точку...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Причина</div>
            <select className="inp" value={reason} onChange={e => setReason(e.target.value)}>
              {['Истёк срок', 'Порча', 'Пересорт', 'Другое'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Добавить товар</div>
            <ProductPicker products={products} onPick={addLine} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {lines.map(l => {
            const p = products.find(x => x.id === l.productId)
            return (
              <div key={l.productId} style={{ display: 'grid', gridTemplateColumns: '2fr .8fr auto', gap: 8, alignItems: 'center', padding: 9, background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A' }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
                <input className="inp" type="number" value={l.qty} onChange={e => setLine(l.productId, { qty: e.target.value })} placeholder="Кол-во" style={{ padding: '6px 9px', fontSize: 12 }} />
                <button className="btn" onClick={() => removeLine(l.productId)} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,69,69,.1)', color: '#FF4545', fontSize: 11 }}>✕</button>
              </div>
            )
          })}
          {lines.length === 0 && <div style={{ fontSize: 12, color: '#3D6645', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF4545', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>Отмена</button>
          <button className="btn ub" onClick={submit} disabled={busy || !lines.length} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#E24C4C,#FF6969)' }}>
            {busy ? 'Списываем...' : '✓ Провести списание'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TransferModal({ products, locations, onClose, onDone }: {
  products: Product[]; locations: RetailLocation[]; onClose: () => void; onDone: () => void
}) {
  const { lines, addLine, setLine, removeLine } = useProductLines()
  const [fromId, setFromId] = useState(locations[0]?.id || '')
  const [toId, setToId] = useState(locations[1]?.id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!fromId || !toId) { setErr('Выберите обе точки'); return }
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      await api.stockTransfer({ fromLocationId: fromId, toLocationId: toId, items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })), createdBy: 'retail' })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось выполнить перемещение')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>🔀 Перемещение между точками</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Откуда</div>
            <select className="inp" value={fromId} onChange={e => setFromId(e.target.value)}>
              <option value="">Точка-отправитель...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Куда</div>
            <select className="inp" value={toId} onChange={e => setToId(e.target.value)}>
              <option value="">Точка назначения...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Добавить товар</div>
          <ProductPicker products={products} onPick={addLine} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {lines.map(l => {
            const p = products.find(x => x.id === l.productId)
            return (
              <div key={l.productId} style={{ display: 'grid', gridTemplateColumns: '2fr .8fr auto', gap: 8, alignItems: 'center', padding: 9, background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A' }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
                <input className="inp" type="number" value={l.qty} onChange={e => setLine(l.productId, { qty: e.target.value })} placeholder="Кол-во" style={{ padding: '6px 9px', fontSize: 12 }} />
                <button className="btn" onClick={() => removeLine(l.productId)} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,69,69,.1)', color: '#FF4545', fontSize: 11 }}>✕</button>
              </div>
            )
          })}
          {lines.length === 0 && <div style={{ fontSize: 12, color: '#3D6645', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF4545', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>Отмена</button>
          <button className="btn ub" onClick={submit} disabled={busy || !lines.length} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#3B8EF0,#5FA6FF)' }}>
            {busy ? 'Перемещаем...' : '✓ Переместить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InventoryModal({ products, locations, defaultLocationId, onClose, onDone }: {
  products: Product[]; locations: RetailLocation[]; defaultLocationId: string; onClose: () => void; onDone: () => void
}) {
  const [locationId, setLocationId] = useState(defaultLocationId !== 'all' ? defaultLocationId : (locations[0]?.id || ''))
  const [search, setSearch] = useState('')
  const [counted, setCounted] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const filtered = products.filter(p => !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()) || p.art.toLowerCase().includes(search.toLowerCase()))
  const touched = Object.entries(counted).filter(([, v]) => v !== '')

  const submit = async () => {
    if (!locationId) { setErr('Выберите точку'); return }
    if (!touched.length) { setErr('Введите фактический остаток хотя бы для одного товара'); return }
    setBusy(true); setErr('')
    try {
      await api.stockInventory({ locationId, items: touched.map(([id, v]) => ({ productId: Number(id), countedStock: Number(v) || 0 })), createdBy: 'retail' })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести инвентаризацию')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>📋 Инвентаризация</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Точка</div>
            <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Выберите точку...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <input className="inp" style={{ alignSelf: 'end' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию/артикулу..." />
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #162B1A', borderRadius: 12, marginBottom: 14 }}>
          <table>
            <thead><tr><th>Товар</th><th>По системе</th><th>Фактически</th><th>Разница</th></tr></thead>
            <tbody>
              {filtered.map(p => {
                const systemStock = locationId ? stockForLocation(p, locationId, locations.length) : p.stock
                const val = counted[p.id]
                const diff = val !== undefined && val !== '' ? (Number(val) || 0) - systemStock : null
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{p.e} {p.name}</td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{systemStock}</span></td>
                    <td><input className="inp" type="number" value={val || ''} onChange={e => setCounted(c => ({ ...c, [p.id]: e.target.value }))} placeholder={String(systemStock)} style={{ width: 80, padding: '5px 8px', fontSize: 12 }} /></td>
                    <td>{diff != null && diff !== 0 && <span className="mono" style={{ fontSize: 12, color: diff > 0 ? '#1FD760' : '#FF4545' }}>{diff > 0 ? '+' : ''}{diff}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <div style={{ fontSize: 12, color: '#FF4545', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>Отмена</button>
          <button className="btn ub" onClick={submit} disabled={busy || !touched.length} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 12, fontWeight: 800, color: 'white', background: 'linear-gradient(135deg,#9B6DFF,#B48CFF)' }}>
            {busy ? 'Применяем...' : `✓ Применить (${touched.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
