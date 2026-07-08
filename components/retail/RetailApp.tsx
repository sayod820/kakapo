'use client'
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useProducts, useOrders } from '@/lib/store'
import { api } from '@/lib/api'
import type { RetailLocation, StockBatch, RetailSupplier, RetailExpense } from '@/lib/api'
import type { Product, Order } from '@/lib/types'
import { useCards, hydrateCardStore } from '@/lib/cardStore'
import { useClients, hydrateClientStore } from '@/lib/clientStore'
import { mergeCardsWithClients, cardHasDebtSection, cardLoyaltyFromCard, findClientForCard, type AdminCard } from '@/lib/cardCrm'
import { saveCardLoyalty } from '@/lib/clientCardSync'
import { phonesMatch } from '@/lib/clientCrm'
import { loadDebtHistory, subscribeDebtHistory } from '@/lib/clientVipCredit'
import { useCourierTeam, hydrateCourierTeamStore } from '@/lib/courierTeamStore'
import { useAssemblerTeam, hydrateAssemblerTeamStore } from '@/lib/assemblerTeamStore'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');
  :root{
    --bg:#030B05; --surface:#0A1710; --surface2:#0F2216; --border:#1A3322; --border2:#234430;
    --gr:#1FD760; --gr2:#17B34E; --gd:#FFB800; --org:#FF8C00; --blue:#3B8EF0;
    --pur:#9B6DFF; --red:#FF4545; --t1:#F1FBF3; --t2:#8FB897; --t3:#3D6645;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  .rt-root{background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .mono{font-family:'JetBrains Mono',monospace;font-weight:700;}
  .btn{cursor:pointer;border:none;transition:all .15s cubic-bezier(.16,1,.3,1);font-family:inherit;}.btn:active{transform:scale(.97);}
  .btn:disabled{cursor:not-allowed;opacity:.5;}
  .card{background:var(--surface);border:1.5px solid var(--border);border-radius:16px;}
  .inp{background:var(--surface2);border:1.5px solid var(--border);border-radius:11px;color:var(--t1);font-family:'Nunito',sans-serif;font-size:13px;outline:none;padding:9px 12px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:var(--gr);}
  .inp::placeholder{color:var(--t3);}
  ::-webkit-scrollbar{width:7px;height:7px;}
  ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:7px;}
  table{width:100%;border-collapse:collapse;}
  th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3);font-weight:800;padding:10px 14px;border-bottom:1px solid var(--border);}
  th.r{text-align:right;}
  td{padding:11px 14px;border-bottom:1px solid var(--border);font-size:12.5px;vertical-align:middle;}
  tbody tr:last-child td{border-bottom:none;}
  tr:hover td{background:var(--surface2);}
  .price-cell{font-family:'JetBrains Mono';font-weight:900;color:var(--gd);font-size:14px;}

  .rt-shell{min-height:100vh;display:flex;background:var(--bg);}
  .rt-sidebar{width:224px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;}
  .rt-brand{display:flex;align-items:center;gap:10px;padding:20px 18px;border-bottom:1px solid var(--border);}
  .rt-logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#0F8A3A,var(--gr));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:16px;color:var(--bg);flex-shrink:0;}
  .rt-group{padding:14px 10px 4px;}
  .rt-group-title{font-size:9.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;font-weight:800;padding:0 10px 8px;}
  .rt-nav-item{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:12px;color:var(--t2);font-size:12.5px;font-weight:700;width:100%;text-align:left;background:none;margin-bottom:2px;}
  .rt-nav-item:hover{background:var(--surface2);color:var(--t1);}
  .rt-nav-item.on{background:rgba(31,215,96,.1);color:var(--gr);}
  .rt-nav-item .ic{font-size:16px;width:20px;text-align:center;flex-shrink:0;}
  .rt-nav-item .badge{margin-left:auto;background:var(--red);color:white;font-size:9px;font-weight:800;padding:2px 6px;border-radius:7px;}
  .rt-nav-item.on .badge{background:var(--gr);color:var(--bg);}
  .rt-foot{margin-top:auto;padding:14px;border-top:1px solid var(--border);}
  .rt-main{flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto;}
  .rt-content{padding:22px 26px 40px;}

  .locbar{display:flex;align-items:center;gap:12px;padding:0 26px 18px;margin-top:20px;border-bottom:1px solid var(--border);}
  .src-tag{font-size:10.5px;color:var(--t3);display:flex;align-items:center;gap:6px;}
  .src-tag .dot{width:6px;height:6px;border-radius:50%;background:var(--gr);animation:pulse 2s infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .loc-pill{display:flex;align-items:center;gap:9px;background:var(--surface);border:1.5px solid var(--border2);border-radius:14px;padding:9px 15px;font-size:12.5px;font-weight:700;margin-left:auto;color:var(--t1);}

  .page-head{display:flex;align-items:center;gap:14px;margin-bottom:20px;flex-wrap:wrap;}
  .page-head h1{font-family:'Unbounded';font-size:18px;font-weight:800;}
  .page-head .sub{font-size:12px;color:var(--t2);margin-top:2px;}
  .page-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;}
  .rbtn{padding:9px 15px;border-radius:12px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:7px;}
  .rbtn-primary{background:var(--gr);color:var(--bg);}
  .rbtn-primary:hover{background:var(--gr2);}
  .rbtn-ghost{background:var(--surface2);border:1px solid var(--border);color:var(--t2);}
  .rbtn-ghost:hover{border-color:var(--border2);color:var(--t1);}

  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:22px;}
  .stat-card{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:18px;}
  .stat-card .l{font-size:11px;color:var(--t2);font-weight:700;margin-bottom:8px;}
  .stat-card .v{font-family:'JetBrains Mono';font-size:24px;font-weight:900;line-height:1;}
  .stat-card .d{font-size:10.5px;color:var(--t3);margin-top:6px;}

  .alert-list{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;overflow:hidden;margin-bottom:22px;}
  .alert-row{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--border);}
  .alert-row:last-child{border-bottom:none;}
  .alert-row .aic{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
  .alert-row .info{flex:1;min-width:0;}
  .alert-row .info b{font-size:12.5px;display:block;}
  .alert-row .info span{font-size:11px;color:var(--t2);}
  .alert-row .val{font-family:'JetBrains Mono';font-weight:800;font-size:13px;flex-shrink:0;}

  .panel{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;overflow:hidden;margin-bottom:20px;}
  .panel-head{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;}
  .panel-head b{font-family:'Unbounded';font-size:12.5px;font-weight:800;}

  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:8px;font-size:10.5px;font-weight:800;}
  .badge.ok{background:rgba(31,215,96,.12);color:var(--gr);}
  .badge.warn{background:rgba(255,184,0,.12);color:var(--gd);}
  .badge.danger{background:rgba(255,69,69,.12);color:var(--red);}
  .badge.info{background:rgba(59,142,240,.12);color:var(--blue);}
  .badge.muted{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}

  .filters{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;}

  .client-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
  .client-card{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:16px;cursor:pointer;transition:border-color .15s;}
  .client-card:hover{border-color:var(--border2);}
  .client-top{display:flex;align-items:center;gap:11px;margin-bottom:12px;}
  .client-av{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#0F8A3A,var(--gr));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:13px;color:var(--bg);flex-shrink:0;}
  .client-top .ci{min-width:0;}
  .client-top .ci b{font-size:13px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .client-top .ci span{font-size:10.5px;color:var(--t2);}
  .debt-row{display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-bottom:5px;}
  .debt-row b{font-family:'JetBrains Mono';color:var(--t1);}
  .debt-meter{height:6px;background:var(--border);border-radius:4px;overflow:hidden;}
  .debt-meter i{display:block;height:100%;border-radius:4px;}

  .supplier-card{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:16px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
  .supplier-ic{width:44px;height:44px;border-radius:13px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
  .supplier-info{flex:1;min-width:160px;}
  .supplier-info b{font-size:13.5px;display:block;margin-bottom:2px;}
  .supplier-info span{font-size:11px;color:var(--t2);}
  .supplier-debt{text-align:right;}
  .supplier-debt .l{font-size:10px;color:var(--t3);margin-bottom:3px;}
  .supplier-debt .v{font-family:'JetBrains Mono';font-weight:900;font-size:17px;color:var(--org);}

  .bar-list{padding:6px 18px 16px;}
  .bar-row{margin-bottom:14px;}
  .bar-row .top{display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;}
  .bar-row .top b{color:var(--t1);font-weight:700;}
  .bar-row .top span{font-family:'JetBrains Mono';font-weight:800;color:var(--gd);}
  .bar-track{height:9px;background:var(--surface2);border-radius:5px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--gr2),var(--gr));}

  .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .compare-card{background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:16px;text-align:center;}
  .compare-card .l{font-size:11px;color:var(--t2);margin-bottom:8px;}
  .compare-card .v{font-family:'JetBrains Mono';font-size:22px;font-weight:900;}

  .emp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
  .emp-card{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:16px;text-align:center;}
  .emp-av{width:50px;height:50px;border-radius:15px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:17px;margin:0 auto 10px;}
  .emp-card b{font-size:13px;display:block;margin-bottom:6px;}
  .emp-kpi{display:flex;justify-content:space-around;padding-top:12px;margin-top:10px;border-top:1px solid var(--border);}
  .emp-kpi .v{font-family:'JetBrains Mono';font-weight:900;font-size:15px;color:var(--gd);}
  .emp-kpi .l{font-size:9px;color:var(--t3);margin-top:2px;}

  .point-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
  .point-card{background:var(--surface);border:1.5px solid var(--border);border-radius:20px;padding:18px;position:relative;}
  .point-card.active{border-color:var(--gr);background:rgba(31,215,96,.05);}
  .point-card .active-tag{position:absolute;top:14px;right:14px;font-size:9px;font-weight:800;color:var(--gr);background:rgba(31,215,96,.12);padding:3px 8px;border-radius:7px;}
  .point-ic{width:42px;height:42px;border-radius:13px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:12px;}
  .point-card b.nm{font-size:14px;display:block;margin-bottom:3px;}
  .point-card .addr{font-size:11px;color:var(--t2);margin-bottom:14px;}
  .point-stats{display:flex;gap:14px;padding-top:12px;border-top:1px solid var(--border);}
  .point-stats div{flex:1;}
  .point-stats .v{font-family:'JetBrains Mono';font-weight:900;font-size:15px;}
  .point-stats .l{font-size:9px;color:var(--t3);margin-top:2px;}

  .overlay{position:fixed;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px;}
  .modal{width:100%;max-width:440px;max-height:86vh;overflow-y:auto;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:24px;}
  .modal h3{font-family:'Unbounded';font-size:14.5px;font-weight:800;margin-bottom:16px;}
  .field{margin-bottom:13px;}
  .field label{font-size:11px;color:var(--t2);font-weight:700;margin-bottom:6px;display:block;}
  .field-row{display:flex;gap:10px;}
  .field-row .field{flex:1;}
  .modal-actions{display:flex;gap:9px;margin-top:6px;}
  .modal-actions button{flex:1;padding:12px;border-radius:13px;font-weight:800;font-size:12.5px;}
  .btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}
  .btn-confirm{background:var(--gr);color:var(--bg);}
  .btn-confirm:hover{background:var(--gr2);}

  .invrow{display:grid;grid-template-columns:1.5fr .7fr .8fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);font-size:12px;}
