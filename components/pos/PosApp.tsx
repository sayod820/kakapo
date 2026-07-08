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
import { CLIENT_LEVEL_COLORS, type AdminClient, type ClientLevel } from '@/lib/clientCrm'
import type { AdminCard } from '@/lib/cardCrm'

/* ══════════════════════════════════════════════════════════════
   KAKAPO POS — единое приложение (касса, склад, клиенты, финансы)
   Тёмная фирменная тема + боковое меню, сетка товаров и чек.
══════════════════════════════════════════════════════════════ */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap');
  .k-pos *{box-sizing:border-box}
  .k-pos{
    --bg:#070C09; --panel:#0B120E; --card:#101A13; --card2:#0D1610; --border:#1C2A21;
    --text:#E8F3EB; --muted:#7E9A86; --muted2:#5E7A67;
    --green:#1FD760; --green-d:#12351E; --blue:#3B8EF0; --purple:#9B6DFF; --red:#FF5A5A; --gold:#FFB800;
    display:flex;min-height:100vh;background:var(--bg);color:var(--text);
    font-family:'Nunito',system-ui,-apple-system,sans-serif;font-size:14px;
  }
  .k-pos button{font-family:inherit}
  .k-pos::-webkit-scrollbar,.k-scroll::-webkit-scrollbar{width:8px;height:8px}
  .k-pos ::-webkit-scrollbar-thumb{background:#1e2f24;border-radius:8px}

  /* ─ Sidebar ─ */
  .k-side{width:236px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .k-logo{display:flex;align-items:center;gap:10px;padding:18px 18px 14px;font-weight:900;font-size:18px}
  .k-logo .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 6px 16px rgba(31,215,96,.28)}
  .k-nav{flex:1;overflow-y:auto;padding:6px 12px 12px}
  .k-navitem{display:flex;align-items:center;gap:12px;width:100%;border:none;background:transparent;color:var(--muted);cursor:pointer;padding:11px 12px;border-radius:12px;font-size:14px;font-weight:700;text-align:left;margin-bottom:2px;transition:background .12s,color .12s}
  .k-navitem .ic{font-size:17px;width:22px;text-align:center}
  .k-navitem:hover{background:#111d15;color:var(--text)}
  .k-navitem.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;box-shadow:0 8px 20px rgba(31,215,96,.25)}
  .k-navitem.active .ic{filter:none}
  .k-side-foot{padding:12px;border-top:1px solid var(--border)}
  .k-store{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}
  .k-store .name{font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:8px}
  .k-online{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--green);font-weight:700;margin-top:4px}
  .k-online .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(31,215,96,.18)}
  .k-clock{margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
  .k-clock .date{font-size:12px;color:var(--muted)}
  .k-clock .time{font-size:26px;font-weight:900;line-height:1.1}
  .k-clock .day{font-size:12px;color:var(--muted)}
  .k-changebtn{width:100%;margin-top:10px;border:1px solid var(--border);background:#111d15;color:var(--text);border-radius:10px;padding:9px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
  .k-changebtn:hover{background:#16261b}

  /* ─ Main ─ */
  .k-main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .k-top{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--panel)}
  .k-search{flex:1;position:relative;max-width:640px}
  .k-search input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;color:var(--text);padding:11px 14px 11px 42px;font-size:14px;outline:none}
  .k-search input:focus{border-color:var(--green)}
  .k-search .mag{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted)}
  .k-scan{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:12px;padding:11px 14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px}
  .k-scan:hover{border-color:var(--green)}
  .k-bell{position:relative;width:42px;height:42px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:17px}
  .k-bell .badge{position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 6px}
  .k-user{display:flex;align-items:center;gap:10px;padding:5px 6px 5px 5px;border:1px solid var(--border);background:var(--card);border-radius:14px}
  .k-user .av{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D;display:flex;align-items:center;justify-content:center;font-weight:900}
  .k-user .who b{display:block;font-size:13px;line-height:1.1}
  .k-user .who span{font-size:11px;color:var(--muted)}

  .k-body{flex:1;min-height:0;overflow:auto;padding:18px 20px}

  /* ─ Cashier POS layout ─ */
  .k-cashier{display:flex;gap:16px;height:100%;min-height:0}
  .k-catalog{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
  .k-cats{display:flex;gap:8px;overflow-x:auto;padding-bottom:12px}
  .k-cat{flex-shrink:0;border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:14px;padding:10px 14px;font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:78px;transition:.12s}
  .k-cat .ce{font-size:18px}
  .k-cat:hover{color:var(--text);border-color:#2a4032}
  .k-cat.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;border-color:transparent}
  .k-grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;align-content:start;padding-right:4px}
  .k-prod{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:10px;cursor:pointer;text-align:left;transition:.12s;display:flex;flex-direction:column}
  .k-prod:hover{border-color:var(--green);transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.35)}
  .k-prod:disabled{opacity:.45;cursor:not-allowed}
  .k-prod .ph{height:92px;border-radius:12px;background:#0A130D;display:flex;align-items:center;justify-content:center;font-size:40px;overflow:hidden;margin-bottom:8px;position:relative}
  .k-prod .ph img{width:100%;height:100%;object-fit:cover}
  .k-prod .unitb{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px}
  .k-prod .nm{font-weight:700;font-size:13px;line-height:1.25;min-height:32px}
  .k-prod .pr{color:var(--green);font-weight:900;margin-top:4px}
  .k-prod .st{font-size:11px;color:var(--muted);margin-top:2px}
  .k-prod .st.low{color:var(--gold)}
  .k-prod .st.out{color:var(--red)}

  /* ─ Cart ─ */
  .k-cart{width:372px;flex-shrink:0;background:var(--panel);border:1px solid var(--border);border-radius:18px;display:flex;flex-direction:column;overflow:hidden}
  .k-cust{padding:14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;cursor:pointer}
  .k-cust:hover{background:#0e1712}
  .k-cust .cav{width:40px;height:40px;border-radius:12px;background:#12201a;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .k-cust .ci{flex:1;min-width:0}
  .k-cust .ci b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-cust .ci span{font-size:12px;color:var(--muted)}
  .k-lvl{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap}
  .k-cust .bon{text-align:right;font-size:11px;color:var(--muted)}
  .k-cust .bon b{display:block;color:var(--gold);font-size:14px}
  .k-items{flex:1;overflow:auto;padding:8px 12px}
  .k-line{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #16241b}
  .k-line .lav{width:30px;height:30px;border-radius:8px;background:#0e1712;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
  .k-line .li{flex:1;min-width:0}
  .k-line .li b{font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-line .li span{font-size:11px;color:var(--muted)}
  .k-qty{display:flex;align-items:center;gap:6px}
  .k-qty button{width:24px;height:24px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-weight:900;font-size:14px;line-height:1}
  .k-qty button:hover{border-color:var(--green)}
  .k-qty .qv{min-width:26px;text-align:center;font-weight:800;font-size:13px}
  .k-line .lt{width:66px;text-align:right;font-weight:800;font-size:13px}
  .k-line .rm{border:none;background:transparent;color:var(--muted2);cursor:pointer;font-size:15px}
  .k-line .rm:hover{color:var(--red)}
  .k-emptycart{padding:40px 16px;text-align:center;color:var(--muted2)}

  .k-sum{padding:12px 14px;border-top:1px solid var(--border)}
  .k-sumrow{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--muted)}
  .k-sumrow.disc{color:var(--red)}
  .k-sumrow.total{border-top:1px solid var(--border);margin-top:6px;padding-top:10px;color:var(--text);font-size:16px;font-weight:900}
  .k-sumrow.total b{color:var(--green);font-size:20px}

  .k-acts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 14px 8px}
  .k-act{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:12px;padding:9px 6px;font-weight:800;font-size:12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
  .k-act .ai{font-size:15px}
  .k-act:hover{border-color:var(--green)}
  .k-act.warn{border-color:#3a1f1f;color:#ffbdbd}
  .k-act.warn:hover{border-color:var(--red)}
  .k-act.act{background:var(--green-d);border-color:var(--green);color:var(--green)}

  .k-pays{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 14px 8px}
  .k-pay{border:none;border-radius:12px;padding:12px 6px;font-weight:800;font-size:13px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;color:#fff}
  .k-pay .pi{font-size:17px}
  .k-pay.cash{background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D}
  .k-pay.card{background:linear-gradient(135deg,#3B8EF0,#2f6fd0)}
  .k-pay.qr{background:linear-gradient(135deg,#9B6DFF,#7d4fe0)}
  .k-pay.selected{outline:3px solid rgba(255,255,255,.35);outline-offset:2px}
  .k-checkout{margin:0 14px 14px;border:none;border-radius:14px;padding:15px;font-size:16px;font-weight:900;cursor:pointer;background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D}
  .k-checkout:disabled{opacity:.5;cursor:not-allowed}

  /* ─ Generic modules ─ */
  .k-page-h{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap}
  .k-page-h h1{font-size:22px;font-weight:900;margin:0}
  .k-page-h .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .k-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
  .k-kpi{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px}
  .k-kpi .kl{font-size:12px;color:var(--muted);font-weight:700}
  .k-kpi .kv{font-size:24px;font-weight:900;margin-top:6px}
  .k-card{background:var(--card);border:1px solid var(--border);border-radius:16px}
  .k-card-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}
  .k-card-h b{font-size:16px;font-weight:900}
  .k-card-b{padding:16px}
  .k-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .k-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
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
  .k-tbl th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:9px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card)}
  .k-tbl td{padding:9px 10px;border-bottom:1px solid #16241b;font-size:13px}
  .k-tbl tbody tr:hover{background:#0e1712}
  .k-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .k-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800}
  .k-empty{padding:34px;text-align:center;color:var(--muted2)}
  .k-alert{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;background:var(--green-d);color:var(--green);border:1px solid #1f5a33}
  .k-alert.err{background:#2a1414;color:#ffb3b3;border-color:#5a1f1f}
  .k-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .k-subtab{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}
  .k-subtab.active{background:var(--green-d);border-color:var(--green);color:var(--green)}

  /* ─ Modal ─ */
  .k-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px}
  .k-modal{width:460px;max-width:100%;max-height:82vh;background:var(--panel);border:1px solid var(--border);border-radius:18px;display:flex;flex-direction:column;overflow:hidden}
  .k-modal-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .k-modal-h b{font-size:16px;font-weight:900}
  .k-modal-h button{border:none;background:transparent;color:var(--muted);font-size:20px;cursor:pointer}
  .k-modal-b{overflow:auto;padding:12px}
  .k-pick{display:flex;align-items:center;gap:12px;padding:11px;border-radius:12px;cursor:pointer;border:1px solid transparent}
  .k-pick:hover{background:#0e1712;border-color:var(--border)}
  .k-pick .pav{width:36px;height:36px;border-radius:10px;background:#12201a;display:flex;align-items:center;justify-content:center;font-weight:800}
  .k-pick .pi{flex:1;min-width:0}
  .k-pick .pi b{display:block;font-size:14px}
  .k-pick .pi span{font-size:12px;color:var(--muted)}

  @media (max-width:1100px){
    .k-cashier{flex-direction:column;height:auto}
    .k-cart{width:100%}
    .k-kpis{grid-template-columns:repeat(2,1fr)}
    .k-grid2,.k-grid3{grid-template-columns:1fr}
  }
  @media (max-width:760px){
    .k-side{position:fixed;z-index:50;transform:translateX(-100%);transition:.2s}
    .k-side.open{transform:none}
  }
`

const LEVEL_LABELS: Record<ClientLevel, string> = {
  basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина',
}

type PosPage =
  | 'sales' | 'products' | 'clients' | 'debts'
  | 'warehouse' | 'suppliers' | 'finance' | 'reports'

const PAGES: { id: PosPage; label: string; icon: string }[] = [
  { id: 'sales', label: 'Касса', icon: '🛒' },
  { id: 'products', label: 'Товары', icon: '📦' },
  { id: 'clients', label: 'Клиенты', icon: '👥' },
  { id: 'debts', label: 'Долги', icon: '💳' },
  { id: 'warehouse', label: 'Склад', icon: '🏬' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚' },
  { id: 'finance', label: 'Финансы', icon: '💰' },
  { id: 'reports', label: 'Отчёты', icon: '📊' },
]

function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}
function today() { return new Date().toISOString().slice(0, 10) }
function fmtIso(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU')
}
function initials(name?: string) {
  const t = (name || '').trim()
  if (!t) return 'К'
  const parts = t.split(/\s+/)
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
}
const CAT_EMOJI: Record<string, string> = {
  'Напитки': '🥤', 'Продукты': '🛍️', 'Фрукты': '🍎', 'Овощи': '🥬', 'Мясо': '🥩',
  'Молочные': '🥛', 'Хлеб': '🍞', 'Сладости': '🍫', 'Бакалея': '🌾',
}

function Alert({ text }: { text: string }) {
  if (!text) return null
  const err = /не удал|ошибк|недостаточно|добавьте|error|не найден/i.test(text)
  return <div className={`k-alert ${err ? 'err' : ''}`}>{text}</div>
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

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="k-card">
      <div className="k-card-h"><b>{title}</b>{actions}</div>
      <div className="k-card-b">{children}</div>
    </section>
  )
}

/* ═══════════════ Клиентский пикер (модалка) ═══════════════ */
function ClientPicker({ clients, onPick, onClose }: { clients: AdminClient[]; onPick: (c: AdminClient | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = clients.filter(c => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return `${c.name} ${c.phone} ${c.card}`.toLowerCase().includes(s)
  }).slice(0, 60)
  return (
    <div className="k-modal-bg" onClick={onClose}>
      <div className="k-modal" onClick={e => e.stopPropagation()}>
        <div className="k-modal-h"><b>Выбор клиента</b><button onClick={onClose}>×</button></div>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <input className="k-inp" autoFocus placeholder="Поиск по имени, телефону, карте…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="k-modal-b">
          <div className="k-pick" onClick={() => onPick(null)}>
            <div className="pav">∅</div><div className="pi"><b>Без клиента</b><span>Продажа без карты</span></div>
          </div>
          {list.map(c => (
            <div key={c.id} className="k-pick" onClick={() => onPick(c)}>
              <div className="pav" style={{ color: CLIENT_LEVEL_COLORS[c.level] }}>{initials(c.name)}</div>
              <div className="pi"><b>{c.name}</b><span>{c.phone} · {c.card || 'без карты'}</span></div>
              <div style={{ textAlign: 'right' }}>
                <span className="k-lvl" style={{ background: CLIENT_LEVEL_COLORS[c.level] + '22', color: CLIENT_LEVEL_COLORS[c.level] }}>{LEVEL_LABELS[c.level]}</span>
                <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4, fontWeight: 800 }}>{c.bonus} б.</div>
              </div>
            </div>
          ))}
          {!list.length && <div className="k-empty">Ничего не найдено</div>}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ КАССА (POS) ═══════════════ */
type CartLine = { productId: number; qty: number }

function CashierScreen({
  products, clients, search, openShift, reloadAll,
}: {
  products: Product[]
  clients: AdminClient[]
  search: string
  openShift?: { id: string; cashierId: string; cashierName: string }
  reloadAll: () => Promise<void>
}) {
  const [cat, setCat] = useState('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [client, setClient] = useState<AdminClient | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [showDisc, setShowDisc] = useState(false)
  const [discInput, setDiscInput] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'qr' | 'credit'>('cash')
  const [held, setHeld] = useState<{ id: number; cart: CartLine[]; client: AdminClient | null }[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const cats = useMemo(() => {
    const set = new Map<string, number>()
    for (const p of products) set.set(p.cat || 'Прочее', (set.get(p.cat || 'Прочее') || 0) + 1)
    return [...set.keys()]
  }, [products])

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    return products.filter(p => {
      if (cat !== 'all' && (p.cat || 'Прочее') !== cat) return false
      if (s && !`${p.name} ${p.barcode || ''} ${p.brand || ''}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [products, cat, search])

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const subtotal = cart.reduce((sum, l) => sum + (Number(byId.get(l.productId)?.price) || 0) * l.qty, 0)
  const disc = Math.min(discount, subtotal)
  const payable = Math.max(0, subtotal - disc)
  const count = cart.reduce((s, l) => s + l.qty, 0)

  function addToCart(p: Product) {
    if (Number(p.stock) <= 0) { setMsg(`«${p.name}» нет в наличии`); return }
    setMsg('')
    setCart(list => {
      const found = list.find(l => l.productId === p.id)
      if (found) return list.map(l => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)
      return [...list, { productId: p.id, qty: 1 }]
    })
  }
  function changeQty(id: number, delta: number) {
    setCart(list => list.flatMap(l => {
      if (l.productId !== id) return [l]
      const q = l.qty + delta
      return q <= 0 ? [] : [{ ...l, qty: q }]
    }))
  }
  function removeLine(id: number) { setCart(list => list.filter(l => l.productId !== id)) }
  function clearCart() { setCart([]); setClient(null); setDiscount(0); setDiscInput('') }

  function applyBonus() {
    if (!client || client.bonus <= 0) { setMsg('У клиента нет бонусов'); return }
    setDiscount(Math.min(client.bonus, subtotal))
    setMsg(`Применены бонусы клиента: ${Math.min(client.bonus, subtotal)}`)
  }
  function holdOrder() {
    if (!cart.length) return
    setHeld(h => [...h, { id: Date.now(), cart, client }])
    clearCart()
    setMsg('Чек отложен')
  }
  function restoreHold(id: number) {
    const h = held.find(x => x.id === id); if (!h) return
    setCart(h.cart); setClient(h.client)
    setHeld(list => list.filter(x => x.id !== id))
  }

  async function checkout(method: 'cash' | 'card' | 'qr' | 'credit') {
    if (!cart.length) { setMsg('Добавьте товары в чек'); return }
    if (method === 'credit' && !client) { setMsg('Для продажи в долг выберите клиента'); return }
    setBusy(true); setMsg('')
    try {
      const scale = subtotal > 0 ? payable / subtotal : 1
      const items = cart.map(l => {
        const p = byId.get(l.productId)!
        return { productId: l.productId, qty: l.qty, price: Math.round((Number(p.price) || 0) * scale * 100) / 100 }
      })
      const apiMethod = method === 'qr' ? 'card' : method
      await api.createPosSale({
        cashierId: openShift?.cashierId,
        shiftId: openShift?.id,
        clientId: client?.id || '',
        clientName: client?.name || '',
        clientPhone: client?.phone || '',
        cardNum: client?.card || '',
        paymentMethod: apiMethod,
        paidCash: apiMethod === 'cash' ? payable : 0,
        paidCard: apiMethod === 'card' ? payable : 0,
        debtAdded: apiMethod === 'credit' ? payable : 0,
        note: disc > 0 ? `Скидка ${disc.toFixed(2)}` : '',
        items,
      })
      clearCart()
      setMsg(`Чек проведён · ${money(payable)}`)
      await reloadAll()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось провести чек')
    } finally { setBusy(false) }
  }

  return (
    <div className="k-cashier">
      {/* Каталог */}
      <div className="k-catalog">
        <div className="k-cats">
          <button className={`k-cat ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>
            <span className="ce">🗂️</span>Все товары
          </button>
          {cats.map(c => (
            <button key={c} className={`k-cat ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              <span className="ce">{CAT_EMOJI[c] || '🏷️'}</span>{c}
            </button>
          ))}
        </div>
        <div className="k-grid k-scroll">
          {shown.map(p => {
            const out = Number(p.stock) <= 0
            const low = !out && Number(p.stock) <= 5
            return (
              <button key={p.id} className="k-prod" onClick={() => addToCart(p)} disabled={out}>
                <div className="ph">
                  {p.photo ? <img src={p.photo} alt="" /> : <span>{p.e || '📦'}</span>}
                  {p.sellType === 'weight' && <span className="unitb">{p.unit || 'кг'}</span>}
                </div>
                <div className="nm">{p.name}</div>
                <div className="pr">{money(p.price)}</div>
                <div className={`st ${out ? 'out' : low ? 'low' : ''}`}>{out ? 'Нет в наличии' : `В наличии: ${p.stock}${p.sellType === 'weight' ? ' ' + (p.unit || 'кг') : ''}`}</div>
              </button>
            )
          })}
          {!shown.length && <div className="k-empty" style={{ gridColumn: '1/-1' }}>Товары не найдены</div>}
        </div>
      </div>

      {/* Чек */}
      <aside className="k-cart">
        <div className="k-cust" onClick={() => setShowPicker(true)}>
          <div className="cav">{client ? initials(client.name) : '👤'}</div>
          <div className="ci">
            <b>{client ? client.name : 'Выберите клиента'}</b>
            <span>{client ? client.phone : 'Розничный покупатель'}</span>
          </div>
          {client && (
            <>
              <span className="k-lvl" style={{ background: CLIENT_LEVEL_COLORS[client.level] + '22', color: CLIENT_LEVEL_COLORS[client.level] }}>{LEVEL_LABELS[client.level]}</span>
              <div className="bon"><b>{client.bonus}</b>бонусов</div>
            </>
          )}
        </div>

        {held.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            {held.map(h => (
              <button key={h.id} className="k-btn k-btn-s" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => restoreHold(h.id)}>
                ↩ Отложенный ({h.cart.reduce((s, l) => s + l.qty, 0)})
              </button>
            ))}
          </div>
        )}

        <div className="k-items">
          {cart.length ? cart.map(l => {
            const p = byId.get(l.productId)
            if (!p) return null
            return (
              <div key={l.productId} className="k-line">
                <div className="lav">{p.photo ? <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : (p.e || '📦')}</div>
                <div className="li"><b>{p.name}</b><span>{l.qty} × {money(p.price)}</span></div>
                <div className="k-qty">
                  <button onClick={() => changeQty(l.productId, -1)}>−</button>
                  <span className="qv">{l.qty}</span>
                  <button onClick={() => changeQty(l.productId, +1)}>+</button>
                </div>
                <div className="lt">{money(p.price * l.qty)}</div>
                <button className="rm" onClick={() => removeLine(l.productId)}>×</button>
              </div>
            )
          }) : <div className="k-emptycart">Чек пуст.<br />Нажимайте на товары, чтобы добавить их.</div>}
        </div>

        {showDisc && (
          <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
            <input className="k-inp" type="number" placeholder="Сумма скидки" value={discInput} onChange={e => setDiscInput(e.target.value)} />
            <button className="k-btn k-btn-g" onClick={() => { setDiscount(Number(discInput) || 0); setShowDisc(false) }}>ОК</button>
          </div>
        )}

        <div className="k-sum">
          <div className="k-sumrow"><span>{count} товаров</span><span>{money(subtotal)}</span></div>
          {disc > 0 && <div className="k-sumrow disc"><span>Скидка</span><span>−{money(disc)}</span></div>}
          <div className="k-sumrow total"><span>К оплате</span><b>{money(payable)}</b></div>
        </div>

        <div className="k-acts">
          <button className={`k-act ${showDisc ? 'act' : ''}`} onClick={() => setShowDisc(v => !v)}><span className="ai">🏷️</span>Скидка</button>
          <button className="k-act" onClick={applyBonus}><span className="ai">🎁</span>Бонусы</button>
          <button className="k-act" onClick={holdOrder}><span className="ai">🕓</span>Отложить</button>
          <button className={`k-act warn ${payMethod === 'credit' ? 'act' : ''}`} onClick={() => { setPayMethod('credit'); checkout('credit') }}><span className="ai">📝</span>В долг</button>
          <button className="k-act warn" onClick={clearCart} style={{ gridColumn: 'span 2' }}><span className="ai">🗑️</span>Очистить</button>
        </div>

        <div className="k-pays">
          <button className={`k-pay cash ${payMethod === 'cash' ? 'selected' : ''}`} onClick={() => setPayMethod('cash')}><span className="pi">💵</span>Наличные</button>
          <button className={`k-pay card ${payMethod === 'card' ? 'selected' : ''}`} onClick={() => setPayMethod('card')}><span className="pi">💳</span>Карта</button>
          <button className={`k-pay qr ${payMethod === 'qr' ? 'selected' : ''}`} onClick={() => setPayMethod('qr')}><span className="pi">📱</span>QR оплата</button>
        </div>

        <button className="k-checkout" disabled={busy || !cart.length} onClick={() => checkout(payMethod)}>
          {busy ? 'Проведение…' : `Оплатить ${money(payable)}`}
        </button>
        {msg && <div style={{ padding: '0 14px 14px' }}><Alert text={msg} /></div>}
      </aside>

      {showPicker && <ClientPicker clients={clients} onPick={c => { setClient(c); setShowPicker(false); setDiscount(0) }} onClose={() => setShowPicker(false)} />}
    </div>
  )
}

/* ═══════════════ ТОВАРЫ ═══════════════ */
function ProductsView({ products, search }: { products: Product[]; search: string }) {
  const s = search.trim().toLowerCase()
  const list = products.filter(p => !s || `${p.name} ${p.barcode || ''}`.toLowerCase().includes(s))
  return (
    <Card title={`Каталог товаров · ${list.length}`}>
      <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
        <table className="k-tbl">
          <thead><tr><th>Товар</th><th>Категория</th><th className="num">Остаток</th><th className="num">Цена</th><th className="num">Себест.</th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#0e1712', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{p.e || '📦'}</span>
                  {p.name}
                </td>
                <td>{p.cat}</td>
                <td className="num" style={{ color: Number(p.stock) <= 5 ? 'var(--gold)' : undefined }}>{p.stock} {p.sellType === 'weight' ? (p.unit || 'кг') : ''}</td>
                <td className="num" style={{ color: 'var(--green)', fontWeight: 800 }}>{money(p.price)}</td>
                <td className="num">{money(p.costPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="k-empty">Нет товаров</div>}
      </div>
    </Card>
  )
}

/* ═══════════════ КЛИЕНТЫ ═══════════════ */
function ClientsView({ clients, search }: { clients: AdminClient[]; search: string }) {
  const s = search.trim().toLowerCase()
  const list = clients.filter(c => !s || `${c.name} ${c.phone} ${c.card}`.toLowerCase().includes(s))
  return (
    <Card title={`Клиенты · ${list.length}`}>
      <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
        <table className="k-tbl">
          <thead><tr><th>Клиент</th><th>Телефон</th><th>Карта</th><th>Статус</th><th className="num">Бонусы</th><th className="num">Долг</th></tr></thead>
          <tbody>
            {list.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.card || '—'}</td>
                <td><span className="k-badge" style={{ background: CLIENT_LEVEL_COLORS[c.level] + '22', color: CLIENT_LEVEL_COLORS[c.level] }}>{LEVEL_LABELS[c.level]}</span></td>
                <td className="num" style={{ color: 'var(--gold)' }}>{c.bonus}</td>
                <td className="num" style={{ color: Number(c.debt) > 0 ? 'var(--red)' : 'var(--muted)' }}>{money(c.debt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="k-empty">Клиентов нет</div>}
      </div>
    </Card>
  )
}

/* ═══════════════ ДОЛГИ ═══════════════ */
function DebtsView({ clients, cards, sales }: { clients: AdminClient[]; cards: AdminCard[]; sales: PosSale[] }) {
  const debtClients = clients.filter(c => Number(c.debt) > 0)
  const creditSales = sales.filter(s => Number(s.debtAdded) > 0)
  const totalDebt = debtClients.reduce((s, c) => s + Number(c.debt), 0)
  return (
    <>
      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Должников</div><div className="kv">{debtClients.length}</div></div>
        <div className="k-kpi"><div className="kl">Сумма долга</div><div className="kv" style={{ color: 'var(--red)' }}>{money(totalDebt)}</div></div>
        <div className="k-kpi"><div className="kl">Продаж в долг</div><div className="kv">{creditSales.length}</div></div>
        <div className="k-kpi"><div className="kl">Карт с долгом</div><div className="kv">{cards.filter(c => Number(c.debt) > 0).length}</div></div>
      </div>
      <div className="k-grid2">
        <Card title="Клиенты с долгами">
          {debtClients.length ? (
            <table className="k-tbl">
              <thead><tr><th>Клиент</th><th>Телефон</th><th className="num">Долг</th></tr></thead>
              <tbody>{debtClients.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="num" style={{ color: 'var(--red)' }}>{money(c.debt)}</td></tr>)}</tbody>
            </table>
          ) : <div className="k-empty">Долгов нет</div>}
        </Card>
        <Card title="Последние продажи в долг">
          {creditSales.length ? (
            <table className="k-tbl">
              <thead><tr><th>Чек</th><th>Клиент</th><th className="num">Сумма</th></tr></thead>
              <tbody>{creditSales.slice(0, 12).map(s => <tr key={s.id}><td>{s.id}</td><td>{s.clientName || '—'}</td><td className="num">{money(s.debtAdded)}</td></tr>)}</tbody>
            </table>
          ) : <div className="k-empty">Продаж в долг нет</div>}
        </Card>
      </div>
    </>
  )
}

/* ═══════════════ СКЛАД (с подвкладками) ═══════════════ */
function WarehouseView({ products, suppliers, expiry, reloadAll }: { products: Product[]; suppliers: any[]; expiry: any[]; reloadAll: () => Promise<void> }) {
  const [tab, setTab] = useState<'ops' | 'stock' | 'revision' | 'expiry'>('ops')
  const [rProd, setRProd] = useState(products[0]?.id || 0)
  const [rQty, setRQty] = useState('')
  const [rCost, setRCost] = useState('')
  const [rSup, setRSup] = useState('')
  const [rExp, setRExp] = useState(today())
  const [wProd, setWProd] = useState(products[0]?.id || 0)
  const [wQty, setWQty] = useState('')
  const [wReason, setWReason] = useState('Списание')
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState('')

  async function addReceipt() {
    try {
      await api.createStockReceipt({ supplierId: rSup, createdBy: 'pos', items: [{ productId: rProd, qty: Number(rQty) || 0, costPrice: Number(rCost) || 0, expiryDate: rExp }] })
      setRQty(''); setRCost(''); setMsg('Приход сохранён'); await reloadAll()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
  }
  async function addWriteoff() {
    try {
      await api.createStockWriteoff({ reason: wReason, createdBy: 'pos', items: [{ productId: wProd, qty: Number(wQty) || 0 }] })
      setWQty(''); setMsg('Списание сохранено'); await reloadAll()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
  }
  const revList = products.slice(0, 40)
  async function saveRevision() {
    try {
      await api.createStockRevision({ createdBy: 'pos', items: revList.map(p => ({ productId: p.id, countedStock: counts[p.id] === undefined ? p.stock : Number(counts[p.id]) || 0 })) })
      setMsg('Ревизия сохранена'); await reloadAll()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
  }

  return (
    <>
      <div className="k-subtabs">
        {([['ops', 'Приход / Списание'], ['stock', 'Остатки'], ['revision', 'Ревизия'], ['expiry', 'Сроки']] as const).map(([id, label]) => (
          <button key={id} className={`k-subtab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'ops' && (
        <div className="k-grid2">
          <Card title="Приход товара">
            <div className="k-grid2">
              <div className="k-field"><label>Товар</label>
                <select className="k-sel" value={rProd} onChange={e => setRProd(Number(e.target.value))}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="k-field"><label>Поставщик</label>
                <select className="k-sel" value={rSup} onChange={e => setRSup(e.target.value)}><option value="">Без поставщика</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="k-field"><label>Количество</label><input className="k-inp" type="number" step="0.01" value={rQty} onChange={e => setRQty(e.target.value)} /></div>
              <div className="k-field"><label>Себестоимость</label><input className="k-inp" type="number" step="0.01" value={rCost} onChange={e => setRCost(e.target.value)} /></div>
              <div className="k-field"><label>Срок годности</label><input className="k-inp" type="date" value={rExp} onChange={e => setRExp(e.target.value)} /></div>
            </div>
            <button className="k-btn k-btn-g" onClick={addReceipt}>Оприходовать</button>
          </Card>
          <Card title="Списание товара">
            <div className="k-grid2">
              <div className="k-field"><label>Товар</label>
                <select className="k-sel" value={wProd} onChange={e => setWProd(Number(e.target.value))}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="k-field"><label>Количество</label><input className="k-inp" type="number" step="0.01" value={wQty} onChange={e => setWQty(e.target.value)} /></div>
            </div>
            <div className="k-field"><label>Причина</label><input className="k-inp" value={wReason} onChange={e => setWReason(e.target.value)} /></div>
            <button className="k-btn k-btn-s" onClick={addWriteoff}>Провести списание</button>
            <Alert text={msg} />
          </Card>
        </div>
      )}

      {tab === 'stock' && (
        <Card title="Остатки на складе">
          <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
            <table className="k-tbl">
              <thead><tr><th>Товар</th><th className="num">Остаток</th><th className="num">Цена</th><th className="num">Себест.</th></tr></thead>
              <tbody>{products.map(p => (
                <tr key={p.id}><td>{p.name}{Number(p.stock) <= 5 && <span className="k-badge" style={{ marginLeft: 8, background: '#2a2414', color: 'var(--gold)' }}>мало</span>}</td><td className="num">{p.stock}</td><td className="num">{money(p.price)}</td><td className="num">{money(p.costPrice)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'revision' && (
        <Card title="Инвентаризация" actions={<button className="k-btn k-btn-g" onClick={saveRevision}>Сохранить ревизию</button>}>
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            <table className="k-tbl">
              <thead><tr><th>Товар</th><th className="num">Учётный</th><th className="num">Фактический</th><th className="num">Отклонение</th></tr></thead>
              <tbody>{revList.map(p => {
                const counted = counts[p.id] === undefined ? p.stock : Number(counts[p.id]) || 0
                const diff = counted - p.stock
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td><td className="num">{p.stock}</td>
                    <td className="num"><input className="k-inp" style={{ maxWidth: 110, marginLeft: 'auto', textAlign: 'right' }} value={counts[p.id] ?? String(p.stock)} onChange={e => setCounts(s => ({ ...s, [p.id]: e.target.value }))} /></td>
                    <td className="num" style={{ color: diff === 0 ? 'var(--muted)' : diff > 0 ? 'var(--green)' : 'var(--red)' }}>{diff > 0 ? `+${diff}` : diff}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          <Alert text={msg} />
        </Card>
      )}

      {tab === 'expiry' && (
        <Card title="Контроль сроков годности">
          {expiry.length ? (
            <table className="k-tbl">
              <thead><tr><th>Товар</th><th className="num">Остаток партии</th><th>Годен до</th><th className="num">Дней осталось</th></tr></thead>
              <tbody>{expiry.map(r => (
                <tr key={`${r.receiptId}-${r.productId}`}><td>{r.productName}</td><td className="num">{r.qty}</td><td>{r.expiryDate}</td><td className="num"><span className="k-badge" style={{ background: r.daysLeft <= 3 ? '#2a1414' : '#12351e', color: r.daysLeft <= 3 ? 'var(--red)' : 'var(--green)' }}>{r.daysLeft}</span></td></tr>
              ))}</tbody>
            </table>
          ) : <div className="k-empty">Нет партий с близким сроком</div>}
        </Card>
      )}
    </>
  )
}

/* ═══════════════ ПОСТАВЩИКИ ═══════════════ */
function SuppliersView({ suppliers, reloadAll }: { suppliers: any[]; reloadAll: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [amount, setAmount] = useState('')
  const [msg, setMsg] = useState('')
  async function add() { try { await api.createSupplier({ name, phone }); setName(''); setPhone(''); setMsg('Поставщик добавлен'); await reloadAll() } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') } }
  async function pay() { try { await api.createSupplierPayment(supplierId, { amount: Number(amount) || 0 }); setAmount(''); setMsg('Оплата проведена'); await reloadAll() } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') } }
  return (
    <div className="k-grid2">
      <Card title="Поставщики и оплаты">
        <div className="k-grid2">
          <div className="k-field"><label>Название</label><input className="k-inp" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="k-field"><label>Телефон</label><input className="k-inp" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <button className="k-btn k-btn-g" onClick={add}>Добавить поставщика</button>
        <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div className="k-grid2">
          <div className="k-field"><label>Поставщик</label><select className="k-sel" value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Выберите</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="k-field"><label>Сумма оплаты</label><input className="k-inp" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <button className="k-btn k-btn-s" onClick={pay}>Оплатить поставщику</button>
        <Alert text={msg} />
      </Card>
      <Card title="Баланс поставщиков">
        {suppliers.length ? (
          <table className="k-tbl">
            <thead><tr><th>Поставщик</th><th className="num">Долг</th><th className="num">Поставлено</th><th className="num">Оплачено</th></tr></thead>
            <tbody>{suppliers.map(s => <tr key={s.id}><td>{s.name}</td><td className="num" style={{ color: Number(s.payableAmount) > 0 ? 'var(--red)' : 'var(--muted)' }}>{money(s.payableAmount)}</td><td className="num">{money(s.totalSupplied)}</td><td className="num">{money(s.totalPaid)}</td></tr>)}</tbody>
          </table>
        ) : <div className="k-empty">Поставщиков нет</div>}
      </Card>
    </div>
  )
}

/* ═══════════════ ФИНАНСЫ ═══════════════ */
function FinanceView({ financeSummary, expenses, openShiftId, reloadAll }: { financeSummary: any; expenses: any[]; openShiftId?: string; reloadAll: () => Promise<void> }) {
  const [category, setCategory] = useState('Хозрасход')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  async function addExpense() { try { await api.createExpense({ category, amount: Number(amount) || 0, note, createdBy: 'pos', shiftId: openShiftId }); setAmount(''); setNote(''); setMsg('Расход добавлен'); await reloadAll() } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') } }
  return (
    <>
      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Выручка</div><div className="kv" style={{ color: 'var(--green)' }}>{money(financeSummary?.revenue)}</div></div>
        <div className="k-kpi"><div className="kl">Наличные</div><div className="kv">{money(financeSummary?.cashRevenue)}</div></div>
        <div className="k-kpi"><div className="kl">Безнал</div><div className="kv">{money(financeSummary?.cardRevenue)}</div></div>
        <div className="k-kpi"><div className="kl">Выдано в долг</div><div className="kv" style={{ color: 'var(--red)' }}>{money(financeSummary?.creditIssued)}</div></div>
      </div>
      <div className="k-grid2">
        <Card title="Добавить расход">
          <div className="k-grid2">
            <div className="k-field"><label>Категория</label><input className="k-inp" value={category} onChange={e => setCategory(e.target.value)} /></div>
            <div className="k-field"><label>Сумма</label><input className="k-inp" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          </div>
          <div className="k-field"><label>Комментарий</label><textarea className="k-ta" value={note} onChange={e => setNote(e.target.value)} /></div>
          <button className="k-btn k-btn-g" onClick={addExpense}>Сохранить расход</button>
          <Alert text={msg} />
        </Card>
        <Card title="Последние расходы">
          {expenses.length ? (
            <table className="k-tbl"><thead><tr><th>Категория</th><th className="num">Сумма</th><th>Дата</th></tr></thead>
              <tbody>{expenses.slice(0, 14).map(e => <tr key={e.id}><td>{e.category}</td><td className="num">{money(e.amount)}</td><td>{fmtIso(e.createdAtIso)}</td></tr>)}</tbody></table>
          ) : <div className="k-empty">Расходов нет</div>}
        </Card>
      </div>
    </>
  )
}

/* ═══════════════ ОТЧЁТЫ ═══════════════ */
function ReportsView({ report }: { report: any }) {
  const summary = report?.summary || {}
  return (
    <>
      <div className="k-kpis">
        <div className="k-kpi"><div className="kl">Продаж всего</div><div className="kv">{summary.salesCount || 0}</div></div>
        <div className="k-kpi"><div className="kl">Долг клиентов</div><div className="kv">{money(summary.clientDebt)}</div></div>
        <div className="k-kpi"><div className="kl">Долг поставщикам</div><div className="kv">{money(summary.supplierDebt)}</div></div>
        <div className="k-kpi"><div className="kl">Расходы</div><div className="kv">{money(summary.expenses)}</div></div>
      </div>
      <div className="k-grid2">
        <Card title="Топ товаров по выручке">
          {report?.topProducts?.length ? (
            <table className="k-tbl"><thead><tr><th>Товар</th><th className="num">Кол-во</th><th className="num">Выручка</th></tr></thead>
              <tbody>{report.topProducts.map((p: any) => <tr key={p.productId}><td>{p.productName}</td><td className="num">{p.qty}</td><td className="num">{money(p.revenue)}</td></tr>)}</tbody></table>
          ) : <div className="k-empty">Нет данных</div>}
        </Card>
        <Card title="Последние продажи">
          {report?.recentSales?.length ? (
            <table className="k-tbl"><thead><tr><th>Чек</th><th className="num">Сумма</th><th>Дата</th></tr></thead>
              <tbody>{report.recentSales.map((s: PosSale) => <tr key={s.id}><td>{s.id}</td><td className="num">{money(s.total)}</td><td>{fmtIso(s.createdAtIso)}</td></tr>)}</tbody></table>
          ) : <div className="k-empty">Продаж нет</div>}
        </Card>
      </div>
    </>
  )
}

/* ═══════════════ КОРНЕВОЙ КОМПОНЕНТ ═══════════════ */
function PosAppInner() {
  useApiSync('pos')
  const { page, setPage } = useAppNavigation('sales')
  const products = useProducts(s => s.products)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const pos = usePosStore()
  const [booted, setBooted] = useState(false)
  const [search, setSearch] = useState('')
  const [sideOpen, setSideOpen] = useState(false)

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

  const current = (PAGES.some(p => p.id === page) ? page : 'sales') as PosPage
  const currentMeta = PAGES.find(p => p.id === current)!

  return (
    <div className="k-pos">
      <style>{CSS}</style>

      {/* Sidebar */}
      <aside className={`k-side ${sideOpen ? 'open' : ''}`}>
        <div className="k-logo"><span className="mark">🦜</span> KAKAPO POS</div>
        <nav className="k-nav">
          {PAGES.map(item => (
            <button key={item.id} className={`k-navitem ${current === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setSideOpen(false) }}>
              <span className="ic">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="k-side-foot">
          <div className="k-store">
            <div className="name">Магазин KAKAPO <span>▾</span></div>
            <div className="k-online"><span className="d" />Онлайн</div>
            <Clock />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="k-main">
        <header className="k-top">
          <div className="k-search">
            <span className="mag">🔍</span>
            <input placeholder="Поиск товара по названию, штрихкоду…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="k-scan">📷 Сканер</button>
          <button className="k-bell">🔔<span className="badge">{lowStock}</span></button>
          <div className="k-user">
            <div className="av">{initials(openShift?.cashierName || 'Администратор')}</div>
            <div className="who"><b>{openShift ? openShift.cashierName : 'Кассир'}</b><span>{openShift ? 'Смена открыта' : 'Администратор'}</span></div>
          </div>
        </header>

        <div className="k-body">
          {!booted ? (
            <div className="k-empty">Загрузка модуля POS…</div>
          ) : pos.apiError ? (
            <div className="k-card"><div className="k-empty">{pos.apiError}</div></div>
          ) : current === 'sales' ? (
            <CashierScreen products={products} clients={clients} search={search} openShift={openShift} reloadAll={reloadAll} />
          ) : (
            <>
              <div className="k-page-h">
                <div><h1>{currentMeta.icon} {currentMeta.label}</h1></div>
              </div>
              {current === 'products' ? <ProductsView products={products} search={search} />
                : current === 'clients' ? <ClientsView clients={clients} search={search} />
                : current === 'debts' ? <DebtsView clients={clients} cards={cards} sales={pos.sales} />
                : current === 'warehouse' ? <WarehouseView products={products} suppliers={pos.suppliers} expiry={pos.expiry} reloadAll={reloadAll} />
                : current === 'suppliers' ? <SuppliersView suppliers={pos.suppliers} reloadAll={reloadAll} />
                : current === 'finance' ? <FinanceView financeSummary={pos.financeSummary} expenses={pos.expenses} openShiftId={openShift?.id} reloadAll={reloadAll} />
                : <ReportsView report={pos.report} />}
            </>
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
