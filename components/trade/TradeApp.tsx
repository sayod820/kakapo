'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApiSync } from '@/lib/useApiSync'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { useProducts } from '@/lib/store'
import ProductsModule from '@/components/trade/ProductsModule'
import WarehouseModule from '@/components/trade/WarehouseModule'
import CashierModule from '@/components/trade/CashierModule'
import ComingSoonModule from '@/components/trade/ComingSoonModule'

/* ══════════════════════════════════════════════════════════════
   6-е приложение KAKAPO — «Торговля»
   POS / Касса — один из разделов внутри, не название приложения.
══════════════════════════════════════════════════════════════ */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap');
  .k-trade *{box-sizing:border-box}
  .k-trade{
    --bg:#070C09; --panel:#0B120E; --card:#101A13; --card2:#0D1610; --border:#1C2A21;
    --text:#E8F3EB; --muted:#7E9A86; --muted2:#5E7A67;
    --green:#1FD760; --green-d:#12351E; --blue:#3B8EF0; --purple:#9B6DFF; --red:#FF5A5A; --gold:#FFB800;
    display:flex;min-height:100vh;background:var(--bg);color:var(--text);
    font-family:'Nunito',system-ui,-apple-system,sans-serif;font-size:14px;
  }
  .k-trade button{font-family:inherit}
  .k-trade ::-webkit-scrollbar{width:8px;height:8px}
  .k-trade ::-webkit-scrollbar-thumb{background:#1e2f24;border-radius:8px}

  .k-side{width:236px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .k-logo{display:flex;align-items:center;gap:10px;padding:18px 18px 6px;font-weight:900;font-size:17px;line-height:1.2}
  .k-logo .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 6px 16px rgba(31,215,96,.28);flex-shrink:0}
  .k-logo-sub{padding:0 18px 12px;font-size:11px;color:var(--muted);line-height:1.35}
  .k-nav{flex:1;overflow-y:auto;padding:6px 12px 12px}
  .k-navitem{display:flex;align-items:center;gap:12px;width:100%;border:none;background:transparent;color:var(--muted);cursor:pointer;padding:11px 12px;border-radius:12px;font-size:14px;font-weight:700;text-align:left;margin-bottom:2px;transition:background .12s,color .12s}
  .k-navitem .ic{font-size:17px;width:22px;text-align:center;flex-shrink:0}
  .k-navitem .tag{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:#1a1a1a;color:var(--muted)}
  .k-navitem:hover{background:#111d15;color:var(--text)}
  .k-navitem.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;box-shadow:0 8px 20px rgba(31,215,96,.25)}
  .k-navitem.active .tag{background:rgba(5,33,13,.2);color:#05210D}
  .k-side-foot{padding:12px;border-top:1px solid var(--border)}
  .k-store{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}
  .k-store .name{font-weight:800}
  .k-online{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--green);font-weight:700;margin-top:4px}
  .k-online .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(31,215,96,.18)}
  .k-clock{margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
  .k-clock .date{font-size:12px;color:var(--muted)}
  .k-clock .time{font-size:26px;font-weight:900;line-height:1.1}
  .k-clock .day{font-size:12px;color:var(--muted)}

  .k-main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .k-top{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--panel)}
  .k-search{flex:1;position:relative;max-width:640px}
  .k-search input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;color:var(--text);padding:11px 14px 11px 42px;font-size:14px;outline:none}
  .k-search input:focus{border-color:var(--green)}
  .k-search .mag{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted)}
  .k-bell{position:relative;width:42px;height:42px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:17px}
  .k-bell .badge{position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 6px}
  .k-user{display:flex;align-items:center;gap:10px;padding:5px 6px 5px 5px;border:1px solid var(--border);background:var(--card);border-radius:14px}
  .k-user .av{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D;display:flex;align-items:center;justify-content:center;font-weight:900}
  .k-user .who b{display:block;font-size:13px;line-height:1.1}
  .k-user .who span{font-size:11px;color:var(--muted)}
  .k-body{flex:1;min-height:0;overflow:auto;padding:18px 20px}

  .k-page-h{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap}
  .k-page-h h1{font-size:22px;font-weight:900;margin:0}
  .k-page-h .sub{color:var(--muted);font-size:13px;margin-top:4px;max-width:560px;line-height:1.45}
  .k-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
  .k-kpi{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px}
  .k-kpi .kl{font-size:12px;color:var(--muted);font-weight:700}
  .k-kpi .kv{font-size:24px;font-weight:900;margin-top:6px}
  .k-statcard{text-align:left;transition:border-color .12s,background .12s}
  .k-card{background:var(--card);border:1px solid var(--border);border-radius:16px}
  .k-card-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}
  .k-card-h b{font-size:16px;font-weight:900}
  .k-card-b{padding:16px}
  .k-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .k-field{margin-bottom:12px}
  .k-field label{display:block;font-size:12px;color:var(--muted);font-weight:700;margin-bottom:5px}
  .k-inp,.k-sel,.k-ta{width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:9px 11px;font-size:14px;outline:none}
  .k-inp:focus,.k-sel:focus,.k-ta:focus{border-color:var(--green)}
  .k-ta{min-height:70px;resize:vertical}
  .k-btn{border:none;border-radius:10px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer}
  .k-btn-g{background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D}
  .k-btn-s{background:var(--card2);border:1px solid var(--border);color:var(--text)}
  .k-btn-s:hover{border-color:var(--green)}
  .k-tbl{width:100%;border-collapse:collapse}
  .k-tbl th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:9px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1}
  .k-tbl td{padding:9px 10px;border-bottom:1px solid #16241b;font-size:13px}
  .k-tbl tbody tr.k-prodrow{cursor:pointer}
  .k-tbl tbody tr:hover{background:#0e1712}
  .k-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .k-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800}
  .k-empty{padding:34px;text-align:center;color:var(--muted2)}
  .k-alert{padding:10px 14px;border-radius:10px;font-size:13px;background:var(--green-d);color:var(--green);border:1px solid #1f5a33}
  .k-cats{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .k-cat{flex-shrink:0;border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:14px;padding:10px 14px;font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:78px;transition:.12s}
  .k-cat .ce{font-size:18px}
  .k-cat:hover{color:var(--text);border-color:#2a4032}
  .k-cat.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;border-color:transparent}
  .k-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px}
  .k-modal{width:460px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--border);border-radius:18px;display:flex;flex-direction:column;overflow:hidden}
  .k-modal-wide{width:640px}
  .k-modal-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .k-modal-h b{font-size:16px;font-weight:900}
  .k-modal-h button{border:none;background:transparent;color:var(--muted);font-size:20px;cursor:pointer}
  .k-modal-b{overflow:auto}
  .k-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .k-subtab{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:9px 16px;font-weight:800;font-size:13px;cursor:pointer}
  .k-subtab:hover{color:var(--text);border-color:#2a4032}
  .k-subtab.active{background:var(--green-d);border-color:var(--green);color:var(--green)}
  .k-product-layout{display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start}
  .k-product-list{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;position:sticky;top:0}
  .k-product-list-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px}
  .k-product-list-body{max-height:62vh;overflow:auto;padding:8px}
  .k-product-pick{display:flex;align-items:center;gap:10px;width:100%;border:1px solid transparent;background:transparent;color:var(--text);border-radius:10px;padding:9px 10px;cursor:pointer;text-align:left;margin-bottom:4px}
  .k-product-pick:hover{background:#0e1712;border-color:var(--border)}
  .k-product-pick.active{background:var(--green-d);border-color:var(--green)}
  .k-product-pick .pe{font-size:18px;width:24px;text-align:center}
  .k-product-pick .pi{flex:1;min-width:0}
  .k-product-pick .pi b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-product-pick .pi span{font-size:11px;color:var(--muted)}
  .k-product-form{min-height:400px}
  @media (max-width:900px){.k-grid2{grid-template-columns:1fr}.k-product-layout{grid-template-columns:1fr}}
`

type TradePage =
  | 'sales' | 'products' | 'clients' | 'debts'
  | 'warehouse' | 'suppliers' | 'finance' | 'reports'

type NavItem = {
  id: TradePage
  label: string
  icon: string
  tag?: string
}

const NAV: NavItem[] = [
  { id: 'sales', label: 'Касса', icon: '🛒', tag: 'скоро' },
  { id: 'products', label: 'Товары', icon: '📦' },
  { id: 'clients', label: 'Клиенты', icon: '👥', tag: 'скоро' },
  { id: 'debts', label: 'Долги', icon: '💳', tag: 'скоро' },
  { id: 'warehouse', label: 'Склад', icon: '🏬' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚', tag: 'скоро' },
  { id: 'finance', label: 'Финансы', icon: '💰', tag: 'скоро' },
  { id: 'reports', label: 'Отчёты', icon: '📊', tag: 'скоро' },
]

const SOON_PAGES: Record<string, { title: string; icon: string; desc: string }> = {
  clients: { icon: '👥', title: 'Клиенты', desc: 'Список клиентов магазина. Данные общие с магазином и админкой.' },
  debts: { icon: '💳', title: 'Долги', desc: 'Клиентские долги и продажи в кредит.' },
  suppliers: { icon: '🚚', title: 'Поставщики', desc: 'Поставщики, приходы и оплаты.' },
  finance: { icon: '💰', title: 'Финансы', desc: 'Выручка, расходы и движение денег.' },
  reports: { icon: '📊', title: 'Отчёты', desc: 'Сводные отчёты по продажам и складу.' },
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return <div className="k-clock"><div className="time">--:--</div></div>
  return (
    <div className="k-clock">
      <div className="date">{now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div className="time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="day" style={{ textTransform: 'capitalize' }}>{now.toLocaleDateString('ru-RU', { weekday: 'long' })}</div>
    </div>
  )
}

function TradeAppInner() {
  useApiSync('pos')
  const { page, setPage } = useAppNavigation('products')
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const [search, setSearch] = useState('')

  useEffect(() => {
    void useProducts.getState().fetchProducts()
  }, [])

  const current = (NAV.some(p => p.id === page) ? page : 'products') as TradePage
  const lowStock = useMemo(() => products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 5).length, [products])
  const showSearch = current === 'products' || current === 'sales'

  function renderPage() {
    if (!loaded && current === 'products') return <div className="k-empty">Загрузка товаров…</div>
    if (current === 'products') return <ProductsModule search={search} />
    if (current === 'warehouse') return <WarehouseModule products={products} />
    if (current === 'sales') return <CashierModule />
    const soon = SOON_PAGES[current]
    if (soon) return <ComingSoonModule icon={soon.icon} title={soon.title} description={soon.desc} />
    return <ProductsModule search={search} />
  }

  return (
    <div className="k-trade">
      <style>{CSS}</style>

      <aside className="k-side">
        <div className="k-logo">
          <span className="mark">🦜</span>
          <span>Торговля</span>
        </div>
        <div className="k-logo-sub">6-е приложение KAKAPO · касса, склад, товары</div>
        <nav className="k-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              type="button"
              className={`k-navitem ${current === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="ic">{item.icon}</span>
              {item.label}
              {item.tag && <span className="tag">{item.tag}</span>}
            </button>
          ))}
        </nav>
        <div className="k-side-foot">
          <div className="k-store">
            <div className="name">Магазин KAKAPO</div>
            <div className="k-online"><span className="d" />Онлайн</div>
            <Clock />
          </div>
        </div>
      </aside>

      <div className="k-main">
        <header className="k-top">
          {showSearch ? (
            <div className="k-search">
              <span className="mag">🔍</span>
              <input
                placeholder="Поиск по названию, артикулу, штрихкоду…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          ) : (
            <div style={{ flex: 1, fontWeight: 800, color: 'var(--muted)' }}>
              {NAV.find(n => n.id === current)?.label}
            </div>
          )}
          <button type="button" className="k-bell" title="Товары с низким остатком">
            🔔<span className="badge">{lowStock}</span>
          </button>
          <div className="k-user">
            <div className="av">K</div>
            <div className="who"><b>Сотрудник</b><span>Торговля</span></div>
          </div>
        </header>

        <div className="k-body">{renderPage()}</div>
      </div>
    </div>
  )
}

export default function TradeApp() {
  return (
    <AppNavigationBoundary>
      <TradeAppInner />
    </AppNavigationBoundary>
  )
}