`

type ModuleId = 'locations' | 'dashboard' | 'warehouse' | 'clients' | 'suppliers' | 'finance' | 'prices' | 'reports' | 'employees'

const CONNECTED_APPS = [
  { icon: '🛒', name: 'Магазин (клиент)', desc: 'Читает каталог, цены и остатки' },
  { icon: '🍽', name: 'Кабинет ресторана', desc: 'Читает меню и цены' },
  { icon: '📦', name: 'Сборщик', desc: 'Читает остатки при сборке заказа' },
  { icon: '🛵', name: 'Курьер', desc: 'Читает адрес точки для маршрута' },
  { icon: '⚙️', name: 'Админ-панель', desc: 'Управляет заказами, видит сводку отсюда' },
]

function money(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}
function expiryBadgeClass(days: number): 'ok' | 'warn' | 'danger' {
  return days < 3 ? 'danger' : days <= 7 ? 'warn' : 'ok'
}
function stockForLocation(product: Product, locationId: string, locationsCount: number): number {
  const map = product.stockByLocation
  if (map && locationId in map) return Number(map[locationId]) || 0
  if (locationsCount <= 1) return Number(product.stock) || 0
  return 0
}
function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function NI({ lbl, val, set, ph, type = 'text' }: { lbl: string; val: string; set: (v: string) => void; ph?: string; type?: string }) {
  return (
    <div className="field">
      <label>{lbl}</label>
      <input className="inp" type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph} />
    </div>
  )
}

function StatCard({ l, v, c, d }: { l: string; v: string | number; c?: string; d?: string }) {
  return (
    <div className="stat-card">
      <div className="l">{l}</div>
      <div className="v mono" style={{ color: c || 'var(--t1)' }}>{v}</div>
      {d && <div className="d">{d}</div>}
    </div>
  )
}

const NAV_ITEMS: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'locations', icon: '🏪', label: 'Точки продаж' },
  { id: 'dashboard', icon: '📊', label: 'Дашборд' },
  { id: 'warehouse', icon: '📦', label: 'Склад' },
  { id: 'clients', icon: '👥', label: 'Клиенты и долги' },
  { id: 'suppliers', icon: '🏭', label: 'Поставщики' },
]
const NAV_FINANCE: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'finance', icon: '💵', label: 'Кассовая книга' },
  { id: 'prices', icon: '🏷', label: 'Цены' },
  { id: 'reports', icon: '📈', label: 'Отчёты' },
]
const NAV_MGMT: { id: ModuleId; icon: string; label: string }[] = [
  { id: 'employees', icon: '👤', label: 'Сотрудники' },
]

export default function RetailApp() {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const allOrders = useOrders(s => s.orders)
  const fetchOrders = useOrders(s => s.fetchOrders)
  const cardsRaw = useCards()
  const clients = useClients()
  const couriers = useCourierTeam()
  const assemblers = useAssemblerTeam()

  const [module, setModule] = useState<ModuleId>('locations')
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [suppliers, setSuppliers] = useState<RetailSupplier[]>([])
  const [expenses, setExpenses] = useState<RetailExpense[]>([])
  const [activeLocationId, setActiveLocationId] = useState<string>('all')
  const [loaded, setLoaded] = useState(false)

  const reloadLocations = () => { void api.getLocations().then(setLocations).catch(() => {}) }
  const reloadBatches = () => { void api.getStockBatches().then(setBatches).catch(() => {}) }
  const reloadSuppliers = () => { void api.getRetailSuppliers().then(setSuppliers).catch(() => {}) }
  const reloadExpenses = () => { void api.getRetailExpenses().then(setExpenses).catch(() => {}) }

  useEffect(() => {
    void fetchProducts()
    void fetchOrders()
    hydrateCardStore()
    hydrateClientStore()
    hydrateCourierTeamStore()
    hydrateAssemblerTeamStore()
    reloadLocations()
    reloadBatches()
    reloadSuppliers()
    reloadExpenses()
    setLoaded(true)
  }, [fetchProducts, fetchOrders])

  const cards = useMemo(() => mergeCardsWithClients(cardsRaw, clients), [cardsRaw, clients])
  const debtCards = useMemo(
    () => cards.filter(c => c.status === 'active' && cardHasDebtSection(c) && !!(c.phone || c.clientId || c.client)),
    [cards],
  )

  const lowStockCount = useMemo(() => products.filter(p => {
    const stock = activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locations.length)
    return p.minStock != null && stock <= p.minStock
  }).length, [products, activeLocationId, locations.length])
  const expiringCount = useMemo(() => batches.filter(b => {
    if (activeLocationId !== 'all' && b.locationId !== activeLocationId) return false
    const d = daysUntil(b.expiryDate)
    return d != null && d <= 7
  }).length, [batches, activeLocationId])
  const warehouseAlerts = lowStockCount + expiringCount

  const activeLocation = locations.find(l => l.id === activeLocationId)

  const navLabel = (id: ModuleId) => [...NAV_ITEMS, ...NAV_FINANCE, ...NAV_MGMT].find(n => n.id === id)

  return (
    <div className="rt-root">
      <style>{CSS}</style>
      <div className="rt-shell">
        <aside className="rt-sidebar">
          <div className="rt-brand">
            <div className="rt-logo">K</div>
            <div><b className="ub" style={{ fontSize: 13, fontWeight: 800, display: 'block' }}>KAKAPO Ритейл</b><span style={{ fontSize: 9, color: 'var(--t3)' }}>Источник данных · все точки</span></div>
          </div>
          <div className="rt-group">
            {NAV_ITEMS.map(n => (
              <button key={n.id} className={`btn rt-nav-item ${module === n.id ? 'on' : ''}`} onClick={() => setModule(n.id)}>
                <span className="ic">{n.icon}</span>{n.label}
                {n.id === 'warehouse' && warehouseAlerts > 0 && <span className="badge">{warehouseAlerts}</span>}
              </button>
            ))}
          </div>
          <div className="rt-group">
            <div className="rt-group-title">Финансы</div>
            {NAV_FINANCE.map(n => (
              <button key={n.id} className={`btn rt-nav-item ${module === n.id ? 'on' : ''}`} onClick={() => setModule(n.id)}>
                <span className="ic">{n.icon}</span>{n.label}
              </button>
            ))}
          </div>
          <div className="rt-group">
            <div className="rt-group-title">Управление</div>
            {NAV_MGMT.map(n => (
              <button key={n.id} className={`btn rt-nav-item ${module === n.id ? 'on' : ''}`} onClick={() => setModule(n.id)}>
                <span className="ic">{n.icon}</span>{n.label}
              </button>
            ))}
          </div>
          <div className="rt-foot">
            <Link href="/" className="btn rbtn rbtn-ghost" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>← На главную</Link>
          </div>
        </aside>

        <div className="rt-main">
          <div className="locbar">
            <div className="src-tag"><span className="dot" />Единый источник данных · читают: Магазин, Ресторан, Сборщик, Курьер, Админ</div>
            <select className="loc-pill" value={activeLocationId} onChange={e => setActiveLocationId(e.target.value)} style={{ cursor: 'pointer', outline: 'none' }}>
              <option value="all">🌐 Все точки</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.type === 'warehouse' ? '📦' : '🏪'} {l.name}</option>)}
            </select>
          </div>

          <div className="rt-content">
            {!loaded ? null : (
              <>
                {module === 'locations' && (
                  <LocationsModule locations={locations} products={products} orders={allOrders} batches={batches} activeLocationId={activeLocationId} onReload={reloadLocations} />
                )}
                {module === 'dashboard' && (
                  <DashboardModule products={products} orders={allOrders} batches={batches} debtCards={debtCards} activeLocationId={activeLocationId} locationsCount={locations.length} />
                )}
                {module === 'warehouse' && (
                  <WarehouseModule products={products} locations={locations} batches={batches} activeLocationId={activeLocationId}
                    onReloadProducts={() => void fetchProducts()} onReloadBatches={reloadBatches} />
                )}
                {module === 'clients' && <ClientsDebtModule debtCards={debtCards} clients={clients} orders={allOrders} />}
                {module === 'suppliers' && <SuppliersModule suppliers={suppliers} batches={batches} onReload={reloadSuppliers} />}
                {module === 'finance' && <FinanceModule products={products} orders={allOrders} expenses={expenses} onReload={reloadExpenses} />}
                {module === 'prices' && <PricesModule products={products} onReload={() => void fetchProducts()} />}
                {module === 'reports' && <ReportsModule products={products} orders={allOrders} />}
                {module === 'employees' && <EmployeesModule couriers={couriers} assemblers={assemblers} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════ ТОЧКИ ПРОДАЖ ══════════ */
function LocationsModule({ locations, products, batches, activeLocationId, onReload }: {
  locations: RetailLocation[]; products: Product[]; orders: Order[]; batches: StockBatch[]; activeLocationId: string; onReload: () => void
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

  const lowStockCount = (locId: string) => products.filter(p => {
    const stock = stockForLocation(p, locId, locations.length)
    return p.minStock != null && stock <= p.minStock
  }).length
  const expiringCount = (locId: string) => batches.filter(b => b.locationId === locId && daysUntil(b.expiryDate) != null && (daysUntil(b.expiryDate) as number) <= 7).length
  const batchesStored = (locId: string) => batches.filter(b => b.locationId === locId).reduce((s, b) => s + b.quantity, 0)

  return (
    <div>
      <div className="page-head">
        <h1>Точки продаж</h1>
        <div className="sub">Все магазины и склады KAKAPO</div>
        <div className="page-actions"><button className="btn rbtn rbtn-primary" onClick={() => setShowAdd(true)}>+ Новая точка</button></div>
      </div>

      <div className="point-grid" style={{ marginBottom: 24 }}>
        {locations.map(loc => {
          const alerts = lowStockCount(loc.id) + expiringCount(loc.id)
          const isActive = loc.id === activeLocationId
          return (
            <div key={loc.id} className={`point-card ${isActive ? 'active' : ''}`}>
              {isActive && <span className="active-tag">● Активна сейчас</span>}
              <div className="point-ic">{loc.type === 'warehouse' ? '📦' : '🏪'}</div>
              <b className="nm ub">{loc.name}</b>
              <div className="addr">{loc.address || (loc.type === 'warehouse' ? 'Не торгует · только хранение' : 'Адрес не указан')}</div>
              <div className="point-stats">
                {loc.type === 'warehouse' ? (
                  <>
                    <div><div className="v mono" style={{ color: 'var(--blue)' }}>{batchesStored(loc.id)}</div><div className="l">позиций хранится</div></div>
                    <div><div className="v mono" style={{ color: alerts > 0 ? 'var(--red)' : 'var(--t1)' }}>{alerts}</div><div className="l">алертов</div></div>
                  </>
                ) : (
                  <>
                    <div><div className="v mono" style={{ color: 'var(--gr)' }}>—</div><div className="l">выручка сегодня</div></div>
                    <div><div className="v mono" style={{ color: alerts > 0 ? 'var(--red)' : 'var(--t1)' }}>{alerts}</div><div className="l">алертов склада</div></div>
                  </>
                )}
              </div>
            </div>
          )
        })}
        <button className="btn point-card" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'var(--t2)', minHeight: 170 }} onClick={() => setShowAdd(true)}>
          <span style={{ fontSize: 26 }}>+</span><span style={{ fontSize: 12, fontWeight: 700 }}>Добавить точку продаж</span>
        </button>
        {locations.length === 0 && (
          <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--t3)', gridColumn: '1/-1' }}>Точек продаж пока нет — добавьте первую</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
        Выручка и чеки по конкретной точке появятся, когда продажи будут привязаны к точкам (следующий этап).
      </div>

      <div className="panel">
        <div className="panel-head"><b>🔗 Кто подключён к этим данным</b></div>
        <div className="alert-list" style={{ border: 'none', borderRadius: 0, margin: 0 }}>
          {CONNECTED_APPS.map(a => (
            <div key={a.name} className="alert-row">
              <div className="aic" style={{ background: 'rgba(31,215,96,.12)' }}>{a.icon}</div>
              <div className="info"><b>{a.name}</b><span>{a.desc}</span></div>
              <span className="badge ok">Подключено</span>
            </div>
          ))}
        </div>
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Новая точка</h3>
            <NI lbl="Название *" val={name} set={setName} ph="Магазин на Рудаки" />
            <NI lbl="Адрес" val={address} set={setAddress} ph="ул. Рудаки, 10" />
            <div className="field">
              <label>Тип</label>
              <select className="inp" value={type} onChange={e => setType(e.target.value as 'shop' | 'warehouse')}>
                <option value="shop">🏪 Магазин / точка продаж</option>
                <option value="warehouse">📦 Склад</option>
              </select>
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700, marginBottom: 10 }}>{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setShowAdd(false)}>Отмена</button>
              <button className="btn btn-confirm" onClick={submit} disabled={busy}>{busy ? 'Создаём...' : 'Создать точку'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════ ДАШБОРД ══════════ */
function DashboardModule({ products, orders, batches, debtCards, activeLocationId, locationsCount }: {
  products: Product[]; orders: Order[]; batches: StockBatch[]; debtCards: AdminCard[]; activeLocationId: string; locationsCount: number
}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const deliveredToday = useMemo(() => orders.filter(o => o.status === 'delivered' && (o.deliveredAtIso || '').slice(0, 10) === todayStr), [orders, todayStr])
  const revenueToday = deliveredToday.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const checksToday = deliveredToday.length
  const avgCheck = checksToday ? revenueToday / checksToday : 0

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const costToday = deliveredToday.reduce((s, o) => {
    const items = o.items || []
    return s + items.reduce((si, it) => {
      const p = productById.get(Number(it.product_id ?? it.id))
      return si + (Number(p?.costPrice) || 0) * (Number(it.qty) || 0)
    }, 0)
  }, 0)
  const profitToday = Math.max(0, revenueToday - costToday)
  const marginPct = revenueToday > 0 ? (profitToday / revenueToday) * 100 : 0

  const totalDebt = debtCards.reduce((s, c) => s + c.debt, 0)
  const clientsWithDebt = debtCards.filter(c => c.debt > 0).length

  const lowStockItems = products.filter(p => {
    const stock = activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locationsCount)
    return p.minStock != null && stock <= p.minStock
  })
  const expiringBatches = batches
    .filter(b => activeLocationId === 'all' || b.locationId === activeLocationId)
    .map(b => ({ b, d: daysUntil(b.expiryDate) }))
    .filter(x => x.d != null && x.d <= 7)
    .sort((a, b2) => (a.d as number) - (b2.d as number))
  const overLimitCards = debtCards.filter(c => c.debtLimit > 0 && c.debt > c.debtLimit)

  const topProducts = useMemo(() => {
    const qtyByProduct = new Map<string, number>()
    for (const o of orders) {
      if (o.status !== 'delivered') continue
      for (const it of o.items || []) {
        const key = `${it.e || ''} ${it.name}`
        qtyByProduct.set(key, (qtyByProduct.get(key) || 0) + (Number(it.qty) || 0))
      }
    }
    return Array.from(qtyByProduct.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [orders])
  const topMax = topProducts[0]?.[1] || 1

  return (
    <div>
      <div className="page-head"><h1>Дашборд</h1><div className="sub">Общая картина по {activeLocationId === 'all' ? 'всем точкам' : 'точке'} · сегодня</div></div>

      <div className="stat-grid">
        <StatCard l="💰 Выручка сегодня" v={money(revenueToday)} c="var(--gr)" />
        <StatCard l="🧾 Чеков" v={checksToday} d={checksToday ? `средний чек ${money(avgCheck)} ЅМ` : undefined} />
        <StatCard l="📈 Прибыль (наценка)" v={money(profitToday)} c="var(--gd)" d={revenueToday ? `${marginPct.toFixed(1)}% от выручки` : undefined} />
        <StatCard l="💳 Долги клиентов" v={money(totalDebt)} c="var(--org)" d={`${clientsWithDebt} клиентов должны`} />
      </div>

      <div className="panel">
        <div className="panel-head"><b>⚠️ Требует внимания</b></div>
        <div className="alert-list" style={{ border: 'none', borderRadius: 0, margin: 0 }}>
          {expiringBatches.slice(0, 5).map(({ b, d }) => (
            <div className="alert-row" key={b.id}>
              <div className="aic" style={{ background: 'rgba(255,69,69,.12)' }}>⏰</div>
              <div className="info"><b>{b.productName} — истекает срок годности</b><span>Осталось {d}{d === 1 ? ' день' : ' дн.'} · партия {b.id}</span></div>
              <div className="val" style={{ color: 'var(--red)' }}>{b.quantity} шт</div>
            </div>
          ))}
          {lowStockItems.slice(0, 5).map(p => (
            <div className="alert-row" key={p.id}>
              <div className="aic" style={{ background: 'rgba(255,184,0,.12)' }}>📉</div>
              <div className="info"><b>{p.name} — низкий остаток</b><span>Ниже минимального уровня ({p.minStock})</span></div>
              <div className="val" style={{ color: 'var(--gd)' }}>{activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locationsCount)}</div>
            </div>
          ))}
          {overLimitCards.slice(0, 5).map(c => (
            <div className="alert-row" key={c.num}>
              <div className="aic" style={{ background: 'rgba(255,69,69,.12)' }}>💳</div>
              <div className="info"><b>{c.client || c.num} — превышен лимит долга</b><span>Долг {money(c.debt)} ЅМ при лимите {money(c.debtLimit)} ЅМ</span></div>
              <div className="val" style={{ color: 'var(--red)' }}>+{money(c.debt - c.debtLimit)} ЅМ</div>
            </div>
          ))}
          {expiringBatches.length === 0 && lowStockItems.length === 0 && overLimitCards.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>Всё в порядке — нет активных алертов</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><b>🏆 Топ товаров</b></div>
        <div className="bar-list">
          {topProducts.map(([name, qty]) => (
            <div className="bar-row" key={name}>
              <div className="top"><b>{name}</b><span>{qty} шт</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round((qty / topMax) * 100)}%` }} /></div>
            </div>
          ))}
          {topProducts.length === 0 && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 16 }}>Продаж пока не было</div>}
        </div>
      </div>
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
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
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

  const closeAndReload = () => { setModal(null); onReloadProducts(); onReloadBatches() }

  return (
    <div>
      <div className="page-head">
        <h1>Склад</h1><div className="sub">Остатки, приход, списание, инвентаризация</div>
        <div className="page-actions">
          <button className="btn rbtn rbtn-ghost" onClick={() => setModal('income')}>📥 Приход</button>
          <button className="btn rbtn rbtn-ghost" onClick={() => setModal('writeoff')}>🗑 Списание</button>
          <button className="btn rbtn rbtn-ghost" onClick={() => setModal('transfer')}>🔀 Перемещение</button>
          <button className="btn rbtn rbtn-primary" onClick={() => setModal('inventory')}>📋 Инвентаризация</button>
        </div>
      </div>

      <div className="filters">
        <input className="inp" style={{ maxWidth: 260 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск товара или артикула…" />
        <select className="inp" style={{ maxWidth: 200 }} value={catFlt} onChange={e => setCatFlt(e.target.value)}>
          <option value="all">Все категории</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Артикул</th><th>Товар</th><th className="r">Остаток</th><th className="r">Мин.</th><th>Срок годности</th><th className="r">Закупка</th><th className="r">Продажа</th></tr></thead>
          <tbody>
            {filtered.map(p => {
              const stock = activeLocationId === 'all' ? p.stock : stockForLocation(p, activeLocationId, locations.length)
              const low = p.minStock != null && stock <= p.minStock
              const batch = batchFor(p.id)
              const days = batch ? daysUntil(batch.expiryDate) : null
              return (
                <tr key={p.id}>
                  <td className="mono" style={{ color: 'var(--t2)', fontSize: 11 }}>{p.art}</td>
                  <td style={{ fontWeight: 600 }}>{p.e} {p.name}</td>
                  <td style={{ textAlign: 'right' }}><span className="mono" style={{ fontSize: 14, color: low ? 'var(--org)' : 'var(--t1)' }}>{stock}</span></td>
                  <td style={{ textAlign: 'right', color: 'var(--t3)' }}>{p.minStock ?? '—'}</td>
                  <td>{days != null ? <span className={`badge ${expiryBadgeClass(days)}`}>{days < 0 ? 'просрочено' : `${days} дн.`}</span> : <span style={{ color: 'var(--t3)' }}>—</span>}</td>
                  <td style={{ textAlign: 'right' }}><span className="mono" style={{ fontSize: 13, color: 'var(--t2)' }}>{p.costPrice ? money(p.costPrice) : '—'}</span></td>
                  <td style={{ textAlign: 'right' }}><span className="price-cell">{money(p.price)}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 30 }}>Ничего не найдено</div>}
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
  return { lines, addLine, setLine, removeLine }
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

function LineRow({ p, qty, extra, extraPh, onQty, onExtra, onRemove }: {
  p?: Product; qty: string; extra?: string; extraPh?: string
  onQty: (v: string) => void; onExtra?: (v: string) => void; onRemove: () => void
}) {
  return (
    <div className="invrow" style={{ gridTemplateColumns: onExtra ? '1.5fr .7fr .8fr auto' : '2fr .8fr auto' }}>
      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.e} {p?.name}</div>
      <input className="inp" type="number" value={qty} onChange={e => onQty(e.target.value)} placeholder="Кол-во" style={{ padding: '6px 9px', fontSize: 12 }} />
      {onExtra && <input className="inp" type="number" value={extra} onChange={e => onExtra(e.target.value)} placeholder={extraPh} style={{ padding: '6px 9px', fontSize: 12 }} />}
      <button className="btn" onClick={onRemove} style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,69,69,.1)', color: 'var(--red)', fontSize: 11 }}>✕</button>
    </div>
  )
}

function IncomeModal({ products, locations, defaultLocationId, onClose, onDone }: {
  products: Product[]; locations: RetailLocation[]; defaultLocationId: string; onClose: () => void; onDone: () => void
}) {
  const { lines, addLine, setLine, removeLine } = useProductLines()
  const [locationId, setLocationId] = useState(defaultLocationId !== 'all' ? defaultLocationId : (locations[0]?.id || ''))
  const [supplierId, setSupplierId] = useState('')
  const [suppliers, setSuppliers] = useState<RetailSupplier[]>([])
  const [paidNow, setPaidNow] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { void api.getRetailSuppliers().then(setSuppliers).catch(() => {}) }, [])

  const submit = async () => {
    if (!locationId) { setErr('Выберите точку'); return }
    if (!lines.length) { setErr('Добавьте хотя бы один товар'); return }
    setBusy(true); setErr('')
    try {
      await api.stockIncome({
        locationId,
        supplierId: supplierId || undefined,
        paidNow: Number(paidNow) || 0,
        items: lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0, costPrice: Number(l.extra) || 0, expiryDate: expiryDate || null })),
        createdBy: 'retail',
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести приход')
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>📥 Приход товара (накладная)</h3>
        <div className="field-row">
          <div className="field">
            <label>Поставщик</label>
            <select className="inp" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Без поставщика</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <NI lbl="Срок годности партии" val={expiryDate} set={setExpiryDate} type="date" />
        </div>
        <div className="field">
          <label>Точка назначения</label>
          <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Выберите точку...</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Добавить товар</label>
          <ProductPicker products={products} onPick={addLine} />
        </div>
        <div style={{ marginBottom: 14 }}>
          {lines.map(l => (
            <LineRow key={l.productId} p={products.find(x => x.id === l.productId)} qty={l.qty} extra={l.extra} extraPh="Цена закупки"
              onQty={v => setLine(l.productId, { qty: v })} onExtra={v => setLine(l.productId, { extra: v })} onRemove={() => removeLine(l.productId)} />
          ))}
          {lines.length === 0 && <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {supplierId && <NI lbl="Оплачено сейчас (остальное — в долг поставщику)" val={paidNow} set={setPaidNow} ph="0" type="number" />}
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn btn-confirm" onClick={submit} disabled={busy || !lines.length}>{busy ? 'Проводим...' : 'Оприходовать'}</button>
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
  const [reason, setReason] = useState('Истёк срок годности')
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
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>🗑 Списание товара</h3>
        <div className="field">
          <label>Точка</label>
          <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Выберите точку...</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Товар</label>
            <ProductPicker products={products} onPick={addLine} />
          </div>
          <div className="field">
            <label>Причина</label>
            <select className="inp" value={reason} onChange={e => setReason(e.target.value)}>
              {['Истёк срок годности', 'Порча/бой', 'Пересорт', 'Другое'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          {lines.map(l => (
            <LineRow key={l.productId} p={products.find(x => x.id === l.productId)} qty={l.qty} onQty={v => setLine(l.productId, { qty: v })} onRemove={() => removeLine(l.productId)} />
          ))}
          {lines.length === 0 && <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn btn-confirm" style={{ background: 'var(--red)' }} onClick={submit} disabled={busy || !lines.length}>{busy ? 'Списываем...' : 'Списать'}</button>
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
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>🔀 Перемещение между точками</h3>
        <div className="field-row">
          <div className="field">
            <label>Откуда</label>
            <select className="inp" value={fromId} onChange={e => setFromId(e.target.value)}>
              <option value="">Точка-отправитель...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Куда</label>
            <select className="inp" value={toId} onChange={e => setToId(e.target.value)}>
              <option value="">Точка назначения...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Добавить товар</label>
          <ProductPicker products={products} onPick={addLine} />
        </div>
        <div style={{ marginBottom: 14 }}>
          {lines.map(l => (
            <LineRow key={l.productId} p={products.find(x => x.id === l.productId)} qty={l.qty} onQty={v => setLine(l.productId, { qty: v })} onRemove={() => removeLine(l.productId)} />
          ))}
          {lines.length === 0 && <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: 8 }}>Список пуст</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn btn-confirm" style={{ background: 'var(--blue)' }} onClick={submit} disabled={busy || !lines.length}>{busy ? 'Перемещаем...' : 'Переместить'}</button>
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
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h3>📋 Инвентаризация — пересчёт склада</h3>
        <div className="field-row">
          <div className="field">
            <label>Точка</label>
            <select className="inp" value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Выберите точку...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Поиск</label>
            <input className="inp" value={search} onChange={e => setSearch(e.target.value)} placeholder="Название/артикул..." />
          </div>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 14 }}>
          <div className="invrow" style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 800, borderBottom: '1.5px solid var(--border2)' }}>
            <span>ТОВАР</span><span style={{ textAlign: 'center' }}>ПО СИСТЕМЕ</span><span style={{ textAlign: 'center' }}>ФАКТ</span><span style={{ textAlign: 'center' }}>РАЗН.</span>
          </div>
          {filtered.map(p => {
            const systemStock = locationId ? stockForLocation(p, locationId, locations.length) : p.stock
            const val = counted[p.id]
            const diff = val !== undefined && val !== '' ? (Number(val) || 0) - systemStock : null
            return (
              <div className="invrow" key={p.id}>
                <span>{p.e} {p.name}</span>
                <span className="mono" style={{ textAlign: 'center' }}>{systemStock}</span>
                <input className="inp mono" type="number" value={val || ''} onChange={e => setCounted(c => ({ ...c, [p.id]: e.target.value }))} placeholder={String(systemStock)} style={{ textAlign: 'center', padding: '6px 8px', fontSize: 12 }} />
                <span className="mono" style={{ textAlign: 'center', color: diff == null || diff === 0 ? 'var(--t3)' : diff > 0 ? 'var(--gr)' : 'var(--red)' }}>{diff == null ? '' : diff > 0 ? `+${diff}` : diff}</span>
              </div>
            )
          })}
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Отмена</button>
          <button className="btn btn-confirm" style={{ background: 'var(--pur)' }} onClick={submit} disabled={busy || !touched.length}>{busy ? 'Применяем...' : `Подтвердить пересчёт (${touched.length})`}</button>
        </div>
      </div>
    </div>
  )
}

