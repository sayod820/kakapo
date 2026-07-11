'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { filterProductsBySearch } from '@/lib/productBarcodes'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import { useProducts } from '@/lib/store'
import type { PosCashier, PosShift, Product } from '@/lib/types'
import { useCategories } from '@/lib/useCategories'
import { fmtDateTime, fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'

const SETTINGS_KEY = 'kakapo_trade_pos_settings'

type PosSettings = {
  cashierId: string
  cashierName: string
}

type CartLine = {
  productId: number
  name: string
  emoji: string
  price: number
  qty: number
  stock: number
  unit: string
}

type PayMethod = 'cash' | 'card'

function loadSettings(): PosSettings {
  if (typeof window === 'undefined') return { cashierId: '', cashierName: 'Кассир' }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { cashierId: '', cashierName: 'Кассир' }
    const parsed = JSON.parse(raw) as PosSettings
    return {
      cashierId: String(parsed.cashierId || ''),
      cashierName: String(parsed.cashierName || 'Кассир').trim() || 'Кассир',
    }
  } catch {
    return { cashierId: '', cashierName: 'Кассир' }
  }
}

function saveSettings(s: PosSettings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0)
}

export default function CashierModule({ search = '' }: { search?: string }) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const shifts = usePosStore(s => s.shifts)
  const cashiers = usePosStore(s => s.cashiers)
  const apiSyncing = usePosStore(s => s.apiSyncing)
  const apiError = usePosStore(s => s.apiError)
  const { roots } = useCategories()

  const [settings, setSettings] = useState<PosSettings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openShiftOpen, setOpenShiftOpen] = useState(false)
  const [closeShiftOpen, setCloseShiftOpen] = useState(false)
  const [openingCash, setOpeningCash] = useState('')
  const [closingCash, setClosingCash] = useState('')
  const [settingsName, setSettingsName] = useState(settings.cashierName)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [payOpen, setPayOpen] = useState(false)
  const [payMethod, setPayMethod] = useState<PayMethod>('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [saleMsg, setSaleMsg] = useState('')

  const refreshPos = useCallback(async () => {
    await Promise.all([syncPosFromApi(), fetchProducts()])
  }, [fetchProducts])

  useEffect(() => {
    void refreshPos()
  }, [refreshPos])

  const activeShift = useMemo(() => {
    if (!settings.cashierId) return null
    return shifts.find(s => s.status === 'open' && s.cashierId === settings.cashierId) || null
  }, [shifts, settings.cashierId])

  const visibleProducts = useMemo(() => {
    let list = products.filter(p => (Number(p.stock) || 0) > 0)
    if (catFilter) list = list.filter(p => p.catId === catFilter || p.cat === catFilter)
    if (search.trim()) list = filterProductsBySearch(list, search.trim())
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [products, catFilter, search])

  const total = useMemo(() => cartTotal(cart), [cart])

  async function ensureCashier(name: string): Promise<PosCashier> {
    const trimmed = name.trim() || 'Кассир'
    const existing = cashiers.find(c => c.name === trimmed)
    if (existing) return existing
    if (!USE_API) throw new Error('Нужен API сервер для кассы')
    return api.createCashier({ name: trimmed, pin: '0000' })
  }

  async function saveSettingsForm() {
    setBusy(true)
    setMsg('')
    try {
      const cashier = await ensureCashier(settingsName)
      const next = { cashierId: cashier.id, cashierName: cashier.name }
      saveSettings(next)
      setSettings(next)
      setSettingsOpen(false)
      await refreshPos()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  async function submitOpenShift() {
    const cash = Number(openingCash) || 0
    if (cash < 0) {
      setMsg('Укажите сумму наличных в кассе')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      let cashierId = settings.cashierId
      if (!cashierId) {
        const cashier = await ensureCashier(settings.cashierName)
        cashierId = cashier.id
        const next = { cashierId, cashierName: cashier.name }
        saveSettings(next)
        setSettings(next)
      }
      if (!USE_API) throw new Error('Касса работает только с подключённым API')
      await api.openPosShift({ cashierId, openingCash: cash })
      await refreshPos()
      setOpenShiftOpen(false)
      setOpeningCash('')
      setCart([])
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось открыть смену')
    } finally {
      setBusy(false)
    }
  }

  async function submitCloseShift() {
    if (!activeShift) return
    const cash = Number(closingCash)
    if (!(cash >= 0)) {
      setMsg('Укажите сумму наличных в кассе при закрытии')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      await api.closePosShift(activeShift.id, { closingCash: cash })
      await refreshPos()
      setCloseShiftOpen(false)
      setClosingCash('')
      setCart([])
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось закрыть смену')
    } finally {
      setBusy(false)
    }
  }

  function addToCart(p: Product) {
    const stock = Number(p.stock) || 0
    if (stock <= 0) return
    setCart(prev => {
      const idx = prev.findIndex(l => l.productId === p.id)
      if (idx >= 0) {
        const next = [...prev]
        const line = next[idx]
        if (line.qty >= stock) return prev
        next[idx] = { ...line, qty: line.qty + 1 }
        return next
      }
      return [...prev, {
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

  function setLineQty(productId: number, qty: number) {
    setCart(prev => prev.map(l => {
      if (l.productId !== productId) return l
      const q = Math.max(0, Math.min(l.stock, qty))
      return { ...l, qty: q }
    }).filter(l => l.qty > 0))
  }

  function openPayment() {
    if (!cart.length) return
    setPayMethod('cash')
    setPaidAmount(String(total.toFixed(2)))
    setSaleMsg('')
    setPayOpen(true)
  }

  async function submitSale() {
    if (!activeShift || !cart.length) return
    const saleTotal = total
    const paid = Number(paidAmount) || 0
    if (payMethod === 'cash' && paid < saleTotal - 0.001) {
      setSaleMsg('Недостаточно наличных')
      return
    }
    setBusy(true)
    setSaleMsg('')
    try {
      await api.createPosSale({
        cashierId: activeShift.cashierId,
        shiftId: activeShift.id,
        paymentMethod: payMethod,
        paidCash: payMethod === 'cash' ? paid : 0,
        paidCard: payMethod === 'card' ? saleTotal : 0,
        items: cart.map(l => ({ productId: l.productId, qty: l.qty, price: l.price })),
      })
      await refreshPos()
      setCart([])
      setPayOpen(false)
    } catch (e) {
      setSaleMsg(e instanceof Error ? e.message : 'Ошибка продажи')
    } finally {
      setBusy(false)
    }
  }

  if (!activeShift) {
    return (
      <div>
        <div className="k-page-h">
          <div>
            <h1>🛒 Точка продажи</h1>
            <div className="sub">Откройте смену, чтобы начать продажи. Остатки списываются со склада автоматически.</div>
          </div>
          <button type="button" className="k-btn k-btn-s" onClick={() => { setSettingsName(settings.cashierName); setSettingsOpen(true); setMsg('') }}>
            ⚙️ Настройки
          </button>
        </div>

        {apiError && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
            {apiError}
          </div>
        )}

        <div className="k-card" style={{ maxWidth: 520, margin: '0 auto' }}>
          <div className="k-card-b" style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏪</div>
            <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>Смена закрыта</div>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
              Кассир: <b style={{ color: 'var(--text)' }}>{settings.cashierName}</b>
              {settings.cashierId && <span style={{ display: 'block', fontSize: 12, marginTop: 6 }}>ID: {settings.cashierId}</span>}
            </p>
            <button
              type="button"
              className="k-btn k-btn-g"
              style={{ width: '100%', padding: '14px 20px', fontSize: 16, fontWeight: 900 }}
              onClick={() => { setOpenShiftOpen(true); setOpeningCash(''); setMsg('') }}
            >
              🟢 Открыть смену
            </button>
          </div>
        </div>

        {openShiftOpen && (
          <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setOpenShiftOpen(false)}>
            <div className="k-modal" onClick={e => e.stopPropagation()}>
              <div className="k-modal-h">
                <b>🟢 Открытие смены</b>
                <button type="button" onClick={() => !busy && setOpenShiftOpen(false)}>✕</button>
              </div>
              <div className="k-modal-b" style={{ padding: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
                  Укажите, сколько наличных сейчас в кассе. Эта сумма пойдёт в отчёт смены.
                </p>
                <label>Сумма наличных в кассе *</label>
                <input
                  className="k-inp"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={openingCash}
                  onChange={e => setOpeningCash(sanitizeDecimalInput(e.target.value))}
                  placeholder="0.00"
                  style={{ fontSize: 18, fontWeight: 800 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {[0, 100, 500, 1000].map(v => (
                    <button key={v} type="button" className="k-btn k-btn-s" style={{ fontSize: 12 }} onClick={() => setOpeningCash(String(v))}>
                      {v === 0 ? 'Пустая' : `${v} сом`}
                    </button>
                  ))}
                </div>
                {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
              </div>
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => void submitOpenShift()}>
                  {busy ? 'Открываем…' : 'Открыть смену'}
                </button>
                <button type="button" className="k-btn k-btn-s" disabled={busy} onClick={() => setOpenShiftOpen(false)}>Отмена</button>
              </div>
            </div>
          </div>
        )}

        {settingsOpen && (
          <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setSettingsOpen(false)}>
            <div className="k-modal" onClick={e => e.stopPropagation()}>
              <div className="k-modal-h">
                <b>⚙️ Настройки кассы</b>
                <button type="button" onClick={() => !busy && setSettingsOpen(false)}>✕</button>
              </div>
              <div className="k-modal-b" style={{ padding: 16 }}>
                <label>Имя кассира</label>
                <input className="k-inp" value={settingsName} onChange={e => setSettingsName(e.target.value)} placeholder="Кассир" />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.45 }}>
                  Используется при открытии смены и в чеках продаж.
                </div>
                {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
              </div>
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => void saveSettingsForm()}>
                  {busy ? 'Сохранение…' : 'Сохранить'}
                </button>
                <button type="button" className="k-btn k-btn-s" disabled={busy} onClick={() => setSettingsOpen(false)}>Отмена</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 120px)' }}>
      <div className="k-page-h" style={{ marginBottom: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>🛒 Касса</h1>
          <div className="sub" style={{ fontSize: 12 }}>
            Смена {activeShift.id} · {settings.cashierName} · открыта {fmtDateTime(activeShift.openedAtIso)}
            {apiSyncing && ' · обновление…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="k-btn k-btn-s" onClick={() => { setSettingsName(settings.cashierName); setSettingsOpen(true) }}>⚙️</button>
          <button type="button" className="k-btn k-btn-s" onClick={() => { setCloseShiftOpen(true); setClosingCash(''); setMsg('') }}>Закрыть смену</button>
        </div>
      </div>

      <div className="k-kpis" style={{ marginBottom: 10 }}>
        <div className="k-kpi k-statcard"><div className="kl">В кассе (старт)</div><div className="kv">{fmtMoney(activeShift.openingCash)}</div></div>
        <div className="k-kpi k-statcard"><div className="kl">Продаж</div><div className="kv">{activeShift.salesCount}</div></div>
        <div className="k-kpi k-statcard"><div className="kl">Наличные</div><div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(activeShift.salesCash)}</div></div>
        <div className="k-kpi k-statcard"><div className="kl">Карта</div><div className="kv">{fmtMoney(activeShift.salesCard)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: 12, flex: 1, minHeight: 0 }}>
        <div className="k-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`k-subtab ${!catFilter ? 'active' : ''}`} style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setCatFilter(null)}>Все</button>
            {roots.map(c => (
              <button key={c.id} type="button" className={`k-subtab ${catFilter === c.id ? 'active' : ''}`} style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setCatFilter(c.id)}>
                {c.emoji || '📦'} {c.name}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, alignContent: 'start' }}>
            {!visibleProducts.length ? (
              <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                {search.trim() ? 'Товар не найден' : 'Нет товаров в наличии'}
              </div>
            ) : visibleProducts.map(p => {
              const stock = Number(p.stock) || 0
              const inCart = cart.find(l => l.productId === p.id)?.qty || 0
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  style={{
                    textAlign: 'left', padding: '12px 10px', borderRadius: 12, cursor: 'pointer',
                    background: 'var(--card2)', border: '1px solid var(--border)',
                    color: 'inherit', fontFamily: 'inherit',
                    opacity: inCart >= stock ? 0.55 : 1,
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{p.e || '📦'}</div>
                  <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.3, marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontWeight: 900, color: 'var(--green)' }}>{fmtMoney(p.price)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{stock} {p.unit || 'шт'}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="k-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 900 }}>Чек</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            {!cart.length ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Добавьте товары</div>
            ) : cart.map(line => (
              <div key={line.productId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 22 }}>{line.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{line.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtMoney(line.price)} × {line.qty}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px' }} onClick={() => setLineQty(line.productId, line.qty - 1)}>−</button>
                  <span style={{ fontWeight: 900, minWidth: 20, textAlign: 'center' }}>{line.qty}</span>
                  <button type="button" className="k-btn k-btn-s" style={{ padding: '2px 8px' }} onClick={() => setLineQty(line.productId, line.qty + 1)}>+</button>
                </div>
                <div style={{ fontWeight: 900, minWidth: 72, textAlign: 'right' }}>{fmtMoney(line.price * line.qty)}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 800 }}>Итого</span>
              <span style={{ fontWeight: 900, fontSize: 20, color: 'var(--green)' }}>{fmtMoney(total)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={!cart.length} onClick={openPayment}>💵 Оплата</button>
              <button type="button" className="k-btn k-btn-s" disabled={!cart.length} onClick={() => setCart([])}>Очистить</button>
            </div>
          </div>
        </div>
      </div>

      {payOpen && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setPayOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>Оплата · {fmtMoney(total)}</b>
              <button type="button" onClick={() => !busy && setPayOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button type="button" className={`k-subtab ${payMethod === 'cash' ? 'active' : ''}`} style={{ flex: 1, padding: '8px 12px' }} onClick={() => { setPayMethod('cash'); setPaidAmount(String(total.toFixed(2))) }}>💵 Наличные</button>
                <button type="button" className={`k-subtab ${payMethod === 'card' ? 'active' : ''}`} style={{ flex: 1, padding: '8px 12px' }} onClick={() => setPayMethod('card')}>💳 Карта</button>
              </div>
              {payMethod === 'cash' && (
                <>
                  <label>Получено наличными</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={paidAmount} onChange={e => setPaidAmount(sanitizeDecimalInput(e.target.value))} />
                  {Number(paidAmount) > total && (
                    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold)', fontWeight: 800 }}>
                      Сдача: {fmtMoney(Number(paidAmount) - total)}
                    </div>
                  )}
                </>
              )}
              {saleMsg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{saleMsg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => void submitSale()}>
                {busy ? 'Проводим…' : '✓ Провести продажу'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={busy} onClick={() => setPayOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {closeShiftOpen && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setCloseShiftOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>Закрытие смены</b>
              <button type="button" onClick={() => !busy && setCloseShiftOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
                Продаж за смену: <b>{activeShift.salesCount}</b> · наличные <b>{fmtMoney(activeShift.salesCash)}</b>
              </div>
              <label>Сколько наличных сейчас в кассе?</label>
              <input className="k-inp" type="text" inputMode="decimal" value={closingCash} onChange={e => setClosingCash(sanitizeDecimalInput(e.target.value))} placeholder="0.00" />
              {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => void submitCloseShift()}>
                {busy ? 'Закрываем…' : 'Закрыть смену'}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={busy} onClick={() => setCloseShiftOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="k-modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setSettingsOpen(false)}>
          <div className="k-modal" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>⚙️ Настройки</b>
              <button type="button" onClick={() => !busy && setSettingsOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <label>Имя кассира</label>
              <input className="k-inp" value={settingsName} onChange={e => setSettingsName(e.target.value)} />
              {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={busy} onClick={() => void saveSettingsForm()}>
                {busy ? '…' : 'Сохранить'}
              </button>
              <button type="button" className="k-btn k-btn-s" onClick={() => setSettingsOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
