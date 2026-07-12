'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { loyaltySummaryForClient } from '@/lib/clientCardSync'
import {
  CLIENT_LEVEL_COLORS,
  CLIENT_LEVEL_OPTIONS,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
} from '@/lib/clientCrm'
import { syncClientsFromApi, useClientStore } from '@/lib/clientStore'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  loadBalanceTopups,
  loadDebtHistory,
  recordBalanceTopup,
  recordStoreDebtRepayment,
  subscribeBalanceTopup,
  subscribeDebtHistory,
} from '@/lib/clientVipCredit'
import {
  calcCashDepositBonus,
  cashDepositTierForAmount,
  cashDepositTierLabel,
  resolveEffectiveDebtLimit,
} from '@/lib/loyaltyStatusConfig'
import { filterProductsBySearch, productBarcodes } from '@/lib/productBarcodes'
import { useProductPhotos } from '@/lib/productPhotos'
import { isWeighted } from '@/lib/productWeight'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import type { Product } from '@/lib/types'
import { useCategories } from '@/lib/useCategories'
import { fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'
import { POS_MOCK_CSS } from './posMockCss'

const SETTINGS_KEY = 'kakapo_trade_pos_settings'
const THEME_KEY = 'kakapo_trade_pos_theme'

type ThemeName = 'green' | 'purple' | 'gold'
type PayMethod = 'cash' | 'card' | 'credit' | 'qr' | 'balance'
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
  art?: string
  barcode?: string
  weightKg?: number
}

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
    <div className="keypad">
      {keys.map(k => (
        <button key={k} type="button" className={k === '⌫' ? 'kp-clear' : undefined} onClick={() => (k === '⌫' ? onBack() : onDigit(k))}>
          {k}
        </button>
      ))}
    </div>
  )
}

function TopMetaClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="top-clock">
      <div className="tm">
        {now
          ? now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '--:--:--'}
      </div>
      <div className="dt">
        {now
          ? now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
          : '—'}
      </div>
    </div>
  )
}

type NavTarget = 'products' | 'clients' | 'debts' | 'warehouse' | 'reports' | 'suppliers' | 'finance'