/* ══════════ КЛИЕНТЫ И ДОЛГИ ══════════ */
function ClientsDebtModule({ debtCards, clients, orders }: { debtCards: AdminCard[]; clients: ReturnType<typeof useClients>; orders: Order[] }) {
  const [filter, setFilter] = useState<'with_debt' | 'over_limit' | 'all'>('with_debt')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<AdminCard | null>(null)

  const stats = useMemo(() => ({
    totalDebt: debtCards.reduce((s, c) => s + c.debt, 0),
    withDebt: debtCards.filter(c => c.debt > 0).length,
    overLimit: debtCards.filter(c => c.debtLimit > 0 && c.debt > c.debtLimit).length,
  }), [debtCards])

  const filtered = useMemo(() => {
    let list = debtCards
    if (filter === 'with_debt') list = list.filter(c => c.debt > 0)
    if (filter === 'over_limit') list = list.filter(c => c.debtLimit > 0 && c.debt > c.debtLimit)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(c => c.num.toLowerCase().includes(q) || c.client.toLowerCase().includes(q) || c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
    return [...list].sort((a, b) => b.debt - a.debt)
  }, [debtCards, filter, search])

  return (
    <div>
      <div className="page-head">
        <h1>Клиенты и долги</h1><div className="sub">Дебиторская задолженность, кредитные лимиты</div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <button className="btn stat-card" style={{ textAlign: 'left', border: filter === 'with_debt' ? '2px solid #FF454555' : undefined }} onClick={() => setFilter('with_debt')}>
          <div className="l">Всего должны</div><div className="v mono" style={{ color: 'var(--org)' }}>{money(stats.totalDebt)}</div>
        </button>
        <button className="btn stat-card" style={{ textAlign: 'left' }} onClick={() => setFilter('with_debt')}>
          <div className="l">Клиентов с долгом</div><div className="v mono">{stats.withDebt}</div>
        </button>
        <button className="btn stat-card" style={{ textAlign: 'left', border: filter === 'over_limit' ? '2px solid #FF454555' : undefined }} onClick={() => setFilter('over_limit')}>
          <div className="l">Превышен лимит</div><div className="v mono" style={{ color: 'var(--red)' }}>{stats.overLimit}</div>
        </button>
      </div>

      <div className="filters">
        <input className="inp" style={{ maxWidth: 280 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Имя, телефон или карта..." />
        <button className={`btn rbtn ${filter === 'all' ? 'rbtn-primary' : 'rbtn-ghost'}`} onClick={() => setFilter('all')}>Все с разделом долга</button>
      </div>

      <div className="client-grid">
        {filtered.map(c => {
          const overLimit = c.debtLimit > 0 && c.debt > c.debtLimit
          const badge = overLimit ? { l: 'Лимит!', cls: 'danger' } : c.debt > 0 ? { l: 'ОК', cls: 'ok' } : { l: 'Нет долга', cls: 'muted' }
          const pct = c.debtLimit > 0 ? Math.min(100, (c.debt / c.debtLimit) * 100) : c.debt > 0 ? 100 : 0
          return (
            <div key={c.num} className="client-card" onClick={() => setDetail(c)}>
              <div className="client-top">
                <div className="client-av">{initials(c.client || c.num)}</div>
                <div className="ci"><b>{c.client || 'Без имени'}</b><span>{c.phone || c.num}</span></div>
                <span className={`badge ${badge.cls}`} style={{ marginLeft: 'auto' }}>{badge.l}</span>
              </div>
              <div className="debt-row"><span>Долг</span><b>{money(c.debt)} / {c.debtLimit ? money(c.debtLimit) : '∞'} ЅМ</b></div>
              <div className="debt-meter"><i style={{ width: `${pct}%`, background: overLimit ? 'var(--red)' : c.debt > 0 ? 'var(--gd)' : 'transparent' }} /></div>
            </div>
          )
        })}
        {filtered.length === 0 && <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--t3)', gridColumn: '1/-1' }}>Никого не найдено</div>}
      </div>

      {detail && <ClientDetailModal card={detail} clients={clients} orders={orders} onClose={() => setDetail(null)} />}
    </div>
  )
}

function ClientDetailModal({ card, clients, orders, onClose }: { card: AdminCard; clients: ReturnType<typeof useClients>; orders: Order[]; onClose: () => void }) {
  const [action, setAction] = useState<'add' | 'subtract'>('subtract')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeDebtHistory(() => setTick(t => t + 1)), [])
  const history = useMemo(() => card.phone ? loadDebtHistory(card.phone).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8) : [], [card.phone, tick])
  const creditOrders = useMemo(() => {
    if (!card.phone) return []
    return orders.filter(o => (o.payment_method === 'credit' || o.pay === 'credit') && phonesMatch(o.client?.phone || '', card.phone)).slice(0, 5)
  }, [card.phone, orders])

  const submit = async () => {
    const value = Math.max(0, parseFloat(amount) || 0)
    if (value <= 0) { setErr('Укажите сумму'); return }
    setBusy(true); setErr('')
    try {
      const client = findClientForCard(clients, card)
      const nextDebt = action === 'add' ? card.debt + value : Math.max(0, card.debt - value)
      const form = { ...cardLoyaltyFromCard(card, client), debt: nextDebt }
      await saveCardLoyalty(card, form, 'edit')
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <h3>👤 {card.client || card.num}</h3>
        <div className="field-row" style={{ marginBottom: 16 }}>
          <div className="stat-card" style={{ flex: 1, padding: 12 }}><div className="l" style={{ fontSize: 10 }}>Долг</div><div className="v mono" style={{ fontSize: 18, color: 'var(--org)' }}>{money(card.debt)}</div></div>
          <div className="stat-card" style={{ flex: 1, padding: 12 }}><div className="l" style={{ fontSize: 10 }}>Лимит</div><div className="v mono" style={{ fontSize: 18 }}>{card.debtLimit ? money(card.debtLimit) : '∞'}</div></div>
        </div>

        {history.length > 0 && (
          <>
            <label style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 700, marginBottom: 8, display: 'block' }}>История платежей</label>
            <table style={{ marginBottom: 14 }}>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px 4px', fontSize: 11.5 }}>{h.date || ''}</td>
                    <td style={{ padding: '8px 4px', fontSize: 11.5, color: 'var(--t2)' }}>{h.desc || (h.type === 'pay' ? 'Оплата долга' : 'Покупка в долг')}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: (h.amount || 0) < 0 ? 'var(--red)' : 'var(--gr)' }}>{(h.amount || 0) > 0 ? '+' : ''}{money(h.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {creditOrders.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14 }}>{creditOrders.length} покупок в долг связано с этим клиентом</div>
        )}

        <div className="field-row">
          <div className="field">
            <label>Действие</label>
            <select className="inp" value={action} onChange={e => setAction(e.target.value as 'add' | 'subtract')}>
              <option value="subtract">Внести оплату (уменьшить долг)</option>
              <option value="add">Начислить долг (увеличить)</option>
            </select>
          </div>
          <NI lbl="Сумма" val={amount} set={setAmount} ph="0.00" type="number" />
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Закрыть</button>
          <button className="btn btn-confirm" onClick={submit} disabled={busy}>{busy ? 'Сохраняем...' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  )
}

