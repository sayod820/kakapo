'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { loyaltySummaryForClient } from '@/lib/clientCardSync'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  type AdminClient,
  type ClientLevel,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  calcCashDepositBonus,
  resolveEffectiveDebtLimit,
} from '@/lib/loyaltyStatusConfig'
import { filterProductsBySearch } from '@/lib/productBarcodes'
import { useProductPhotos } from '@/lib/productPhotos'
import { isWeighted } from '@/lib/productWeight'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import type { Product } from '@/lib/types'
import { useCategories } from '@/lib/useCategories'
import { fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

const SETTINGS_KEY = 'kakapo_trade_pos_settings'
const THEME_KEY = 'kakapo_trade_pos_theme'

type ThemeName = 'green' | 'purple' | 'gold'
type PayMethod = 'cash' | 'card' | 'credit' | 'qr'
type PosSettings = { cashierId: string; cashierName: string; initials: string }

type CartLine = {
  key: string
  productId: number
  name: string
  emoji: string
  price: number
  qty: number
  stock: number
  unit: string
  weightKg?: number
}

const POS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');
.pos-root{--bg:#030B05;--surface:#0A1710;--surface2:#0F2216;--surface3:#132A1A;--border:#1A3322;--border2:#234430;--accent:#1FD760;--accent2:#17B34E;--gd:#FFB800;--org:#FF8C00;--blue:#3B8EF0;--pur:#9B6DFF;--red:#FF4545;--t1:#F1FBF3;--t2:#8FB897;--t3:#3D6645;position:fixed;inset:0;z-index:100;height:100vh;width:100vw;margin:0;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;overflow:hidden}
.pos-root[data-theme="purple"]{--accent:#9B6DFF;--accent2:#7C4FE0}
.pos-root[data-theme="gold"]{--accent:#FFB800;--accent2:#E0A000}
.pos-root *{box-sizing:border-box}
.pos-root button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.pos-root input,select{font-family:inherit;color:inherit}
.pos-mono{font-family:'JetBrains Mono',monospace}
.pos-ub{font-family:'Unbounded',sans-serif}
@keyframes posPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
@keyframes posFade{from{opacity:0}to{opacity:1}}
@keyframes posTile{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes posPulse{0%,100%{opacity:1}50%{opacity:.4}}
.pos-gate{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--bg)}
.pos-gate-bg{position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 20% 20%,rgba(31,215,96,.09),transparent 45%),radial-gradient(circle at 82% 78%,rgba(255,184,0,.06),transparent 45%)}
.pos-gate-card{position:relative;width:min(400px,92vw);background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:32px;animation:posPop .3s cubic-bezier(.16,1,.3,1)}
.pos-gate-logo{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:21px;color:var(--bg);margin:0 auto 14px}
.pos-gate-title{font-family:'Unbounded';font-size:16px;font-weight:800;text-align:center;margin-bottom:4px}
.pos-gate-sub{font-size:12px;color:var(--t2);text-align:center;margin-bottom:24px}
.pos-gate-label{font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px;display:block}
.pos-cashier-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px}
.pos-cashier-opt{padding:12px 5px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface2);text-align:center}
.pos-cashier-opt.on{border-color:var(--accent);background:rgba(31,215,96,.08)}
.pos-cashier-opt .av{width:32px;height:32px;border-radius:10px;background:var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;margin:0 auto 6px}
.pos-cashier-opt.on .av{background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg)}
.pos-cashier-opt span{font-size:10.5px;font-weight:700;color:var(--t2)}
.pos-cashier-opt.on span{color:var(--t1)}
.pos-gate-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:13px;padding:13px 15px;font-size:14px;font-weight:700;outline:none;margin-bottom:12px;font-family:'JetBrains Mono'}
.pos-gate-input:focus{border-color:var(--accent)}
.pos-btn-gate{width:100%;padding:14px;border-radius:14px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:14px}
.pos-app{display:grid;grid-template-columns:1fr minmax(300px,380px);grid-template-rows:64px 1fr;height:100%}
.pos-topbar{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:0 18px;background:var(--surface);border-bottom:1px solid var(--border)}
.pos-search{flex:1;max-width:520px;display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:11px 16px}
.pos-search:focus-within{border-color:var(--accent)}
.pos-search input{flex:1;background:none;border:none;outline:none;font-size:13.5px;color:var(--t1)}
.pos-search input::placeholder{color:var(--t3)}
.pos-theme{display:flex;gap:6px;margin-left:auto}
.pos-theme-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);cursor:pointer}
.pos-theme-dot.on{border-color:var(--t1)}
.pos-account{display:flex;align-items:center;gap:9px;padding:6px 10px 6px 6px;border-radius:13px;flex-shrink:0}
.pos-account:hover{background:var(--surface2)}
.pos-av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:'Unbounded'}
.pos-products{background:var(--bg);overflow:hidden;display:flex;flex-direction:column}
.pos-cats{display:flex;gap:9px;padding:14px 18px 6px;overflow-x:auto;flex-shrink:0}
.pos-cat{padding:9px 16px;border-radius:13px;font-size:12px;font-weight:700;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;display:flex;align-items:center;gap:7px;flex-shrink:0}
.pos-cat.on{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.pos-grid-wrap{flex:1;overflow-y:auto;padding:8px 18px 18px}
.pos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.pos-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;animation:posTile .25s ease both;transition:border-color .15s,transform .1s}
.pos-tile:hover{border-color:var(--accent);transform:translateY(-2px)}
.pos-tile:active{transform:scale(.97)}
.pos-photo{width:100%;height:78px;border-radius:12px;background:linear-gradient(145deg,var(--surface2),var(--surface3));display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:10px;overflow:hidden;position:relative}
.pos-photo img{width:100%;height:100%;object-fit:cover}
.pos-weight-tag{position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.75);color:var(--t1);padding:2px 7px;border-radius:7px}
.pos-name{font-size:12px;font-weight:800;line-height:1.25;margin-bottom:4px;min-height:30px}
.pos-price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd)}
.pos-unit{font-size:9.5px;color:var(--t3);font-weight:600}
.pos-stock{font-size:10px;color:var(--accent);margin-top:4px;font-weight:700}
.pos-stock.low{color:var(--red)}
.pos-manual{border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--t2);min-height:172px}
.pos-cart{background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.pos-client{margin:14px 14px 0;padding:12px 14px;border-radius:16px;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;gap:11px;cursor:pointer;flex-shrink:0}
.pos-client.set{border-color:rgba(255,184,0,.3);background:rgba(255,184,0,.05)}
.pos-client .av{width:38px;height:38px;border-radius:12px;background:var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:13px;color:var(--t2);flex-shrink:0}
.pos-client.set .av{background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg)}
.pos-client .info{flex:1;min-width:0}
.pos-client .nm{font-size:12.5px;font-weight:800}
.pos-client .ph{font-size:10px;color:var(--t2)}
.pos-client .tier{padding:3px 9px;border-radius:8px;font-size:9.5px;font-weight:800;flex-shrink:0}
.pos-client .x{width:22px;height:22px;border-radius:7px;color:var(--t3);font-size:12px;flex-shrink:0}
.pos-client .x:hover{background:rgba(255,69,69,.12);color:var(--red)}
.pos-strip{margin:8px 14px 0;padding:9px 12px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px}
.pos-strip .set-btn{font-size:10.5px;color:var(--blue);font-weight:800}
.pos-items{flex:1;overflow-y:auto;padding:10px 14px}
.pos-empty{text-align:center;color:var(--t3);padding:50px 10px}
.pos-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-radius:14px}
.pos-row:hover{background:var(--surface2)}
.pos-row .ic{width:38px;height:38px;border-radius:11px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.pos-row .info{flex:1;min-width:0}
.pos-row .name{font-size:12px;font-weight:700}
.pos-row .sub{font-size:10px;color:var(--t3);margin-top:1px}
.pos-qty{display:flex;align-items:center;gap:7px;background:var(--surface2);border-radius:10px;padding:4px;flex-shrink:0}
.pos-qty button{width:20px;height:20px;border-radius:7px;font-size:13px;font-weight:800;color:var(--t2)}
.pos-qty span{font-size:12px;font-weight:800;min-width:16px;text-align:center;font-family:'JetBrains Mono'}
.pos-row .price{font-family:'JetBrains Mono';font-size:14px;font-weight:900;color:var(--gd);flex-shrink:0;min-width:64px;text-align:right}
.pos-row .rm{width:22px;height:22px;border-radius:8px;color:var(--t3);font-size:12px;flex-shrink:0}
.pos-totals{padding:12px 14px;border-top:1px solid var(--border);flex-shrink:0}
.pos-tot-row{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:6px}
.pos-tot-final{display:flex;justify-content:space-between;align-items:baseline;padding-top:9px;margin-top:3px;border-top:1px dashed var(--border)}
.pos-tot-final b{font-family:'Unbounded';font-size:12.5px}
.pos-tot-final .sum{font-family:'JetBrains Mono';font-size:24px;font-weight:900;color:var(--accent)}
.pos-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:0 14px 9px;flex-shrink:0}
.pos-chip{padding:11px 6px;border-radius:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;border:1px solid}
.pos-chip span{font-size:10px;font-weight:700;color:var(--t2)}
.pos-chip .iw{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px}
.pos-chip.disc{background:rgba(155,109,255,.06);border-color:rgba(155,109,255,.2)}
.pos-chip.disc .iw{background:rgba(155,109,255,.15)}
.pos-chip.bonus{background:rgba(255,184,0,.06);border-color:rgba(255,184,0,.2)}
.pos-chip.bonus .iw{background:rgba(255,184,0,.15)}
.pos-chip.hold{background:rgba(59,142,240,.06);border-color:rgba(59,142,240,.2)}
.pos-chip.hold .iw{background:rgba(59,142,240,.15)}
.pos-pay{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:7px;padding:0 14px 10px;flex-shrink:0}
.pos-pay-btn{padding:12px 4px;border-radius:13px;text-align:center;font-size:10px;font-weight:800;color:#fff;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.85}
.pos-pay-btn.on{opacity:1;box-shadow:0 4px 14px rgba(0,0,0,.3);transform:translateY(-1px)}
.pos-pay-btn.disabled{opacity:.25;pointer-events:none}
.pos-pay-cash{background:linear-gradient(135deg,var(--accent2),var(--accent))}
.pos-pay-card{background:linear-gradient(135deg,#1E5BB5,var(--blue))}
.pos-pay-credit{background:linear-gradient(135deg,#B57F00,var(--gd));color:#241900}
.pos-pay-qr{background:linear-gradient(135deg,#7C4FE0,var(--pur))}
.pos-checkout{margin:0 14px 16px;padding:16px;border-radius:16px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 10px 26px rgba(31,215,96,.28)}
.pos-checkout:disabled{opacity:.3;box-shadow:none}
.pos-overlay{position:absolute;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:50;animation:posFade .2s ease}
.pos-modal{width:min(360px,92vw);background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:posPop .25s cubic-bezier(.16,1,.3,1);max-height:90%;overflow:auto}
.pos-modal.wide{width:min(420px,94vw)}
.pos-modal h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px}
.pos-modal-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:12px 15px;font-size:13.5px;outline:none;margin-bottom:12px}
.pos-modal-input:focus{border-color:var(--blue)}
.pos-modal-actions{display:flex;gap:8px;margin-top:4px}
.pos-modal-actions button{flex:1;padding:12px;border-radius:14px;font-weight:800;font-size:12px}
.pos-btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border)}
.pos-btn-ok{background:var(--accent);color:var(--bg)}
.pos-btn-ok:disabled{opacity:.3}
.pos-kp-display{background:var(--surface2);border:1.5px solid var(--border);border-radius:16px;padding:16px;text-align:center;margin-bottom:14px}
.pos-kp-display .lbl{font-size:10px;color:var(--t3);letter-spacing:.5px;margin-bottom:4px}
.pos-kp-display .val{font-family:'JetBrains Mono';font-size:28px;font-weight:800}
.pos-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}
.pos-keypad button{padding:14px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);font-family:'JetBrains Mono';font-size:17px;font-weight:700}
.pos-keypad button:hover{background:var(--border2)}
.pos-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.pos-quick button{padding:8px 4px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);font-size:11px;font-weight:700;color:var(--t2)}
.pos-client-hit{padding:11px;border-radius:15px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;width:100%;text-align:left}
.pos-client-hit:hover,.pos-client-hit.on{border-color:var(--accent)}
.pos-client-hit .av{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:12px;color:var(--bg);flex-shrink:0}
.pos-z-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px}
.pos-z-stat{background:var(--surface2);border:1px solid var(--border);border-radius:15px;padding:13px}
.pos-z-stat .l{font-size:9.5px;color:var(--t3);text-transform:uppercase;margin-bottom:5px}
.pos-z-stat .v{font-family:'JetBrains Mono';font-size:17px;font-weight:800}
.pos-err{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.3);color:var(--red)}
.pos-toast{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface);border:1.5px solid var(--accent);border-radius:18px;padding:14px 20px;display:flex;align-items:center;gap:11px;z-index:60;box-shadow:0 14px 32px rgba(0,0,0,.5);animation:posPop .25s ease}
.pos-status{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:6px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border)}
.pos-status .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(31,215,96,.18);animation:posPulse 2s infinite}
.pos-status .meta{font-size:11px;font-weight:700;color:var(--t2);line-height:1.25}
.pos-status .meta b{display:block;color:var(--t1);font-size:12px}
.pos-status .clock{font-family:'JetBrains Mono';font-size:14px;font-weight:800;color:var(--gd);margin-left:4px}
.pos-exit{padding:8px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:700;flex-shrink:0}
.pos-exit:hover{border-color:var(--red);color:var(--red)}
@media(max-width:900px){
  .pos-root{overflow:auto}
  .pos-app{grid-template-columns:1fr;grid-template-rows:auto auto auto;min-height:100%}
  .pos-topbar{grid-column:1;flex-wrap:wrap;height:auto;padding:10px 12px;gap:8px}
  .pos-cart{border-left:none;border-top:1px solid var(--border);max-height:50vh}
}
`

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'K'
}

function loadSettings(): PosSettings {
  if (typeof window === 'undefined') return { cashierId: '', cashierName: 'Кассир', initials: 'К' }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { cashierId: '', cashierName: 'Кассир', initials: 'К' }
    const p = JSON.parse(raw) as PosSettings
    return {
      cashierId: String(p.cashierId || ''),
      cashierName: String(p.cashierName || 'Кассир'),
      initials: String(p.initials || initialsOf(p.cashierName || 'К')),
    }
  } catch {
    return { cashierId: '', cashierName: 'Кассир', initials: 'К' }
  }
}

function saveSettings(s: PosSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

function loadTheme(): ThemeName {
  if (typeof window === 'undefined') return 'green'
  const t = localStorage.getItem(THEME_KEY)
  return t === 'purple' || t === 'gold' ? t : 'green'
}

function levelLabel(level: ClientLevel) {
  return CLIENT_LEVEL_OPTIONS.find(o => o.id === level)?.label || level
}

function Keypad({ onDigit, onBack }: { onDigit: (k: string) => void; onBack: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
  return (
    <div className="pos-keypad">
      {keys.map(k => (
        <button key={k} type="button" onClick={() => (k === '⌫' ? onBack() : onDigit(k))} style={k === '⌫' ? { color: 'var(--red)', fontFamily: 'Nunito', fontSize: 12, fontWeight: 800 } : undefined}>
          {k}
        </button>
      ))}
    </div>
  )
}

function PosClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return <span className="clock">--:--</span>
  return (
    <span className="clock">
      {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

export default function CashierModule({ onExit }: { onExit?: () => void }) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const shifts = usePosStore(s => s.shifts)
  const cashiers = usePosStore(s => s.cashiers)
  const { roots } = useCategories()
  const { getPhoto, hydrate } = useProductPhotos()

  const [settings, setSettings] = useState<PosSettings>(loadSettings)
  const [theme, setTheme] = useState<ThemeName>(loadTheme)
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [client, setClient] = useState<AdminClient | null>(null)
  const [pay, setPay] = useState<PayMethod>('cash')
  const [discountPct, setDiscountPct] = useState(0)
  const [bonusUsed, setBonusUsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)

  const [gateCash, setGateCash] = useState('0.00')
  const [gateName, setGateName] = useState(settings.cashierName)
  const [pickedCashierId, setPickedCashierId] = useState(settings.cashierId)

  const [clientOpen, setClientOpen] = useState(false)
  const [clientQ, setClientQ] = useState('')
  const [clientPick, setClientPick] = useState<AdminClient | null>(null)
  const [discOpen, setDiscOpen] = useState(false)
  const [discBuf, setDiscBuf] = useState('')
  const [cashOpen, setCashOpen] = useState(false)
  const [cashBuf, setCashBuf] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualBuf, setManualBuf] = useState('')
  const [zOpen, setZOpen] = useState(false)
  const [closingCash, setClosingCash] = useState('')
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupBuf, setTopupBuf] = useState('')
  const [scaleProduct, setScaleProduct] = useState<Product | null>(null)
  const [scaleWeight, setScaleWeight] = useState(0)

  const refresh = useCallback(async () => {
    await Promise.all([syncPosFromApi(), syncClientsFromApi(), syncCardsFromApi(), fetchProducts()])
  }, [fetchProducts])

  useEffect(() => { void hydrate() }, [hydrate])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const activeShift = useMemo(() => {
    if (!settings.cashierId) return shifts.find(s => s.status === 'open') || null
    return shifts.find(s => s.status === 'open' && s.cashierId === settings.cashierId) || null
  }, [shifts, settings.cashierId])

  const cashierOptions = useMemo(() => {
    if (cashiers.length) return cashiers.filter(c => c.active !== false)
    return [{ id: 'local', name: settings.cashierName || 'Кассир', pin: '0000', active: true, salesCount: 0, salesTotal: 0 }]
  }, [cashiers, settings.cashierName])

  const search = q
  const visibleProducts = useMemo(() => {
    let list = products.filter(p => (Number(p.stock) || 0) > 0)
    if (catFilter) list = list.filter(p => p.catId === catFilter || p.cat === catFilter)
    if (search.trim()) list = filterProductsBySearch(list, search.trim())
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [products, catFilter, search])

  const clientHits = useMemo(() => {
    const query = clientQ.trim().toLowerCase()
    if (query.length < 2) return []
    return clients.filter(c =>
      c.name.toLowerCase().includes(query)
      || (c.phone || '').replace(/\s/g, '').includes(query.replace(/\s/g, ''))
      || (c.card || '').toLowerCase().includes(query),
    ).slice(0, 8)
  }, [clients, clientQ])

  const loyalty = useMemo(() => (client ? loyaltySummaryForClient(client, cards) : null), [client, cards])
  const debtLimit = loyalty ? resolveEffectiveDebtLimit(loyalty) : 0
  const availableDebt = loyalty ? Math.max(0, debtLimit - (Number(loyalty.debt) || 0)) : 0

  const subtotal = useMemo(() => cart.reduce((s, l) => s + (l.weightKg != null ? l.price * l.weightKg : l.price * l.qty), 0), [cart])
  const levelDiscPct = useMemo(() => {
    if (!loyalty || pay === 'credit') return 0
    const map: Record<string, number> = { bronze: 0, silver: 3, gold: 5, platinum: 8, basic: 0 }
    return map[loyalty.level] || 0
  }, [loyalty, pay])
  const discAmount = subtotal * ((discountPct + levelDiscPct) / 100)
  const afterDisc = Math.max(0, subtotal - discAmount)
  const maxBonus = loyalty ? Math.min(Number(loyalty.bonus) || 0, afterDisc) : 0
  const usedBonus = Math.min(bonusUsed, maxBonus)
  const total = Math.max(0, afterDisc - usedBonus)

  function showToast(title: string, sub: string) {
    setToast({ title, sub })
  }

  function appendDigit(buf: string, k: string, maxLen = 8) {
    if (k === '.' && buf.includes('.')) return buf
    if (buf.replace('.', '').length >= maxLen) return buf
    return buf + k
  }

  async function ensureCashier(name: string, preferredId?: string) {
    if (preferredId && preferredId !== 'local') {
      const found = cashiers.find(c => c.id === preferredId)
      if (found) return found
    }
    const trimmed = name.trim() || 'Кассир'
    const existing = cashiers.find(c => c.name === trimmed)
    if (existing) return existing
    if (!USE_API) throw new Error('Нужен API сервер для кассы')
    return api.createCashier({ name: trimmed, pin: '0000' })
  }

  async function openShift() {
    setBusy(true)
    setMsg('')
    try {
      const cash = Number(gateCash) || 0
      if (cash < 0) throw new Error('Укажите сумму наличных')
      const picked = cashierOptions.find(c => c.id === pickedCashierId)
      const cashier = await ensureCashier(picked?.name || gateName, pickedCashierId)
      const next = { cashierId: cashier.id, cashierName: cashier.name, initials: initialsOf(cashier.name) }
      saveSettings(next)
      setSettings(next)
      if (!USE_API) throw new Error('Касса работает только с API')
      await api.openPosShift({ cashierId: cashier.id, openingCash: cash })
      await refresh()
      setCart([])
      setClient(null)
      setDiscountPct(0)
      setBonusUsed(0)
      setPay('cash')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось открыть смену')
    } finally {
      setBusy(false)
    }
  }

  async function closeShift() {
    if (!activeShift) return
    setBusy(true)
    setMsg('')
    try {
      const cash = Number(closingCash)
      if (!(cash >= 0) || closingCash === '') throw new Error('Укажите сумму наличных в кассе')
      await api.closePosShift(activeShift.id, { closingCash: cash })
      await refresh()
      setZOpen(false)
      setCart([])
      setClient(null)
      setGateCash(String(cash.toFixed(2)))
      showToast('Смена закрыта', `В кассе ${fmtMoney(cash)}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось закрыть смену')
    } finally {
      setBusy(false)
    }
  }

  function addProduct(p: Product, weightKg?: number) {
    const stock = Number(p.stock) || 0
    if (stock <= 0) return
    if (isWeighted(p) && weightKg == null) {
      setScaleProduct(p)
      setScaleWeight(0)
      // simulate scale
      let t = 0
      const final = Math.random() * 1.2 + 0.25
      const iv = setInterval(() => {
        t++
        const cur = Math.min(final, (t / 14) * final)
        setScaleWeight(cur)
        if (t >= 14) {
          clearInterval(iv)
          setScaleWeight(final)
          setTimeout(() => {
            setScaleProduct(null)
            addProduct(p, final)
          }, 400)
        }
      }, 55)
      return
    }
    setCart(prev => {
      if (weightKg != null) {
        return [...prev, {
          key: `${p.id}-w-${Date.now()}`,
          productId: p.id,
          name: p.name,
          emoji: p.e || '📦',
          price: Number(p.price) || 0,
          qty: 1,
          stock,
          unit: p.unit || 'кг',
          weightKg,
        }]
      }
      const idx = prev.findIndex(l => l.productId === p.id && l.weightKg == null)
      if (idx >= 0) {
        const next = [...prev]
        if (next[idx].qty >= stock) return prev
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, {
        key: String(p.id),
        productId: p.id,
        name: p.name,
        emoji: p.e || '📦',
        price: Number(p.price) || 0,
        qty: 1,
        stock,
        unit: p.unit || 'шт',
      }]
    })
  }

  function setQty(key: string, qty: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      return { ...l, qty: Math.max(0, Math.min(l.stock, qty)) }
    }).filter(l => l.qty > 0 || (l.weightKg != null && l.weightKg > 0)))
  }

  function removeLine(key: string) {
    setCart(prev => prev.filter(l => l.key !== key))
  }

  function clearCart() {
    setCart([])
    setDiscountPct(0)
    setBonusUsed(0)
    setPay('cash')
  }

  async function submitSale(paidCash = 0) {
    if (!activeShift || !cart.length) return
    if (pay === 'credit' && !client) {
      setClientOpen(true)
      return
    }
    if (pay === 'credit' && total > availableDebt + 0.001) {
      showToast('Лимит долга', `Доступно ${fmtMoney(availableDebt)}`)
      return
    }
    setBusy(true)
    setMsg('')
    try {
      if (cart.some(l => !l.productId)) {
        throw new Error('Ручная цена пока не проводится через склад — уберите позицию из чека')
      }
      const method = pay === 'qr' ? 'card' : pay
      await api.createPosSale({
        cashierId: activeShift.cashierId,
        shiftId: activeShift.id,
        clientId: client?.id,
        clientName: client?.name,
        clientPhone: client?.phone,
        cardNum: client?.card,
        paymentMethod: method === 'credit' ? 'credit' : method,
        paidCash: method === 'cash' ? Math.max(paidCash, total) : 0,
        paidCard: method === 'card' ? total : 0,
        debtAdded: method === 'credit' ? total : 0,
        items: cart.map(l => ({
          productId: l.productId,
          qty: l.weightKg != null ? Math.round(l.weightKg * 1000) / 1000 : l.qty,
          price: l.price,
        })),
      })
      // apply bonus spend locally via note - bonus decrease if used
      if (client && usedBonus > 0 && USE_API && client.card) {
        try {
          const nextBonus = Math.max(0, (Number(loyalty?.bonus) || 0) - Math.floor(usedBonus))
          await api.updateCard(client.card, { bonus: nextBonus, allowBonusDecrease: true })
        } catch { /* ignore */ }
      }
      await refresh()
      const change = method === 'cash' ? Math.max(0, paidCash - total) : 0
      showToast('Чек проведён', method === 'cash' ? `Наличные · сдача ${fmtMoney(change)}` : method === 'credit' ? `В долг · ${client?.name || ''}` : 'Оплачено')
      clearCart()
      setClient(null)
      setCashOpen(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка продажи')
      showToast('Ошибка', e instanceof Error ? e.message : 'Ошибка продажи')
    } finally {
      setBusy(false)
    }
  }

  function startPay() {
    if (!cart.length) return
    if (pay === 'credit' && !client) {
      setClientOpen(true)
      return
    }
    if (pay === 'cash') {
      setCashBuf('')
      setCashOpen(true)
      return
    }
    void submitSale()
  }

  async function submitTopup() {
    if (!client) return
    const cash = Number(topupBuf) || 0
    if (cash <= 0) return
    const bonus = calcCashDepositBonus(cash)
    setBusy(true)
    try {
      const summary = loyaltySummaryForClient(client, cards)
      if (!client.card) throw new Error('У клиента нет карты')
      await api.updateCard(client.card, {
        bonus: (Number(summary.bonus) || 0) + bonus,
      })
      await refresh()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setTopupOpen(false)
      setTopupBuf('')
      showToast('Баланс пополнен', `${client.name}: +${bonus} ⭐ за ${fmtMoney(cash)}`)
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось пополнить')
    } finally {
      setBusy(false)
    }
  }

  // ─── Gate ───
  if (!activeShift) {
    return (
      <div className="pos-root" data-theme={theme}>
        <style>{POS_CSS}</style>
        <div className="pos-gate">
          <div className="pos-gate-bg" />
          <div className="pos-gate-card">
            <div className="pos-gate-logo">K</div>
            <div className="pos-gate-title">Открытие смены</div>
            <div className="pos-gate-sub">KAKAPO Касса · точка продажи</div>
            <div className="pos-status" style={{ marginBottom: 18, justifyContent: 'center' }}>
              <span className="dot" />
              <div className="meta"><b>Магазин KAKAPO</b>Онлайн</div>
              <PosClock />
            </div>
            <span className="pos-gate-label">Кто работает?</span>
            <div className="pos-cashier-grid">
              {cashierOptions.slice(0, 6).map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`pos-cashier-opt ${pickedCashierId === c.id ? 'on' : ''}`}
                  onClick={() => { setPickedCashierId(c.id); setGateName(c.name) }}
                >
                  <div className="av">{initialsOf(c.name)}</div>
                  <span>{c.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            {!cashiers.length && (
              <>
                <span className="pos-gate-label">Имя кассира</span>
                <input className="pos-gate-input" value={gateName} onChange={e => setGateName(e.target.value)} placeholder="Кассир" />
              </>
            )}
            <span className="pos-gate-label">Наличные в кассе на начало смены</span>
            <input className="pos-gate-input" value={gateCash} onChange={e => setGateCash(sanitizeDecimalInput(e.target.value))} inputMode="decimal" />
            <div className="pos-quick" style={{ marginBottom: 16 }}>
              {[0, 100, 500, 1000].map(v => (
                <button key={v} type="button" onClick={() => setGateCash(v === 0 ? '0.00' : String(v))}>{v === 0 ? 'Пустая' : `${v}`}</button>
              ))}
            </div>
            {msg && <div className="pos-err">{msg}</div>}
            <button type="button" className="pos-btn-gate" disabled={busy} onClick={() => void openShift()}>
              {busy ? 'Открываем…' : 'Открыть смену'}
            </button>
            {onExit && (
              <button type="button" className="pos-exit" style={{ width: '100%', marginTop: 10 }} onClick={onExit}>
                ← Вернуться в Торговлю
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const cashReceived = Number(cashBuf) || 0
  const cashChange = cashReceived - total
  const topupCash = Number(topupBuf) || 0
  const topupBonus = calcCashDepositBonus(topupCash)

  return (
    <div className="pos-root" data-theme={theme}>
      <style>{POS_CSS}</style>
      <div className="pos-app">
        <div className="pos-topbar">
          <div className="pos-status">
            <span className="dot" />
            <div className="meta"><b>Магазин KAKAPO</b>Онлайн</div>
            <PosClock />
          </div>
          <div className="pos-search">
            <span>🔍</span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Поиск товара по названию, штрихкоду…"
              autoFocus
              onKeyDown={e => {
                if (e.key !== 'Enter' || !q.trim()) return
                const found = filterProductsBySearch(products, q.trim())[0]
                if (found) { addProduct(found); setQ('') }
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>📷 Сканер</span>
          </div>
          <div className="pos-theme">
            {([
              ['green', '#1FD760'],
              ['purple', '#9B6DFF'],
              ['gold', '#FFB800'],
            ] as [ThemeName, string][]).map(([name, color]) => (
              <button
                key={name}
                type="button"
                className={`pos-theme-dot ${theme === name ? 'on' : ''}`}
                style={{ background: color }}
                onClick={() => { setTheme(name); localStorage.setItem(THEME_KEY, name) }}
              />
            ))}
          </div>
          <button type="button" className="pos-account" onClick={() => { setClosingCash(''); setMsg(''); setZOpen(true) }}>
            <div className="pos-av">{settings.initials}</div>
            <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
              <b style={{ fontSize: 12, display: 'block' }}>{settings.cashierName}</b>
              <span style={{ fontSize: 9.5, color: 'var(--t3)' }}>Смена · закрыть ▾</span>
            </div>
          </button>
          {onExit && (
            <button type="button" className="pos-exit" onClick={onExit} title="Выйти в меню Торговли">
              ✕ Выход
            </button>
          )}
        </div>

        <div className="pos-products">
          <div className="pos-cats">
            <button type="button" className={`pos-cat ${!catFilter ? 'on' : ''}`} onClick={() => setCatFilter(null)}>🗂 Все товары</button>
            {roots.map(c => (
              <button key={c.id} type="button" className={`pos-cat ${catFilter === c.id ? 'on' : ''}`} onClick={() => setCatFilter(c.id)}>
                {c.emoji || '📦'} {c.name}
              </button>
            ))}
          </div>
          <div className="pos-grid-wrap">
            <div className="pos-grid">
              <button type="button" className="pos-tile pos-manual" onClick={() => { setManualBuf(''); setManualOpen(true) }}>
                <span style={{ fontSize: 26, marginBottom: 8 }}>🔢</span>
                <b style={{ fontSize: 11.5 }}>Ручная цена</b>
              </button>
              {visibleProducts.map(p => {
                const stock = Number(p.stock) || 0
                const photo = p.photo || getPhoto(p.id)
                return (
                  <button key={p.id} type="button" className="pos-tile" onClick={() => addProduct(p)}>
                    <div className="pos-photo">
                      {photo ? <img src={photo} alt="" /> : (p.e || '📦')}
                      {isWeighted(p) && <span className="pos-weight-tag">⚖ {p.unit || 'кг'}</span>}
                    </div>
                    <div className="pos-name">{p.name}</div>
                    <div className="pos-price">{(Number(p.price) || 0).toFixed(2)}<span className="pos-unit"> сом/{p.unit || 'шт'}</span></div>
                    <div className={`pos-stock ${stock < 5 ? 'low' : ''}`}>В наличии: {stock} {p.unit || 'шт'}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="pos-cart">
          <div className={`pos-client ${client ? 'set' : ''}`} onClick={() => { setClientQ(''); setClientPick(client); setClientOpen(true) }}>
            <div className="av">{client ? initialsOf(client.name) : '👤'}</div>
            <div className="info">
              <div className="nm">{client?.name || 'Гость'}</div>
              <div className="ph">{client ? client.phone : 'Нажмите чтобы выбрать клиента'}</div>
            </div>
            {client && loyalty && (
              <span className="tier" style={{ background: `${CLIENT_LEVEL_COLORS[loyalty.level]}22`, color: CLIENT_LEVEL_COLORS[loyalty.level] }}>
                {levelLabel(loyalty.level)}
              </span>
            )}
            {client && (
              <button type="button" className="x" onClick={e => { e.stopPropagation(); setClient(null); setBonusUsed(0); if (pay === 'credit') setPay('cash') }}>✕</button>
            )}
          </div>

          {loyalty && (Number(loyalty.bonus) || 0) > 0 && (
            <div className="pos-strip" style={{ background: 'rgba(255,184,0,.06)', borderColor: 'rgba(255,184,0,.2)' }}>
              <span>🎁 Бонусов: <b style={{ color: 'var(--gd)' }}>{loyalty.bonus}</b> · доступно {maxBonus.toFixed(0)}</span>
              <b style={{ color: usedBonus > 0 ? 'var(--gd)' : 'var(--t3)' }}>{usedBonus > 0 ? `списано ${usedBonus.toFixed(0)}` : 'не списаны'}</b>
            </div>
          )}

          <div className="pos-strip">
            <span>Скидка кассира: <b>{discountPct}%</b>{levelDiscPct > 0 ? ` + ${levelDiscPct}% статус` : ''}</span>
            <button type="button" className="set-btn" onClick={() => { setDiscBuf(String(discountPct || '')); setDiscOpen(true) }}>Задать</button>
          </div>

          <div className="pos-items">
            {!cart.length ? (
              <div className="pos-empty"><div style={{ fontSize: 38, opacity: 0.5, marginBottom: 8 }}>🛒</div>Чек пуст.<br />Отсканируйте или выберите товар.</div>
            ) : cart.map(line => {
              const lt = line.weightKg != null ? line.price * line.weightKg : line.price * line.qty
              return (
                <div key={line.key} className="pos-row">
                  <div className="ic">{line.emoji}</div>
                  <div className="info">
                    <div className="name">{line.name}</div>
                    <div className="sub">
                      {line.weightKg != null
                        ? <><span style={{ color: 'var(--pur)', fontWeight: 700 }}>⚖ {line.weightKg.toFixed(3)} кг</span> · {line.price.toFixed(2)}</>
                        : `${line.price.toFixed(2)} × ${line.qty}`}
                    </div>
                  </div>
                  {line.weightKg == null && (
                    <div className="pos-qty">
                      <button type="button" onClick={() => setQty(line.key, line.qty - 1)}>−</button>
                      <span>{line.qty}</span>
                      <button type="button" onClick={() => setQty(line.key, line.qty + 1)}>+</button>
                    </div>
                  )}
                  <div className="price">{lt.toFixed(2)}</div>
                  <button type="button" className="rm" onClick={() => removeLine(line.key)}>✕</button>
                </div>
              )
            })}
          </div>

          <div className="pos-totals">
            <div className="pos-tot-row"><span>Позиций</span><span>{cart.reduce((s, l) => s + (l.weightKg != null ? 1 : l.qty), 0)}</span></div>
            {discAmount > 0 && <div className="pos-tot-row" style={{ color: 'var(--red)' }}><span>Скидка</span><span>−{discAmount.toFixed(2)}</span></div>}
            {usedBonus > 0 && <div className="pos-tot-row" style={{ color: 'var(--red)' }}><span>Бонусы</span><span>−{usedBonus.toFixed(2)}</span></div>}
            <div className="pos-tot-final"><b>Итого</b><span className="sum">{total.toFixed(2)} сом</span></div>
          </div>

          <div className="pos-actions">
            <button type="button" className="pos-chip disc" onClick={() => { setDiscBuf(String(discountPct || '')); setDiscOpen(true) }}><span className="iw">🏷</span><span>Скидка</span></button>
            <button type="button" className="pos-chip bonus" onClick={() => {
              if (!client) { setClientOpen(true); return }
              if (!maxBonus) { showToast('Нет бонусов', 'У клиента нет бонусов'); return }
              setBonusUsed(v => v > 0 ? 0 : maxBonus)
            }}><span className="iw">🎁</span><span>Бонусы</span></button>
            <button type="button" className="pos-chip hold" onClick={() => { if (!client) setClientOpen(true); else { setTopupBuf(''); setTopupOpen(true) } }}><span className="iw">💰</span><span>Пополнить</span></button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '0 14px 8px' }}>
            <button type="button" style={{ fontSize: 10.5, color: 'var(--t3)', fontWeight: 700 }} onClick={clearCart}>Очистить чек</button>
          </div>

          <div className="pos-pay">
            <button type="button" className={`pos-pay-btn pos-pay-cash ${pay === 'cash' ? 'on' : ''}`} onClick={() => setPay('cash')}><span>💵</span>Наличные</button>
            <button type="button" className={`pos-pay-btn pos-pay-card ${pay === 'card' ? 'on' : ''}`} onClick={() => setPay('card')}><span>💳</span>Карта</button>
            <button type="button" className={`pos-pay-btn pos-pay-credit ${pay === 'credit' ? 'on' : ''}`} onClick={() => { setPay('credit'); if (!client) setClientOpen(true) }}><span>📝</span>В долг</button>
            <button type="button" className={`pos-pay-btn pos-pay-qr ${pay === 'qr' ? 'on' : ''}`} onClick={() => setPay('qr')}><span>📱</span>QR</button>
          </div>

          <button type="button" className="pos-checkout" disabled={!cart.length || busy || (pay === 'credit' && !client)} onClick={startPay}>
            <span>🖨</span><span>Оплатить</span>
          </button>
        </div>
      </div>

      {scaleProduct && (
        <div className="pos-overlay">
          <div className="pos-modal" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{scaleProduct.e || '📦'}</div>
            <h3>{scaleProduct.name}</h3>
            <p style={{ fontSize: 11.5, color: 'var(--t2)', marginBottom: 16 }}>Взвешивание на весах…</p>
            <div className="pos-kp-display">
              <div className="val" style={{ color: 'var(--accent)' }}>{scaleWeight.toFixed(3)}</div>
              <div className="lbl">КГ</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 20, fontWeight: 900, color: 'var(--gd)', marginTop: 8 }}>
                {(scaleWeight * (Number(scaleProduct.price) || 0)).toFixed(2)} сом
              </div>
            </div>
          </div>
        </div>
      )}

      {clientOpen && (
        <div className="pos-overlay" onClick={() => setClientOpen(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <h3>👤 Выбор клиента</h3>
            <input className="pos-modal-input" value={clientQ} onChange={e => setClientQ(e.target.value)} placeholder="Телефон, карта или имя…" autoFocus />
            <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
              {clientHits.map(c => {
                const sum = loyaltySummaryForClient(c, cards)
                return (
                  <button key={c.id} type="button" className={`pos-client-hit ${clientPick?.id === c.id ? 'on' : ''}`} onClick={() => setClientPick(c)}>
                    <div className="av">{initialsOf(c.name)}</div>
                    <div>
                      <b style={{ fontSize: 12.5, display: 'block' }}>{c.name}</b>
                      <span style={{ fontSize: 10, color: 'var(--t2)' }}>{c.phone} · {c.card || 'без карты'} · ⭐ {sum.bonus}</span>
                    </div>
                  </button>
                )
              })}
              {clientQ.trim().length >= 2 && !clientHits.length && (
                <div style={{ fontSize: 11, color: 'var(--t3)', padding: 8 }}>Клиент не найден</div>
              )}
            </div>
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" onClick={() => setClientOpen(false)}>Отмена</button>
              <button type="button" className="pos-btn-ok" disabled={!clientPick} onClick={() => { setClient(clientPick); setBonusUsed(0); setClientOpen(false) }}>Выбрать</button>
            </div>
          </div>
        </div>
      )}

      {discOpen && (
        <div className="pos-overlay" onClick={() => setDiscOpen(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <h3>🏷 Скидка на чек</h3>
            <div className="pos-kp-display"><div className="lbl">СКИДКА, %</div><div className="val">{discBuf || '0'}</div></div>
            <div className="pos-quick">
              {[0, 5, 10, 15].map(v => <button key={v} type="button" onClick={() => setDiscBuf(String(v))}>{v}%</button>)}
            </div>
            <Keypad onDigit={k => setDiscBuf(b => appendDigit(b, k, 3))} onBack={() => setDiscBuf(b => b.slice(0, -1))} />
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" onClick={() => setDiscOpen(false)}>Отмена</button>
              <button type="button" className="pos-btn-ok" onClick={() => { setDiscountPct(Math.min(90, Number(discBuf) || 0)); setDiscOpen(false) }}>Применить</button>
            </div>
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="pos-overlay" onClick={() => setManualOpen(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <h3>🔢 Товар без штрихкода</h3>
            <div className="pos-kp-display"><div className="lbl">СУММА</div><div className="val">{(Number(manualBuf) || 0).toFixed(2)} сом</div></div>
            <Keypad onDigit={k => setManualBuf(b => appendDigit(b, k))} onBack={() => setManualBuf(b => b.slice(0, -1))} />
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" onClick={() => setManualOpen(false)}>Отмена</button>
              <button
                type="button"
                className="pos-btn-ok"
                disabled={!(Number(manualBuf) > 0)}
                onClick={() => {
                  const price = Number(manualBuf) || 0
                  setCart(prev => [...prev, { key: `manual-${Date.now()}`, productId: 0, name: 'Товар без штрихкода', emoji: '🔢', price, qty: 1, stock: 999, unit: 'шт' }])
                  setManualOpen(false)
                }}
              >
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}

      {cashOpen && (
        <div className="pos-overlay" onClick={() => !busy && setCashOpen(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <h3>💵 Оплата наличными</h3>
            <div className="pos-kp-display">
              <div className="lbl">К ОПЛАТЕ: {total.toFixed(2)} сом</div>
              <div className="val">{cashReceived.toFixed(2)}</div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Сдача</span>
                <b className="pos-mono" style={{ color: cashChange < 0 ? 'var(--red)' : 'var(--gd)' }}>{cashChange.toFixed(2)} сом</b>
              </div>
            </div>
            <div className="pos-quick">
              {[total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100].map((v, i) => (
                <button key={i} type="button" onClick={() => setCashBuf(String(Math.round(v)))}>{Math.round(v)}</button>
              ))}
            </div>
            <Keypad onDigit={k => setCashBuf(b => appendDigit(b, k))} onBack={() => setCashBuf(b => b.slice(0, -1))} />
            {msg && <div className="pos-err">{msg}</div>}
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" disabled={busy} onClick={() => setCashOpen(false)}>Отмена</button>
              <button type="button" className="pos-btn-ok" disabled={busy || cashReceived < total - 0.001} onClick={() => void submitSale(cashReceived)}>Подтвердить</button>
            </div>
          </div>
        </div>
      )}

      {topupOpen && client && (
        <div className="pos-overlay" onClick={() => !busy && setTopupOpen(false)}>
          <div className="pos-modal" onClick={e => e.stopPropagation()}>
            <h3>💰 Наличные → бонусы</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12 }}>Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b></div>
            <div className="pos-kp-display"><div className="lbl">СУММА НАЛИЧНЫХ</div><div className="val">{topupCash.toFixed(2)} сом</div></div>
            <Keypad onDigit={k => setTopupBuf(b => appendDigit(b, k))} onBack={() => setTopupBuf(b => b.slice(0, -1))} />
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Внесено</span><b className="pos-mono">{topupCash.toFixed(2)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)' }}><span>Бонус</span><b className="pos-mono">+{topupBonus}</b></div>
            </div>
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" onClick={() => setTopupOpen(false)}>Отмена</button>
              <button type="button" className="pos-btn-ok" disabled={busy || topupCash <= 0 || topupBonus <= 0} onClick={() => void submitTopup()}>Начислить</button>
            </div>
          </div>
        </div>
      )}

      {zOpen && (
        <div className="pos-overlay" onClick={() => !busy && setZOpen(false)}>
          <div className="pos-modal wide" onClick={e => e.stopPropagation()}>
            <h3>📊 Закрытие смены</h3>
            <div className="pos-z-grid">
              <div className="pos-z-stat"><div className="l">Продаж</div><div className="v">{activeShift.salesCount}</div></div>
              <div className="pos-z-stat"><div className="l">Старт кассы</div><div className="v" style={{ color: 'var(--gd)' }}>{fmtMoney(activeShift.openingCash)}</div></div>
              <div className="pos-z-stat"><div className="l">Наличные</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtMoney(activeShift.salesCash)}</div></div>
              <div className="pos-z-stat"><div className="l">Карта</div><div className="v" style={{ color: 'var(--blue)' }}>{fmtMoney(activeShift.salesCard)}</div></div>
              <div className="pos-z-stat"><div className="l">В долг</div><div className="v" style={{ color: 'var(--org)' }}>{fmtMoney(activeShift.salesCredit)}</div></div>
              <div className="pos-z-stat"><div className="l">Ожид. в кассе</div><div className="v">{fmtMoney(activeShift.openingCash + activeShift.salesCash)}</div></div>
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: 8 }}>Наличные сейчас в кассе</label>
            <input className="pos-modal-input" value={closingCash} onChange={e => setClosingCash(sanitizeDecimalInput(e.target.value))} inputMode="decimal" placeholder="0.00" />
            {msg && <div className="pos-err">{msg}</div>}
            <div className="pos-modal-actions">
              <button type="button" className="pos-btn-cancel" disabled={busy} onClick={() => setZOpen(false)}>Отмена</button>
              <button type="button" className="pos-btn-ok" disabled={busy} onClick={() => void closeShift()}>Закрыть смену</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pos-toast">
          <div style={{ width: 34, height: 34, borderRadius: 11, background: 'rgba(31,215,96,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔔</div>
          <div><b style={{ fontSize: 13, display: 'block' }}>{toast.title}</b><span style={{ fontSize: 10.5, color: 'var(--t2)' }}>{toast.sub}</span></div>
        </div>
      )}
    </div>
  )
}