export default function CashierModule({
  onExit,
  onNavigate: _onNavigate,
}: {
  onExit?: () => void
  onNavigate?: (page: NavTarget) => void
}) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const shifts = usePosStore(s => s.shifts)
  const cashiers = usePosStore(s => s.cashiers)
  const sales = usePosStore(s => s.sales)
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
  const [zOpen, setZOpen] = useState(false)
  const [closingCash, setClosingCash] = useState('')
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupBuf, setTopupBuf] = useState('')
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayBuf, setRepayBuf] = useState('')
  const [repayMethod, setRepayMethod] = useState<'cash' | 'card'>('cash')
  const [histOpen, setHistOpen] = useState(false)
  const [histTick, setHistTick] = useState(0)
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
  useEffect(() => {
    const bump = () => setHistTick(n => n + 1)
    const offDebt = subscribeDebtHistory(bump)
    const offTopup = subscribeBalanceTopup(bump)
    return () => { offDebt(); offTopup() }
  }, [])

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
  const clientDebt = Number(loyalty?.debt) || 0

  type ClientHistRow = {
    id: string
    ts: number
    when: string
    title: string
    sub: string
    amount: number
    tone: 'sale' | 'credit' | 'repay' | 'topup'
  }

  const clientHistory = useMemo(() => {
    void histTick
    if (!client) return [] as ClientHistRow[]
    const rows: ClientHistRow[] = []
    for (const s of sales) {
      const matchId = client.id && s.clientId === client.id
      const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
      if (!matchId && !matchPhone) continue
      const isCredit = s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0
      const methodLabel = isCredit
        ? 'В долг'
        : s.paymentMethod === 'cash'
          ? 'Наличные'
          : s.paymentMethod === 'card'
            ? 'Карта'
            : s.paymentMethod === 'mixed'
              ? 'Смешанная'
              : String(s.paymentMethod)
      const when = new Date(s.createdAtIso)
      rows.push({
        id: `sale-${s.id}`,
        ts: when.getTime() || 0,
        when: Number.isNaN(when.getTime())
          ? s.createdAtIso
          : `${when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        title: isCredit ? 'Чек в долг' : 'Чек',
        sub: methodLabel,
        amount: Number(s.total) || 0,
        tone: isCredit ? 'credit' : 'sale',
      })
    }
    if (client.phone) {
      for (const h of loadDebtHistory(client.phone)) {
        if (h.type !== 'pay') continue
        rows.push({
          id: `repay-${h.id}`,
          ts: h.ts || 0,
          when: `${h.date}${h.time ? ` · ${h.time}` : ''}`,
          title: 'Погашение долга',
          sub: h.desc || 'Погашение',
          amount: Number(h.amount) || 0,
          tone: 'repay',
        })
      }
      for (const t of loadBalanceTopups(client.phone)) {
        rows.push({
          id: `topup-${t.id}`,
          ts: t.ts || 0,
          when: `${t.date}${t.time ? ` · ${t.time}` : ''}`,
          title: 'Пополнение баланса',
          sub: t.bonus > 0 ? `+${t.bonus} ⭐ бонус` : 'Без бонуса',
          amount: Number(t.cash) || 0,
          tone: 'topup',
        })
      }
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, 80)
  }, [client, sales, histTick])

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
      const art = String(p.art || '').trim()
      const barcode = productBarcodes(p)[0] || ''
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
          art,
          barcode,
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
        art,
        barcode,
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
    if ((pay === 'credit' || pay === 'balance') && !client) {
      setClientOpen(true)
      return
    }
    if (pay === 'credit' && total > availableDebt + 0.001) {
      showToast('Лимит долга', `Доступно ${fmtMoney(availableDebt)}`)
      return
    }
    if (pay === 'balance' && total > 0.001) {
      showToast('Недостаточно баланса', 'Спишите бонусы или выберите другой способ')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const method = pay === 'qr' || pay === 'balance' ? 'card' : pay
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
      if (client && usedBonus > 0 && USE_API && client.card) {
        try {
          const nextBonus = Math.max(0, (Number(loyalty?.bonus) || 0) - Math.floor(usedBonus))
          await api.updateCard(client.card, { bonus: nextBonus, allowBonusDecrease: true })
        } catch { /* ignore */ }
      }
      await refresh()
      const change = method === 'cash' ? Math.max(0, paidCash - total) : 0
      const toastSub = method === 'cash'
        ? `Наличные · сдача ${fmtMoney(change)}`
        : pay === 'credit'
          ? `В долг · ${client?.name || ''}`
          : pay === 'balance'
            ? 'Баланс / бонусы'
            : pay === 'qr'
              ? 'QR'
              : 'Карта'
      showToast('Чек проведён', toastSub)
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
    if ((pay === 'credit' || pay === 'balance') && !client) {
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
      if (client.phone) recordBalanceTopup(client.phone, cash, bonus)
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

  async function submitDebtRepay() {
    if (!client) return
    const amount = Number(repayBuf) || 0
    const prevDebt = clientDebt
    if (amount <= 0) return
    if (amount > prevDebt + 0.001) {
      showToast('Слишком много', `Долг клиента ${fmtMoney(prevDebt)}`)
      return
    }
    setBusy(true)
    try {
      if (!client.card) throw new Error('У клиента нет карты')
      const nextDebt = Math.max(0, prevDebt - amount)
      await api.updateCard(client.card, { debt: nextDebt })
      if (client.phone) recordStoreDebtRepayment(client.phone, amount, { method: repayMethod })
      await refresh()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setRepayOpen(false)
      setRepayBuf('')
      setRepayMethod('cash')
      showToast('Долг погашен', `${client.name}: −${fmtMoney(amount)} · ${repayMethod === 'cash' ? 'нал' : 'карта'} · остаток ${fmtMoney(nextDebt)}`)
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось погасить долг')
    } finally {
      setBusy(false)
    }
  }

  function needClient(then: () => void) {
    if (!client) {
      setClientOpen(true)
      showToast('Выберите клиента', 'Сначала выберите клиента вверху чека')
      return
    }
    then()
  }

  // ─── Gate ───
  if (!activeShift) {
    return (
      <div className="pos-root" data-theme={theme}>
        <style>{POS_MOCK_CSS}</style>
        <div className="gate">
          <div className="gate-bg" />
          <div className="gate-card">
            <div className="gate-logo">K</div>
            <div className="gate-title">Открытие смены</div>
            <div className="gate-sub">KAKAPO Касса · г. Яван, РЦ №1</div>
            <span className="gate-label">Кто работает?</span>
            <div className="cashier-grid">
              {cashierOptions.slice(0, 6).map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`cashier-opt ${pickedCashierId === c.id ? 'on' : ''}`}
                  onClick={() => { setPickedCashierId(c.id); setGateName(c.name) }}
                >
                  <div className="av">{initialsOf(c.name)}</div>
                  <span>{c.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            {!cashiers.length && (
              <>
                <span className="gate-label">Имя кассира</span>
                <input className="gate-input" value={gateName} onChange={e => setGateName(e.target.value)} placeholder="Кассир" />
              </>
            )}
            <span className="gate-label">Наличные в кассе на начало смены</span>
            <input className="gate-input" value={gateCash} onChange={e => setGateCash(sanitizeDecimalInput(e.target.value))} inputMode="decimal" />
            <div className="kp-quick" style={{ marginBottom: 16 }}>
              {[0, 100, 500, 1000].map(v => (
                <button key={v} type="button" onClick={() => setGateCash(v === 0 ? '0.00' : String(v))}>{v === 0 ? 'Пустая' : `${v}`}</button>
              ))}
            </div>
            {msg && <div className="pos-err">{msg}</div>}
            <button type="button" className="btn-gate" disabled={busy} onClick={() => void openShift()}>
              {busy ? 'Открываем…' : 'Открыть смену'}
            </button>
            {onExit && (
              <button type="button" className="btn-switch-till" style={{ marginTop: 10 }} onClick={onExit}>
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
  const topupTier = cashDepositTierForAmount(topupCash)
  const repayAmount = Number(repayBuf) || 0
  const repayRemain = Math.max(0, clientDebt - repayAmount)

  return (
    <div className="pos-root" data-theme={theme}>
      <style>{POS_MOCK_CSS}</style>
      <div className="app">
        <div className="topbar">
          <div className="searchpill">
            <span className="ic">🔍</span>
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
            <span className="scan-tag">📷 Сканер</span>
          </div>

          <div className="top-meta">
            <div className="top-loc">
              <b>Магазин · Ленина 42</b>
              <div className="dot-row"><span className="d" />Онлайн</div>
            </div>
            <TopMetaClock />
            <button type="button" className="btn-switch-till" onClick={() => { setClosingCash(''); setMsg(''); setZOpen(true) }}>
              <span className="sw-ic">🔁</span>
              Сменить кассу
            </button>
          </div>

          <div className="theme-dots">
            {([
              ['green', '#1FD760'],
              ['purple', '#9B6DFF'],
              ['gold', '#FFB800'],
            ] as [ThemeName, string][]).map(([name, color]) => (
              <button
                key={name}
                type="button"
                className={`theme-dot ${theme === name ? 'on' : ''}`}
                style={{ background: color }}
                onClick={() => { setTheme(name); localStorage.setItem(THEME_KEY, name) }}
              />
            ))}
          </div>
          <button type="button" className="bell-btn" title="Уведомления" onClick={() => showToast('Уведомления', 'Нет новых уведомлений')}>
            🔔<span className="bell-badge" />
          </button>
          <button type="button" className="account-btn" onClick={() => { setClosingCash(''); setMsg(''); setZOpen(true) }}>
            <div className="account-av">{settings.initials}</div>
            <div className="info">
              <b>{settings.cashierName}</b>
              <span>Администратор ▾</span>
            </div>
          </button>
        </div>

        <div className="products">
          <div className="cat-row">
            <button type="button" className={`cat-pill ${!catFilter ? 'on' : ''}`} onClick={() => setCatFilter(null)}>🗂 Все товары</button>
            {roots.map(c => (
              <button key={c.id} type="button" className={`cat-pill ${catFilter === c.id ? 'on' : ''}`} onClick={() => setCatFilter(c.id)}>
                {c.emoji || '📦'} {c.name}
              </button>
            ))}
          </div>
          <div className="grid-wrap">
            <div className="p-grid">
              {visibleProducts.map(p => {
                const stock = Number(p.stock) || 0
                const photo = p.photo || getPhoto(p.id)
                const weighted = isWeighted(p)
                const unit = weighted ? 'кг' : (p.unit || 'шт')
                const unitShort = unit.replace(/^[\d.,\s]+/, '') || unit
                const barcode = productBarcodes(p)[0] || ''
                const art = String(p.art || '').trim()
                return (
                  <button key={p.id} type="button" className="p-tile" onClick={() => addProduct(p)}>
                    <div className="p-photo">
                      {photo ? <img src={photo} alt="" /> : (p.e || '📦')}
                      {weighted && <span className="p-weight-tag">⚖ {unitShort}</span>}
                    </div>
                    <div className="p-name">{p.name}</div>
                    <div className="p-codes">
                      {art ? <span>арт. {art}</span> : null}
                      {barcode ? <span>ш/к {barcode}</span> : null}
                      {!art && !barcode ? <span className="muted">без кода</span> : null}
                    </div>
                    <div className="p-price">{(Number(p.price) || 0).toFixed(2)}<span className="p-unit"> ЅМ/{unitShort}</span></div>
                    <div className={`p-stock ${stock < 5 ? 'low' : ''}`}>В наличии: {stock}{weighted ? ' кг' : ' шт'}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="cart">
          <div className={`client-card ${client ? 'set' : ''}`} onClick={() => { setClientQ(''); setClientPick(client); setClientOpen(true) }}>
            <div className="client-av">{client ? initialsOf(client.name) : '👤'}</div>
            <div className="client-info">
              <div className="nm-row">
                <div className="nm">{client?.name || 'Гость'}</div>
                {client && (
                  <button
                    type="button"
                    className="client-hist-link"
                    onClick={e => { e.stopPropagation(); setHistOpen(true) }}
                  >
                    История
                  </button>
                )}
              </div>
              <div className="ph">{client ? client.phone : 'Нажмите чтобы выбрать клиента'}</div>
              {client && loyalty && (
                <div className="client-bonus">
                  ⭐ {loyalty.bonus} бон.
                  {clientDebt > 0 ? <> · долг {fmtMoney(clientDebt)}</> : null}
                </div>
              )}
            </div>
            {client && loyalty && (
              <span className="client-tier" style={{ background: `${CLIENT_LEVEL_COLORS[loyalty.level]}22`, color: CLIENT_LEVEL_COLORS[loyalty.level] }}>
                {levelLabel(loyalty.level)}
              </span>
            )}
            {client && (
              <button type="button" className="client-x" onClick={e => { e.stopPropagation(); setClient(null); setBonusUsed(0); if (pay === 'credit' || pay === 'balance') setPay('cash') }}>✕</button>
            )}
          </div>

          {loyalty && (
            <div className="tier-strip">
              <span className="lbl">
                🎁 <b>{loyalty.bonus}</b>
                {(Number(loyalty.debt) || 0) > 0 ? <> · долг <b style={{ color: 'var(--org)' }}>{fmtMoney(Number(loyalty.debt))}</b></> : null}
                {debtLimit > 0 ? <> · лимит {fmtMoney(availableDebt)}</> : null}
              </span>
              <b>{usedBonus > 0 ? `−${usedBonus.toFixed(0)} бон.` : 'бонусы'}</b>
            </div>
          )}

          <div className="discount-strip">
            <span className="lbl">Скидка кассира: <b>{discountPct}%</b>{levelDiscPct > 0 ? ` + ${levelDiscPct}% статус` : ''}</span>
            <button type="button" className="set-btn" onClick={() => { setDiscBuf(String(discountPct || '')); setDiscOpen(true) }}>Задать</button>
          </div>

          <div className="cart-items">
            {!cart.length ? (
              <div className="cart-empty"><div className="ic">🛒</div>Чек пуст.<br />Отсканируйте или выберите товар.</div>
            ) : cart.map(line => {
              const lt = line.weightKg != null ? line.price * line.weightKg : line.price * line.qty
              return (
                <div key={line.key} className="cart-row">
                  <div className="ic">{line.emoji}</div>
                  <div className="info">
                    <div className="name">{line.name}</div>
                    {(line.art || line.barcode) && (
                      <div className="codes">
                        {line.art ? <span>арт. {line.art}</span> : null}
                        {line.barcode ? <span>ш/к {line.barcode}</span> : null}
                      </div>
                    )}
                    <div className="sub">
                      {line.weightKg != null
                        ? <><span className="w">{line.weightKg.toFixed(3)} кг</span> · {line.price.toFixed(2)} ЅМ/{line.unit}</>
                        : `${line.price.toFixed(2)} ЅМ × ${line.qty}`}
                    </div>
                  </div>
                  {line.weightKg == null && (
                    <div className="qtyctrl">
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

          <div className="cart-totals">
            <div className="tot-row"><span>Позиций</span><span>{cart.reduce((s, l) => s + (l.weightKg != null ? 1 : l.qty), 0)}</span></div>
            {discAmount > 0 && <div className="tot-row disc"><span>Скидка</span><span>−{discAmount.toFixed(2)}</span></div>}
            {usedBonus > 0 && <div className="tot-row disc"><span>Списано бонусами</span><span>−{usedBonus.toFixed(2)}</span></div>}
            <div className="tot-final"><b>Итого</b><span className="sum">{total.toFixed(2)} ЅМ</span></div>
          </div>

          <div className="ops-block ops-client">
            <div className="ops-lbl">Операции с клиентом · не трогают чек</div>
            <div className="action-row">
              <button
                type="button"
                className="action-chip ac-repay"
                onClick={() => needClient(() => {
                  if (clientDebt <= 0) { showToast('Нет долга', 'У клиента нет задолженности'); return }
                  setRepayBuf('')
                  setRepayMethod('cash')
                  setRepayOpen(true)
                })}
              >
                <span className="ic-wrap">💳</span><span>Погасить долг</span>
              </button>
              <button
                type="button"
                className="action-chip ac-topup"
                onClick={() => needClient(() => { setTopupBuf(''); setTopupOpen(true) })}
              >
                <span className="ic-wrap">💰</span><span>Пополнить баланс</span>
              </button>
            </div>
          </div>

          <div className="ops-block ops-check">
            <div className="ops-lbl">Этот чек</div>
            <div className="action-row">
              <button type="button" className={`action-chip ac-discount ${discountPct > 0 ? 'on' : ''}`} onClick={() => { setDiscBuf(String(discountPct || '')); setDiscOpen(true) }}>
                <span className="ic-wrap">🏷</span><span>Скидка{discountPct > 0 ? ` ${discountPct}%` : ''}</span>
              </button>
              <button
                type="button"
                className={`action-chip ac-bonus ${usedBonus > 0 ? 'on' : ''}`}
                onClick={() => needClient(() => {
                  if (!maxBonus) { showToast('Нет бонусов', 'У клиента нет бонусов'); return }
                  if (pay === 'credit') { showToast('В долг', 'С бонусами нельзя оплатить в долг'); return }
                  setBonusUsed(v => v > 0 ? 0 : maxBonus)
                  if (pay === 'balance') setPay('cash')
                })}
              >
                <span className="ic-wrap">🎁</span><span>{usedBonus > 0 ? `Бонусы −${usedBonus.toFixed(0)}` : 'Бонусы'}</span>
              </button>
            </div>
          </div>

          <div className="link-row">
            <button type="button" onClick={clearCart}>Очистить чек</button>
          </div>

          <div className="ops-block pay-block">
            <div className="ops-lbl">Оплата текущего чека</div>
            <div className="pay-grid">
              <button type="button" className={`pay-btn pay-cash ${pay === 'cash' ? 'on' : ''}`} onClick={() => setPay('cash')}>
                <span className="ic">💵</span>Наличные
              </button>
              <button type="button" className={`pay-btn pay-card ${pay === 'card' ? 'on' : ''}`} onClick={() => setPay('card')}>
                <span className="ic">💳</span>Карта
              </button>
              <button
                type="button"
                className={`pay-btn pay-credit ${pay === 'credit' ? 'on' : ''}`}
                onClick={() => needClient(() => {
                  setBonusUsed(0)
                  setPay('credit')
                })}
              >
                <span className="ic">📝</span>В долг
              </button>
              <button type="button" className={`pay-btn pay-qr ${pay === 'qr' ? 'on' : ''}`} onClick={() => setPay('qr')}>
                <span className="ic">📱</span>QR
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-checkout"
            disabled={!cart.length || busy || (pay === 'credit' && !client)}
            onClick={startPay}
          >
            <span>🖨</span><span>{pay === 'credit' ? 'В долг' : 'Оплатить'}</span>
          </button>
        </div>
      </div>

      {scaleProduct && (
        <div className="overlay">
          <div className="modal-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{scaleProduct.e || '📦'}</div>
            <h3>{scaleProduct.name}</h3>
            <p style={{ fontSize: 11.5, color: 'var(--t2)', marginBottom: 16 }}>Взвешивание на весах…</p>
            <div className="kp-display">
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
        <div className="overlay" onClick={() => setClientOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>👤 Выбор клиента</h3>
            <input className="modal-card-input" value={clientQ} onChange={e => setClientQ(e.target.value)} placeholder="Телефон, карта или имя…" autoFocus />
            <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
              {clientHits.map(c => {
                const sum = loyaltySummaryForClient(c, cards)
                return (
                  <button key={c.id} type="button" className={`client-result ${clientPick?.id === c.id ? 'on' : ''}`} onClick={() => setClientPick(c)}>
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
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setClientOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={!clientPick} onClick={() => { setClient(clientPick); setBonusUsed(0); setClientOpen(false) }}>Выбрать</button>
            </div>
          </div>
        </div>
      )}

      {discOpen && (
        <div className="overlay" onClick={() => setDiscOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>🏷 Скидка на чек</h3>
            <div className="kp-display"><div className="lbl">СКИДКА, %</div><div className="val">{discBuf || '0'}</div></div>
            <div className="kp-quick">
              {[0, 5, 10, 15].map(v => <button key={v} type="button" onClick={() => setDiscBuf(String(v))}>{v}%</button>)}
            </div>
            <Keypad onDigit={k => setDiscBuf(b => appendDigit(b, k, 3))} onBack={() => setDiscBuf(b => b.slice(0, -1))} />
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setDiscOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" onClick={() => { setDiscountPct(Math.min(90, Number(discBuf) || 0)); setDiscOpen(false) }}>Применить</button>
            </div>
          </div>
        </div>
      )}

      {cashOpen && (
        <div className="overlay" onClick={() => !busy && setCashOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>💵 Оплата наличными</h3>
            <div className="kp-display">
              <div className="lbl">К ОПЛАТЕ: {total.toFixed(2)} сом</div>
              <div className="val">{cashReceived.toFixed(2)}</div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Сдача</span>
                <b className="mono" style={{ color: cashChange < 0 ? 'var(--red)' : 'var(--gd)' }}>{cashChange.toFixed(2)} сом</b>
              </div>
            </div>
            <div className="kp-quick">
              {[total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100].map((v, i) => (
                <button key={i} type="button" onClick={() => setCashBuf(String(Math.round(v)))}>{Math.round(v)}</button>
              ))}
            </div>
            <Keypad onDigit={k => setCashBuf(b => appendDigit(b, k))} onBack={() => setCashBuf(b => b.slice(0, -1))} />
            {msg && <div className="pos-err">{msg}</div>}
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" disabled={busy} onClick={() => setCashOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={busy || cashReceived < total - 0.001} onClick={() => void submitSale(cashReceived)}>Подтвердить</button>
            </div>
          </div>
        </div>
      )}

      {topupOpen && client && (
        <div className="overlay" onClick={() => !busy && setTopupOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>💰 Пополнить баланс</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
              Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>Не связано с текущим чеком · бонусы по порогам</div>
            </div>
            <div className="kp-display"><div className="lbl">СУММА ПОПОЛНЕНИЯ</div><div className="val">{topupCash.toFixed(2)} сом</div></div>
            <Keypad onDigit={k => setTopupBuf(b => appendDigit(b, k))} onBack={() => setTopupBuf(b => b.slice(0, -1))} />
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Внесено</span><b className="mono">{topupCash.toFixed(2)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)' }}><span>Бонус на карту</span><b className="mono">+{topupBonus}</b></div>
              <div style={{ fontSize: 10.5, color: 'var(--t3)' }}>
                {topupTier ? cashDepositTierLabel(topupTier) : 'Порог не достигнут — настройте в админке «Статус карты»'}
              </div>
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setTopupOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={busy || topupCash <= 0 || topupBonus <= 0} onClick={() => void submitTopup()}>Пополнить</button>
            </div>
          </div>
        </div>
      )}

      {repayOpen && client && (
        <div className="overlay" onClick={() => !busy && setRepayOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>💳 Погасить долг</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
              Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>Старый долг · текущий чек не затрагивается</div>
            </div>
            <div className="kp-display">
              <div className="lbl">ТЕКУЩИЙ ДОЛГ</div>
              <div className="val" style={{ color: 'var(--org)' }}>{clientDebt.toFixed(2)} сом</div>
            </div>
            <div className="kp-display" style={{ marginTop: -6 }}>
              <div className="lbl">СУММА ОПЛАТЫ</div>
              <div className="val">{repayAmount.toFixed(2)} сом</div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Останется долг</span>
                <b className="mono" style={{ color: repayRemain > 0 ? 'var(--org)' : 'var(--gd)' }}>{repayRemain.toFixed(2)}</b>
              </div>
            </div>
            <div className="kp-quick">
              {clientDebt > 0 && <button type="button" onClick={() => setRepayBuf(String(clientDebt))}>Весь долг</button>}
            </div>
            <div className="repay-methods">
              <button type="button" className={`repay-m ${repayMethod === 'cash' ? 'on' : ''}`} onClick={() => setRepayMethod('cash')}>💵 Наличные</button>
              <button type="button" className={`repay-m ${repayMethod === 'card' ? 'on' : ''}`} onClick={() => setRepayMethod('card')}>💳 Карта</button>
            </div>
            <Keypad onDigit={k => setRepayBuf(b => appendDigit(b, k))} onBack={() => setRepayBuf(b => b.slice(0, -1))} />
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setRepayOpen(false)}>Отмена</button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy || repayAmount <= 0 || repayAmount > clientDebt + 0.001}
                onClick={() => void submitDebtRepay()}
              >
                Погасить
              </button>
            </div>
          </div>
        </div>
      )}

      {histOpen && client && (
        <div className="overlay" onClick={() => setHistOpen(false)}>
          <div className="modal-card hist-card" onClick={e => e.stopPropagation()}>
            <h3>История · {client.name}</h3>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>Чеки, погашения долга и пополнения баланса</div>
            <div className="hist-list">
              {!clientHistory.length && (
                <div style={{ fontSize: 12, color: 'var(--t3)', padding: '20px 8px', textAlign: 'center' }}>Пока нет операций</div>
              )}
              {clientHistory.map(row => (
                <div key={row.id} className={`hist-row tone-${row.tone}`}>
                  <div className="hist-main">
                    <b>{row.title}</b>
                    <span className="hist-when">{row.when}</span>
                    <span className="hist-sub">{row.sub}</span>
                  </div>
                  <div className="hist-amt">{fmtMoney(row.amount)}</div>
                </div>
              ))}
            </div>
            <div className="modal-card-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-cancel" onClick={() => setHistOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {zOpen && (
        <div className="overlay" onClick={() => !busy && setZOpen(false)}>
          <div className="modal-card wide-card" onClick={e => e.stopPropagation()}>
            <h3>📊 Закрытие смены</h3>
            <div className="z-grid">
              <div className="z-stat"><div className="l">Продаж</div><div className="v">{activeShift.salesCount}</div></div>
              <div className="z-stat"><div className="l">Старт кассы</div><div className="v" style={{ color: 'var(--gd)' }}>{fmtMoney(activeShift.openingCash)}</div></div>
              <div className="z-stat"><div className="l">Наличные</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtMoney(activeShift.salesCash)}</div></div>
              <div className="z-stat"><div className="l">Карта</div><div className="v" style={{ color: 'var(--blue)' }}>{fmtMoney(activeShift.salesCard)}</div></div>
              <div className="z-stat"><div className="l">В долг</div><div className="v" style={{ color: 'var(--org)' }}>{fmtMoney(activeShift.salesCredit)}</div></div>
              <div className="z-stat"><div className="l">Ожид. в кассе</div><div className="v">{fmtMoney(activeShift.openingCash + activeShift.salesCash)}</div></div>
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', display: 'block', marginBottom: 8 }}>Наличные сейчас в кассе</label>
            <input className="modal-card-input" value={closingCash} onChange={e => setClosingCash(sanitizeDecimalInput(e.target.value))} inputMode="decimal" placeholder="0.00" />
            {msg && <div className="pos-err">{msg}</div>}
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" disabled={busy} onClick={() => setZOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={busy} onClick={() => void closeShift()}>Закрыть смену</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <div style={{ width: 34, height: 34, borderRadius: 11, background: 'rgba(31,215,96,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔔</div>
          <div><b style={{ fontSize: 13, display: 'block' }}>{toast.title}</b><span style={{ fontSize: 10.5, color: 'var(--t2)' }}>{toast.sub}</span></div>
        </div>
      )}
    </div>
  )
}