/* ══════════ ПОСТАВЩИКИ ══════════ */
function SuppliersModule({ suppliers, batches, onReload }: { suppliers: RetailSupplier[]; batches: StockBatch[]; onReload: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [payTarget, setPayTarget] = useState<RetailSupplier | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payBusy, setPayBusy] = useState(false)

  const addSupplier = async () => {
    if (!name.trim()) { setErr('Укажите название'); return }
    setBusy(true); setErr('')
    try {
      await api.createRetailSupplier({ name: name.trim(), category: category.trim(), phone: phone.trim() })
      setName(''); setCategory(''); setPhone(''); setShowAdd(false)
      onReload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось добавить поставщика')
    } finally { setBusy(false) }
  }

  const pay = async () => {
    if (!payTarget) return
    const amount = Number(payAmount) || 0
    if (amount <= 0) return
    setPayBusy(true)
    try {
      await api.payRetailSupplier(payTarget.id, { amount })
      setPayTarget(null); setPayAmount('')
      onReload()
    } finally { setPayBusy(false) }
  }

  const deliveriesCount = (supplierId: string) => batches.filter(b => b.supplierId === supplierId).length

  return (
    <div>
      <div className="page-head">
        <h1>Поставщики</h1><div className="sub">Кредиторская задолженность, история поставок</div>
        <div className="page-actions"><button className="btn rbtn rbtn-primary" onClick={() => setShowAdd(true)}>+ Новый поставщик</button></div>
      </div>

      {suppliers.map(s => (
        <div key={s.id} className="supplier-card">
          <div className="supplier-ic">🏭</div>
          <div className="supplier-info">
            <b>{s.name}</b>
            <span>{s.category || 'Без категории'} · {s.lastDeliveryAtIso ? `последняя поставка ${new Date(s.lastDeliveryAtIso).toLocaleDateString('ru-RU')}` : 'поставок пока не было'} · {deliveriesCount(s.id)} партий</span>
          </div>
          <div className="supplier-debt">
            <div className="l">Мы должны</div>
            <div className="v" style={{ color: s.payableAmount > 0 ? 'var(--org)' : 'var(--gr)' }}>{money(s.payableAmount)} ЅМ</div>
          </div>
          {s.payableAmount > 0 && (
            <button className="btn rbtn rbtn-ghost" onClick={() => { setPayTarget(s); setPayAmount('') }}>Погасить</button>
          )}
        </div>
      ))}
      {suppliers.length === 0 && <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>Поставщиков пока нет</div>}

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Новый поставщик</h3>
            <NI lbl="Название *" val={name} set={setName} ph="ОсОО «Яван-Овощпром»" />
            <div className="field-row">
              <NI lbl="Категория" val={category} set={setCategory} ph="Овощи и фрукты" />
              <NI lbl="Телефон" val={phone} set={setPhone} ph="+992 __ ___ __ __" />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setShowAdd(false)}>Отмена</button>
              <button className="btn btn-confirm" onClick={addSupplier} disabled={busy}>{busy ? 'Добавляем...' : 'Добавить'}</button>
            </div>
          </div>
        </div>
      )}

      {payTarget && (
        <div className="overlay" onClick={() => setPayTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Погасить долг — {payTarget.name}</h3>
            <NI lbl={`Сумма (текущий долг ${money(payTarget.payableAmount)} ЅМ)`} val={payAmount} set={setPayAmount} ph="0.00" type="number" />
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setPayTarget(null)}>Отмена</button>
              <button className="btn btn-confirm" onClick={pay} disabled={payBusy}>{payBusy ? 'Проводим...' : 'Погасить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════ ФИНАНСЫ / КАССОВАЯ КНИГА ══════════ */
function FinanceModule({ products, orders, expenses, onReload }: { products: Product[]; orders: Order[]; expenses: RetailExpense[]; onReload: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [category, setCategory] = useState('Аренда')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const delivered = useMemo(() => orders.filter(o => o.status === 'delivered'), [orders])

  const monthStr = new Date().toISOString().slice(0, 7)
  const monthOrders = delivered.filter(o => (o.deliveredAtIso || o.createdAt || '').slice(0, 7) === monthStr)
  const monthRevenue = monthOrders.reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const monthCost = monthOrders.reduce((s, o) => s + (o.items || []).reduce((si, it) => {
    const p = productById.get(Number(it.product_id ?? it.id))
    return si + (Number(p?.costPrice) || 0) * (Number(it.qty) || 0)
  }, 0), 0)
  const monthProfit = monthRevenue - monthCost
  const monthMargin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0

  const days = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>()
    for (const o of delivered) {
      const d = (o.deliveredAtIso || o.createdAt || '').slice(0, 10)
      if (!d) continue
      const row = map.get(d) || { income: 0, expense: 0 }
      row.income += Number(o.goodsTotal) || 0
      map.set(d, row)
    }
    for (const e of expenses) {
      const d = e.createdAtIso.slice(0, 10)
      const row = map.get(d) || { income: 0, expense: 0 }
      row.expense += e.amount
      map.set(d, row)
    }
    const sorted = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
    let balance = 0
    const withBalance = sorted.slice().reverse().map(([date, row]) => {
      balance += row.income - row.expense
      return { date, ...row, balance }
    })
    return withBalance.reverse()
  }, [delivered, expenses])

  const submit = async () => {
    const value = Number(amount)
    if (!value || value <= 0) { setErr('Укажите сумму'); return }
    setBusy(true); setErr('')
    try {
      await api.createRetailExpense({ category, amount: value, note: note.trim(), createdBy: 'retail' })
      setAmount(''); setNote(''); setShowAdd(false)
      onReload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось добавить расход')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Кассовая книга</h1><div className="sub">Движение денег, себестоимость, прибыль</div>
        <div className="page-actions"><button className="btn rbtn rbtn-primary" onClick={() => setShowAdd(true)}>💸 Новый расход</button></div>
      </div>

      <div className="stat-grid">
        <StatCard l="Выручка (месяц)" v={money(monthRevenue)} c="var(--gr)" />
        <StatCard l="Себестоимость" v={money(monthCost)} />
        <StatCard l="Прибыль" v={money(monthProfit)} c="var(--gd)" />
        <StatCard l="Наценка" v={`${monthMargin.toFixed(1)}%`} c="var(--blue)" />
      </div>

      <div className="panel">
        <div className="panel-head"><b>Кассовая книга — последние дни</b></div>
        <table>
          <thead><tr><th>Дата</th><th className="r">Приход</th><th className="r">Расход</th><th className="r">Остаток на конец дня</th></tr></thead>
          <tbody>
            {days.map(d => (
              <tr key={d.date}>
                <td>{new Date(d.date).toLocaleDateString('ru-RU')}</td>
                <td style={{ textAlign: 'right' }}><span className="mono" style={{ color: 'var(--gr)' }}>+{money(d.income)}</span></td>
                <td style={{ textAlign: 'right' }}><span className="mono" style={{ color: 'var(--red)' }}>−{money(d.expense)}</span></td>
                <td style={{ textAlign: 'right' }}><span className="price-cell">{money(d.balance)}</span></td>
              </tr>
            ))}
            {days.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Данных пока нет</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-head"><b>Последние расходы</b></div>
        <div className="alert-list" style={{ border: 'none', borderRadius: 0, margin: 0 }}>
          {expenses.slice().reverse().slice(0, 10).map(e => (
            <div className="alert-row" key={e.id}>
              <div className="aic" style={{ background: 'rgba(255,69,69,.12)' }}>💸</div>
              <div className="info"><b>{e.category}</b><span>{new Date(e.createdAtIso).toLocaleString('ru-RU')}{e.note ? ` · ${e.note}` : ''}</span></div>
              <div className="val" style={{ color: 'var(--red)' }}>−{money(e.amount)} ЅМ</div>
            </div>
          ))}
          {expenses.length === 0 && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Расходов пока не было</div>}
        </div>
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>💸 Новый расход</h3>
            <div className="field">
              <label>Категория</label>
              <select className="inp" value={category} onChange={e => setCategory(e.target.value)}>
                {['Аренда', 'Зарплата', 'Коммунальные', 'Транспорт', 'Другое'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <NI lbl="Сумма" val={amount} set={setAmount} ph="0.00" type="number" />
            <NI lbl="Заметка" val={note} set={setNote} ph="Необязательно" />
            {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setShowAdd(false)}>Отмена</button>
              <button className="btn btn-confirm" onClick={submit} disabled={busy}>{busy ? 'Сохраняем...' : 'Добавить расход'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════ ЦЕНЫ ══════════ */
function PricesModule({ products, onReload }: { products: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [catId, setCatId] = useState('all')
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cats = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products) if (p.catId) map.set(p.catId, p.cat || p.catId)
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [products])

  const filtered = products.filter(p => !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()))

  const submit = async () => {
    const v = Number(value)
    if (!v) { setErr('Укажите значение изменения'); return }
    setBusy(true); setErr('')
    try {
      await api.bulkPriceChange({ catId, mode, value: v })
      setShowBulk(false); setValue('')
      onReload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось изменить цены')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Цены</h1><div className="sub">Типы цен, массовое изменение</div>
        <div className="page-actions"><button className="btn rbtn rbtn-primary" onClick={() => setShowBulk(true)}>📊 Массовое изменение</button></div>
      </div>

      <div className="filters">
        <input className="inp" style={{ maxWidth: 280 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Поиск товара..." />
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Товар</th><th className="r">Закупка</th><th className="r">Розница</th><th className="r">Опт</th><th className="r">VIP</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.e} {p.name}</td>
                <td style={{ textAlign: 'right' }}><span className="mono" style={{ color: 'var(--t2)' }}>{p.costPrice ? money(p.costPrice) : '—'}</span></td>
                <td style={{ textAlign: 'right' }}><span className="price-cell">{money(p.price)}</span></td>
                <td style={{ textAlign: 'right' }}><span className="mono">{p.bulkPricing?.[0]?.price ? money(p.bulkPricing[0].price) : '—'}</span></td>
                <td style={{ textAlign: 'right' }}><span className="mono">{p.vipPrice ? money(p.vipPrice) : '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 30 }}>Ничего не найдено</div>}
      </div>

      {showBulk && (
        <div className="overlay" onClick={() => setShowBulk(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>📊 Массовое изменение цен</h3>
            <div className="field">
              <label>Применить к</label>
              <select className="inp" value={catId} onChange={e => setCatId(e.target.value)}>
                <option value="all">Всем товарам</option>
                {cats.map(c => <option key={c.id} value={c.id}>Категория: {c.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Изменить на</label>
                <select className="inp" value={mode} onChange={e => setMode(e.target.value as 'percent' | 'fixed')}>
                  <option value="percent">Процент (%)</option>
                  <option value="fixed">Фиксированная сумма</option>
                </select>
              </div>
              <NI lbl="Значение" val={value} set={setValue} ph={mode === 'percent' ? '+5' : '+0.50'} type="number" />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setShowBulk(false)}>Отмена</button>
              <button className="btn btn-confirm" onClick={submit} disabled={busy}>{busy ? 'Применяем...' : 'Применить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════ ОТЧЁТЫ ══════════ */
function ReportsModule({ products, orders }: { products: Product[]; orders: Order[] }) {
  const delivered = useMemo(() => orders.filter(o => o.status === 'delivered'), [orders])

  const weekRevenue = (weeksAgo: number) => {
    const now = new Date()
    const start = new Date(now); start.setDate(now.getDate() - now.getDay() - weeksAgo * 7)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(start.getDate() + 7)
    return delivered
      .filter(o => {
        const t = new Date(o.deliveredAtIso || o.createdAt || 0).getTime()
        return t >= start.getTime() && t < end.getTime()
      })
      .reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  }
  const thisWeek = weekRevenue(0)
  const lastWeek = weekRevenue(1)

  const abc = useMemo(() => {
    const revenueByProduct = new Map<string, number>()
    for (const o of delivered) {
      for (const it of o.items || []) {
        const key = `${it.e || ''} ${it.name}`
        revenueByProduct.set(key, (revenueByProduct.get(key) || 0) + (Number(it.price) || 0) * (Number(it.qty) || 0))
      }
    }
    const total = Array.from(revenueByProduct.values()).reduce((s, v) => s + v, 0)
    const sorted = Array.from(revenueByProduct.entries()).sort((a, b) => b[1] - a[1])
    let cum = 0
    return sorted.map(([name, revenue]) => {
      cum += revenue
      const share = total > 0 ? (revenue / total) * 100 : 0
      const cumShare = total > 0 ? (cum / total) * 100 : 0
      const group: 'A' | 'B' | 'C' = cumShare <= 80 ? 'A' : cumShare <= 95 ? 'B' : 'C'
      return { name, revenue, share, group }
    })
  }, [delivered])

  return (
    <div>
      <div className="page-head"><h1>Отчёты</h1><div className="sub">Продажи, ABC-анализ, сравнение периодов</div></div>

      <div className="compare-grid" style={{ marginBottom: 20 }}>
        <div className="compare-card"><div className="l">Эта неделя</div><div className="v mono" style={{ color: 'var(--gr)' }}>{money(thisWeek)} ЅМ</div></div>
        <div className="compare-card"><div className="l">Прошлая неделя</div><div className="v mono">{money(lastWeek)} ЅМ</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><b>📊 Продажи по точкам / сотрудникам</b></div>
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>
          Появится, когда продажи будут привязаны к точкам и сотрудникам (следующий этап)
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><b>ABC-анализ товаров</b></div>
        <table>
          <thead><tr><th>Товар</th><th>Группа</th><th className="r">Доля выручки</th></tr></thead>
          <tbody>
            {abc.slice(0, 15).map(row => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td><span className={`badge ${row.group === 'A' ? 'ok' : row.group === 'B' ? 'warn' : 'muted'}`}>{row.group} — {row.group === 'A' ? 'важный' : row.group === 'B' ? 'средний' : 'редкий'}</span></td>
                <td style={{ textAlign: 'right' }}>{row.share.toFixed(1)}%</td>
              </tr>
            ))}
            {abc.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Продаж пока не было</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════ СОТРУДНИКИ ══════════ */
function EmployeesModule({ couriers, assemblers }: { couriers: ReturnType<typeof useCourierTeam>; assemblers: ReturnType<typeof useAssemblerTeam> }) {
  return (
    <div>
      <div className="page-head"><h1>Сотрудники</h1><div className="sub">Курьеры и сборщики · реальные KPI из их приложений</div></div>

      <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: 'var(--t2)', marginBottom: 10 }}>🛵 КУРЬЕРЫ</div>
      <div className="emp-grid" style={{ marginBottom: 24 }}>
        {couriers.map(c => (
          <div key={c.id} className="emp-card">
            <div className="emp-av">{initials(c.name)}</div>
            <b>{c.name}</b>
            <span className={`badge ${c.blocked ? 'danger' : 'info'}`}>{c.blocked ? 'Заблокирован' : 'Курьер'}</span>
            <div className="emp-kpi">
              <div><div className="v">{c.today}</div><div className="l">заказов сегодня</div></div>
              <div><div className="v">{c.rating.toFixed(1)}</div><div className="l">рейтинг</div></div>
            </div>
          </div>
        ))}
        {couriers.length === 0 && <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', gridColumn: '1/-1' }}>Курьеров пока нет</div>}
      </div>

      <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: 'var(--t2)', marginBottom: 10 }}>📦 СБОРЩИКИ</div>
      <div className="emp-grid">
        {assemblers.map(a => (
          <div key={a.id} className="emp-card">
            <div className="emp-av" style={{ background: 'linear-gradient(135deg,#6B3FBF,var(--pur))' }}>{initials(a.name)}</div>
            <b>{a.name}</b>
            <span className={`badge ${a.blocked ? 'danger' : 'info'}`}>{a.blocked ? 'Заблокирован' : 'Сборщик'}</span>
            <div className="emp-kpi">
              <div><div className="v">{a.ordersToday}</div><div className="l">заказов сегодня</div></div>
              <div><div className="v">{a.rating.toFixed(1)}</div><div className="l">рейтинг</div></div>
            </div>
          </div>
        ))}
        {assemblers.length === 0 && <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', gridColumn: '1/-1' }}>Сборщиков пока нет</div>}
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 18, lineHeight: 1.6 }}>
        Кассиры и права доступа по ролям появятся на следующем этапе (управление правами).
      </div>
    </div>
  )
}
