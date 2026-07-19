'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { cardNumsMatch } from '@/lib/cardCrm'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  allocateRepaymentFifo,
  buildDebtOrderBalances,
  loadBalanceTopups,
  loadDebtHistory,
  recordBalanceTopup,
  recordStoreDebtCharge,
  recordStoreDebtRepayment,
  recordStorePurchase,
  subscribeBalanceTopup,
  subscribeDebtHistory,
  topupBalanceCredit,
  type DebtOrderBalance,
} from '@/lib/clientVipCredit'
import {
  calcCashDepositBonus,
  cashDepositTierForAmount,
  cashDepositTierLabel,
  resolveEffectiveDebtLimit,
} from '@/lib/loyaltyStatusConfig'
import { filterProductsBySearch, pickProductBySearch, productBarcodes, productSearchScore } from '@/lib/productBarcodes'
import { useProductPhotos } from '@/lib/productPhotos'
import { isWeighted, unitPriceSuffix } from '@/lib/productWeight'
import { syncPosFromApi, usePosStore } from '@/lib/posStore'
import {
  printPosReceipt,
  buildDemoReceiptSale,
  buildPosReceiptHtml,
  DEFAULT_RECEIPT_STORE,
  loadReceiptStore,
  normalizeReceiptStore,
  RECEIPT_TEXT_FIELDS,
  RECEIPT_TOGGLE_FIELDS,
  saveReceiptStore,
  type ReceiptStoreConfig,
} from '@/lib/printPosReceipt'
import {
  getKakapoDesktop,
  isKakapoDesktop,
  type CasWeightEvent,
  type DesktopPrinter,
} from '@/lib/desktopBridge'
import { isLikelyReceiptPrinter, pickReceiptPrinter, sortReceiptPrinters, XP58C_RECEIPT_MM } from '@/lib/printerPresets'
import { useProducts } from '@/lib/store'
import type { Category, PosSale, Product, ProductStockLayer } from '@/lib/types'
import {
  categorySlug,
  countProductsInCategory,
  getCategoryBySlug,
  productMatchesCategoryFilter,
  useCategories,
} from '@/lib/useCategories'
import { fmtMoney, sanitizeDecimalInput } from './warehouse/warehouseShared'
import { POS_MOCK_CSS } from './posMockCss'

const SETTINGS_KEY = 'kakapo_trade_pos_settings'
const THEME_KEY = 'kakapo_trade_pos_theme'
const FAV_KEY = 'kakapo_pos_favorites'

type ThemeName = 'dark' | 'light'
type PayMethod = 'cash' | 'card' | 'credit' | 'balance' | 'mixed'
type PosSettings = { cashierId: string; cashierName: string; initials: string }

const RECEIPT_HEADER_TEXT_FIELDS = RECEIPT_TEXT_FIELDS.filter(f =>
  f.group === 'Шапка' && f.key !== 'storeName' && f.key !== 'storePhone' && f.key !== 'subtitle',
)
const RECEIPT_LABEL_TEXT_FIELDS = RECEIPT_TEXT_FIELDS.filter(f => f.group === 'Подписи полей')
const RECEIPT_FOOTER_TEXT_FIELDS = RECEIPT_TEXT_FIELDS.filter(f => f.group === 'Футер')

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
  discPct?: number
  /** Партия прихода (если кассир выбрал вручную) */
  receiptId?: string
  costPrice?: number
  supplierName?: string
}

type PosTicket = {
  id: string
  seq: number
  cart: CartLine[]
  client: AdminClient | null
  discountPct: number
  bonusUsed: number
  pay: PayMethod
  selectedLineKey: string | null
}

const MAX_TICKETS = 8

function makeTicket(seq: number): PosTicket {
  return {
    id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    seq,
    cart: [],
    client: null,
    discountPct: 0,
    bonusUsed: 0,
    pay: 'cash',
    selectedLineKey: null,
  }
}

function ticketLineCount(t: PosTicket) {
  return t.cart.reduce((s, l) => s + (l.weightKg != null ? 1 : l.qty), 0)
}

function ticketNetSum(t: PosTicket) {
  return t.cart.reduce((s, l) => s + lineNet(l), 0)
}

type ClientHistLine = {
  name: string
  qty: number
  price: number
  sum: number
}

type ClientHistRow = {
  id: string
  ts: number
  when: string
  title: string
  sub: string
  items?: string
  lines?: ClientHistLine[]
  amount: number
  tone: 'sale' | 'credit' | 'repay' | 'topup' | 'debt'
  debtStatus?: 'open' | 'partial' | 'paid'
  debtPaid?: number
  debtRemain?: number
}

function mapSaleLines(
  items: { productName?: string; productId?: number; qty?: number; price?: number; lineTotal?: number }[] | undefined,
  products: { id: number; name: string; price?: number }[],
): ClientHistLine[] {
  if (!items?.length) return []
  return items.map(i => {
    const fromCatalog = i.productId ? products.find(p => p.id === i.productId) : undefined
    const name = String(i.productName || fromCatalog?.name || '').trim() || (i.productId ? `#${i.productId}` : 'товар')
    const qty = Number(i.qty) || 0
    const price = Number(i.price) || Number(fromCatalog?.price) || 0
    const sum = Number(i.lineTotal) || Math.round(price * qty * 100) / 100
    return { name, qty, price, sum }
  })
}

function linesLabel(lines: ClientHistLine[]): string {
  if (!lines.length) return ''
  const parts = lines.slice(0, 5).map(l => {
    const q = Number.isInteger(l.qty) ? String(l.qty) : String(Math.round(l.qty * 1000) / 1000)
    return `${l.name} ×${q}`
  })
  if (lines.length > 5) parts.push(`+${lines.length - 5}`)
  return parts.join(', ')
}

function parseItemsSummary(raw?: string): ClientHistLine[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(.*?)(?:\s*[×xX]\s*([\d.,]+))?$/)
    const name = (m?.[1] || part).trim()
    const qty = m?.[2] ? Number(String(m[2]).replace(',', '.')) || 0 : 0
    return { name, qty, price: 0, sum: 0 }
  }).filter(l => l.name && !l.name.startsWith('+'))
}

function lineGross(line: CartLine) {
  return line.weightKg != null ? line.price * line.weightKg : line.price * line.qty
}

function lineNet(line: CartLine) {
  const g = lineGross(line)
  const pct = Math.min(90, Math.max(0, Number(line.discPct) || 0))
  return Math.max(0, g * (1 - pct / 100))
}

function displaySellUnit(p: Product): string {
  if (isWeighted(p)) return unitPriceSuffix(p)
  let u = String(p.unit || 'шт').trim() || 'шт'
  u = u
    .replace(/\bkilograms?\b/gi, 'кг')
    .replace(/\bkg\b/gi, 'кг')
    .replace(/\bliters?\b/gi, 'л')
    .replace(/\blitres?\b/gi, 'л')
    .replace(/\bgrams?\b/gi, 'гр')
    .replace(/\bgr\b/gi, 'гр')
    .replace(/\bpcs?\b/gi, 'шт')
    .replace(/\bpieces?\b/gi, 'шт')
    .replace(/(\d)\s*g\b/gi, '$1 гр')
    .replace(/(^|[^а-яa-z])l\b/gi, '$1л')
  return u
}

function saleNumber(s: { number?: number }) {
  const n = Number(s.number)
  return n > 0 ? n : 0
}

/** Цифровая часть K-4863 или №11 — для сортировки/поиска */
function saleOrderSeq(s: { orderId?: string; number?: number; id?: string }) {
  const fromOrder = String(s.orderId || '').match(/(\d+)\s*$/)
  if (fromOrder) return Number(fromOrder[1]) || 0
  return saleNumber(s)
}

function saleNumberLabel(s: { orderId?: string; number?: number; id?: string }) {
  const oid = String(s.orderId || '').trim()
  if (oid) return oid
  const n = saleNumber(s)
  return n > 0 ? `№${n}` : (s.id || '—')
}

function stockUnitLabel(p: Product): string {
  if (isWeighted(p)) return 'кг'
  const u = displaySellUnit(p).toLowerCase().replace(/\s+/g, '')
  if (u === 'л' || u === 'мл') return displaySellUnit(p)
  if (u === 'кг' || u.endsWith('кг')) return 'кг'
  if (u === 'гр' || u === 'г' || /^\d+гр$/.test(u) || /^\d+г$/.test(u)) return 'шт'
  return 'шт'
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'K'
}

/** Ожидаемые наличные в кассе: старт + продажи нал + внесено − снято/расходы */
function expectedTillCash(shift: {
  openingCash?: number
  salesCash?: number
  cashInTotal?: number
  expenseTotal?: number
}) {
  return Math.round((
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    + (Number(shift.cashInTotal) || 0)
    - (Number(shift.expenseTotal) || 0)
  ) * 100) / 100
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
  if (typeof window === 'undefined') return 'dark'
  const t = localStorage.getItem(THEME_KEY)
  if (t === 'light') return 'light'
  return 'dark'
}

function loadFavIds(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(FAV_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

function saveFavIds(ids: number[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(ids))
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

function QrIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5.2" y="5.2" width="2.6" height="2.6" fill="currentColor" rx="0.4" />
      <rect x="16.2" y="5.2" width="2.6" height="2.6" fill="currentColor" rx="0.4" />
      <rect x="5.2" y="16.2" width="2.6" height="2.6" fill="currentColor" rx="0.4" />
      <rect x="14" y="14" width="2.2" height="2.2" fill="currentColor" rx="0.3" />
      <rect x="18.5" y="14" width="2.5" height="2.5" fill="currentColor" rx="0.3" />
      <rect x="14" y="18.5" width="2.5" height="2.5" fill="currentColor" rx="0.3" />
      <rect x="17.2" y="17.2" width="1.6" height="1.6" fill="currentColor" rx="0.2" />
    </svg>
  )
}

type NavTarget = 'products' | 'clients' | 'debts' | 'warehouse' | 'reports' | 'suppliers' | 'finance'

export default function CashierModule({
  onExit,
  onNavigate: _onNavigate,
  embedded = false,
  onSurfaceChange,
  theme: themeProp,
  onThemeChange,
}: {
  onExit?: () => void
  onNavigate?: (page: NavTarget) => void
  /** Встроена в правую панель «Торговля» (с боковым меню) */
  embedded?: boolean
  onSurfaceChange?: (surface: 'dashboard' | 'register') => void
  theme?: ThemeName
  onThemeChange?: (theme: ThemeName) => void
}) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  const shifts = usePosStore(s => s.shifts)
  const posPoints = usePosStore(s => s.posPoints)
  const cashiers = usePosStore(s => s.cashiers)
  const sales = usePosStore(s => s.sales)
  const suppliers = usePosStore(s => s.suppliers)
  const apiReady = usePosStore(s => s.apiReady)
  const { categories, roots, childrenOf } = useCategories()
  const { getPhoto, hydrate } = useProductPhotos()

  const [settings, setSettings] = useState<PosSettings>(loadSettings)
  const [themeLocal, setThemeLocal] = useState<ThemeName>(loadTheme)
  const theme = themeProp ?? themeLocal

  function applyTheme(next: ThemeName) {
    if (onThemeChange) onThemeChange(next)
    else {
      setThemeLocal(next)
      localStorage.setItem(THEME_KEY, next)
    }
  }
  const [q, setQ] = useState('')
  const qRef = useRef('')
  const scanCommitTimer = useRef<number | null>(null)
  const scanLastKeyTs = useRef(0)
  const scanBurstRef = useRef(false)
  const scanAccumRef = useRef('')
  const [showFav, setShowFav] = useState(false)
  const [selectedCatSlugs, setSelectedCatSlugs] = useState<string[]>([])
  const [favIds, setFavIds] = useState<number[]>(loadFavIds)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [catModalQ, setCatModalQ] = useState('')
  const bootTicket = useRef(makeTicket(1)).current
  const [tickets, setTickets] = useState<PosTicket[]>([bootTicket])
  const [activeTicketId, setActiveTicketId] = useState(bootTicket.id)
  const [nextTicketSeq, setNextTicketSeq] = useState(2)
  const activeTicket = tickets.find(t => t.id === activeTicketId) || tickets[0] || bootTicket
  const cart = activeTicket.cart
  const client = activeTicket.client
  const pay = activeTicket.pay
  const discountPct = activeTicket.discountPct
  const bonusUsed = activeTicket.bonusUsed
  const selectedLineKey = activeTicket.selectedLineKey

  function setCart(u: CartLine[] | ((prev: CartLine[]) => CartLine[])) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, cart: typeof u === 'function' ? u(t.cart) : u }
    }))
  }
  function setClient(u: AdminClient | null | ((prev: AdminClient | null) => AdminClient | null)) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, client: typeof u === 'function' ? u(t.client) : u }
    }))
  }
  function setPay(u: PayMethod | ((prev: PayMethod) => PayMethod)) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, pay: typeof u === 'function' ? u(t.pay) : u }
    }))
  }
  function setDiscountPct(u: number | ((prev: number) => number)) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, discountPct: typeof u === 'function' ? u(t.discountPct) : u }
    }))
  }
  function setBonusUsed(u: number | ((prev: number) => number)) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, bonusUsed: typeof u === 'function' ? u(t.bonusUsed) : u }
    }))
  }
  function setSelectedLineKey(u: string | null | ((prev: string | null) => string | null)) {
    setTickets(prev => prev.map(t => {
      if (t.id !== activeTicketId) return t
      return { ...t, selectedLineKey: typeof u === 'function' ? u(t.selectedLineKey) : u }
    }))
  }

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)

  const [gateCash, setGateCash] = useState('0.00')
  const [gateName, setGateName] = useState(settings.cashierName)
  const [pickedCashierId, setPickedCashierId] = useState(settings.cashierId)

  const [clientOpen, setClientOpen] = useState(false)
  const [clientQ, setClientQ] = useState('')
  const [clientPick, setClientPick] = useState<AdminClient | null>(null)
  const [clientScanOpen, setClientScanOpen] = useState(false)
  const [clientScanBuf, setClientScanBuf] = useState('')
  const clientScanRef = useRef<HTMLInputElement>(null)
  const clientSearchRef = useRef<HTMLInputElement>(null)
  const [discOpen, setDiscOpen] = useState(false)
  const [discBuf, setDiscBuf] = useState('')
  const [discMode, setDiscMode] = useState<'all' | 'line'>('all')
  const [discLineKey, setDiscLineKey] = useState<string | null>(null)
  const [discPickOpen, setDiscPickOpen] = useState(false)
  const [qtyEditOpen, setQtyEditOpen] = useState(false)
  const [qtyEditKey, setQtyEditKey] = useState<string | null>(null)
  const [qtyEditMode, setQtyEditMode] = useState<'qty' | 'sum'>('qty')
  const [qtyEditBuf, setQtyEditBuf] = useState('')
  const [qtyEditPad, setQtyEditPad] = useState(false)
  const qtyEditInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [cashOpen, setCashOpen] = useState(false)
  const [splitCardOpen, setSplitCardOpen] = useState(false)
  const [cashBuf, setCashBuf] = useState('')
  const [splitCardBuf, setSplitCardBuf] = useState('')
  /** Экранная клавиатура в модалках суммы (скидка / нал / пополнение / долг) */
  const [amountPad, setAmountPad] = useState(false)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const [cashierMenuOpen, setCashierMenuOpen] = useState(false)
  const [cashierScreen, setCashierScreen] = useState<null | 'close' | 'switch' | 'receipts'>(null)
  const [openShiftModal, setOpenShiftModal] = useState(false)
  const [openingPosId, setOpeningPosId] = useState<string | null>(null)
  const [createPosModal, setCreatePosModal] = useState(false)
  const [newPosName, setNewPosName] = useState('')
  const [newPosCode, setNewPosCode] = useState('')
  const [editPosId, setEditPosId] = useState<string | null>(null)
  const [editPosName, setEditPosName] = useState('')
  const [editPosCode, setEditPosCode] = useState('')
  const [editPosNote, setEditPosNote] = useState('')
  const [editReceiptPhone, setEditReceiptPhone] = useState('')
  const [deletePosId, setDeletePosId] = useState<string | null>(null)
  /** Как в Odoo: сначала Dashboard, в кассу — после «Новая сессия» / «Продолжить» */
  const [posSurface, setPosSurfaceState] = useState<'dashboard' | 'register'>('dashboard')
  const setPosSurface = useCallback((surface: 'dashboard' | 'register') => {
    setPosSurfaceState(surface)
    onSurfaceChange?.(surface)
  }, [onSurfaceChange])
  const [dashMenuPosId, setDashMenuPosId] = useState<string | null>(null)
  const [switchCashierId, setSwitchCashierId] = useState('')
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null)
  const [receiptQ, setReceiptQ] = useState('')
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'cash' | 'card' | 'credit' | 'returned'>('all')
  const receiptSearchRef = useRef<HTMLInputElement>(null)
  /** index позиции → qty к возврату (0 = не выбрано) */
  const [returnQtyByIdx, setReturnQtyByIdx] = useState<Record<number, number>>({})
  const [closingCash, setClosingCash] = useState('')
  const [tillMoveKind, setTillMoveKind] = useState<null | 'in' | 'out'>(null)
  const [tillAmountBuf, setTillAmountBuf] = useState('')
  const [tillNote, setTillNote] = useState('')
  const [tillSupplierId, setTillSupplierId] = useState('')
  const [layerPickOpen, setLayerPickOpen] = useState(false)
  const [layerPickProduct, setLayerPickProduct] = useState<Product | null>(null)
  const [layerPickLayers, setLayerPickLayers] = useState<ProductStockLayer[]>([])
  const [layerPickWeightKg, setLayerPickWeightKg] = useState<number | undefined>(undefined)
  const [layerPickBusy, setLayerPickBusy] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupBuf, setTopupBuf] = useState('')
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayBuf, setRepayBuf] = useState('')
  const [repayMethod, setRepayMethod] = useState<'cash' | 'card'>('cash')
  /** Погасить старый долг вместе с текущим чеком (только если долг > 0) */
  const [payDebtOn, setPayDebtOn] = useState(false)
  const [payDebtBuf, setPayDebtBuf] = useState('')
  const [histOpen, setHistOpen] = useState(false)
  const [histView, setHistView] = useState<'profile' | 'history'>('profile')
  const [histTab, setHistTab] = useState<'checks' | 'debts'>('checks')
  const [histDetail, setHistDetail] = useState<ClientHistRow | null>(null)
  const [histTick, setHistTick] = useState(0)
  const [payPickOpen, setPayPickOpen] = useState(false)
  const [creditNoteOpen, setCreditNoteOpen] = useState(false)
  const [creditNoteBuf, setCreditNoteBuf] = useState('')
  const [creditPending, setCreditPending] = useState<{
    paidCash: number
    method: PayMethod
    paidCard?: number
    debtAmt?: number
  } | null>(null)
  const [printAskSale, setPrintAskSale] = useState<PosSale | null>(null)
  const printChoiceLockedRef = useRef(false)
  const printingSaleIdsRef = useRef(new Set<string>())
  const [printingSaleId, setPrintingSaleId] = useState<string | null>(null)
  const [deskPrinters, setDeskPrinters] = useState<DesktopPrinter[]>([])
  const [deskPrinterName, setDeskPrinterName] = useState('')
  const [deskPaperMm, setDeskPaperMm] = useState<58 | 80>(XP58C_RECEIPT_MM)
  const [deskScaleMode, setDeskScaleMode] = useState<'none' | 'plu-label'>('plu-label')
  const [deskScaleHost, setDeskScaleHost] = useState('')
  const [deskScalePort, setDeskScalePort] = useState('20304')
  const [deskScaleDept, setDeskScaleDept] = useState('1')
  const [deskScaleLiveWeight, setDeskScaleLiveWeight] = useState(true)
  const [deskPrintBusy, setDeskPrintBusy] = useState(false)
  const [deskCasBusy, setDeskCasBusy] = useState(false)
  const [deskCasTestBusy, setDeskCasTestBusy] = useState(false)
  const [casWeight, setCasWeight] = useState<CasWeightEvent>({
    connected: false,
    weightKg: 0,
    grams: 0,
    stable: false,
    error: '',
  })
  const deskScaleLiveWeightRef = useRef(true)
  const casMonitorWantedRef = useRef(false)
  const qtyEditOpenRef = useRef(false)
  const qtyEditIsWeightRef = useRef(false)
  /** После снятия товара держим вес в окне, чтобы не перебило чужим/нулевым */
  const SCALE_HOLD_MS = 1500
  const scaleHoldUntilRef = useRef(0)
  const lastHeldKgRef = useRef(0)
  const scaleHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scaleHolding, setScaleHolding] = useState(false)
  const [receiptTemplateOpen, setReceiptTemplateOpen] = useState(false)
  const [receiptTemplateDraft, setReceiptTemplateDraft] = useState<ReceiptStoreConfig>(() => ({
    ...DEFAULT_RECEIPT_STORE,
  }))
  const [qtyEditDraftKey, setQtyEditDraftKey] = useState<string | null>(null)

  const receiptPreviewHtml = useMemo(() => buildPosReceiptHtml(buildDemoReceiptSale(), {
    ...receiptTemplateDraft,
    storeName: editPosName.trim() || 'КАКАПО',
    storePhone: editReceiptPhone.trim(),
    subtitle: '',
    posLabel: editPosName.trim() || 'Касса №1',
  }), [receiptTemplateDraft, editPosName, editReceiptPhone])

  const refresh = useCallback(async () => {
    await Promise.all([syncPosFromApi(), syncClientsFromApi(), syncCardsFromApi(), fetchProducts()])
  }, [fetchProducts])

  useEffect(() => {
    if (!cashierMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!accountMenuRef.current?.contains(e.target as Node)) setCashierMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [cashierMenuOpen])

  useEffect(() => {
    onSurfaceChange?.(posSurface)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- sync initial surface to TradeApp once

  useEffect(() => { void hydrate() }, [hydrate])
  useEffect(() => { void refresh() }, [refresh])

  /** Автообновление статуса кассы (смена открыта/закрыта, продажи) */
  useEffect(() => {
    if (!USE_API) return
    let cancelled = false
    const softSync = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      void syncPosFromApi()
    }
    const id = window.setInterval(softSync, 4000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') softSync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

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
  useEffect(() => {
    if (!qtyEditOpen) return
    const t = window.setTimeout(() => {
      const el = qtyEditInputRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [qtyEditOpen, qtyEditMode, qtyEditPad])

  useEffect(() => {
    const open = discOpen || cashOpen || splitCardOpen || topupOpen || repayOpen || !!tillMoveKind
    if (!open || amountPad) return
    const t = window.setTimeout(() => {
      const el = amountInputRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [discOpen, cashOpen, splitCardOpen, topupOpen, repayOpen, tillMoveKind, amountPad])

  useEffect(() => {
    if (!clientScanOpen) return
    const t = window.setTimeout(() => {
      clientScanRef.current?.focus()
      clientScanRef.current?.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [clientScanOpen])

  useEffect(() => {
    if (!clientOpen) return
    const t = window.setTimeout(() => {
      const el = clientSearchRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [clientOpen])

  const activeShift = useMemo(() => {
    const open = shifts.filter(s => s.status === 'open')
    if (!open.length) return null
    if (settings.cashierId) {
      const mine = open.find(s => s.cashierId === settings.cashierId)
      if (mine) return mine
    }
    return open[0]
  }, [shifts, settings.cashierId])

  const tillExpected = useMemo(
    () => (activeShift ? expectedTillCash(activeShift) : 0),
    [activeShift],
  )

  const tillSuppliers = useMemo(
    () => [...suppliers].sort((a, b) => (Number(b.payableAmount) || 0) - (Number(a.payableAmount) || 0)),
    [suppliers],
  )

  const activePosPoint = useMemo(() => {
    const id = activeShift?.posId
    if (!id) return posPoints[0] || null
    return posPoints.find(p => p.id === id) || posPoints[0] || null
  }, [activeShift?.posId, posPoints])

  const visiblePosPoints = useMemo(
    () => (posPoints.length ? posPoints : []).filter(p => p.active !== false),
    [posPoints],
  )

  function shiftForPos(posId: string) {
    return shifts.find(s => s.status === 'open' && (s.posId || '') === posId) || null
  }

  function formatOpenedAt(iso?: string | null) {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? String(iso)
      : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const overlayBlocksSearch =
    posSurface !== 'register'
    || !activeShift
    || openShiftModal
    || createPosModal
    || !!editPosId
    || !!deletePosId
    || !!cashierScreen
    || catModalOpen || clientOpen || clientScanOpen || discOpen || discPickOpen
    || qtyEditOpen || cashOpen || splitCardOpen || topupOpen || repayOpen
    || histOpen || payPickOpen || creditNoteOpen || receiptTemplateOpen || !!printAskSale
    || !!dashMenuPosId

  function focusProductSearch() {
    const el = searchInputRef.current
    if (!el) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      el.focus()
    }
  }

  useEffect(() => () => {
    if (scanCommitTimer.current) window.clearTimeout(scanCommitTimer.current)
  }, [])

  useEffect(() => {
    deskScaleLiveWeightRef.current = deskScaleLiveWeight
  }, [deskScaleLiveWeight])

  useEffect(() => {
    qtyEditOpenRef.current = qtyEditOpen
  }, [qtyEditOpen])

  /** Загрузить настройки весов при старте desktop-кассы */
  useEffect(() => {
    if (!isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    if (!desk) return
    void desk.getPrinterSettings().then(settings => {
      setDeskScaleMode(settings?.scaleMode === 'none' ? 'none' : 'plu-label')
      setDeskScaleHost(settings?.scaleHost || '')
      setDeskScalePort(String(settings?.scalePort || 20304))
      setDeskScaleDept(String(settings?.scaleDept || 1))
      setDeskScaleLiveWeight(settings?.scaleLiveWeight !== false)
    }).catch(() => undefined)
  }, [])

  /** Живой вес CAS → поле в окне «Ввод веса» (как в старой кассе) */
  useEffect(() => {
    if (!isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    if (!desk?.onCasWeight) return
    const off = desk.onCasWeight(payload => {
      setCasWeight(payload)
      if (!deskScaleLiveWeightRef.current) return
      if (!qtyEditOpenRef.current || !qtyEditIsWeightRef.current) return
      const kg = Math.round((Number(payload.weightKg) || 0) * 1000) / 1000
      const now = Date.now()

      // Задержка после снятия: 1.5 с вес стоит, новый/чужой не попадает
      if (now < scaleHoldUntilRef.current) return

      if (kg > 0.0005) {
        lastHeldKgRef.current = kg
        setQtyEditMode('qty')
        setQtyEditBuf(kg.toFixed(3))
        if (scaleHoldTimerRef.current) {
          clearTimeout(scaleHoldTimerRef.current)
          scaleHoldTimerRef.current = null
        }
        setScaleHolding(false)
        return
      }

      // Сняли с весов (0) — фиксируем последний вес на SCALE_HOLD_MS
      if (lastHeldKgRef.current > 0.0005) {
        scaleHoldUntilRef.current = now + SCALE_HOLD_MS
        setScaleHolding(true)
        if (scaleHoldTimerRef.current) clearTimeout(scaleHoldTimerRef.current)
        scaleHoldTimerRef.current = setTimeout(() => {
          scaleHoldTimerRef.current = null
          setScaleHolding(false)
        }, SCALE_HOLD_MS)
      }
    })
    return () => {
      off()
      if (scaleHoldTimerRef.current) clearTimeout(scaleHoldTimerRef.current)
    }
  }, [])

  useEffect(() => () => {
    const desk = getKakapoDesktop()
    void desk?.stopCasWeight?.()
  }, [])

  /** Поиск всегда в фокусе на экране кассы (сканер / ввод), пока нет модалок */
  useEffect(() => {
    if (overlayBlocksSearch) return
    const t = window.setTimeout(focusProductSearch, 40)
    return () => window.clearTimeout(t)
  }, [
    overlayBlocksSearch,
    activeShift?.id,
    activeTicketId,
    catModalOpen, clientOpen, clientScanOpen, discOpen, discPickOpen,
    qtyEditOpen, cashOpen, splitCardOpen, topupOpen, repayOpen,
    histOpen, payPickOpen, creditNoteOpen, receiptTemplateOpen, printAskSale,
  ])

  useEffect(() => {
    if (overlayBlocksSearch) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
      if (t.closest('.modal-card, .overlay, .cash-checkout-shell, .cashier-menu')) return
      window.setTimeout(focusProductSearch, 0)
    }
    document.addEventListener('pointerup', onPointer)
    return () => document.removeEventListener('pointerup', onPointer)
  }, [overlayBlocksSearch])

  const cashierOptions = useMemo(() => {
    if (cashiers.length) return cashiers.filter(c => c.active !== false)
    return [{ id: 'local', name: settings.cashierName || 'Кассир', pin: '0000', active: true, salesCount: 0, salesTotal: 0 }]
  }, [cashiers, settings.cashierName])

  const search = q
  const favSet = useMemo(() => new Set(favIds), [favIds])
  const inStockProducts = useMemo(
    () => products.filter(p => (Number(p.stock) || 0) > 0),
    [products],
  )
  const selectedCatSet = useMemo(() => new Set(selectedCatSlugs), [selectedCatSlugs])
  const quickCatSlugs = useMemo(() => (
    selectedCatSlugs.filter(slug => !!getCategoryBySlug(categories, slug))
  ), [selectedCatSlugs, categories])

  /** Подкатегории — если выбрана ровно одна категория (корень или её дочка) */
  const focusRootCat = useMemo(() => {
    if (selectedCatSlugs.length !== 1) return null
    const cat = getCategoryBySlug(categories, selectedCatSlugs[0])
    if (!cat) return null
    if (cat.parent_id != null) {
      return categories.find(c => c.id === Number(cat.parent_id)) || null
    }
    return cat
  }, [selectedCatSlugs, categories])
  const subCats = useMemo(
    () => (focusRootCat ? childrenOf(focusRootCat.id) : []),
    [focusRootCat, childrenOf],
  )

  const modalCategories = useMemo(() => {
    const qLower = catModalQ.trim().toLowerCase()
    if (!qLower) return roots
    const hits: Category[] = []
    for (const c of categories) {
      if (!(c.name || '').toLowerCase().includes(qLower)) continue
      hits.push(c)
    }
    return hits.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
  }, [categories, roots, catModalQ])

  const visibleProducts = useMemo(() => {
    let list = inStockProducts
    if (showFav) list = list.filter(p => favSet.has(p.id))
    else if (selectedCatSlugs.length > 0) {
      list = list.filter(p => selectedCatSlugs.some(slug =>
        productMatchesCategoryFilter(p.catId, slug, categories)
        || productMatchesCategoryFilter(p.cat, slug, categories),
      ))
    }
    if (search.trim()) list = filterProductsBySearch(list, search.trim())
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [inStockProducts, showFav, favSet, selectedCatSlugs, categories, search])

  function toggleFavorite(productId: number) {
    setFavIds(prev => {
      const next = prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
      saveFavIds(next)
      return next
    })
  }

  function selectAllProducts() {
    setShowFav(false)
    setSelectedCatSlugs([])
  }

  function selectFavorites() {
    if (showFav) {
      selectAllProducts()
      return
    }
    setShowFav(true)
    setSelectedCatSlugs([])
  }

  function toggleCategory(slug: string) {
    const cat = getCategoryBySlug(categories, slug)
    if (!cat) return
    setShowFav(false)
    setSelectedCatSlugs(prev => {
      if (prev.includes(slug)) return prev.filter(s => s !== slug)
      return [...prev, slug]
    })
  }

  function pickSubCategory(slug: string | null) {
    if (!focusRootCat) return
    const rootSlug = categorySlug(focusRootCat)
    if (!slug) {
      setSelectedCatSlugs([rootSlug])
      return
    }
    setSelectedCatSlugs([slug])
  }

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

  const clientHistory = useMemo(() => {
    void histTick
    if (!client) return [] as ClientHistRow[]
    const rows: ClientHistRow[] = []
    const debtList = client.phone ? loadDebtHistory(client.phone) : []
    const { unpaid, paid } = buildDebtOrderBalances(debtList)
    const unpaidById = new Map(unpaid.map(d => [d.id, d]))
    const paidById = new Map(paid.map(d => [d.id, d]))

    const debtStatusFor = (saleId: string, total: number, ts: number) => {
      const byOrder = unpaid.find(d => d.orderId && d.orderId === saleId)
        || paid.find(d => d.orderId && d.orderId === saleId)
      if (byOrder) {
        if (paidById.has(byOrder.id)) {
          return { debtStatus: 'paid' as const, debtPaid: Math.abs(Number(byOrder.amount) || total), debtRemain: 0, debtId: byOrder.id }
        }
        const u = unpaidById.get(byOrder.id)
        if (u?.partial) {
          return { debtStatus: 'partial' as const, debtPaid: u.paidAmount, debtRemain: u.remainingAmount, debtId: byOrder.id }
        }
        if (u) {
          return { debtStatus: 'open' as const, debtPaid: 0, debtRemain: u.remainingAmount, debtId: byOrder.id }
        }
      }
      const nearUnpaid = unpaid.find(d =>
        Math.abs(Math.abs(Number(d.amount) || 0) - total) < 0.02
        && Math.abs((d.ts || 0) - ts) < 10 * 60 * 1000,
      )
      if (nearUnpaid) {
        if (nearUnpaid.partial) {
          return { debtStatus: 'partial' as const, debtPaid: nearUnpaid.paidAmount, debtRemain: nearUnpaid.remainingAmount, debtId: nearUnpaid.id }
        }
        return { debtStatus: 'open' as const, debtPaid: 0, debtRemain: nearUnpaid.remainingAmount, debtId: nearUnpaid.id }
      }
      const nearPaid = paid.find(d =>
        Math.abs(Math.abs(Number(d.amount) || 0) - total) < 0.02
        && Math.abs((d.ts || 0) - ts) < 10 * 60 * 1000,
      )
      if (nearPaid) {
        return { debtStatus: 'paid' as const, debtPaid: Math.abs(Number(nearPaid.amount) || total), debtRemain: 0, debtId: nearPaid.id }
      }
      // Нет записи в истории долгов — не считаем «открытым» (иначе все старые чеки висят)
      return { debtStatus: 'paid' as const, debtPaid: total, debtRemain: 0, debtId: '' }
    }

    const linkedDebtIds = new Set<string>()

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
      const ts = when.getTime() || 0
      const total = Number(s.total) || 0
      const mappedLines = mapSaleLines(s.items, products)
      const debtMeta = isCredit ? debtStatusFor(s.id, Number(s.debtAdded) || total, ts) : null
      if (debtMeta?.debtId) linkedDebtIds.add(debtMeta.debtId)

      let title = isCredit ? 'Чек в долг' : 'Чек'
      let sub = methodLabel
      if (isCredit && debtMeta) {
        if (debtMeta.debtStatus === 'paid') {
          title = 'Чек · долг погашен'
          sub = `${methodLabel} · оплачен полностью`
        } else if (debtMeta.debtStatus === 'partial') {
          title = 'Чек · долг частично'
          sub = `${methodLabel} · оплачено ${fmtMoney(debtMeta.debtPaid || 0)} · остаток ${fmtMoney(debtMeta.debtRemain || 0)}`
        } else {
          title = 'Чек · долг открыт'
          sub = `${methodLabel} · не оплачен`
        }
      }
      const saleNote = String(s.note || '').trim()
      if (saleNote) sub = `${sub} · ${saleNote}`

      rows.push({
        id: `sale-${s.id}`,
        ts,
        when: Number.isNaN(when.getTime())
          ? s.createdAtIso
          : `${when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        title,
        sub,
        items: linesLabel(mappedLines) || undefined,
        lines: mappedLines.length ? mappedLines : undefined,
        amount: total,
        tone: isCredit ? 'credit' : 'sale',
        debtStatus: debtMeta?.debtStatus,
        debtPaid: debtMeta?.debtPaid,
        debtRemain: debtMeta?.debtRemain,
      })
    }

    if (client.phone) {
      for (const h of debtList) {
        if (h.type === 'pay') {
          rows.push({
            id: `repay-${h.id}`,
            ts: h.ts || 0,
            when: `${h.date}${h.time ? ` · ${h.time}` : ''}`,
            title: 'Погашение долга',
            sub: h.desc || 'Погашение',
            amount: Number(h.amount) || 0,
            tone: 'repay',
          })
          continue
        }
        if (linkedDebtIds.has(h.id)) continue
        const u = unpaidById.get(h.id)
        const isPaid = paidById.has(h.id)
        const amt = Math.abs(Number(h.amount) || 0)
        let title = 'Долг по заказу'
        let sub = h.desc || h.itemsSummary || 'Долг'
        let debtStatus: ClientHistRow['debtStatus'] = 'open'
        let debtPaid = 0
        let debtRemain = amt
        if (isPaid) {
          title = 'Долг · погашен'
          sub = `${sub} · оплачен полностью`
          debtStatus = 'paid'
          debtPaid = amt
          debtRemain = 0
        } else if (u?.partial) {
          title = 'Долг · частично'
          sub = `${sub} · оплачено ${fmtMoney(u.paidAmount)} · остаток ${fmtMoney(u.remainingAmount)}`
          debtStatus = 'partial'
          debtPaid = u.paidAmount
          debtRemain = u.remainingAmount
        } else {
          title = 'Долг · открыт'
          sub = `${sub} · не оплачен`
        }
        rows.push({
          id: `debt-${h.id}`,
          ts: h.ts || 0,
          when: `${h.date}${h.time ? ` · ${h.time}` : ''}`,
          title,
          sub,
          items: h.itemsSummary || undefined,
          lines: parseItemsSummary(h.itemsSummary),
          amount: amt,
          tone: 'debt',
          debtStatus,
          debtPaid,
          debtRemain,
        })
      }
      for (const t of loadBalanceTopups(client.phone)) {
        const credited = topupBalanceCredit(t)
        const isTopup = !t.desc || String(t.desc).includes('Пополнение')
        const cash = Math.floor(Number(t.cash) || 0)
        const storedBonus = Math.floor(Number(t.bonus) || 0)
        const percentPart = isTopup && cash > 0 && storedBonus < cash ? storedBonus : Math.max(0, storedBonus - cash)
        rows.push({
          id: `topup-${t.id}`,
          ts: t.ts || 0,
          when: `${t.date}${t.time ? ` · ${t.time}` : ''}`,
          title: isTopup ? 'Пополнение баланса' : (t.desc || 'Начисление наличными'),
          sub: isTopup
            ? (percentPart > 0
              ? `+${cash.toLocaleString('ru-RU')} ⭐ сумма · +${percentPart.toLocaleString('ru-RU')} ⭐ бонус %`
              : `+${credited.toLocaleString('ru-RU')} ⭐ на баланс`)
            : (credited > 0 ? `+${credited.toLocaleString('ru-RU')} ⭐ на баланс` : 'Без зачисления'),
          amount: Number(t.cash) || 0,
          tone: 'topup',
        })
      }
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, 120)
  }, [client, sales, histTick, products])

  const histChecks = useMemo(
    () => clientHistory.filter(r => r.tone === 'sale'),
    [clientHistory],
  )
  const histDebtOrders = useMemo(
    () => clientHistory.filter(r => r.tone === 'credit' || r.tone === 'debt'),
    [clientHistory],
  )
  const histRepays = useMemo(
    () => clientHistory.filter(r => r.tone === 'repay'),
    [clientHistory],
  )
  const histTopups = useMemo(
    () => clientHistory.filter(r => r.tone === 'topup'),
    [clientHistory],
  )
  const histDebtsCount = histDebtOrders.length + histRepays.length

  /** Активные долги только по FIFO-остатку (со старых чеков); сумма ≈ «Долг сейчас» */
  const histActiveDebts = useMemo(() => {
    void histTick
    if (!client) return [] as ClientHistRow[]

    const fmtWhen = (ts: number, fallback = '') => {
      if (!ts) return fallback
      const d = new Date(ts)
      if (Number.isNaN(d.getTime())) return fallback
      return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    }

    const toRow = (u: DebtOrderBalance, lines: ClientHistLine[]): ClientHistRow => ({
      id: `active-${u.id}`,
      ts: u.ts || 0,
      when: `${u.date}${u.time ? ` · ${u.time}` : ''}` || fmtWhen(u.ts || 0),
      title: u.partial ? 'Чек · долг частично' : 'Чек · долг открыт',
      sub: u.partial
        ? `Остаток ${fmtMoney(u.remainingAmount)} из ${fmtMoney(u.originalAmount)} · погашение со старых`
        : `Не оплачен · ${fmtMoney(u.remainingAmount)}`,
      items: linesLabel(lines) || u.itemsSummary || undefined,
      lines: lines.length ? lines : parseItemsSummary(u.itemsSummary),
      amount: u.remainingAmount,
      tone: 'debt',
      debtStatus: u.partial ? 'partial' : 'open',
      debtPaid: u.paidAmount,
      debtRemain: u.remainingAmount,
    })

    const findSaleLines = (u: DebtOrderBalance): ClientHistLine[] => {
      if (u.orderId) {
        const sale = sales.find(s => s.id === u.orderId)
        if (sale) return mapSaleLines(sale.items, products)
      }
      const amt = Math.abs(Number(u.amount) || 0)
      const sale = sales.find(s => {
        const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
        const matchId = client.id && s.clientId === client.id
        if (!matchPhone && !matchId) return false
        if (!(s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0)) return false
        const st = new Date(s.createdAtIso).getTime() || 0
        return Math.abs((Number(s.debtAdded) || Number(s.total) || 0) - amt) < 0.02
          && Math.abs(st - (u.ts || 0)) < 15 * 60 * 1000
      })
      return sale ? mapSaleLines(sale.items, products) : parseItemsSummary(u.itemsSummary)
    }

    if (client.phone) {
      const debtList = loadDebtHistory(client.phone)
      const hasDebtEntries = debtList.some(h => h.type === 'debt')
      if (hasDebtEntries) {
        const { unpaid } = buildDebtOrderBalances(debtList)
        const unpaidSum = unpaid.reduce((s, u) => s + (Number(u.remainingAmount) || 0), 0)
        if (Math.abs(unpaidSum - clientDebt) < 0.51 || clientDebt <= 0.001) {
          return unpaid
            .filter(u => (Number(u.remainingAmount) || 0) > 0.001)
            .slice()
            .sort((a, b) => (a.ts || 0) - (b.ts || 0))
            .map(u => toRow(u, findSaleLines(u)))
        }
      }
    }

    const creditSales = sales
      .filter(s => {
        const matchId = client.id && s.clientId === client.id
        const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
        if (!matchId && !matchPhone) return false
        return s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0
      })
      .map(s => ({
        sale: s,
        ts: new Date(s.createdAtIso).getTime() || 0,
        amt: Number(s.debtAdded) || Number(s.total) || 0,
      }))
      .filter(x => x.amt > 0)
      .sort((a, b) => a.ts - b.ts)

    const charged = creditSales.reduce((s, x) => s + x.amt, 0)
    let payLeft = Math.max(0, Math.round((charged - clientDebt) * 100) / 100)
    const active: ClientHistRow[] = []
    for (const x of creditSales) {
      if (payLeft >= x.amt - 0.001) {
        payLeft = Math.round((payLeft - x.amt) * 100) / 100
        continue
      }
      const paidAmount = payLeft > 0.001 ? payLeft : 0
      const remainingAmount = Math.round((x.amt - paidAmount) * 100) / 100
      payLeft = 0
      if (remainingAmount <= 0.001) continue
      const partial = paidAmount > 0.001
      const lines = mapSaleLines(x.sale.items, products)
      active.push({
        id: `active-sale-${x.sale.id}`,
        ts: x.ts,
        when: fmtWhen(x.ts, x.sale.createdAtIso),
        title: partial ? 'Чек · долг частично' : 'Чек · долг открыт',
        sub: partial
          ? `Остаток ${fmtMoney(remainingAmount)} из ${fmtMoney(x.amt)} · погашение со старых`
          : `Не оплачен · ${fmtMoney(remainingAmount)}`,
        items: linesLabel(lines) || undefined,
        lines: lines.length ? lines : undefined,
        amount: remainingAmount,
        tone: 'credit',
        debtStatus: partial ? 'partial' : 'open',
        debtPaid: paidAmount,
        debtRemain: remainingAmount,
      })
    }
    return active
  }, [client, sales, clientDebt, histTick, products])

  const histPaidDebts = useMemo(
    () => histDebtOrders.filter(r => r.debtStatus === 'paid'),
    [histDebtOrders],
  )
  const histOpenDebts = useMemo(
    () => histActiveDebts.slice(0, 12),
    [histActiveDebts],
  )

  function renderHistRow(row: ClientHistRow, opts?: { compact?: boolean }) {
    return (
      <button
        key={row.id}
        type="button"
        className={`hist-row tone-${row.tone}${row.debtStatus === 'partial' ? ' partial' : ''}${row.debtStatus === 'paid' ? ' settled' : ''}${opts?.compact ? ' sm' : ''}`}
        onClick={() => setHistDetail(row)}
      >
        <div className="hist-main">
          <div className="hist-title-row">
            <b>{row.title}</b>
            {row.debtStatus === 'paid' && <span className="hist-badge paid">Полностью</span>}
            {row.debtStatus === 'partial' && <span className="hist-badge partial">Частично</span>}
            {row.debtStatus === 'open' && (row.tone === 'credit' || row.tone === 'debt') && (
              <span className="hist-badge open">Открыт</span>
            )}
          </div>
          <span className="hist-when">{row.when}</span>
          {!opts?.compact && <span className="hist-sub">{row.sub}</span>}
          {row.items ? <span className="hist-items">{row.items}</span> : null}
        </div>
        <div className="hist-amt-col">
          <div className="hist-amt">{fmtMoney(row.amount)}</div>
          {row.debtStatus === 'partial' && row.debtRemain != null && (
            <div className="hist-remain">остаток {fmtMoney(row.debtRemain)}</div>
          )}
        </div>
      </button>
    )
  }

  // Восстановить баланс по истории: пополнение = вся сумма наличными (1:1)
  useEffect(() => {
    if (!histOpen || !client?.card || !client.phone || !USE_API) return
    let cancelled = false
    const histCredit = loadBalanceTopups(client.phone).reduce((s, t) => s + topupBalanceCredit(t), 0)
    if (histCredit <= 0) return
    const cardRow = cards.find(c => cardNumsMatch(c.num, client.card!))
    const curBonus = Number(loyalty?.bonus ?? cardRow?.bonus) || 0
    const curPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
    if (curBonus >= histCredit && curPos >= histCredit) return
    void (async () => {
      try {
        const nextPos = Math.max(curPos, histCredit)
        const nextBonus = Math.max(curBonus, nextPos)
        if (nextPos === curPos && nextBonus === curBonus) return
        await api.updateCard(client.card!, {
          bonus: nextBonus,
          posCashBonus: nextPos,
        })
        if (!cancelled) {
          await refresh()
          const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
          if (fresh) setClient(fresh)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one heal when opening profile
  }, [histOpen, client?.id, client?.card, client?.phone])

  const clientProfileStats = useMemo(() => {
    void histTick
    const bonus = Number(loyalty?.bonus) || 0
    let repaid = 0
    let charged = 0
    if (client?.phone) {
      for (const h of loadDebtHistory(client.phone)) {
        if (h.type === 'pay') repaid += Number(h.amount) || 0
        else charged += Math.abs(Number(h.amount) || 0)
      }
    }
    const creditSales = clientHistory.filter(r => r.tone === 'credit').length
    return { bonus, repaid, charged, creditSales }
  }, [client, loyalty, histTick, clientHistory])

  const subtotalGross = useMemo(() => cart.reduce((s, l) => s + lineGross(l), 0), [cart])
  const itemDiscAmount = useMemo(() => cart.reduce((s, l) => s + (lineGross(l) - lineNet(l)), 0), [cart])
  const subtotal = useMemo(() => cart.reduce((s, l) => s + lineNet(l), 0), [cart])
  const levelDiscPct = useMemo(() => {
    if (!loyalty || pay === 'credit') return 0
    const map: Record<string, number> = { bronze: 0, silver: 3, gold: 5, platinum: 8, basic: 0 }
    return map[loyalty.level] || 0
  }, [loyalty, pay])
  const checkDiscPct = discountPct + levelDiscPct
  const discAmount = subtotal * (checkDiscPct / 100)
  const afterDisc = Math.max(0, subtotal - discAmount)
  const maxBonus = loyalty ? Math.min(Number(loyalty.bonus) || 0, afterDisc) : 0
  const usedBonus = Math.min(bonusUsed, maxBonus)
  const total = Math.max(0, afterDisc - usedBonus)

  function showToast(title: string, sub: string) {
    setToast({ title, sub })
  }

  function findClientByScan(raw: string): AdminClient | null {
    const q = raw.trim().replace(/\s+/g, '')
    if (!q) return null
    const exact = clients.find(c => c.card && cardNumsMatch(c.card, q))
    if (exact) return exact
    const lower = q.toLowerCase()
    const byCard = clients.find(c => (c.card || '').replace(/\s+/g, '').toLowerCase() === lower)
    if (byCard) return byCard
    const byPhone = clients.find(c => phonesMatch(c.phone, q))
    if (byPhone) return byPhone
    if (q.length >= 4) {
      const partial = clients.find(c => (c.card || '').replace(/\s+/g, '').toLowerCase().includes(lower))
      if (partial) return partial
    }
    return null
  }

  function applyClientScan(raw: string): boolean {
    const found = findClientByScan(raw)
    if (!found) {
      showToast('Клиент не найден', 'Проверьте QR-код или номер карты')
      return false
    }
    setClient(found)
    setBonusUsed(0)
    setClientOpen(false)
    setClientScanOpen(false)
    setClientScanBuf('')
    setClientQ('')
    setClientPick(null)
    showToast('Клиент выбран', `${found.name}${found.card ? ` · ${found.card}` : ''}`)
    return true
  }

  /** Те же товары, что в левом окне при текущем фильтре + поисковой строке */
  function leftPanelMatches(raw: string) {
    let list = inStockProducts
    if (showFav) list = list.filter(p => favSet.has(p.id))
    else if (selectedCatSlugs.length > 0) {
      list = list.filter(p => selectedCatSlugs.some(slug =>
        productMatchesCategoryFilter(p.catId, slug, categories)
        || productMatchesCategoryFilter(p.cat, slug, categories),
      ))
    }
    return filterProductsBySearch(list, raw.trim(), 40)
  }

  /** Сканер: брать значение из input (не из устаревшего state) и класть товар в чек */
  function commitPosSearch(rawIn?: string): boolean {
    const raw = String(
      rawIn
      || scanAccumRef.current
      || searchInputRef.current?.value
      || qRef.current
      || '',
    ).trim()
    if (!raw) return false
    scanAccumRef.current = ''

    const clientHit = findClientByScan(raw)
    const looksLikeClientCard = /какапо/i.test(raw) || /^k-?\d+/i.test(raw)
    if (clientHit && (looksLikeClientCard || !pickProductBySearch(products, raw))) {
      applyClientScan(raw)
      qRef.current = ''
      setQ('')
      scanBurstRef.current = false
      window.setTimeout(focusProductSearch, 0)
      return true
    }

    const digits = raw.replace(/\D/g, '')
    const pool = inStockProducts.length ? inStockProducts : products
    let productHit: Product | null =
      (pickProductBySearch(pool, raw) as Product | null)
      || (digits.length >= 4
        ? (pool.find(p => productBarcodes(p).some(c => c.replace(/\D/g, '') === digits)) as Product | undefined) || null
        : null)

    if (!productHit) {
      const ranked = leftPanelMatches(raw)
      // Как слева: один товар в списке после скана → сразу в чек
      if (ranked.length === 1) productHit = ranked[0] as Product
      else if (ranked[0] && productSearchScore(ranked[0], raw) >= 300) productHit = ranked[0] as Product
      else if (digits.length >= 6) {
        const byCode = ranked.find(p =>
          productBarcodes(p).some(c => {
            const cd = c.replace(/\D/g, '')
            return cd === digits || cd.endsWith(digits) || digits.endsWith(cd)
          }),
        )
        if (byCode) productHit = byCode as Product
      }
    }

    if (!productHit) {
      // точного нет — не чистим поиск, кассир видит фильтр слева
      return false
    }
    if ((Number(productHit.stock) || 0) <= 0) {
      showToast('Нет на складе', productHit.name)
      return false
    }
    addProduct(productHit)
    qRef.current = ''
    setQ('')
    scanBurstRef.current = false
    window.setTimeout(focusProductSearch, 0)
    return true
  }

  function scheduleScanCommit(delayMs: number) {
    if (scanCommitTimer.current) {
      window.clearTimeout(scanCommitTimer.current)
      scanCommitTimer.current = null
    }
    scanCommitTimer.current = window.setTimeout(() => {
      scanCommitTimer.current = null
      const live = String(
        scanAccumRef.current
        || searchInputRef.current?.value
        || qRef.current
        || '',
      ).trim()
      if (live.length < 3) return
      commitPosSearch(live)
    }, delayMs)
  }

  function onProductSearchChange(value: string) {
    qRef.current = value
    setQ(value)
    const trimmed = value.trim()
    const digits = trimmed.replace(/\D/g, '')
    const digitHeavy = digits.length >= 4 && digits.length >= Math.ceil(trimmed.length * 0.6)
    const looksBarcode = /^[\d\- ]{4,48}$/.test(trimmed) && digits.length >= 4
    // USB-сканер: быстрый ввод и/или штрихкод без Enter → автодобавление после паузы
    if (!(scanBurstRef.current || looksBarcode || digitHeavy)) return
    scheduleScanCommit(scanBurstRef.current ? 130 : 160)
  }

  function onProductSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const now = performance.now()
    const gap = now - scanLastKeyTs.current
    scanLastKeyTs.current = now

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // сканер печатает заметно быстрее человека — копим код отдельно от React-state
      if (gap > 0 && gap < 70) {
        scanBurstRef.current = true
        if (!scanAccumRef.current) {
          const field = String(searchInputRef.current?.value || qRef.current || '')
          // keydown обычно до появления символа в value; если уже есть — не дублируем
          scanAccumRef.current = field.endsWith(e.key) ? field.slice(0, -e.key.length) : field
        }
        scanAccumRef.current += e.key
        scheduleScanCommit(130)
      } else if (gap > 220) {
        scanBurstRef.current = false
        scanAccumRef.current = ''
      } else if (scanBurstRef.current && gap < 160) {
        scanAccumRef.current += e.key
        scheduleScanCommit(130)
      }
    }

    // Enter или Tab (многие сканеры суффикс Tab) → в чек
    if (e.key === 'Enter' || e.key === 'Tab') {
      const fromAccum = scanAccumRef.current.trim()
      const raw = (fromAccum || (e.currentTarget as HTMLInputElement).value).trim()
      if (!raw) return
      if (e.key === 'Tab' && !scanBurstRef.current && !/^[\d\- ]{4,}$/.test(raw)) return
      e.preventDefault()
      if (scanCommitTimer.current) {
        window.clearTimeout(scanCommitTimer.current)
        scanCommitTimer.current = null
      }
      commitPosSearch(raw)
    }
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
      const posId = openingPosId || visiblePosPoints[0]?.id
      if (!posId) throw new Error('Сначала создайте точку продаж')
      const picked = cashierOptions.find(c => c.id === pickedCashierId)
      const cashier = await ensureCashier(picked?.name || gateName, pickedCashierId)
      const next = { cashierId: cashier.id, cashierName: cashier.name, initials: initialsOf(cashier.name) }
      saveSettings(next)
      setSettings(next)
      if (!USE_API) throw new Error('Касса работает только с API')
      await api.openPosShift({ cashierId: cashier.id, openingCash: cash, posId })
      await refresh()
      setCart([])
      setClient(null)
      setDiscountPct(0)
      setBonusUsed(0)
      setPay('cash')
      setOpenShiftModal(false)
      setOpeningPosId(null)
      setPosSurface('register')
      showToast('Смена открыта', cashier.name)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось открыть смену')
    } finally {
      setBusy(false)
    }
  }

  async function createPosPoint() {
    setBusy(true)
    setMsg('')
    try {
      const name = newPosName.trim()
      if (!name) throw new Error('Укажите название точки продаж')
      if (!USE_API) throw new Error('Нужен API сервер')
      await api.createPosPoint({ name, code: newPosCode.trim() || undefined })
      await refresh()
      setCreatePosModal(false)
      setNewPosName('')
      setNewPosCode('')
      showToast('Точка создана', name)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось создать точку')
    } finally {
      setBusy(false)
    }
  }

  function openPosSettings(posId: string) {
    const point = posPoints.find(p => p.id === posId)
    if (!point) return
    setDashMenuPosId(null)
    setMsg('')
    setEditPosId(point.id)
    setEditPosName(point.name || '')
    setEditPosCode(point.code || '')
    setEditPosNote(point.note || '')
    setEditReceiptPhone(point.receiptPhone || '')
    if (isKakapoDesktop()) {
      const desk = getKakapoDesktop()
      void Promise.all([
        desk?.getPrinters().catch(() => [] as DesktopPrinter[]),
        desk?.getPrinterSettings().catch(() => ({
          printerName: '',
          paperWidthMm: XP58C_RECEIPT_MM,
          labelPrinterName: '',
          scaleMode: 'plu-label' as const,
          scaleHost: '',
          scalePort: 20304,
          scaleDept: 1,
          scaleLiveWeight: true,
        })),
      ]).then(([printers, settings]) => {
        const list = printers || []
        setDeskPrinters(sortReceiptPrinters(list))
        const saved = String(settings?.printerName || '').trim()
        const savedStillThere = saved && list.some(p => p.name === saved)
        const auto = pickReceiptPrinter(list)
        const name = (savedStillThere ? saved : '') || auto || (list[0]?.name || '')
        setDeskPrinterName(name)
        setDeskPaperMm(XP58C_RECEIPT_MM)
        setDeskScaleMode(settings?.scaleMode === 'none' ? 'none' : 'plu-label')
        setDeskScaleHost(settings?.scaleHost || '')
        setDeskScalePort(String(settings?.scalePort || 20304))
        setDeskScaleDept(String(settings?.scaleDept || 1))
        setDeskScaleLiveWeight(settings?.scaleLiveWeight !== false)
        if (name && desk) {
          void desk.savePrinterSettings({
            ...settings,
            printerName: name,
            paperWidthMm: XP58C_RECEIPT_MM,
          }).catch(() => undefined)
        }
      })
    }
  }

  async function savePosSettings() {
    if (!editPosId) return
    setBusy(true)
    setMsg('')
    try {
      const name = editPosName.trim()
      if (!name) throw new Error('Укажите название')
      if (!USE_API) throw new Error('Нужен API сервер')
      await api.updatePosPoint(editPosId, {
        name,
        code: editPosCode.trim(),
        note: editPosNote.trim(),
        receiptPhone: editReceiptPhone.trim(),
      })
      if (isKakapoDesktop()) {
        const desk = getKakapoDesktop()
        const printers = deskPrinters.length
          ? deskPrinters
          : await desk?.getPrinters().catch(() => [] as DesktopPrinter[]) || []
        const printerName = deskPrinterName || pickReceiptPrinter(printers) || printers[0]?.name || ''
        if (!printerName) throw new Error('Выберите принтер XP-58C')
        const cur = await desk?.getPrinterSettings()
        await desk?.savePrinterSettings({
          ...cur,
          printerName,
          paperWidthMm: XP58C_RECEIPT_MM,
          scaleMode: deskScaleMode,
          scaleHost: deskScaleHost.trim(),
          scalePort: Number(deskScalePort) || 20304,
          scaleDept: Number(deskScaleDept) || 1,
          scaleLiveWeight: deskScaleLiveWeight,
        })
        setDeskPrinterName(printerName)
        setDeskPaperMm(XP58C_RECEIPT_MM)
        if (deskScaleLiveWeight && deskScaleHost.trim()) {
          void ensureCasWeightMonitor(true)
        } else {
          void ensureCasWeightMonitor(false)
        }
      }
      await refresh()
      setEditPosId(null)
      showToast('Сохранено', name)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function refreshDeskPrinters() {
    const desk = getKakapoDesktop()
    if (!desk) {
      showToast('Принтеры', 'Запустите KAKAPO Касса (desktop)')
      return
    }
    try {
      const [printers, settings] = await Promise.all([
        desk.getPrinters(),
        desk.getPrinterSettings().catch(() => null),
      ])
      const list = sortReceiptPrinters(printers || [])
      setDeskPrinters(list)
      const saved = String(settings?.printerName || deskPrinterName || '').trim()
      const savedOk = saved && list.some(p => p.name === saved)
      const auto = pickReceiptPrinter(list)
      const name = (savedOk ? saved : '') || auto || ''
      setDeskPrinterName(name)
      setDeskPaperMm(XP58C_RECEIPT_MM)
      if (name) {
        await desk.savePrinterSettings({
          ...(settings || {}),
          printerName: name,
          paperWidthMm: XP58C_RECEIPT_MM,
        }).catch(() => undefined)
        showToast('Принтеры', `Найден: ${name}`)
      } else {
        showToast(
          'XP-58C не найден',
          list.length
            ? `В Windows: ${list.slice(0, 3).map(p => p.displayName || p.name).join(', ')}`
            : 'Подключите принтер USB и установите драйвер',
        )
      }
    } catch (e) {
      showToast('Принтеры', e instanceof Error ? e.message : 'Не удалось обновить список')
    }
  }

  async function testReceiptPrinter() {
    const desk = getKakapoDesktop()
    if (!desk) {
      showToast('Печать', 'Запустите KAKAPO Касса (desktop)')
      return
    }
    setDeskPrintBusy(true)
    try {
      const printers = sortReceiptPrinters(await desk.getPrinters().catch(() => [] as DesktopPrinter[]))
      setDeskPrinters(printers)
      const xp = pickReceiptPrinter(printers)
      if (!xp) {
        const names = printers.map(p => p.displayName || p.name).filter(Boolean)
        throw new Error(
          names.length
            ? `XP-58C не найден в Windows. Сейчас: ${names.slice(0, 4).join(', ')}. Подключите принтер USB и установите драйвер Xprinter.`
            : 'XP-58C не найден в Windows. Подключите USB, включите принтер и установите драйвер Xprinter.',
        )
      }
      setDeskPrinterName(xp)
      setDeskPaperMm(XP58C_RECEIPT_MM)
      const cur = await desk.getPrinterSettings()
      await desk.savePrinterSettings({
        ...cur,
        printerName: xp,
        paperWidthMm: XP58C_RECEIPT_MM,
      })
      const sample = buildDemoReceiptSale()
      const storeName = editPosName.trim() || 'КАКАПО'
      const storePhone = editReceiptPhone.trim()
      await printPosReceipt(sample, {
        storeName,
        storePhone,
        subtitle: '',
        posLabel: storeName,
        cashierName: sample.cashierName,
      })
      showToast('Чек напечатан', xp)
    } catch (e) {
      showToast('Печать', e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setDeskPrintBusy(false)
    }
  }

  function openReceiptTemplateEditor() {
    setReceiptTemplateDraft(loadReceiptStore())
    setReceiptTemplateOpen(true)
  }

  function saveReceiptTemplateEditor() {
    const next = normalizeReceiptStore(receiptTemplateDraft)
    saveReceiptStore(next)
    setReceiptTemplateDraft(next)
    setReceiptTemplateOpen(false)
    showToast('Шаблон чека', 'Настройки сохранены')
  }

  function resetReceiptTemplateEditor() {
    setReceiptTemplateDraft({ ...DEFAULT_RECEIPT_STORE })
  }

  async function testReceiptTemplateDraft() {
    const desk = getKakapoDesktop()
    if (!desk) {
      showToast('Печать', 'Запустите KAKAPO Касса (desktop)')
      return
    }
    setDeskPrintBusy(true)
    try {
      const sample = buildDemoReceiptSale()
      await printPosReceipt(sample, {
        ...normalizeReceiptStore(receiptTemplateDraft),
        storeName: editPosName.trim() || 'КАКАПО',
        storePhone: editReceiptPhone.trim(),
        subtitle: '',
        posLabel: editPosName.trim() || 'Касса №1',
        cashierName: sample.cashierName,
      })
      showToast('Тестовый чек', 'Шаблон отправлен на XP-58C')
    } catch (e) {
      showToast('Печать', e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setDeskPrintBusy(false)
    }
  }

  async function confirmDeletePos() {
    if (!deletePosId) return
    setBusy(true)
    setMsg('')
    try {
      if (!USE_API) throw new Error('Нужен API сервер')
      const name = posPoints.find(p => p.id === deletePosId)?.name || 'Точка'
      await api.deletePosPoint(deletePosId)
      await refresh()
      setDeletePosId(null)
      showToast('Удалено', name)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
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
      setCashierScreen(null)
      setCashierMenuOpen(false)
      setPosSurface('dashboard')
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

  async function switchCashier() {
    if (!activeShift) return
    const next = cashierOptions.find(c => c.id === switchCashierId)
    if (!next) {
      setMsg('Выберите кассира')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const cash = Number(closingCash)
      if (!(cash >= 0) || closingCash === '') throw new Error('Укажите сумму наличных в кассе')
      await api.closePosShift(activeShift.id, { closingCash: cash })
      const cashier = await ensureCashier(next.name, next.id)
      const s = { cashierId: cashier.id, cashierName: cashier.name, initials: initialsOf(cashier.name) }
      saveSettings(s)
      setSettings(s)
      await api.openPosShift({
        cashierId: cashier.id,
        openingCash: cash,
        posId: activeShift.posId || activePosPoint?.id,
      })
      await refresh()
      setCashierScreen(null)
      setCashierMenuOpen(false)
      setCart([])
      setClient(null)
      setDiscountPct(0)
      setBonusUsed(0)
      setPay('cash')
      setGateCash(String(cash.toFixed(2)))
      setPickedCashierId(cashier.id)
      setGateName(cashier.name)
      showToast('Кассир сменён', `${cashier.name} · в кассе ${fmtMoney(cash)}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сменить кассира')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  function openCashierScreen(kind: 'close' | 'switch' | 'receipts') {
    setCashierMenuOpen(false)
    setMsg('')
    if (kind === 'receipts') {
      setReceiptQ('')
      setReceiptFilter('all')
      setReceiptSaleId(null)
      setReturnQtyByIdx({})
      setCashierScreen('receipts')
      void refresh()
      return
    }
    const expected = activeShift ? expectedTillCash(activeShift) : 0
    setClosingCash(expected > 0 ? expected.toFixed(2) : '0.00')
    setSwitchCashierId(settings.cashierId || pickedCashierId || cashierOptions[0]?.id || '')
    setCashierScreen(kind)
  }

  function openTillMove(kind: 'in' | 'out') {
    if (!activeShift) {
      showToast('Смена закрыта', 'Сначала откройте смену')
      return
    }
    setCashierMenuOpen(false)
    setMsg('')
    setTillMoveKind(kind)
    setTillAmountBuf('')
    setTillNote('')
    setTillSupplierId('')
    setAmountPad(false)
  }

  async function submitTillMove() {
    if (!activeShift || !tillMoveKind) return
    setBusy(true)
    setMsg('')
    try {
      const amount = Number(tillAmountBuf)
      if (!(amount > 0)) throw new Error('Укажите сумму')
      if (!USE_API) throw new Error('Нужен API')
      if (tillMoveKind === 'out' && amount > tillExpected + 0.009) {
        throw new Error(`В кассе только ${fmtMoney(tillExpected)}`)
      }
      await api.createFinanceMove({
        type: tillMoveKind === 'in' ? 'deposit' : 'withdraw',
        amount,
        note: tillNote.trim() || undefined,
        createdBy: settings.cashierName,
        cashierId: settings.cashierId || activeShift.cashierId,
        cashierName: settings.cashierName || activeShift.cashierName,
        shiftId: activeShift.id,
        posId: activeShift.posId || activePosPoint?.id,
        supplierId: tillMoveKind === 'out' && tillSupplierId ? tillSupplierId : undefined,
        reason: tillMoveKind === 'in'
          ? 'Внесение в кассу'
          : tillSupplierId
            ? undefined
            : 'Снятие из кассы',
      })
      await refresh()
      const kindLabel = tillMoveKind === 'in' ? 'Внесено' : 'Снято'
      const supplierName = tillSupplierId
        ? suppliers.find(s => s.id === tillSupplierId)?.name
        : ''
      showToast(
        kindLabel,
        supplierName ? `${fmtMoney(amount)} · ${supplierName}` : fmtMoney(amount),
      )
      setTillMoveKind(null)
      setTillAmountBuf('')
      setTillNote('')
      setTillSupplierId('')
      setAmountPad(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  function saleLineLeft(it: { qty?: number; returnedQty?: number }) {
    return Math.max(0, Math.round(((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)) * 100) / 100)
  }

  function isSaleFullyReturned(s: typeof sales[number]) {
    if (s.status === 'returned') return true
    const items = s.items || []
    return items.length > 0 && items.every(it => saleLineLeft(it) <= 0)
  }

  function isSalePartiallyReturned(s: typeof sales[number]) {
    if (isSaleFullyReturned(s)) return false
    if (s.status === 'partial') return true
    return (s.items || []).some(it => (Number(it.returnedQty) || 0) > 0)
  }

  const receiptList = useMemo(() => {
    const qRaw = receiptQ.trim()
    const q = qRaw.toLowerCase()
    const qDigits = qRaw.replace(/[^\d]/g, '')
    const looksOrderNum = /^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(qRaw)
    const barcodeHit = qRaw ? pickProductBySearch(products, qRaw) : null
    const barcodeIds = new Set<number>()
    if (barcodeHit?.id != null) barcodeIds.add(Number(barcodeHit.id))
    if (qDigits.length >= 4) {
      for (const p of products) {
        if (productBarcodes(p).some(c => {
          const cd = c.replace(/\D/g, '')
          return c === qRaw || cd === qDigits || (qDigits.length >= 8 && (cd.endsWith(qDigits) || qDigits.endsWith(cd)))
        })) {
          barcodeIds.add(Number(p.id))
        }
      }
    }
    const namedHits = qRaw && !looksOrderNum
      ? filterProductsBySearch(products, qRaw, 40)
      : []
    const namedIds = new Set(namedHits.map(p => Number(p.id)))

    return [...sales]
      .filter(s => {
        const posId = activeShift?.posId
        if (!posId) return true
        if (!s.posId) return true
        return s.posId === posId
      })
      .sort((a, b) => {
        const nb = saleOrderSeq(b)
        const na = saleOrderSeq(a)
        if (nb !== na) return nb - na
        return String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || ''))
      })
      .filter(s => {
        const fully = isSaleFullyReturned(s)
        const partial = isSalePartiallyReturned(s)
        if (receiptFilter === 'returned') return fully || partial
        if (receiptFilter === 'cash') return !fully && s.paymentMethod === 'cash'
        if (receiptFilter === 'card') return !fully && (s.paymentMethod === 'card' || s.paymentMethod === 'mixed')
        if (receiptFilter === 'credit') return !fully && (s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0)
        return true
      })
      .filter(s => {
        if (!q) return true
        const seq = saleOrderSeq(s)
        const label = saleNumberLabel(s)
        const items = s.items || []

        // Штрихкод / артикул товара → чеки с этим productId
        if (barcodeIds.size > 0 && (qDigits.length >= 4 || barcodeHit)) {
          if (items.some(i => barcodeIds.has(Number(i.productId)))) return true
          // длинный штрихкод без совпадения по id — не путать с номером чека
          if (qDigits.length >= 8 && !looksOrderNum) return false
        }

        // Короткий номер чека: "4863", "K-4863", "№11"
        if (looksOrderNum && qDigits) {
          if (String(seq) === qDigits || label.toLowerCase() === q || label.replace(/^k-/i, '') === qDigits) return true
        }

        // Поиск по названию товара из каталога
        if (namedIds.size && items.some(i => namedIds.has(Number(i.productId)))) return true
        if (items.some(i => (i.productName || '').toLowerCase().includes(q))) return true

        const hay = [
          label,
          seq > 0 ? String(seq) : '',
          s.orderId,
          s.id,
          s.clientName,
          s.clientPhone,
          s.cardNum,
          s.cashierName,
          ...items.map(i => i.productName),
        ].join(' ').toLowerCase()
        return hay.includes(q)
      })
  }, [sales, receiptQ, receiptFilter, products, activeShift?.posId])

  const receiptProductHint = useMemo(() => {
    const qRaw = receiptQ.trim()
    if (!qRaw) return null
    if (/^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(qRaw)) return null
    const hit = pickProductBySearch(products, qRaw)
    if (!hit) return null
    const n = receiptList.filter(s => (s.items || []).some(i => Number(i.productId) === Number(hit.id))).length
    return { name: hit.name, count: n }
  }, [receiptQ, products, receiptList])

  useEffect(() => {
    if (cashierScreen !== 'receipts' || receiptSaleId) return
    const t = window.setTimeout(() => {
      try { receiptSearchRef.current?.focus({ preventScroll: true }) }
      catch { receiptSearchRef.current?.focus() }
    }, 40)
    return () => window.clearTimeout(t)
  }, [cashierScreen, receiptSaleId])

  const receiptDetail = useMemo(
    () => (receiptSaleId ? sales.find(s => s.id === receiptSaleId) || null : null),
    [sales, receiptSaleId],
  )

  const receiptReturnPreview = useMemo(() => {
    if (!receiptDetail) return { count: 0, total: 0, items: [] as { index: number; qty: number }[] }
    const items: { index: number; qty: number }[] = []
    let total = 0
    ;(receiptDetail.items || []).forEach((line, index) => {
      const qty = Number(returnQtyByIdx[index]) || 0
      if (!(qty > 0)) return
      const left = saleLineLeft(line)
      const take = Math.min(qty, left)
      if (!(take > 0)) return
      const unit = Number(line.qty) > 0
        ? (Number(line.lineTotal) || 0) / Number(line.qty)
        : Number(line.price) || 0
      total += unit * take
      items.push({ index, qty: take })
    })
    return { count: items.length, total: Math.round(total * 100) / 100, items }
  }, [receiptDetail, returnQtyByIdx])

  function toggleReturnLine(index: number, left: number) {
    if (!(left > 0)) return
    setReturnQtyByIdx(prev => {
      const cur = Number(prev[index]) || 0
      if (cur > 0) {
        const next = { ...prev }
        delete next[index]
        return next
      }
      return { ...prev, [index]: left }
    })
  }

  function setReturnLineQty(index: number, qty: number, left: number) {
    const q = Math.max(0, Math.min(left, Math.round(qty * 100) / 100))
    setReturnQtyByIdx(prev => {
      if (!(q > 0)) {
        const next = { ...prev }
        delete next[index]
        return next
      }
      return { ...prev, [index]: q }
    })
  }

  function selectAllReturnLines(sale: typeof sales[number]) {
    const next: Record<number, number> = {}
    ;(sale.items || []).forEach((line, index) => {
      const left = saleLineLeft(line)
      if (left > 0) next[index] = left
    })
    setReturnQtyByIdx(next)
  }

  async function returnReceipt(saleId: string, mode: 'selected' | 'all') {
    const sale = sales.find(s => s.id === saleId)
    if (!sale) return
    if (isSaleFullyReturned(sale)) {
      showToast('Уже возвращён', 'Этот чек уже полностью возвращён')
      return
    }

    let payloadItems: { index: number; qty: number }[] | undefined
    let confirmTotal = 0
    let confirmLabel = ''

    if (mode === 'all') {
      const all = (sale.items || []).map((line, index) => ({ index, qty: saleLineLeft(line) })).filter(x => x.qty > 0)
      if (!all.length) {
        showToast('Нечего возвращать', 'Все позиции уже возвращены')
        return
      }
      payloadItems = undefined
      confirmTotal = Number(sale.total) || 0
      confirmLabel = `Вернуть весь чек на ${fmtMoney(confirmTotal)}?\nВсе оставшиеся товары вернутся на склад.`
    } else {
      const selected = receiptReturnPreview.items
      if (!selected.length) {
        showToast('Выберите товары', 'Отметьте позиции для возврата')
        return
      }
      payloadItems = selected
      confirmTotal = receiptReturnPreview.total
      confirmLabel = `Вернуть ${selected.length} позиц. на ${fmtMoney(confirmTotal)}?\nТовары вернутся на склад.`
    }

    if (!window.confirm(confirmLabel)) return
    setBusy(true)
    setMsg('')
    try {
      const debtBefore = Number(sale.debtAdded) || 0
      const updated = await api.returnPosSale(sale.id, {
        note: mode === 'all' ? 'Полный возврат с кассы' : 'Частичный возврат с кассы',
        cashierId: settings.cashierId || activeShift?.cashierId,
        ...(payloadItems ? { items: payloadItems } : {}),
      })
      const debtCut = Math.max(0, debtBefore - (Number(updated.debtAdded) || 0))
      if (sale.clientPhone && debtCut > 0) {
        recordStoreDebtRepayment(sale.clientPhone, debtCut, {
          desc: `Возврат чека ${saleNumberLabel(sale)}`,
          method: 'cash',
        })
      }
      await refresh()
      await fetchProducts()
      setReturnQtyByIdx({})
      const retTotal = Number(updated.lastReturnTotal) || confirmTotal
      showToast(
        updated.status === 'returned' ? 'Чек возвращён' : 'Частичный возврат',
        `${fmtMoney(retTotal)} · товары на складе`,
      )
      setReceiptSaleId(sale.id)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось оформить возврат')
      showToast('Ошибка возврата', e instanceof Error ? e.message : 'Не удалось')
    } finally {
      setBusy(false)
    }
  }

  function refillCartFromSale(sale: typeof sales[number]) {
    const lines = (sale.items || [])
      .map((it, idx) => {
        const left = saleLineLeft(it)
        if (!(left > 0)) return null
        const p = products.find(x => x.id === it.productId)
        return {
          key: `ret-${sale.id}-${it.productId}-${idx}`,
          productId: it.productId,
          name: it.productName || p?.name || `#${it.productId}`,
          emoji: p?.e || '📦',
          price: Number(it.price) || Number(p?.price) || 0,
          qty: left,
          stock: Number(p?.stock) || 9999,
          unit: p ? displaySellUnit(p) : 'шт',
        } as CartLine
      })
      .filter((x): x is CartLine => !!x)
    if (!lines.length) {
      showToast('Пустой чек', 'Нет товаров для добавления')
      return
    }
    setCart(lines)
    setCashierScreen(null)
    setReceiptSaleId(null)
    setReturnQtyByIdx({})
    showToast('Товары в чеке', `${lines.length} поз. из истории`)
  }

  function addProduct(p: Product, weightKg?: number) {
    if (!activeShift) {
      showToast('Смена не открыта', 'Сначала откройте смену')
      setOpenShiftModal(true)
      return
    }
    const stock = Number(p.stock) || 0
    if (stock <= 0) return
    void addProductWithLayers(p, weightKg)
  }

  async function addProductWithLayers(p: Product, weightKg?: number) {
    if (!USE_API) {
      pushProductToCart(p, weightKg)
      return
    }
    setLayerPickBusy(true)
    try {
      const layers = await api.getProductStockLayers(p.id)
      const open = (layers || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
      // Несколько партий — кассир сам выбирает, с какой цены продавать
      if (open.length > 1) {
        setLayerPickProduct(p)
        setLayerPickLayers(open)
        setLayerPickWeightKg(weightKg)
        setLayerPickOpen(true)
        return
      }
      if (open.length === 1) {
        pushProductToCart(p, weightKg, open[0])
        return
      }
      pushProductToCart(p, weightKg)
    } catch {
      pushProductToCart(p, weightKg)
    } finally {
      setLayerPickBusy(false)
    }
  }

  function cartLineKey(productId: number, receiptId?: string, weightKg?: number) {
    if (weightKg != null) return `${productId}-w-${Date.now()}`
    return receiptId ? `${productId}::${receiptId}` : String(productId)
  }

  async function ensureCasWeightMonitor(want: boolean) {
    const desk = getKakapoDesktop()
    if (!desk) return
    casMonitorWantedRef.current = want
    try {
      if (!want) {
        await desk.stopCasWeight?.()
        setCasWeight(prev => ({ ...prev, connected: false, running: false, weightKg: 0, grams: 0, error: '' }))
        return
      }
      const host = deskScaleHost.trim()
      if (!host || !desk.startCasWeight) return
      await desk.startCasWeight({
        host,
        port: Number(deskScalePort) || 20304,
      })
    } catch (e) {
      setCasWeight(prev => ({
        ...prev,
        connected: false,
        running: false,
        error: e instanceof Error ? e.message : 'Нет связи с весами',
      }))
    }
  }

  function liveWeightEnabled() {
    return deskScaleLiveWeightRef.current
      && deskScaleLiveWeight
      && isKakapoDesktop()
      && !!deskScaleHost.trim()
  }

  function applyScaleKgToModal(kg: number) {
    const w = Math.round((Number(kg) || 0) * 1000) / 1000
    if (!(w > 0.0005)) return
    lastHeldKgRef.current = w
    scaleHoldUntilRef.current = 0
    setScaleHolding(false)
    setQtyEditMode('qty')
    setQtyEditBuf(w.toFixed(3))
  }

  function startWeightModalMonitor() {
    qtyEditIsWeightRef.current = true
    scaleHoldUntilRef.current = 0
    setScaleHolding(false)
    // Если вес уже был считан — сразу показать (товар уже на платформе)
    if (casWeight.weightKg > 0.0005) {
      applyScaleKgToModal(casWeight.weightKg)
    }
    if (!liveWeightEnabled()) return
    void (async () => {
      await ensureCasWeightMonitor(true)
      const desk = getKakapoDesktop()
      if (!desk?.readCasWeight) return
      try {
        const res = await desk.readCasWeight({
          host: deskScaleHost.trim(),
          port: Number(deskScalePort) || 20304,
        })
        setCasWeight({
          connected: true,
          weightKg: res.weightKg,
          grams: res.grams,
          price: res.price,
          stable: true,
          error: '',
          raw: res.raw,
          ts: res.ts,
        })
        if (res.weightKg > 0.0005) applyScaleKgToModal(res.weightKg)
      } catch {
        /* монитор продолжит опрос */
      }
    })()
  }

  function stopWeightModalMonitor() {
    qtyEditIsWeightRef.current = false
    scaleHoldUntilRef.current = 0
    lastHeldKgRef.current = 0
    setScaleHolding(false)
    if (scaleHoldTimerRef.current) {
      clearTimeout(scaleHoldTimerRef.current)
      scaleHoldTimerRef.current = null
    }
    if (!editPosId) void ensureCasWeightMonitor(false)
  }

  function pushProductToCart(p: Product, weightKg?: number, layer?: ProductStockLayer) {
    const stockTotal = Number(p.stock) || 0
    if (stockTotal <= 0) return
    const layerStock = layer ? Number(layer.remainingQty) || 0 : stockTotal
    if (layer && !(layerStock > 0)) {
      showToast('Партия пуста', 'Выберите другую партию')
      return
    }
    const price = layer
      ? (Number(layer.retailPrice) > 0 ? Number(layer.retailPrice) : Number(p.price) || 0)
      : Number(p.price) || 0
    const receiptId = layer?.receiptId
    const costPrice = layer ? Number(layer.costPrice) || 0 : undefined
    const supplierName = layer?.supplierName || undefined

    if (isWeighted(p) && weightKg == null) {
      const key = cartLineKey(p.id, receiptId, 0)
      const art = String(p.art || '').trim()
      const barcode = productBarcodes(p)[0] || ''
      setCart(prev => [...prev, {
        key,
        productId: p.id,
        name: p.name,
        emoji: p.e || '📦',
        price,
        qty: 1,
        stock: layerStock,
        unit: p.unit || 'кг',
        art,
        barcode,
        weightKg: 0,
        receiptId,
        costPrice,
        supplierName,
      }])
      setSelectedLineKey(key)
      setQtyEditDraftKey(key)
      setQtyEditKey(key)
      setQtyEditMode('qty')
      setQtyEditBuf('')
      setQtyEditPad(false)
      setQtyEditOpen(true)
      startWeightModalMonitor()
      setLayerPickOpen(false)
      setLayerPickProduct(null)
      return
    }

    setCart(prev => {
      const art = String(p.art || '').trim()
      const barcode = productBarcodes(p)[0] || ''
      if (weightKg != null) {
        return [...prev, {
          key: cartLineKey(p.id, receiptId, weightKg),
          productId: p.id,
          name: p.name,
          emoji: p.e || '📦',
          price,
          qty: 1,
          stock: layerStock,
          unit: p.unit || 'кг',
          art,
          barcode,
          weightKg,
          receiptId,
          costPrice,
          supplierName,
        }]
      }
      const idx = prev.findIndex(l =>
        l.productId === p.id
        && l.weightKg == null
        && (l.receiptId || '') === (receiptId || ''),
      )
      if (idx >= 0) {
        const next = [...prev]
        if (next[idx].qty >= next[idx].stock) return prev
        next[idx] = { ...next[idx], qty: next[idx].qty + 1, price }
        return next
      }
      return [...prev, {
        key: cartLineKey(p.id, receiptId),
        productId: p.id,
        name: p.name,
        emoji: p.e || '📦',
        price,
        qty: 1,
        stock: layerStock,
        unit: displaySellUnit(p),
        art,
        barcode,
        receiptId,
        costPrice,
        supplierName,
      }]
    })
    setLayerPickOpen(false)
    setLayerPickProduct(null)
    window.setTimeout(focusProductSearch, 0)
  }

  function pickStockLayer(layer: ProductStockLayer) {
    if (!layerPickProduct) return
    pushProductToCart(layerPickProduct, layerPickWeightKg, layer)
  }

  function setQty(key: string, qty: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      const q = Math.round(Math.max(0, qty) * 1000) / 1000
      return { ...l, qty: Math.min(l.stock, q) }
    }).filter(l => l.qty > 0 || (l.weightKg != null && l.weightKg > 0)))
  }

  function setLineWeight(key: string, weightKg: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      const w = Math.max(0, Math.round(weightKg * 1000) / 1000)
      const maxW = l.stock > 0 ? l.stock : w
      return { ...l, weightKg: Math.min(w, maxW), qty: 1 }
    }).filter(l => (l.weightKg != null ? l.weightKg > 0 : l.qty > 0)))
  }

  function openQtyEdit(line: CartLine) {
    setSelectedLineKey(line.key)
    setQtyEditDraftKey(null)
    setQtyEditKey(line.key)
    setQtyEditMode('qty')
    setQtyEditBuf(line.weightKg != null ? String(line.weightKg) : String(line.qty))
    setQtyEditPad(false)
    setQtyEditOpen(true)
    if (line.weightKg != null) startWeightModalMonitor()
    else {
      qtyEditIsWeightRef.current = false
    }
  }

  function closeQtyEdit(discardDraft = true) {
    if (discardDraft && qtyEditDraftKey) {
      setCart(prev => prev.filter(l => l.key !== qtyEditDraftKey))
    }
    setQtyEditDraftKey(null)
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setQtyEditPad(false)
    stopWeightModalMonitor()
  }

  function resolveQtyEdit(line: CartLine, mode: 'qty' | 'sum', raw: string) {
    const price = Number(line.price) || 0
    const val = Number(raw) || 0
    const isWeight = line.weightKg != null
    if (mode === 'sum') {
      const amount = val
      const qty = price > 0 ? Math.round((amount / price) * 1000) / 1000 : 0
      return { qty, amount, price, isWeight }
    }
    const qty = isWeight ? Math.round(val * 1000) / 1000 : Math.round(val * 1000) / 1000
    return { qty, amount: Math.round(qty * price * 100) / 100, price, isWeight }
  }

  function applyQtyEdit() {
    if (!qtyEditKey) return
    const line = cart.find(l => l.key === qtyEditKey)
    if (!line) return
    const { qty, isWeight } = resolveQtyEdit(line, qtyEditMode, qtyEditBuf)
    if (qty <= 0) {
      showToast('Ошибка', 'Укажите значение больше 0')
      return
    }
    if (qty > line.stock + 0.001) {
      showToast('Мало на складе', `Доступно ${line.stock}${isWeight ? ' кг' : ' шт'}`)
      return
    }
    if (isWeight) setLineWeight(qtyEditKey, qty)
    else setQty(qtyEditKey, qty)
    setQtyEditDraftKey(null)
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setQtyEditPad(false)
    stopWeightModalMonitor()
    window.setTimeout(focusProductSearch, 40)
  }

  function fmtQty(n: number) {
    if (Number.isInteger(n)) return String(n)
    return String(Math.round(n * 1000) / 1000)
  }

  function removeLine(key: string) {
    setCart(prev => prev.filter(l => l.key !== key))
  }

  function clearCart() {
    setTickets(prev => prev.map(t => t.id !== activeTicketId ? t : {
      ...t,
      cart: [],
      client: null,
      discountPct: 0,
      bonusUsed: 0,
      pay: 'cash',
      selectedLineKey: null,
    }))
    setDiscLineKey(null)
  }

  function addTicket() {
    if (tickets.length >= MAX_TICKETS) {
      showToast('Лимит чеков', `Можно открыть не больше ${MAX_TICKETS}`)
      return
    }
    const t = makeTicket(nextTicketSeq)
    setNextTicketSeq(s => s + 1)
    setTickets(prev => [...prev, t])
    setActiveTicketId(t.id)
    setPayPickOpen(false)
    setCashOpen(false)
    setDiscOpen(false)
    setQtyEditOpen(false)
    showToast('Новый чек', `Чек ${t.seq}`)
    // после клика по «+» фокус остаётся на кнопке — вернуть в поиск
    window.setTimeout(focusProductSearch, 0)
    window.setTimeout(focusProductSearch, 60)
  }

  function switchTicket(id: string) {
    if (id === activeTicketId) return
    if (qtyEditDraftKey) {
      setCart(prev => prev.filter(l => l.key !== qtyEditDraftKey))
      setQtyEditDraftKey(null)
    }
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setPayPickOpen(false)
    setCashOpen(false)
    setSplitCardOpen(false)
    setDiscOpen(false)
    setDiscPickOpen(false)
    setActiveTicketId(id)
    window.setTimeout(focusProductSearch, 0)
    window.setTimeout(focusProductSearch, 60)
  }

  function closeTicket(id: string) {
    if (qtyEditDraftKey && id === activeTicketId) {
      setQtyEditDraftKey(null)
      setQtyEditOpen(false)
    }
    setTickets(prev => {
      if (prev.length <= 1) {
        return prev.map(t => t.id !== id ? t : {
          ...t,
          cart: [],
          client: null,
          discountPct: 0,
          bonusUsed: 0,
          pay: 'cash',
          selectedLineKey: null,
        })
      }
      const next = prev.filter(t => t.id !== id)
      if (id === activeTicketId) {
        const fallback = next[next.length - 1]
        if (fallback) setActiveTicketId(fallback.id)
      }
      return next
    })
  }

  function afterSaleTicketReset() {
    setTickets(prev => {
      if (prev.length <= 1) {
        return prev.map(t => t.id !== activeTicketId ? t : {
          ...t,
          cart: [],
          client: null,
          discountPct: 0,
          bonusUsed: 0,
          pay: 'cash',
          selectedLineKey: null,
        })
      }
      const next = prev.filter(t => t.id !== activeTicketId)
      const fallback = next[0]
      if (fallback) setActiveTicketId(fallback.id)
      return next
    })
    setDiscLineKey(null)
    setPayDebtOn(false)
    setPayDebtBuf('')
    setCreditNoteOpen(false)
    setCreditNoteBuf('')
    setCreditPending(null)
  }

  function currentPayDebtAmt() {
    if (!payDebtOn || clientDebt <= 0) return 0
    const raw = Math.round(Math.max(0, Number(payDebtBuf) || 0) * 100) / 100
    return Math.min(clientDebt, raw)
  }

  async function applyDebtRepayAfterSale(amount: number, method: 'cash' | 'card') {
    if (!client?.card || !(amount > 0.001)) return
    const prevDebt = Number(loyalty?.debt) || clientDebt
    const payAmt = Math.min(prevDebt, Math.round(amount * 100) / 100)
    if (!(payAmt > 0.001)) return
    const nextDebt = Math.max(0, Math.round((prevDebt - payAmt) * 100) / 100)
    const repayBonus = method === 'cash' ? calcCashDepositBonus(payAmt) : 0
    const summary = loyaltySummaryForClient(client, cards)
    const cardRow = cards.find(c => cardNumsMatch(c.num, client.card!))
    const prevPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
    await api.updateCard(client.card, {
      debt: nextDebt,
      ...(repayBonus > 0 ? {
        bonus: (Number(summary.bonus) || 0) + repayBonus,
        posCashBonus: prevPos + repayBonus,
      } : {}),
    })
    if (client.phone) {
      recordStoreDebtRepayment(client.phone, payAmt, { method })
      if (repayBonus > 0) {
        recordBalanceTopup(client.phone, payAmt, repayBonus, 'Погашение долга с чеком (нал)')
      }
    }
  }

  function openAllDiscount() {
    if (!cart.length) {
      showToast('Чек пуст', 'Сначала добавьте товары')
      return
    }
    setDiscMode('all')
    setDiscLineKey(null)
    setDiscBuf(String(discountPct || ''))
    setAmountPad(false)
    setDiscOpen(true)
  }

  function openLineDiscount(key?: string) {
    if (!cart.length) {
      showToast('Чек пуст', 'Сначала добавьте товары')
      return
    }
    const targetKey = key || selectedLineKey
    if (targetKey && cart.some(l => l.key === targetKey)) {
      const line = cart.find(l => l.key === targetKey)!
      setDiscMode('line')
      setDiscLineKey(targetKey)
      setDiscBuf(String(line.discPct || ''))
      setDiscPickOpen(false)
      setAmountPad(false)
      setDiscOpen(true)
      return
    }
    if (cart.length === 1) {
      openLineDiscount(cart[0].key)
      return
    }
    setDiscPickOpen(true)
  }

  function applyDiscount() {
    const pct = Math.min(90, Math.max(0, Number(discBuf) || 0))
    if (discMode === 'line' && discLineKey) {
      setCart(prev => prev.map(l => l.key === discLineKey ? { ...l, discPct: pct || undefined } : l))
      setSelectedLineKey(discLineKey)
    } else {
      setDiscountPct(pct)
    }
    setDiscOpen(false)
    setDiscLineKey(null)
  }

  function openCreditNote(pending: {
    paidCash: number
    method: PayMethod
    paidCard?: number
    debtAmt?: number
  }) {
    setCreditPending(pending)
    setCreditNoteBuf('')
    setPayPickOpen(false)
    setCashOpen(false)
    setSplitCardOpen(false)
    setAmountPad(false)
    setCreditNoteOpen(true)
  }

  async function doPrintSale(sale: PosSale) {
    try {
      const posPoint = sale.posId
        ? posPoints.find(p => p.id === sale.posId)
        : activePosPoint
      const storeName = String(posPoint?.name || activePosPoint?.name || '').trim() || 'КАКАПО'
      const storePhone = String(posPoint?.receiptPhone || activePosPoint?.receiptPhone || '').trim()
      await printPosReceipt(sale, {
        storeName,
        storePhone,
        subtitle: '',
        posLabel: posPoint?.name || posPoint?.code || activePosPoint?.name || activePosPoint?.code || undefined,
        cashierName: sale.cashierName || settings.cashierName,
      })
    } catch (e) {
      showToast('Печать', e instanceof Error ? e.message : 'Не удалось напечатать чек')
    }
  }

  async function printSaleOnce(sale: PosSale) {
    const key = String(sale.id || sale.orderId || sale.number || 'sale')
    if (printingSaleIdsRef.current.has(key)) return
    printingSaleIdsRef.current.add(key)
    setPrintingSaleId(key)
    try {
      await doPrintSale(sale)
    } finally {
      printingSaleIdsRef.current.delete(key)
      setPrintingSaleId(cur => cur === key ? null : cur)
    }
  }

  function finishSalePrintChoice(shouldPrint: boolean) {
    const sale = printAskSale
    if (!sale || printChoiceLockedRef.current) return

    // Блокировка ставится синхронно до перерисовки: быстрые повторные клики
    // не смогут отправить несколько одинаковых заданий на XP-58C.
    printChoiceLockedRef.current = true
    setPrintAskSale(null)
    afterSaleTicketReset()

    if (shouldPrint) {
      void printSaleOnce(sale).finally(() => {
        printChoiceLockedRef.current = false
      })
    } else {
      window.setTimeout(() => {
        printChoiceLockedRef.current = false
      }, 0)
    }
  }

  async function confirmCreditNote() {
    if (!creditPending) return
    const note = creditNoteBuf.trim()
    const { paidCash, method, paidCard, debtAmt } = creditPending
    setCreditNoteOpen(false)
    setCreditPending(null)
    await submitSale(paidCash, method, 0, paidCard, debtAmt, note)
  }

  async function submitSale(paidCash = 0, payOverride?: PayMethod, bonusSpendOverride?: number, paidCardAmt?: number, debtAmt?: number, saleNote?: string) {
    if (!activeShift || !cart.length) return
    const methodPay = payOverride ?? pay
    const spend = Math.max(
      0,
      Math.min(
        Math.floor(bonusSpendOverride != null ? bonusSpendOverride : usedBonus),
        Math.floor(maxBonus),
      ),
    )
    const payable = Math.max(0, afterDisc - spend)
    const debtHint = Math.max(0, Number(debtAmt) || 0)
    if ((methodPay === 'credit' || methodPay === 'balance' || (methodPay === 'mixed' && debtHint > 0.001)) && !client) {
      setClientOpen(true)
      showToast('Выберите клиента', methodPay === 'balance' ? 'Для списания бонусов нужен клиент' : 'Для долга нужен клиент')
      return
    }
    if (methodPay === 'balance' && payable > 0.001) {
      showToast('Недостаточно бонусов', 'Спишите бонусы или выберите другой способ')
      return
    }

    let apiMethod: 'cash' | 'card' | 'credit' | 'mixed' = 'cash'
    let cashPaid = 0
    let cardPaid = 0
    let debtAdded = 0
    let change = 0
    let cashReceivedVal = 0

    if (methodPay === 'credit') {
      apiMethod = 'credit'
      debtAdded = payable
      if (debtAdded > availableDebt + 0.001) {
        showToast('Лимит долга', `Доступно ${fmtMoney(availableDebt)}`)
        return
      }
    } else if (methodPay === 'balance') {
      apiMethod = 'card'
    } else if (methodPay === 'mixed') {
      cashPaid = Math.round(Math.max(0, Math.min(payable, paidCash)) * 100) / 100
      cardPaid = Math.round(Math.max(0, paidCardAmt ?? 0) * 100) / 100
      debtAdded = Math.round(Math.max(0, debtAmt ?? 0) * 100) / 100
      const covered = Math.round((cashPaid + cardPaid + debtAdded) * 100) / 100
      if (covered < payable - 0.02) {
        debtAdded = Math.round((payable - cashPaid - cardPaid) * 100) / 100
      } else if (covered > payable + 0.02) {
        cardPaid = Math.round(Math.max(0, payable - cashPaid - debtAdded) * 100) / 100
      }
      if (debtAdded > 0.001) {
        if (!client) {
          setClientOpen(true)
          showToast('Выберите клиента', 'Для долга нужен клиент')
          return
        }
        if (debtAdded > availableDebt + 0.001) {
          showToast('Лимит долга', `Доступно ${fmtMoney(availableDebt)}`)
          return
        }
      }
      if (cashPaid < 0.01 && cardPaid < 0.01 && debtAdded < 0.01) {
        showToast('Ошибка', 'Укажите сумму оплаты')
        return
      }
      if (cashPaid > 0 && cardPaid < 0.01 && debtAdded < 0.01) apiMethod = 'cash'
      else if (cardPaid > 0 && cashPaid < 0.01 && debtAdded < 0.01) apiMethod = 'card'
      else if (debtAdded > 0 && cashPaid < 0.01 && cardPaid < 0.01) apiMethod = 'credit'
      else apiMethod = 'mixed'
      cashReceivedVal = Math.round(Math.max(0, paidCash) * 100) / 100
      change = Math.max(0, Math.round((cashReceivedVal - cashPaid) * 100) / 100)
    } else if (methodPay === 'cash') {
      apiMethod = 'cash'
      cashPaid = payable
      const debtRepayNow = currentPayDebtAmt()
      cashReceivedVal = Math.round(Math.max(0, paidCash) * 100) / 100
      if (cashReceivedVal < payable + debtRepayNow - 0.001) {
        cashReceivedVal = Math.round((payable + debtRepayNow) * 100) / 100
      }
      change = Math.max(0, Math.round((cashReceivedVal - payable - debtRepayNow) * 100) / 100)
    } else {
      apiMethod = 'card'
      cardPaid = payable
    }

    setBusy(true)
    setMsg('')
    try {
      const note = String(saleNote || '').trim()
      const discountTotal = Math.round((itemDiscAmount + discAmount) * 100) / 100
      const bonusBalanceBefore = loyalty ? Math.max(0, Math.floor(Number(loyalty.bonus) || 0)) : undefined
      let earnedBonusPreview = 0
      if (cashPaid > 0 && client?.card && (apiMethod === 'cash' || apiMethod === 'mixed')) {
        earnedBonusPreview = calcCashDepositBonus(cashPaid)
      }
      const bonusBalanceAfter = bonusBalanceBefore != null
        ? Math.max(0, bonusBalanceBefore - spend + earnedBonusPreview)
        : undefined
      const created = await api.createPosSale({
        cashierId: activeShift.cashierId,
        shiftId: activeShift.id,
        posId: activeShift.posId || activePosPoint?.id,
        clientId: client?.id,
        clientName: client?.name,
        clientPhone: client?.phone,
        cardNum: client?.card,
        paymentMethod: apiMethod,
        paidCash: cashPaid,
        paidCard: cardPaid,
        debtAdded,
        cashReceived: cashReceivedVal > 0.001 ? cashReceivedVal : undefined,
        changeGiven: change > 0.001 ? change : undefined,
        bonusSpent: spend > 0 ? spend : undefined,
        bonusEarned: earnedBonusPreview > 0 ? earnedBonusPreview : undefined,
        bonusBalanceBefore,
        bonusBalanceAfter,
        orderGoodsTotal: Math.round(subtotalGross * 100) / 100,
        discountAmount: discountTotal > 0.001 ? discountTotal : undefined,
        note: note || undefined,
        items: cart.map(l => ({
          productId: l.productId,
          productName: l.name,
          qty: l.weightKg != null ? Math.round(l.weightKg * 1000) / 1000 : l.qty,
          price: l.price,
          receiptId: l.receiptId || undefined,
        })),
      })
      if (client?.phone) {
        const itemsSummary = cart.slice(0, 5).map(l => `${l.name} ×${l.weightKg != null ? l.weightKg : l.qty}`).join(', ')
        const purchaseAmt = Math.round((afterDisc - debtAdded) * 100) / 100
        if (purchaseAmt > 0.001) {
          const methods: string[] = []
          if (cashPaid > 0.001) methods.push('нал')
          if (cardPaid > 0.001) methods.push('карта')
          if (spend > 0) methods.push('бонусы')
          recordStorePurchase(
            client.phone,
            purchaseAmt,
            `Покупка в магазине · ${methods.join('+') || 'касса'}`,
            { orderId: created?.orderId || created?.id || undefined, itemsSummary },
          )
        }
        if (debtAdded > 0.001) {
          const baseDesc = debtAdded >= payable - 0.01 ? 'Чек в долг' : 'Часть чека в долг'
          recordStoreDebtCharge(client.phone, debtAdded, note ? `${baseDesc} · ${note}` : baseDesc, {
            orderId: created?.orderId || created?.id || undefined,
            itemsSummary,
          })
        }
        setHistTick(t => t + 1)
      }
      let earnedBonus = 0
      if (cashPaid > 0 && client?.card && (apiMethod === 'cash' || apiMethod === 'mixed')) {
        earnedBonus = calcCashDepositBonus(cashPaid)
      }
      // Бонусы и кэшбэк по заказу начисляет API через loyalty; здесь — только кэшбэк занал (posCashBonus)
      if (client?.card && USE_API && earnedBonus > 0) {
        try {
          const cardRow = cards.find(c => client.card && cardNumsMatch(c.num, client.card))
          const prevPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
          const nextPos = prevPos + earnedBonus
          const base = Number(loyalty?.bonus) || 0
          await api.updateCard(client.card, {
            bonus: base + earnedBonus,
            posCashBonus: nextPos,
          })
          if (client.phone) {
            recordBalanceTopup(client.phone, cashPaid, earnedBonus, apiMethod === 'mixed' ? 'Смешанная оплата (нал)' : 'Оплата наличными (касса)')
          }
        } catch { /* ignore */ }
      } else if (client?.card && USE_API && spend > 0 && !created?.orderId) {
        try {
          const base = Number(loyalty?.bonus) || 0
          const cardRow = cards.find(c => client.card && cardNumsMatch(c.num, client.card))
          const prevPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
          const nextPos = Math.max(0, prevPos - spend)
          await api.updateCard(client.card, {
            bonus: Math.max(0, base - spend),
            posCashBonus: nextPos,
            allowBonusDecrease: true,
          })
        } catch { /* ignore */ }
      }
      await refresh()
      const debtRepay = currentPayDebtAmt()
      let debtRepayNote = ''
      if (debtRepay > 0.001 && client?.card && apiMethod !== 'credit') {
        try {
          const method: 'cash' | 'card' = cashPaid > 0.001 ? 'cash' : 'card'
          await applyDebtRepayAfterSale(debtRepay, method)
          debtRepayNote = ` · погашен долг ${fmtMoney(debtRepay)}`
          await refresh()
        } catch { /* чек уже проведён */ }
      }
      const parts: string[] = []
      if (cashPaid > 0.001) parts.push(`нал ${fmtMoney(cashPaid)}`)
      if (cardPaid > 0.001) parts.push(`карта ${fmtMoney(cardPaid)}`)
      if (debtAdded > 0.001) parts.push(`долг ${fmtMoney(debtAdded)}`)
      if (apiMethod === 'cash' && change > 0) parts.push(`сдача ${fmtMoney(change)}`)
      if (earnedBonus > 0) parts.push(`+${earnedBonus} ⭐`)
      if (spend > 0) parts.push(`−${spend} ⭐`)
      showToast(
        'Чек проведён',
        `${parts.length ? parts.join(' · ') : (methodPay === 'balance' ? `Бонусы −${spend} ⭐` : 'Карта')}${debtRepayNote}`,
      )
      setCashOpen(false)
      setSplitCardOpen(false)
      setPayPickOpen(false)
      setCreditNoteOpen(false)
      setCreditNoteBuf('')
      setCreditPending(null)
      printChoiceLockedRef.current = false
      setPrintAskSale({
        ...created,
        orderGoodsTotal: created.orderGoodsTotal ?? Math.round(subtotalGross * 100) / 100,
        discountAmount: created.discountAmount ?? (discountTotal > 0.001 ? discountTotal : undefined),
        bonusSpent: created.bonusSpent ?? (spend > 0 ? spend : undefined),
        bonusEarned: created.bonusEarned ?? (earnedBonusPreview > 0 ? earnedBonusPreview : undefined),
        bonusBalanceBefore: created.bonusBalanceBefore ?? bonusBalanceBefore,
        bonusBalanceAfter: created.bonusBalanceAfter ?? bonusBalanceAfter,
        total: created.total ?? total,
      })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка продажи')
      showToast('Ошибка', e instanceof Error ? e.message : 'Ошибка продажи')
    } finally {
      setBusy(false)
    }
  }

  function startPay() {
    if (!activeShift) {
      showToast('Смена не открыта', 'Сначала откройте смену')
      setOpenShiftModal(true)
      return
    }
    if (!cart.length) return
    const zeroWeight = cart.find(l => l.weightKg != null && !(l.weightKg > 0.0005))
    if (zeroWeight) {
      showToast('Нет веса', `Укажите вес для «${zeroWeight.name}»`)
      openQtyEdit(zeroWeight)
      return
    }
    setBonusUsed(0)
    setAmountPad(false)
    setCashBuf('')
    setSplitCardBuf('')
    setSplitCardOpen(false)
    setPayDebtOn(false)
    setPayDebtBuf(clientDebt > 0 ? String(Math.round(clientDebt * 100) / 100) : '')
    setPayPickOpen(true)
  }

  function choosePayMethod(method: PayMethod) {
    if ((method === 'credit' || method === 'balance') && !client) {
      setPayPickOpen(false)
      setClientOpen(true)
      showToast('Выберите клиента', method === 'balance' ? 'Для списания бонусов нужен клиент' : 'Для оплаты в долг нужен клиент')
      return
    }
    if (method === 'credit') {
      setPayDebtOn(false)
      setBonusUsed(0)
      setPay(method)
      openCreditNote({ paidCash: 0, method: 'credit', debtAmt: 0 })
      return
    }
    if (method === 'balance') {
      setPayDebtOn(false)
      const cover = Math.min(Math.floor(maxBonus), Math.floor(afterDisc))
      if (cover < afterDisc - 0.001) {
        showToast('Мало бонусов', `Доступно ${cover} ⭐ · к оплате ${afterDisc.toFixed(2)}`)
        return
      }
      setBonusUsed(cover)
      setPay(method)
      setPayPickOpen(false)
      void submitSale(0, 'balance', cover)
      return
    }
    const debtExtra = currentPayDebtAmt()
    const due = Math.round((total + debtExtra) * 100) / 100
    setPay(method)
    if (method === 'cash') {
      setPayPickOpen(false)
      setCashBuf(due > 0 ? due.toFixed(2) : '')
      setAmountPad(false)
      setCashOpen(true)
      return
    }
    setPayPickOpen(false)
    void submitSale(0, method)
  }

  function openCashSplitCard() {
    const remain = Math.max(0, Math.round((total - (Number(cashBuf) || 0)) * 100) / 100)
    if (remain < 0.01) return
    setSplitCardBuf(remain.toFixed(2))
    setAmountPad(false)
    setSplitCardOpen(true)
  }

  function payCashRestAsDebt() {
    const cash = Number(cashBuf) || 0
    const remain = Math.max(0, Math.round((total - cash) * 100) / 100)
    if (remain < 0.01) return
    if (!client) {
      setCashOpen(false)
      setClientOpen(true)
      showToast('Выберите клиента', 'Чтобы записать остаток в долг')
      return
    }
    openCreditNote({ paidCash: cash, method: 'mixed', paidCard: 0, debtAmt: remain })
  }

  function applyPayBonus(amount: number) {
    const max = Math.floor(maxBonus)
    setBonusUsed(Math.max(0, Math.min(max, Math.floor(amount))))
  }

  async function submitTopup() {
    if (!client) return
    const cash = Number(topupBuf) || 0
    if (cash <= 0) return
    // Вся сумма на баланс + % бонус по порогам
    const principal = Math.max(0, Math.floor(cash))
    const percentBonus = calcCashDepositBonus(cash)
    const credit = principal + percentBonus
    if (credit <= 0) return
    setBusy(true)
    try {
      const summary = loyaltySummaryForClient(client, cards)
      if (!client.card) throw new Error('У клиента нет карты')
      const cardRow = cards.find(c => cardNumsMatch(c.num, client.card!))
      const prevPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
      await api.updateCard(client.card, {
        bonus: (Number(summary.bonus) || 0) + credit,
        posCashBonus: prevPos + credit,
      })
      if (client.phone) recordBalanceTopup(client.phone, cash, credit, 'Пополнение баланса')
      await refresh()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setTopupOpen(false)
      setTopupBuf('')
      const extra = percentBonus > 0 ? ` · +${percentBonus.toLocaleString('ru-RU')} ⭐ бонус` : ''
      showToast('Баланс пополнен', `${client.name}: +${principal.toLocaleString('ru-RU')} ⭐${extra}`)
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
      const oldestActive = histActiveDebts
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map(r => ({
          id: r.id,
          remainingAmount: Number(r.debtRemain ?? r.amount) || 0,
          originalAmount: Number(r.amount) || 0,
          paidAmount: Number(r.debtPaid) || 0,
          partial: r.debtStatus === 'partial',
          date: '',
          time: '',
          ts: r.ts,
          desc: r.title,
          amount: -(Number(r.debtRemain ?? r.amount) || 0),
          type: 'debt' as const,
        }))
      const fifoPreview = allocateRepaymentFifo(oldestActive, amount)
      const repayBonus = repayMethod === 'cash' ? calcCashDepositBonus(amount) : 0
      const summary = loyaltySummaryForClient(client, cards)
      const cardRow = cards.find(c => cardNumsMatch(c.num, client.card!))
      const prevPos = Math.max(0, Number(cardRow?.posCashBonus) || 0)
      await api.updateCard(client.card, {
        debt: nextDebt,
        ...(repayBonus > 0 ? {
          bonus: (Number(summary.bonus) || 0) + repayBonus,
          posCashBonus: prevPos + repayBonus,
        } : {}),
      })
      if (client.phone) {
        recordStoreDebtRepayment(client.phone, amount, { method: repayMethod })
        if (repayBonus > 0) {
          recordBalanceTopup(client.phone, amount, repayBonus, 'Погашение долга наличными')
        }
      }
      await refresh()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setRepayOpen(false)
      setRepayBuf('')
      setRepayMethod('cash')
      const fifoNote = fifoPreview.length
        ? ` · списано с ${fifoPreview.length} чек${fifoPreview.length === 1 ? 'а' : 'ов'} (со старых)`
        : ''
      const bonusNote = repayBonus > 0 ? ` · +${repayBonus} ⭐` : ''
      showToast('Долг погашен', `${client.name}: −${fmtMoney(amount)} · ${repayMethod === 'cash' ? 'нал' : 'карта'} · остаток ${fmtMoney(nextDebt)}${bonusNote}${fifoNote}`)
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось погасить долг')
    } finally {
      setBusy(false)
    }
  }

  // ─── Gate (только первая загрузка, не при автообновлении) ───
  if (!apiReady) {
    return (
      <div className="pos-root" data-theme={theme} data-embed={embedded ? '1' : undefined}>
        <style>{POS_MOCK_CSS}</style>
        <div className="gate gate-loading">
          <div className="gate-bg" />
          <div className="gate-card" style={{ textAlign: 'center' }}>
            <div className="gate-logo">K</div>
            <div className="gate-title">Касса</div>
            <div className="gate-sub">Загрузка смены…</div>
          </div>
        </div>
      </div>
    )
  }

  const showDashboard = (!activeShift || posSurface === 'dashboard') && !cashierScreen

  if (showDashboard) {
    const myOpenShift = activeShift
    return (
      <div className="pos-root" data-theme={theme} data-embed={embedded ? '1' : undefined}>
        <style>{POS_MOCK_CSS}</style>
        <div className="odoo-dash" onClick={() => dashMenuPosId && setDashMenuPosId(null)}>
          <div className="odoo-dash-top">
            <div>
              <h1>Точка продаж</h1>
              <p>Выберите кассу и откройте сессию</p>
            </div>
            <div className="odoo-dash-actions">
              <div className="theme-toggle" role="group" aria-label="Тема">
                <button
                  type="button"
                  className={`theme-mode ${theme === 'dark' ? 'on' : ''}`}
                  title="Тёмная тема"
                  onClick={e => { e.stopPropagation(); applyTheme('dark') }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`theme-mode ${theme === 'light' ? 'on' : ''}`}
                  title="Светлая тема"
                  onClick={e => { e.stopPropagation(); applyTheme('light') }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                className="odoo-create-pos"
                onClick={e => {
                  e.stopPropagation()
                  setMsg('')
                  setNewPosName('')
                  setNewPosCode('')
                  setCreatePosModal(true)
                }}
              >
                + Создать точку продаж
              </button>
            </div>
          </div>
          <div className="odoo-dash-body">
            <div className="odoo-kanban">
              {!visiblePosPoints.length && (
                <div className="odoo-card" style={{ padding: 20 }}>
                  <div className="odoo-card-title">Пока нет точек продаж</div>
                  <div className="odoo-card-meta" style={{ padding: '10px 0 14px' }}>
                    Создайте первую кассу — все продажи и сессии будут привязаны к ней
                  </div>
                  <button
                    type="button"
                    className="odoo-btn-primary"
                    onClick={() => setCreatePosModal(true)}
                  >
                    Создать точку продаж
                  </button>
                </div>
              )}
              {visiblePosPoints.map(point => {
                const shift = shiftForPos(point.id)
                const openedLabel = formatOpenedAt(shift?.openedAtIso)
                const isMine = !!(shift && myOpenShift && shift.id === myOpenShift.id)
                const menuOpen = dashMenuPosId === point.id
                return (
                  <div
                    key={point.id}
                    className="odoo-card"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="odoo-card-head">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="odoo-card-mark" aria-hidden>🛒</div>
                        <div className="odoo-card-title">{point.name}</div>
                        <div className="odoo-card-sub">{point.code || 'Касса · KAKAPO'}</div>
                      </div>
                      <div className="odoo-card-menu">
                        <button
                          type="button"
                          className="odoo-card-more"
                          aria-label="Меню"
                          onClick={() => setDashMenuPosId(menuOpen ? null : point.id)}
                        >
                          ⋮
                        </button>
                        {menuOpen && (
                          <div className="odoo-card-drop">
                            <button
                              type="button"
                              className="odoo-card-drop-item"
                              onClick={() => openPosSettings(point.id)}
                            >
                              Настройки
                            </button>
                            {isMine && (
                              <button
                                type="button"
                                className="odoo-card-drop-item"
                                onClick={() => {
                                  setDashMenuPosId(null)
                                  openCashierScreen('receipts')
                                }}
                              >
                                История чеков
                              </button>
                            )}
                            {isMine && (
                              <button
                                type="button"
                                className="odoo-card-drop-item"
                                onClick={() => {
                                  setDashMenuPosId(null)
                                  openCashierScreen('close')
                                }}
                              >
                                Закрыть сессию
                              </button>
                            )}
                            {!shift && (
                              <button
                                type="button"
                                className="odoo-card-drop-item"
                                onClick={() => {
                                  setDashMenuPosId(null)
                                  if (myOpenShift) {
                                    showToast('Сессия уже открыта', 'Сначала закройте текущую сессию')
                                    return
                                  }
                                  setOpeningPosId(point.id)
                                  setMsg('')
                                  setOpenShiftModal(true)
                                }}
                              >
                                Открыть сессию
                              </button>
                            )}
                            <div className="odoo-card-drop-sep" />
                            <button
                              type="button"
                              className="odoo-card-drop-item danger"
                              onClick={() => {
                                setDashMenuPosId(null)
                                if (shift) {
                                  showToast('Нельзя удалить', 'Сначала закройте сессию на этой кассе')
                                  return
                                }
                                setMsg('')
                                setDeletePosId(point.id)
                              }}
                            >
                              Удалить точку
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`odoo-card-status ${shift ? 'open' : 'closed'}`}>
                      {shift ? 'Сессия открыта' : 'Сессия закрыта'}
                    </div>
                    <div className="odoo-card-meta">
                      {shift ? (
                        <>
                          Кассир: <b>{shift.cashierName || '—'}</b>
                          {openedLabel ? <><br />Открыта: <b>{openedLabel}</b></> : null}
                          <br />Продаж: <b>{shift.salesCount || 0}</b>
                          {' · '}Нал: <b>{fmtMoney(shift.salesCash || 0)}</b>
                        </>
                      ) : (
                        <>Откройте сессию, чтобы начать продажи на этой кассе</>
                      )}
                    </div>
                    <div className="odoo-card-actions">
                      {shift && isMine ? (
                        <>
                          <button
                            type="button"
                            className="odoo-btn-primary go"
                            onClick={() => {
                              setDashMenuPosId(null)
                              setPosSurface('register')
                            }}
                          >
                            Продолжить продажу
                          </button>
                          <button
                            type="button"
                            className="odoo-btn-secondary"
                            onClick={() => {
                              setDashMenuPosId(null)
                              openCashierScreen('close')
                            }}
                          >
                            Закрыть сессию
                          </button>
                        </>
                      ) : shift ? (
                        <button type="button" className="odoo-btn-secondary" disabled>
                          Занято · {shift.cashierName || 'кассир'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="odoo-btn-primary"
                          onClick={() => {
                            setDashMenuPosId(null)
                            if (myOpenShift) {
                              showToast('Сессия уже открыта', 'Сначала закройте текущую сессию или продолжите продажу')
                              return
                            }
                            setOpeningPosId(point.id)
                            setMsg('')
                            setOpenShiftModal(true)
                          }}
                        >
                          Новая сессия
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {openShiftModal && (
          <div
            className="gate gate-modal"
            onClick={() => {
              if (busy) return
              setOpenShiftModal(false)
              setOpeningPosId(null)
              setMsg('')
            }}
          >
            <div className="gate-bg" />
            <div className="gate-card" onClick={e => e.stopPropagation()}>
              <div className="gate-logo">K</div>
              <div className="gate-title">Открытие сессии</div>
              <div className="gate-sub">
                {visiblePosPoints.find(p => p.id === openingPosId)?.name
                  || 'Укажите кассира и наличные в кассе'}
              </div>
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
              <span className="gate-label">Наличные в кассе на начало</span>
              <input className="gate-input" value={gateCash} onChange={e => setGateCash(sanitizeDecimalInput(e.target.value))} inputMode="decimal" />
              <div className="kp-quick" style={{ marginBottom: 16 }}>
                {[0, 100, 500, 1000].map(v => (
                  <button key={v} type="button" onClick={() => setGateCash(v === 0 ? '0.00' : String(v))}>{v === 0 ? 'Пустая' : `${v}`}</button>
                ))}
              </div>
              {msg && <div className="pos-err">{msg}</div>}
              <button type="button" className="btn-gate" disabled={busy || !!myOpenShift} onClick={() => void openShift()}>
                {busy ? 'Открываем…' : myOpenShift ? 'Уже есть открытая сессия' : 'Открыть сессию'}
              </button>
              <button
                type="button"
                className="btn-switch-till"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => { setOpenShiftModal(false); setOpeningPosId(null); setMsg('') }}
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {createPosModal && (
          <div
            className="gate gate-modal"
            onClick={() => {
              if (busy) return
              setCreatePosModal(false)
              setMsg('')
            }}
          >
            <div className="gate-bg" />
            <div className="gate-card" onClick={e => e.stopPropagation()}>
              <div className="gate-logo">+</div>
              <div className="gate-title">Новая точка продаж</div>
              <div className="gate-sub">Касса, к которой будут привязаны сессии и продажи</div>
              <span className="gate-label">Название</span>
              <input
                className="gate-input"
                value={newPosName}
                onChange={e => setNewPosName(e.target.value)}
                placeholder="Магазин · Ленина 42"
                autoFocus
              />
              <span className="gate-label">Подпись (необязательно)</span>
              <input
                className="gate-input"
                value={newPosCode}
                onChange={e => setNewPosCode(e.target.value)}
                placeholder={`Касса №${visiblePosPoints.length + 1} · KAKAPO`}
              />
              {msg && <div className="pos-err">{msg}</div>}
              <button type="button" className="btn-gate" disabled={busy} onClick={() => void createPosPoint()}>
                {busy ? 'Создаём…' : 'Создать'}
              </button>
              <button
                type="button"
                className="btn-switch-till"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => { setCreatePosModal(false); setMsg('') }}
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {editPosId && (
          <div className="pos-settings-fs" role="dialog" aria-modal="true" aria-label="Настройки точки продаж">
            <div className="pos-settings-top">
              <div style={{ minWidth: 0 }}>
                <h2>Настройки точки продаж</h2>
                <p>Касса · чек · принтер XP-58C · весы CAS</p>
              </div>
              <div className="pos-settings-top-actions">
                <button
                  type="button"
                  className="btn-switch-till"
                  disabled={busy}
                  onClick={() => { setEditPosId(null); setMsg('') }}
                >
                  ← Назад к кассам
                </button>
              </div>
            </div>

            <div className="pos-settings-scroll">
              <div className="pos-settings-wrap">
                <div className="pos-settings-card">
                  <h3>Касса</h3>
                  <p className="hint">Название видно в списке точек и в шапке чека</p>
                  <div className="pos-settings-field">
                    <span className="gate-label">Название</span>
                    <input
                      className="gate-input"
                      value={editPosName}
                      onChange={e => setEditPosName(e.target.value)}
                      placeholder="Магазин · Ленина 42"
                      autoFocus
                    />
                  </div>
                  <div className="pos-settings-field">
                    <span className="gate-label">Телефон на чеке</span>
                    <input
                      className="gate-input"
                      value={editReceiptPhone}
                      onChange={e => setEditReceiptPhone(e.target.value)}
                      placeholder="+992 112 373 333"
                      inputMode="tel"
                    />
                  </div>
                  <div className="pos-settings-field">
                    <span className="gate-label">Подпись</span>
                    <input
                      className="gate-input"
                      value={editPosCode}
                      onChange={e => setEditPosCode(e.target.value)}
                      placeholder="Касса №1 · KAKAPO"
                    />
                  </div>
                  <div className="pos-settings-field">
                    <span className="gate-label">Заметка / адрес</span>
                    <input
                      className="gate-input"
                      value={editPosNote}
                      onChange={e => setEditPosNote(e.target.value)}
                      placeholder="Адрес, примечание…"
                    />
                  </div>
                </div>

                <div className="pos-settings-card">
                  <h3>Принтер чеков · XP-58C</h3>
                  <p className="hint">Лента 58 мм · ESC/POS · шапка: название + телефон</p>
                  {isKakapoDesktop() ? (
                    <>
                      {!deskPrinters.length ? (
                        <div className="pos-settings-status warn">
                          В Windows нет принтеров. Подключите XP-58C по USB и установите драйвер Xprinter.
                        </div>
                      ) : !pickReceiptPrinter(deskPrinters) ? (
                        <div className="pos-settings-status warn">
                          XP-58C не найден. Сейчас: {deskPrinters.slice(0, 4).map(p => p.displayName || p.name).join(', ')}.
                          Нажмите «Обновить».
                        </div>
                      ) : null}
                      {deskPrinters.length > 0 && (
                        <div className="pos-printer-list">
                          {deskPrinters.map(p => {
                            const recommended = isLikelyReceiptPrinter(p)
                            const on = deskPrinterName === p.name
                            return (
                              <button
                                key={p.name}
                                type="button"
                                className={`pos-printer-opt ${on ? 'on' : ''}`}
                                onClick={() => {
                                  setDeskPrinterName(p.name)
                                  setDeskPaperMm(XP58C_RECEIPT_MM)
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <b>{p.displayName || p.name}</b>
                                  <span>{p.name}{p.isDefault ? ' · по умолчанию Windows' : ''}</span>
                                </div>
                                {recommended ? <span className="pos-printer-badge">XP-58C</span> : null}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <div className={`pos-settings-status ${deskPrinterName ? 'ok' : 'warn'}`}>
                        {deskPrinterName
                          ? `Выбран: ${deskPrinterName} · 58 мм`
                          : 'Выберите принтер чеков в списке выше'}
                      </div>
                      <div className="pos-settings-row-btns">
                        <button
                          type="button"
                          className="btn-switch-till"
                          onClick={() => void refreshDeskPrinters()}
                        >
                          🔄 Обновить
                        </button>
                        <button
                          type="button"
                          className="btn-switch-till"
                          disabled={deskPrintBusy || !deskPrinterName}
                          onClick={() => void testReceiptPrinter()}
                        >
                          {deskPrintBusy ? 'Печатаем…' : '🖨 Тест чека'}
                        </button>
                        <button
                          type="button"
                          className="btn-switch-till"
                          onClick={openReceiptTemplateEditor}
                        >
                          Редактор шаблона
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="pos-settings-status warn">
                      Откройте программу KAKAPO Касса (desktop), чтобы выбрать принтер.
                    </div>
                  )}
                </div>

                <div className="pos-settings-card span-all">
                  <h3>Весы CAS</h3>
                  <p className="hint">CL-3000 / CL-5000 · выгрузка PLU и живой вес по TCP/IP</p>
                  {isKakapoDesktop() ? (
                    <>
                      <div className="pos-settings-field">
                        <span className="gate-label">Режим</span>
                        <select
                          className="gate-input"
                          value={deskScaleMode}
                          onChange={e => setDeskScaleMode(e.target.value === 'none' ? 'none' : 'plu-label')}
                        >
                          <option value="plu-label">CAS · сеть TCP/IP</option>
                          <option value="none">Нет / вручную на кассе</option>
                        </select>
                      </div>
                      {deskScaleMode === 'plu-label' && (
                        <>
                          <div className="pos-settings-scale-grid">
                            <div className="pos-settings-field">
                              <span className="gate-label">IP весов</span>
                              <input
                                className="gate-input"
                                value={deskScaleHost}
                                onChange={e => setDeskScaleHost(e.target.value)}
                                placeholder="192.168.1.10"
                              />
                            </div>
                            <div className="pos-settings-field">
                              <span className="gate-label">Порт</span>
                              <input
                                className="gate-input"
                                value={deskScalePort}
                                onChange={e => setDeskScalePort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                placeholder="20304"
                              />
                            </div>
                            <div className="pos-settings-field">
                              <span className="gate-label">Отдел</span>
                              <input
                                className="gate-input"
                                value={deskScaleDept}
                                onChange={e => setDeskScaleDept(e.target.value.replace(/\D/g, '').slice(0, 2))}
                                placeholder="1"
                              />
                            </div>
                          </div>

                          <label className="pos-settings-check">
                            <input
                              type="checkbox"
                              checked={deskScaleLiveWeight}
                              onChange={e => {
                                const on = e.target.checked
                                setDeskScaleLiveWeight(on)
                                if (!on) {
                                  qtyEditIsWeightRef.current = false
                                  void ensureCasWeightMonitor(false)
                                } else if (deskScaleHost.trim()) {
                                  void ensureCasWeightMonitor(true)
                                }
                              }}
                            />
                            <span>Живой вес в POS</span>
                          </label>

                          <div className={`pos-settings-status ${casWeight.connected ? 'ok' : 'warn'}`}>
                            {casWeight.connected
                              ? `Связь OK · ${casWeight.grams || 0} г (${(casWeight.weightKg || 0).toFixed(3)} кг)${casWeight.stable ? ' · стабильно' : ''}`
                              : (casWeight.error
                                ? `Нет связи: ${casWeight.error}`
                                : 'Нет связи с весами')}
                            <div className="pos-settings-net-hint">
                              Прямой кабель: на кассовом ПК нужен статический IPv4 <b>192.168.1.2/24</b>
                              (весы обычно <b>192.168.1.10:20304</b>). Приложение не меняет настройки Windows.
                            </div>
                          </div>

                          <div className="pos-settings-row-btns">
                            <button
                              type="button"
                              className="btn-switch-till"
                              disabled={deskCasTestBusy || !deskScaleHost.trim()}
                              onClick={() => {
                                void (async () => {
                                  const desk = getKakapoDesktop()
                                  if (!desk?.readCasWeight) return
                                  setDeskCasTestBusy(true)
                                  try {
                                    const res = await desk.readCasWeight({
                                      host: deskScaleHost.trim(),
                                      port: Number(deskScalePort) || 20304,
                                    })
                                    setCasWeight({
                                      connected: true,
                                      weightKg: res.weightKg,
                                      grams: res.grams,
                                      price: res.price,
                                      stable: true,
                                      error: '',
                                      ts: res.ts,
                                    })
                                    showToast(
                                      'CAS',
                                      `Вес: ${res.grams} г (${res.weightKg.toFixed(3)} кг)${res.raw ? ` · ${String(res.raw).slice(0, 40)}` : ''}`,
                                    )
                                    if (deskScaleLiveWeight) void ensureCasWeightMonitor(true)
                                  } catch (e) {
                                    const msg = e instanceof Error ? e.message : 'Ошибка связи с весами'
                                    setCasWeight(prev => ({ ...prev, connected: false, error: msg }))
                                    showToast('CAS', msg)
                                  } finally {
                                    setDeskCasTestBusy(false)
                                  }
                                })()
                              }}
                            >
                              {deskCasTestBusy ? 'Чтение…' : 'Тест связи / вес'}
                            </button>
                            <button
                              type="button"
                              className="btn-switch-till"
                              disabled={deskCasBusy || !deskScaleHost.trim()}
                              onClick={() => {
                                void (async () => {
                                  const desk = getKakapoDesktop()
                                  if (!desk) return
                                  setDeskCasBusy(true)
                                  try {
                                    await ensureCasWeightMonitor(false)
                                    const printerName = deskPrinterName || pickReceiptPrinter(deskPrinters) || ''
                                    await desk.savePrinterSettings({
                                      ...(await desk.getPrinterSettings()),
                                      printerName,
                                      paperWidthMm: XP58C_RECEIPT_MM,
                                      scaleMode: deskScaleMode,
                                      scaleHost: deskScaleHost.trim(),
                                      scalePort: Number(deskScalePort) || 20304,
                                      scaleDept: Number(deskScaleDept) || 1,
                                      scaleLiveWeight: deskScaleLiveWeight,
                                    })
                                    const items = products
                                      .filter(p => isWeighted(p) && Number(p.plu) > 0)
                                      .map(p => ({
                                        plu: Number(p.plu),
                                        name: p.name,
                                        price: Number(p.price) || 0,
                                        barcode: productBarcodes(p)[0] || '',
                                        department: Number(deskScaleDept) || 1,
                                      }))
                                    const res = await desk.syncCasPlu({
                                      host: deskScaleHost.trim(),
                                      port: Number(deskScalePort) || 20304,
                                      department: Number(deskScaleDept) || 1,
                                      items,
                                    })
                                    showToast('CAS', `Выгружено PLU: ${res.count}`)
                                  } catch (e) {
                                    showToast('CAS', e instanceof Error ? e.message : 'Ошибка связи с весами')
                                  } finally {
                                    if (deskScaleLiveWeight) void ensureCasWeightMonitor(true)
                                    setDeskCasBusy(false)
                                  }
                                })()
                              }}
                            >
                              {deskCasBusy ? 'Выгрузка…' : 'Выгрузить PLU на весы'}
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="pos-settings-status warn">Нужен desktop KAKAPO Касса</div>
                  )}
                </div>
              </div>
            </div>

            {msg && <div className="pos-err" style={{ margin: '0 28px 8px', textAlign: 'center' }}>{msg}</div>}

            <div className="pos-settings-actions">
              <div className="pos-settings-actions-inner">
                <button type="button" className="btn-gate" disabled={busy} onClick={() => void savePosSettings()}>
                  {busy ? 'Сохраняем…' : 'Сохранить настройки'}
                </button>
                <button
                  type="button"
                  className="btn-switch-till"
                  disabled={busy}
                  onClick={() => { setEditPosId(null); setMsg('') }}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {receiptTemplateOpen && (
          <div
            className="pos-settings-fs receipt-tpl-fs"
            style={{ zIndex: 8200 }}
            role="dialog"
            aria-modal="true"
            aria-label="Редактор шаблона чека"
          >
            <div className="pos-settings-top">
              <div style={{ minWidth: 0 }}>
                <h2>Редактор шаблона чека XP-58C</h2>
                <p>Лента 58 мм · живой предпросмотр · настройки сохраняются на этой кассе</p>
              </div>
              <div className="pos-settings-top-actions">
                <button
                  type="button"
                  className="btn-switch-till"
                  onClick={() => setReceiptTemplateOpen(false)}
                >
                  ← Назад
                </button>
              </div>
            </div>

            <div className="pos-settings-scroll">
              <div
                className="pos-settings-wrap"
                style={{ gridTemplateColumns: 'minmax(340px, 1fr) minmax(340px, 460px)' }}
              >
                <div style={{ display: 'grid', gap: 14 }}>
                  <div className="pos-settings-card">
                    <h3>Интервал печати</h3>
                    <p className="hint">
                      Межстрочный интервал: {receiptTemplateDraft.lineSpacing} точек
                      {' · '}
                      {receiptTemplateDraft.lineSpacing <= 22
                        ? 'плотно'
                        : receiptTemplateDraft.lineSpacing >= 40
                          ? 'свободно'
                          : 'обычно'}
                    </p>
                    <input
                      type="range"
                      min={16}
                      max={64}
                      step={1}
                      value={receiptTemplateDraft.lineSpacing}
                      onChange={e => setReceiptTemplateDraft(prev => ({
                        ...prev,
                        lineSpacing: Number(e.target.value),
                      }))}
                      style={{ width: '100%' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t2)' }}>
                      <span>16 плотно</span>
                      <span>24</span>
                      <span>64 свободно</span>
                    </div>
                    <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                      Сохраните шаблон и нажмите «Тест на XP-58C», чтобы проверить интервал на бумаге.
                    </p>
                  </div>

                  <div className="pos-settings-card">
                    <h3>Заголовки чека</h3>
                    <p className="hint">
                      Название и телефон магазина задаются в настройках точки.
                    </p>
                    {RECEIPT_HEADER_TEXT_FIELDS.map(field => (
                      <div className="pos-settings-field" key={field.key}>
                        <span className="gate-label">{field.label}</span>
                        <input
                          className="gate-input"
                          value={String(receiptTemplateDraft[field.key] ?? '')}
                          onChange={e => setReceiptTemplateDraft(prev => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="pos-settings-card">
                    <h3>Подписи полей</h3>
                    <p className="hint">
                      Эти названия постоянно стоят на чеке — «Дата», «Касса», «ИТОГ» и т.д. Можно переименовать.
                    </p>
                    {RECEIPT_LABEL_TEXT_FIELDS.map(field => (
                      <div className="pos-settings-field" key={field.key}>
                        <span className="gate-label">{field.label}</span>
                        <input
                          className="gate-input"
                          value={String(receiptTemplateDraft[field.key] ?? '')}
                          onChange={e => setReceiptTemplateDraft(prev => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="pos-settings-card">
                    <h3>Низ чека</h3>
                    {RECEIPT_FOOTER_TEXT_FIELDS.map(field => (
                      <div className="pos-settings-field" key={field.key}>
                        <span className="gate-label">{field.label}</span>
                        <input
                          className="gate-input"
                          value={String(receiptTemplateDraft[field.key] ?? '')}
                          onChange={e => setReceiptTemplateDraft(prev => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="pos-settings-card">
                    <h3>Показывать на чеке</h3>
                    <p className="hint">Отключите ненужные строки, чтобы чек был короче.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
                      {RECEIPT_TOGGLE_FIELDS.map(field => (
                        <label
                          key={field.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minHeight: 38,
                            padding: '7px 9px',
                            border: '1px solid var(--border)',
                            borderRadius: 10,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(receiptTemplateDraft[field.key])}
                            onChange={e => setReceiptTemplateDraft(prev => ({
                              ...prev,
                              [field.key]: e.target.checked,
                            }))}
                          />
                          <span>{field.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pos-settings-card" style={{ position: 'sticky', top: 0 }}>
                  <h3>Предпросмотр</h3>
                  <p className="hint">Фактическая печать идёт текстом ESC/POS на 32 символа.</p>
                  <div
                    style={{
                      background: '#d8d8d8',
                      borderRadius: 12,
                      padding: 12,
                      display: 'flex',
                      justifyContent: 'center',
                      maxHeight: '68vh',
                      overflow: 'auto',
                    }}
                  >
                    <iframe
                      title="Предпросмотр чека"
                      srcDoc={receiptPreviewHtml}
                      style={{
                        width: 384,
                        minWidth: 384,
                        height: 760,
                        border: 0,
                        background: '#fff',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pos-settings-actions">
              <div className="pos-settings-actions-inner" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn-gate" onClick={saveReceiptTemplateEditor}>
                  Сохранить шаблон
                </button>
                <button
                  type="button"
                  className="btn-switch-till"
                  disabled={deskPrintBusy || !deskPrinterName}
                  onClick={() => void testReceiptTemplateDraft()}
                >
                  {deskPrintBusy ? 'Печатаем…' : 'Тест на XP-58C'}
                </button>
                <button type="button" className="btn-switch-till" onClick={resetReceiptTemplateEditor}>
                  Сбросить
                </button>
                <button
                  type="button"
                  className="btn-switch-till"
                  onClick={() => setReceiptTemplateOpen(false)}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {deletePosId && (
          <div
            className="gate gate-modal"
            onClick={() => {
              if (busy) return
              setDeletePosId(null)
              setMsg('')
            }}
          >
            <div className="gate-bg" />
            <div className="gate-card" onClick={e => e.stopPropagation()}>
              <div className="gate-logo" style={{ background: 'rgba(255,90,90,.15)', color: '#FF5A5A' }}>✕</div>
              <div className="gate-title">Удалить точку?</div>
              <div className="gate-sub">
                {posPoints.find(p => p.id === deletePosId)?.name || 'Точка продаж'}
                <br />
                История чеков сохранится, но касса исчезнет из списка
              </div>
              {msg && <div className="pos-err">{msg}</div>}
              <button
                type="button"
                className="btn-gate"
                style={{ background: 'linear-gradient(135deg,#ff5a5a,#d63c3c)', boxShadow: '0 8px 20px rgba(255,90,90,.28)' }}
                disabled={busy}
                onClick={() => void confirmDeletePos()}
              >
                {busy ? 'Удаляем…' : 'Удалить'}
              </button>
              <button
                type="button"
                className="btn-switch-till"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => { setDeletePosId(null); setMsg('') }}
              >
                Отмена
              </button>
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

  const payDebtAmt = currentPayDebtAmt()
  const collectTotal = Math.round((total + payDebtAmt) * 100) / 100
  const cashReceived = Number(cashBuf) || 0
  const cashChange = cashReceived - collectTotal
  const cashShort = !payDebtOn && cashReceived > 0.001 && cashReceived < total - 0.001
  const cashRemain = Math.max(0, Math.round((total - cashReceived) * 100) / 100)
  const splitCardAmt = Math.min(cashRemain, Math.max(0, Number(splitCardBuf) || 0))
  const splitDebtRemain = Math.max(0, Math.round((cashRemain - splitCardAmt) * 100) / 100)
  const cashSaleBonus = client?.card && total > 0 ? calcCashDepositBonus(total) : 0
  const cashSaleTier = client?.card && total > 0 ? cashDepositTierForAmount(total) : null
  const topupCash = Number(topupBuf) || 0
  const topupPrincipal = Math.max(0, Math.floor(topupCash))
  const topupPercentBonus = calcCashDepositBonus(topupCash)
  const topupCredit = topupPrincipal + topupPercentBonus
  const topupTier = cashDepositTierForAmount(topupCash)
  const repayAmount = Number(repayBuf) || 0
  const repayRemain = Math.max(0, clientDebt - repayAmount)
  const repayCashBonus = repayMethod === 'cash' && repayAmount > 0 ? calcCashDepositBonus(repayAmount) : 0
  const repayCashTier = repayMethod === 'cash' && repayAmount > 0 ? cashDepositTierForAmount(repayAmount) : null

  return (
    <div className="pos-root" data-theme={theme} data-embed={embedded ? '1' : undefined}>
      <style>{POS_MOCK_CSS}</style>
      <div className="app">
        <div className="topbar">
          <div className="top-loc">
            <b>{activePosPoint?.name || 'Точка продаж'}</b>
            <div className="dot-row"><span className="d" />{activePosPoint?.code || 'Онлайн'}</div>
          </div>

          <div className="searchpill">
            <span className="ic" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              value={q}
              onChange={e => onProductSearchChange(e.target.value)}
              placeholder="Товар, штрихкод…"
              autoFocus
              onKeyDown={onProductSearchKeyDown}
            />
            <span className="scan-tag" title="Сканер">📷</span>
          </div>

          <div className="order-tabs" aria-label="Открытые чеки">
            {tickets.map(t => {
              const active = t.id === activeTicketId
              const n = ticketLineCount(t)
              const label = t.client?.name?.split(/\s+/)[0] || `Чек ${t.seq}`
              const sum = ticketNetSum(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`order-tab ${active ? 'on' : ''}`}
                  title={sum > 0 ? `${label} · ${sum.toFixed(2)} сом` : label}
                  onClick={() => switchTicket(t.id)}
                >
                  <span className="order-tab-label">{label}</span>
                  {n > 0 && <span className="order-tab-count">{n > 99 ? '99+' : n}</span>}
                  {(tickets.length > 1 || n > 0 || !!t.client) && (
                    <span
                      className="order-tab-x"
                      role="button"
                      tabIndex={-1}
                      title="Закрыть чек"
                      onClick={e => { e.stopPropagation(); closeTicket(t.id) }}
                    >
                      ×
                    </span>
                  )}
                </button>
              )
            })}
            <button
              type="button"
              className="order-tab-add"
              title="Новый чек"
              disabled={tickets.length >= MAX_TICKETS}
              onClick={addTicket}
            >
              +
            </button>
          </div>

          <div className="theme-toggle" role="group" aria-label="Тема" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`theme-mode ${theme === 'dark' ? 'on' : ''}`}
              title="Тёмная тема"
              onClick={() => applyTheme('dark')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className={`theme-mode ${theme === 'light' ? 'on' : ''}`}
              title="Светлая тема"
              onClick={() => applyTheme('light')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <button type="button" className="bell-btn" title="Уведомления" onClick={() => showToast('Уведомления', 'Нет новых уведомлений')}>
            🔔<span className="bell-badge" />
          </button>
          <div className="account-wrap" ref={accountMenuRef}>
            <button
              type="button"
              className={`account-btn ${cashierMenuOpen ? 'on' : ''}`}
              onClick={() => setCashierMenuOpen(v => !v)}
            >
              <div className="account-av">{settings.initials}</div>
              <div className="info">
                <b>{settings.cashierName}</b>
                <span>Кассир ▾</span>
              </div>
            </button>
            {cashierMenuOpen && (
              <div className="account-menu">
                <div className="account-menu-head">
                  <b>{settings.cashierName}</b>
                  <span>Смена открыта</span>
                </div>
                <button
                  type="button"
                  className="account-menu-item"
                  onClick={() => openCashierScreen('receipts')}
                >
                  <span className="ami-ic">🧾</span>
                  <span>
                    <b>История чеков</b>
                    <i>Все продажи, возврат, повтор в чек</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="account-menu-item"
                  onClick={() => openTillMove('in')}
                >
                  <span className="ami-ic">⬇️</span>
                  <span>
                    <b>Внести в кассу</b>
                    <i>Положить наличные · ожидается {fmtMoney(tillExpected)}</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="account-menu-item"
                  onClick={() => openTillMove('out')}
                >
                  <span className="ami-ic">⬆️</span>
                  <span>
                    <b>Снять из кассы</b>
                    <i>Оплата поставщику / расход наличными</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="account-menu-item"
                  onClick={() => openCashierScreen('switch')}
                >
                  <span className="ami-ic">🔁</span>
                  <span>
                    <b>Сменить кассира</b>
                    <i>Закрыть смену и открыть на другого</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="account-menu-item danger"
                  onClick={() => openCashierScreen('close')}
                >
                  <span className="ami-ic">⏹</span>
                  <span>
                    <b>Закрыть смену</b>
                    <i>Итоги смены и наличные в кассе</i>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="products">
          <div className="cat-nav">
            <div className="cat-quick">
              <button
                type="button"
                className={`cat-pill cat-fav ${showFav ? 'on' : ''}`}
                onClick={selectFavorites}
              >
                ★ Избранное
              </button>
              <button
                type="button"
                className={`cat-pill ${!showFav && selectedCatSlugs.length === 0 ? 'on' : ''}`}
                onClick={selectAllProducts}
              >
                🗂 Все
              </button>
              {quickCatSlugs.map(slug => {
                const c = getCategoryBySlug(categories, slug)
                if (!c) return null
                return (
                  <button
                    key={slug}
                    type="button"
                    className="cat-pill on"
                    onClick={() => toggleCategory(slug)}
                    title="Снять категорию"
                  >
                    {c.emoji || '📦'} {c.name}
                  </button>
                )
              })}
              <button
                type="button"
                className={`cat-browse-btn ${!showFav && selectedCatSlugs.length > 0 ? 'has-sel' : ''}`}
                onClick={() => { setCatModalQ(''); setCatModalOpen(true) }}
              >
                Категории{selectedCatSlugs.length > 1 ? ` · ${selectedCatSlugs.length}` : ''} ▾
              </button>
            </div>
            {!showFav && subCats.length > 0 && focusRootCat && (
              <div className="cat-sub">
                <button
                  type="button"
                  className={`cat-pill sm ${selectedCatSet.has(categorySlug(focusRootCat)) ? 'on' : ''}`}
                  onClick={() => pickSubCategory(null)}
                >
                  Все в категории
                </button>
                {subCats.map(c => {
                  const slug = categorySlug(c)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`cat-pill sm ${selectedCatSet.has(slug) ? 'on' : ''}`}
                      onClick={() => pickSubCategory(selectedCatSet.has(slug) ? null : slug)}
                    >
                      {c.emoji || '📦'} {c.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="grid-wrap">
            {showFav && visibleProducts.length === 0 ? (
              <div className="cat-empty">
                <div className="cat-empty-ic">★</div>
                <b>Избранное пусто</b>
                <span>Добавьте товары звёздочкой на плитке</span>
              </div>
            ) : (
              <div className="p-grid">
                {visibleProducts.map(p => {
                  const stock = Number(p.stock) || 0
                  const photo = p.photo || getPhoto(p.id)
                  const weighted = isWeighted(p)
                  const sellUnit = displaySellUnit(p)
                  const stockUnit = stockUnitLabel(p)
                  const barcode = productBarcodes(p)[0] || ''
                  const art = String(p.art || '').trim()
                  const isFav = favSet.has(p.id)
                  return (
                    <button key={p.id} type="button" className="p-tile" onClick={() => addProduct(p)}>
                      <span
                        className={`p-fav ${isFav ? 'on' : ''}`}
                        title={isFav ? 'Убрать из избранного' : 'В избранное'}
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation()
                          e.preventDefault()
                          toggleFavorite(p.id)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            e.preventDefault()
                            toggleFavorite(p.id)
                          }
                        }}
                      >
                        {isFav ? '★' : '☆'}
                      </span>
                      <div className="p-photo">
                        {photo ? <img src={photo} alt="" /> : (p.e || '📦')}
                        {weighted && <span className="p-weight-tag">⚖ {sellUnit}</span>}
                      </div>
                      <div className="p-name">{p.name}</div>
                      <div className="p-codes">
                        {art ? <span>арт. {art}</span> : null}
                        {barcode ? <span>ш/к {barcode}</span> : null}
                        {!art && !barcode ? <span className="muted">без кода</span> : null}
                      </div>
                      <div className="p-price">{(Number(p.price) || 0).toFixed(2)}<span className="p-unit"> ЅМ/{sellUnit}</span></div>
                      <div className={`p-stock ${stock < 5 ? 'low' : ''}`}>В наличии: {stock} {stockUnit}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="cart">
          <div
            className={`client-card ${client ? 'set' : ''}`}
            onClick={() => {
              if (client) {
                setHistView('profile')
                setHistTab('checks')
                setHistOpen(true)
                return
              }
              setClientQ('')
              setClientPick(null)
              setClientOpen(true)
            }}
          >
            <div className="client-av">{client ? initialsOf(client.name) : '👤'}</div>
            <div className="client-info">
              <div className="nm-row">
                <div className="nm">{client?.name || 'Гость'}</div>
                {client && <span className="client-hist-link">Подробнее</span>}
              </div>
              <div className="ph">{client ? client.phone : 'Нажмите чтобы выбрать клиента'}</div>
              {client && loyalty && (
                <div className="client-bonus">
                  ⭐ {Number(loyalty.bonus || 0).toLocaleString('ru-RU')} бон.
                  {clientDebt > 0 ? <> · <span className="debt">долг {fmtMoney(clientDebt)}</span></> : null}
                  {debtLimit > 0 ? <> · лимит {fmtMoney(availableDebt)}</> : null}
                  {usedBonus > 0 ? <> · <span className="used">−{usedBonus.toFixed(0)} бон.</span></> : null}
                </div>
              )}
            </div>
            <button
              type="button"
              className="client-qr-btn"
              title="Сканировать QR клиента"
              onClick={e => {
                e.stopPropagation()
                setClientScanBuf('')
                setClientScanOpen(true)
              }}
            >
              <QrIcon size={15} />
              <span>QR</span>
            </button>
            {client && loyalty && (
              <span className="client-tier" style={{ background: `${CLIENT_LEVEL_COLORS[loyalty.level]}22`, color: CLIENT_LEVEL_COLORS[loyalty.level] }}>
                {levelLabel(loyalty.level)}
              </span>
            )}
            {client && (
              <button type="button" className="client-x" onClick={e => { e.stopPropagation(); setClient(null); setBonusUsed(0); setPayDebtOn(false); setPayDebtBuf(''); if (pay === 'credit' || pay === 'balance') setPay('cash') }}>✕</button>
            )}
          </div>

          <div className="cart-items">
            {!cart.filter(l => l.key !== qtyEditDraftKey).length ? (
              <div className="cart-empty"><div className="ic">🛒</div>Чек пуст.<br />Отсканируйте или выберите товар.</div>
            ) : cart.filter(l => l.key !== qtyEditDraftKey).map(line => {
              const gross = lineGross(line)
              const net = lineNet(line)
              const lineDisc = Number(line.discPct) || 0
              return (
                <div
                  key={line.key}
                  className={`cart-row ${selectedLineKey === line.key ? 'sel' : ''}`}
                  onClick={() => setSelectedLineKey(line.key)}
                >
                  <div className="ic">{line.emoji}</div>
                  <div className="info">
                    <div className="name">{line.name}</div>
                    <div className="meta">
                      {line.art ? <span>арт. {line.art}</span> : null}
                      {line.barcode ? <span>ш/к {line.barcode}</span> : null}
                      <span>
                        {line.weightKg != null
                          ? `${line.weightKg.toFixed(3)} кг · ${line.price.toFixed(2)} ЅМ/${line.unit}`
                          : `${line.price.toFixed(2)} ЅМ × ${fmtQty(line.qty)}`}
                      </span>
                      {line.receiptId ? (
                        <span className="line-batch">
                          партия {line.costPrice != null ? `зак. ${line.costPrice.toFixed(2)}` : ''}
                          {line.supplierName ? ` · ${line.supplierName}` : ''}
                        </span>
                      ) : null}
                      {lineDisc > 0 ? <span className="line-disc">−{lineDisc}%</span> : null}
                    </div>
                  </div>
                  {line.weightKg == null ? (
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={e => { e.stopPropagation(); openQtyEdit(line) }}
                    >
                      ×{fmtQty(line.qty)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={e => { e.stopPropagation(); openQtyEdit(line) }}
                    >
                      {line.weightKg.toFixed(3)} кг
                    </button>
                  )}
                  <div className="price">
                    {lineDisc > 0 ? <span className="old">{gross.toFixed(2)}</span> : null}
                    {net.toFixed(2)}
                  </div>
                  <button type="button" className="rm" onClick={e => { e.stopPropagation(); removeLine(line.key); if (selectedLineKey === line.key) setSelectedLineKey(null) }}>✕</button>
                </div>
              )
            })}
          </div>

          <div className="check-actions">
            <button type="button" className="action-chip ac-clear" onClick={clearCart} disabled={!cart.length && discountPct <= 0}>
              <span className="ic-wrap">🗑</span><span>Очистить</span>
            </button>
            <button type="button" className="action-chip ac-discount" onClick={() => openLineDiscount()} disabled={!cart.length}>
              <span className="ic-wrap">🏷</span><span>Скидка на товар</span>
            </button>
            <button type="button" className={`action-chip ac-discount-all ${discountPct > 0 ? 'on' : ''}`} onClick={openAllDiscount} disabled={!cart.length}>
              <span className="ic-wrap">%</span><span>Скидка на всё</span>
            </button>
          </div>

          <div className="cart-totals">
            <div className="tot-row"><span>Позиций</span><span>{cart.reduce((s, l) => s + (l.weightKg != null ? 1 : l.qty), 0)}</span></div>
            <div className="tot-row"><span>Сумма</span><span>{subtotalGross.toFixed(2)}</span></div>
            <div className={`tot-row disc ${itemDiscAmount + discAmount > 0 ? '' : 'muted'}`}>
              <span>Скидки</span>
              <span>−{(itemDiscAmount + discAmount).toFixed(2)}</span>
            </div>
            {usedBonus > 0 && <div className="tot-row disc"><span>Списано бонусами</span><span>−{usedBonus.toFixed(2)}</span></div>}
            <div className="tot-final"><b>Итого</b><span className="sum">{total.toFixed(2)} ЅМ</span></div>
          </div>

          <button
            type="button"
            className="btn-checkout"
            disabled={!cart.length || busy}
            onClick={startPay}
          >
            <span>🖨</span><span>Оплатить</span>
          </button>
        </div>
      </div>

      {catModalOpen && (
        <div className="overlay" onClick={() => setCatModalOpen(false)}>
          <div className="modal-card cat-browse-card" onClick={e => e.stopPropagation()}>
            <h3>Категории</h3>
            <p className="cat-browse-hint">Можно выбрать несколько — товары объединяются</p>
            <div className="pos-search">
              <span className="ic">🔍</span>
              <input
                value={catModalQ}
                onChange={e => setCatModalQ(e.target.value)}
                placeholder="Поиск категории…"
                autoFocus
              />
            </div>
            <div className="cat-browse-grid">
              <button
                type="button"
                className={`cat-browse-item all ${!showFav && selectedCatSlugs.length === 0 ? 'on' : ''}`}
                onClick={() => selectAllProducts()}
              >
                <span className="cat-browse-emoji">🗂</span>
                <span className="cat-browse-name">Все товары</span>
                <span className="cat-browse-count">{inStockProducts.length}</span>
              </button>
              {modalCategories.map(c => {
                const slug = categorySlug(c)
                const count = countProductsInCategory(inStockProducts, slug, categories)
                const parent = c.parent_id != null
                  ? categories.find(x => x.id === Number(c.parent_id))
                  : null
                const on = !showFav && selectedCatSet.has(slug)
                return (
                  <button
                    key={`${c.id}-${slug}`}
                    type="button"
                    className={`cat-browse-item ${on ? 'on' : ''}`}
                    onClick={() => toggleCategory(slug)}
                  >
                    <span className="cat-browse-check" aria-hidden>{on ? '✓' : ''}</span>
                    <span className="cat-browse-emoji">{c.emoji || '📦'}</span>
                    <span className="cat-browse-name">{c.name}</span>
                    {parent ? <span className="cat-browse-parent">{parent.name}</span> : null}
                    <span className="cat-browse-count">{count}</span>
                  </button>
                )
              })}
              {modalCategories.length === 0 && (
                <div className="cat-browse-empty">Ничего не найдено</div>
              )}
            </div>
            <div className="modal-card-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => { setCatModalOpen(false); setCatModalQ('') }}
              >
                {selectedCatSlugs.length > 0 ? `Готово · ${selectedCatSlugs.length}` : 'Закрыть'}
              </button>
            </div>
          </div>
        </div>
      )}

      {qtyEditOpen && qtyEditKey && (() => {
        const line = cart.find(l => l.key === qtyEditKey)
        if (!line) return null
        const { qty: previewQty, amount: previewSum, price, isWeight } = resolveQtyEdit(line, qtyEditMode, qtyEditBuf)
        const unit = isWeight ? 'кг' : (line.unit || 'шт')
        const overStock = previewQty > line.stock + 0.001
        return (
          <div className="overlay" onClick={() => closeQtyEdit()}>
            <div className="modal-card qty-edit-card" onClick={e => e.stopPropagation()}>
              <div className="qty-edit-head">
                <div className="qty-edit-av">{line.emoji}</div>
                <div>
                  <div className="qty-edit-name">{line.name}</div>
                  <div className="qty-edit-stock">На складе: {line.stock}{isWeight ? ' кг' : ' шт'}</div>
                </div>
              </div>

              <div className="qty-trio">
                <div className="qty-trio-item">
                  <span className="l">Цена</span>
                  <b>{price.toFixed(2)}</b>
                  <span className="u">ЅМ / {unit}</span>
                </div>
                <button
                  type="button"
                  className={`qty-trio-item tap ${qtyEditMode === 'qty' ? 'on' : ''}`}
                  onClick={() => {
                    setQtyEditMode('qty')
                    setQtyEditBuf(previewQty > 0 ? fmtQty(previewQty) : '')
                  }}
                >
                  <span className="l">{isWeight ? 'Вес' : 'Кол-во'}</span>
                  <b className={qtyEditMode === 'qty' ? 'live' : ''}>
                    {previewQty > 0
                      ? fmtQty(previewQty)
                      : (isWeight && liveWeightEnabled() && casWeight.connected ? '…' : '—')}
                  </b>
                  <span className="u">{unit}</span>
                </button>
                <button
                  type="button"
                  className={`qty-trio-item tap ${qtyEditMode === 'sum' ? 'on' : ''}`}
                  onClick={() => {
                    setQtyEditMode('sum')
                    setQtyEditBuf(previewSum > 0 ? String(previewSum) : '')
                  }}
                >
                  <span className="l">Сумма</span>
                  <b className={qtyEditMode === 'sum' ? 'live' : ''}>{previewSum > 0 ? previewSum.toFixed(2) : '—'}</b>
                  <span className="u">ЅМ</span>
                </button>
              </div>

              <div className="qty-edit-hint">
                {qtyEditMode === 'sum'
                  ? 'Количество = сумма ÷ цена (например 3 ÷ 6 = 0.5)'
                  : isWeight
                    ? (liveWeightEnabled()
                      ? (scaleHolding
                        ? 'Вес удержан 1.5 с · можно сохранить'
                        : (casWeight.connected
                          ? ((casWeight.grams || 0) > 0
                            ? `Весы: ${casWeight.grams} г · ${(casWeight.weightKg || 0).toFixed(3)} кг`
                            : 'Весы подключены · положите товар на весы')
                          : (casWeight.error
                            ? `Весы: ${casWeight.error}`
                            : 'Ожидание весов… Можно ввести вес вручную')))
                      : 'Введите вес с клавиатуры — сумма посчитается сама')
                    : 'Введите количество с клавиатуры — сумма посчитается сама'}
              </div>

              <div className={`kp-display qty-edit-input ${qtyEditMode}`}>
                <div className="lbl">{qtyEditMode === 'sum' ? 'ВВОД СУММЫ' : (isWeight ? 'ВВОД ВЕСА' : 'ВВОД КОЛИЧЕСТВА')}</div>
                <div className="qty-edit-stepper">
                  <button
                    type="button"
                    className="qty-step"
                    onClick={() => {
                      const step = qtyEditMode === 'sum' ? 1 : (isWeight ? 0.1 : 1)
                      const cur = Number(qtyEditBuf) || 0
                      const next = Math.max(0, Math.round((cur - step) * 1000) / 1000)
                      setQtyEditBuf(next > 0 ? String(next) : '')
                    }}
                  >
                    −
                  </button>
                  <input
                    ref={qtyEditInputRef}
                    className="qty-edit-field"
                    value={qtyEditBuf}
                    inputMode="decimal"
                    autoFocus
                    onChange={e => setQtyEditBuf(sanitizeDecimalInput(e.target.value))}
                    onFocus={e => e.currentTarget.select()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (previewQty > 0 && !overStock) applyQtyEdit()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        closeQtyEdit()
                      }
                    }}
                    placeholder="0"
                  />
                  <button
                    type="button"
                    className="qty-step"
                    onClick={() => {
                      const step = qtyEditMode === 'sum' ? 1 : (isWeight ? 0.1 : 1)
                      const cur = Number(qtyEditBuf) || 0
                      const next = Math.round((cur + step) * 1000) / 1000
                      setQtyEditBuf(String(next))
                    }}
                  >
                    +
                  </button>
                </div>
                {qtyEditMode === 'sum' && price > 0 && (Number(qtyEditBuf) || 0) > 0 && (
                  <div className="qty-edit-formula">
                    {Number(qtyEditBuf || 0).toFixed(2)} ÷ {price.toFixed(2)} = <b>{fmtQty(previewQty)} {unit}</b>
                  </div>
                )}
                {overStock && <div className="qty-edit-warn">Больше остатка на складе ({line.stock})</div>}
              </div>

              <div className="qty-edit-toolbar">
                <div className="kp-quick" style={{ margin: 0, flex: 1 }}>
                  {(isWeight ? [0.1, 0.25, 0.5, 1, 2, 5] : [10, 15, 20, 30]).map(v => (
                    <button key={v} type="button" onClick={() => setQtyEditBuf(String(v))}>{v}</button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`qty-pad-toggle ${qtyEditPad ? 'on' : ''}`}
                  onClick={() => setQtyEditPad(v => !v)}
                  title={qtyEditPad ? 'Скрыть клавиатуру' : 'Экранная клавиатура'}
                >
                  ⌨ {qtyEditPad ? 'Скрыть' : 'Клавиатура'}
                </button>
              </div>

              {qtyEditPad && (
                <Keypad
                  onDigit={k => setQtyEditBuf(b => appendDigit(b, k, 8))}
                  onBack={() => setQtyEditBuf(b => b.slice(0, -1))}
                />
              )}

              <div className="modal-card-actions">
                <button type="button" className="btn-cancel" onClick={() => closeQtyEdit()}>Отмена</button>
                <button type="button" className="btn-confirm" disabled={previewQty <= 0 || overStock} onClick={applyQtyEdit}>
                  {isWeight ? 'Сохранить' : 'Применить'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {payPickOpen && (
        <div className="overlay" onClick={() => !busy && setPayPickOpen(false)}>
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>Оплата</h3>

            {client && loyalty ? (
              <div className="pay-client-strip">
                <div>
                  <b>{client.name}</b>
                  <span>{client.card || client.phone || 'без карты'}</span>
                </div>
                <div className="pay-client-bonus">⭐ {(Number(loyalty.bonus) || 0).toLocaleString('ru-RU')}</div>
              </div>
            ) : (
              <button
                type="button"
                className="pay-pick-client"
                onClick={() => { setPayPickOpen(false); setClientOpen(true) }}
              >
                👤 Выбрать клиента — чтобы списать бонусы
              </button>
            )}

            <div className="pay-breakdown">
              <div><span>Сумма со скидкой</span><b className="bank-fig">{afterDisc.toFixed(2)}</b></div>
              {usedBonus > 0 && (
                <div className="disc"><span>Бонусы</span><b className="bank-fig">−{usedBonus.toFixed(0)}</b></div>
              )}
              {payDebtAmt > 0.001 && (
                <div className="debt-line"><span>Погашение долга</span><b className="bank-fig">+{payDebtAmt.toFixed(2)}</b></div>
              )}
              <div className="due">
                <span>К оплате</span>
                <b className="bank-fig sum">{collectTotal.toFixed(2)} сом</b>
              </div>
            </div>

            {client && clientDebt > 0.001 && (
              <div className="pay-debt-box">
                <button
                  type="button"
                  className={`pay-debt-toggle ${payDebtOn ? 'on' : ''}`}
                  onClick={() => {
                    setPayDebtOn(v => {
                      const next = !v
                      if (next && !(Number(payDebtBuf) > 0)) {
                        setPayDebtBuf(String(Math.round(clientDebt * 100) / 100))
                      }
                      return next
                    })
                  }}
                >
                  <span className="sw" aria-hidden />
                  <span>
                    Погасить долг <b>{fmtMoney(clientDebt)}</b>
                    <em>вместе с этим чеком</em>
                  </span>
                </button>
                {payDebtOn && (
                  <div className="pay-debt-row">
                    <button
                      type="button"
                      className={Math.abs(payDebtAmt - Math.round(clientDebt / 2 * 100) / 100) < 0.02 ? 'on' : ''}
                      onClick={() => setPayDebtBuf(String(Math.round(clientDebt / 2 * 100) / 100))}
                    >
                      ½
                    </button>
                    <button
                      type="button"
                      className={Math.abs(payDebtAmt - clientDebt) < 0.02 ? 'on' : ''}
                      onClick={() => setPayDebtBuf(String(Math.round(clientDebt * 100) / 100))}
                    >
                      Весь
                    </button>
                    <input
                      className="pay-debt-amt"
                      value={payDebtBuf}
                      inputMode="decimal"
                      onChange={e => {
                        const next = sanitizeDecimalInput(e.target.value)
                        const n = Number(next)
                        if (next !== '' && Number.isFinite(n) && n > clientDebt + 0.001) {
                          setPayDebtBuf(String(Math.round(clientDebt * 100) / 100))
                          return
                        }
                        setPayDebtBuf(next)
                      }}
                      onFocus={e => e.currentTarget.select()}
                      placeholder="0"
                      aria-label="Сумма погашения"
                    />
                  </div>
                )}
              </div>
            )}

            {client && loyalty && maxBonus > 0 && (
              <div className="pay-bonus-box">
                <div className="pay-bonus-head">
                  <span>Списать бонусы</span>
                  <span className="muted">макс. {Math.floor(maxBonus).toLocaleString('ru-RU')} ⭐</span>
                </div>
                <div className="pay-bonus-quick">
                  <button type="button" className={usedBonus <= 0 ? 'on' : ''} onClick={() => applyPayBonus(0)}>Без</button>
                  <button
                    type="button"
                    className={usedBonus > 0 && usedBonus === Math.floor(maxBonus / 2) ? 'on' : ''}
                    onClick={() => applyPayBonus(Math.floor(maxBonus / 2))}
                  >
                    ½
                  </button>
                  <button
                    type="button"
                    className={usedBonus > 0 && usedBonus === Math.floor(maxBonus) ? 'on' : ''}
                    onClick={() => applyPayBonus(Math.floor(maxBonus))}
                  >
                    Все
                  </button>
                </div>
                <input
                  type="range"
                  className="pay-bonus-range"
                  min={0}
                  max={Math.floor(maxBonus)}
                  step={1}
                  value={Math.floor(usedBonus)}
                  onChange={e => applyPayBonus(Number(e.target.value) || 0)}
                />
                <div className="pay-bonus-val">Списываем: <b>{Math.floor(usedBonus).toLocaleString('ru-RU')} ⭐</b></div>
              </div>
            )}

            <div className="pay-grid pay-grid-3">
              <button type="button" className="pay-btn pay-cash" onClick={() => choosePayMethod('cash')} disabled={busy || total <= 0.001}>
                <span className="ic">💵</span>Наличные
              </button>
              <button type="button" className="pay-btn pay-card" onClick={() => choosePayMethod('card')} disabled={busy || total <= 0.001}>
                <span className="ic">💳</span>Карта
              </button>
              <button type="button" className="pay-btn pay-credit" onClick={() => choosePayMethod('credit')} disabled={busy || total <= 0.001}>
                <span className="ic">📝</span>В долг
              </button>
            </div>

            {client && loyalty && afterDisc > 0 && Math.floor(maxBonus) >= Math.floor(afterDisc) && (
              <button
                type="button"
                className="pay-btn pay-balance pay-balance-full"
                disabled={busy}
                onClick={() => choosePayMethod('balance')}
              >
                <span className="ic">⭐</span>
                Оплатить всё бонусами ({Math.floor(afterDisc).toLocaleString('ru-RU')} ⭐)
              </button>
            )}

            {total <= 0.001 && usedBonus > 0 && (
              <button
                type="button"
                className="btn-confirm"
                style={{ width: '100%', marginBottom: 10 }}
                disabled={busy}
                onClick={() => { setPayPickOpen(false); void submitSale(0, 'balance') }}
              >
                Подтвердить · оплачено бонусами
              </button>
            )}

            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" disabled={busy} onClick={() => { setPayPickOpen(false); setBonusUsed(0); setPayDebtOn(false) }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {creditNoteOpen && creditPending && (
        <div
          className="overlay"
          onClick={() => {
            if (busy) return
            setCreditNoteOpen(false)
            setCreditPending(null)
            setCreditNoteBuf('')
          }}
        >
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>📝 В долг</h3>
            {client && (
              <div className="pay-client-strip">
                <div>
                  <b>{client.name}</b>
                  <span>{client.card || client.phone || 'без карты'}</span>
                </div>
              </div>
            )}
            <div className="pay-breakdown" style={{ marginBottom: 12 }}>
              <div className="due">
                <span>В долг</span>
                <b className="bank-fig sum">
                  {(
                    creditPending.method === 'credit'
                      ? total
                      : Math.max(0, Number(creditPending.debtAmt) || 0)
                  ).toFixed(2)} сом
                </b>
              </div>
              {(Number(creditPending.paidCash) > 0.001 || Number(creditPending.paidCard) > 0.001) && (
                <div>
                  <span>Уже оплачено</span>
                  <b className="bank-fig">
                    {(Number(creditPending.paidCash) + Number(creditPending.paidCard || 0)).toFixed(2)}
                  </b>
                </div>
              )}
            </div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--t2)', fontWeight: 700, marginBottom: 6 }}>
              Заметка
            </label>
            <textarea
              value={creditNoteBuf}
              onChange={e => setCreditNoteBuf(e.target.value.slice(0, 200))}
              placeholder="Например: обещал завтра, знакомый, на свадьбу…"
              rows={3}
              autoFocus
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 72,
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                color: 'var(--t1)',
                padding: '10px 12px',
                fontSize: 14,
                outline: 'none',
                marginBottom: 14,
              }}
            />
            {msg && <div className="pos-err">{msg}</div>}
            <div className="modal-card-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => {
                  const pending = creditPending
                  setCreditNoteOpen(false)
                  setCreditPending(null)
                  setCreditNoteBuf('')
                  if (pending.method === 'credit') setPayPickOpen(true)
                  else if (Number(pending.paidCard) > 0.001) setSplitCardOpen(true)
                  else setCashOpen(true)
                }}
              >
                Назад
              </button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy}
                onClick={() => void confirmCreditNote()}
              >
                {busy ? 'Проводим…' : 'В долг'}
              </button>
            </div>
          </div>
        </div>
      )}

      {printAskSale && (
        <div className="overlay">
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>Чек проведён</h3>
            <div className="pay-breakdown" style={{ marginBottom: 14 }}>
              <div><span>Номер</span><b className="bank-fig">{saleNumberLabel(printAskSale)}</b></div>
              <div className="due">
                <span>Сумма</span>
                <b className="bank-fig sum">{fmtMoney(Number(printAskSale.total) || 0)}</b>
              </div>
              {printAskSale.clientName && (
                <div><span>Клиент</span><b>{printAskSale.clientName}</b></div>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 14, textAlign: 'center' }}>
              Печатать чек?
            </div>
            <div className="modal-card-actions" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => finishSalePrintChoice(false)}
              >
                Нет
              </button>
              <button
                type="button"
                className="btn-confirm"
                onClick={() => finishSalePrintChoice(true)}
              >
                🖨 Печатать
              </button>
            </div>
          </div>
        </div>
      )}

      {clientScanOpen && (
        <div className="overlay" onClick={() => setClientScanOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>QR клиента</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12, lineHeight: 1.4 }}>
              Наведите сканер на QR из профиля клиента — карта подставится автоматически
            </div>
            <div className="pos-search">
              <span className="ic"><QrIcon size={15} /></span>
              <input
                ref={clientScanRef}
                value={clientScanBuf}
                autoFocus
                placeholder="Сканируйте QR или введите номер карты…"
                onChange={e => setClientScanBuf(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const raw = clientScanBuf.trim()
                  if (!raw) return
                  if (!applyClientScan(raw)) setClientScanBuf('')
                }}
              />
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setClientScanOpen(false)}>Отмена</button>
              <button
                type="button"
                className="btn-confirm"
                disabled={!clientScanBuf.trim()}
                onClick={() => applyClientScan(clientScanBuf)}
              >
                Найти
              </button>
            </div>
          </div>
        </div>
      )}

      {clientOpen && (
        <div className="overlay" onClick={() => setClientOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>👤 Выбор клиента</h3>
            <div className="pos-search">
              <span className="ic">🔍</span>
              <input
                ref={clientSearchRef}
                value={clientQ}
                onChange={e => setClientQ(e.target.value)}
                placeholder="Телефон, карта, QR или имя…"
                autoFocus
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const raw = clientQ.trim()
                  if (!raw) return
                  if (applyClientScan(raw)) return
                  if (clientHits.length === 1) {
                    setClient(clientHits[0])
                    setBonusUsed(0)
                    setClientOpen(false)
                    showToast('Клиент выбран', clientHits[0].name)
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="client-scan-link"
              onClick={() => {
                setClientOpen(false)
                setClientScanBuf('')
                setClientScanOpen(true)
              }}
            >
              <QrIcon size={16} />
              <span>Сканировать QR клиента</span>
            </button>
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

      {discPickOpen && (
        <div className="overlay" onClick={() => setDiscPickOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>🏷 Скидка на товар</h3>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>Выберите позицию в чеке</div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
              {cart.filter(l => l.key !== qtyEditDraftKey).map(line => (
                <button
                  key={line.key}
                  type="button"
                  className="client-result"
                  onClick={() => openLineDiscount(line.key)}
                >
                  <div className="av">{line.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <b style={{ fontSize: 12.5, display: 'block' }}>{line.name}</b>
                    <span style={{ fontSize: 10, color: 'var(--t2)' }}>
                      {lineNet(line).toFixed(2)} ЅМ
                      {(Number(line.discPct) || 0) > 0 ? ` · уже −${line.discPct}%` : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setDiscPickOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {discOpen && (
        <div className="overlay" onClick={() => setDiscOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{discMode === 'line' ? '🏷 Скидка на товар' : '🏷 Скидка на всё'}</h3>
            {discMode === 'line' && discLineKey && (
              <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12 }}>
                {cart.find(l => l.key === discLineKey)?.name || 'Товар'}
              </div>
            )}
            {discMode === 'all' && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                На весь чек{levelDiscPct > 0 ? ` · уже +${levelDiscPct}% статус` : ''}
              </div>
            )}
            <div className="kp-display">
              <div className="lbl">СКИДКА, %</div>
              <input
                ref={amountInputRef}
                className="kp-field"
                value={discBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setDiscBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0"
              />
            </div>
            <div className="qty-edit-toolbar">
              <div className="kp-quick" style={{ margin: 0, flex: 1 }}>
                {[0, 5, 10, 15, 20].map(v => <button key={v} type="button" onClick={() => setDiscBuf(String(v))}>{v}%</button>)}
              </div>
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
                title={amountPad ? 'Скрыть клавиатуру' : 'Экранная клавиатура'}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            {amountPad && (
              <Keypad onDigit={k => setDiscBuf(b => appendDigit(b, k, 3))} onBack={() => setDiscBuf(b => b.slice(0, -1))} />
            )}
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setDiscOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" onClick={applyDiscount}>Применить</button>
            </div>
          </div>
        </div>
      )}

      {cashOpen && (
        <div className="overlay" onClick={() => !busy && setCashOpen(false)}>
          <div
            className={`cash-checkout-shell ${amountPad ? 'with-pad' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-card cash-checkout-card">
              <div className="cash-head">
                <h3>Наличные</h3>
                {client && (
                  <div className="cash-head-client">
                    {client.name}
                    {usedBonus > 0 ? ` · −${Math.floor(usedBonus)} ⭐` : ''}
                  </div>
                )}
              </div>

              <div className="cash-due-pill">
                <span>К оплате{payDebtAmt > 0.001 ? ' (чек + долг)' : ''}</span>
                <b>{collectTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} сом</b>
              </div>
              {payDebtAmt > 0.001 && (
                <div className="cash-debt-split">
                  Чек {total.toFixed(2)} · долг <span>{payDebtAmt.toFixed(2)}</span>
                </div>
              )}

              <div className={`cash-change-hero ${cashChange < -0.001 ? 'short' : cashReceived > 0.001 ? 'ok' : 'idle'}`}>
                <div className="cash-change-lbl">
                  {cashChange < -0.001 ? 'Остаток' : 'Сдача'}
                </div>
                <div className="cash-change-val">
                  {Math.abs(cashChange).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span>сом</span>
                </div>
                {cashChange < -0.001 && cashReceived > 0.001 && (
                  <div className="cash-change-bonus">Ниже: Карта или Долг</div>
                )}
                {client?.card && cashSaleBonus > 0 && cashChange >= -0.001 && (
                  <div className="cash-change-bonus">На карту +{cashSaleBonus} ⭐{cashSaleTier ? ` · ${cashDepositTierLabel(cashSaleTier)}` : ''}</div>
                )}
              </div>

              <div className="cash-recv">
                <div className="lbl">Получено от клиента</div>
                <input
                  ref={amountInputRef}
                  className="cash-recv-field"
                  value={cashBuf}
                  inputMode="decimal"
                  autoFocus
                  onChange={e => setCashBuf(sanitizeDecimalInput(e.target.value))}
                  onFocus={e => e.currentTarget.select()}
                  placeholder="0"
                />
              </div>

              <div className="cash-bills">
                <button type="button" className="cash-bill exact" onClick={() => setCashBuf(String(Math.round(collectTotal * 100) / 100))}>
                  Без сдачи
                </button>
                {[10, 20, 50, 100, 200, 500].map(v => (
                  <button
                    key={v}
                    type="button"
                    className={cashReceived === v ? 'on' : ''}
                    onClick={() => setCashBuf(String(v))}
                  >
                    {v}
                  </button>
                ))}
                {cashShort && (
                  <>
                    <button type="button" className="cash-bill alt card" onClick={openCashSplitCard}>
                      Карта
                    </button>
                    <button type="button" className="cash-bill alt debt" onClick={payCashRestAsDebt}>
                      Долг
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                className={`cash-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
              >
                ⌨ {amountPad ? 'Скрыть клавиатуру' : 'Клавиатура'}
              </button>

              {msg && <div className="pos-err">{msg}</div>}
              <div className="modal-card-actions cash-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  disabled={busy}
                  onClick={() => { setCashOpen(false); setPayPickOpen(true) }}
                >
                  Назад
                </button>
                <button
                  type="button"
                  className="btn-confirm cash-accept"
                  disabled={busy || cashReceived < collectTotal - 0.001}
                  onClick={() => {
                    void submitSale(cashReceived)
                  }}
                >
                  Принять
                </button>
              </div>
            </div>

            {amountPad && (
              <div className="cash-pad-side">
                <div className="cash-pad-side-title">Клавиатура</div>
                <Keypad onDigit={k => setCashBuf(b => appendDigit(b, k))} onBack={() => setCashBuf(b => b.slice(0, -1))} />
                <button type="button" className="cash-pad-side-hide" onClick={() => setAmountPad(false)}>
                  Скрыть
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {splitCardOpen && (
        <div className="overlay" onClick={() => !busy && setSplitCardOpen(false)}>
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>💳 Карта · остаток</h3>
            <div className="pay-breakdown" style={{ marginBottom: 12 }}>
              <div><span>Наличными</span><b className="bank-fig">{cashReceived.toFixed(2)}</b></div>
              <div className="due">
                <span>Остаток</span>
                <b className="bank-fig sum">{cashRemain.toFixed(2)} сом</b>
              </div>
            </div>

            <div className="mix-row mix-card-row">
              <div className="mix-row-head">
                <span>Списать с карты</span>
                <button type="button" className="mix-auto" style={{ border: 'none', background: 'transparent', cursor: 'pointer' }} onClick={() => setSplitCardBuf(cashRemain.toFixed(2))}>
                  всё {cashRemain.toFixed(2)}
                </button>
              </div>
              <input
                ref={amountInputRef}
                className="mix-field"
                value={splitCardBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setSplitCardBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0.00"
              />
            </div>

            {splitDebtRemain > 0.001 && splitCardAmt > 0.001 && (
              <div className="cash-change-warn" style={{ textAlign: 'left', margin: '8px 0' }}>
                Ещё останется {splitDebtRemain.toFixed(2)} сом — можно в долг
              </div>
            )}

            <div className="qty-edit-toolbar" style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                style={{ width: '100%' }}
                onClick={() => setAmountPad(v => !v)}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            {amountPad && (
              <Keypad onDigit={k => setSplitCardBuf(b => appendDigit(b, k))} onBack={() => setSplitCardBuf(b => b.slice(0, -1))} />
            )}

            {msg && <div className="pos-err">{msg}</div>}
            <div className="modal-card-actions" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => { setSplitCardOpen(false); setAmountPad(false) }}
              >
                Назад
              </button>
              {splitCardAmt > 0.001 && splitDebtRemain <= 0.001 ? (
                <button
                  type="button"
                  className="btn-confirm"
                  disabled={busy}
                  onClick={() => void submitSale(cashReceived, 'mixed', undefined, splitCardAmt, 0)}
                >
                  Подтвердить · карта {splitCardAmt.toFixed(2)}
                </button>
              ) : splitCardAmt > 0.001 && splitDebtRemain > 0.001 ? (
                <button
                  type="button"
                  className="btn-confirm"
                  style={{ background: 'var(--org)' }}
                  disabled={busy}
                  onClick={() => {
                    if (!client) {
                      setSplitCardOpen(false)
                      setCashOpen(false)
                      setClientOpen(true)
                      showToast('Выберите клиента', 'Чтобы записать остаток в долг')
                      return
                    }
                    openCreditNote({
                      paidCash: cashReceived,
                      method: 'mixed',
                      paidCard: splitCardAmt,
                      debtAmt: splitDebtRemain,
                    })
                  }}
                >
                  Долг {splitDebtRemain.toFixed(2)}
                </button>
              ) : (
                <button type="button" className="btn-confirm" disabled>
                  Укажите сумму карты
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {layerPickOpen && layerPickProduct && (
        <div className="overlay" onClick={() => !layerPickBusy && setLayerPickOpen(false)}>
          <div className="modal-card layer-pick-card" onClick={e => e.stopPropagation()}>
            <h3>Выберите партию</h3>
            <div className="layer-pick-hint">
              <b>{layerPickProduct.name}</b>
              <span>Несколько приходов с разными ценами — укажите, с какой партии продавать</span>
            </div>
            <div className="layer-pick-list">
              {layerPickLayers.map(layer => {
                const retail = Number(layer.retailPrice) || Number(layerPickProduct.price) || 0
                const cost = Number(layer.costPrice) || 0
                const rem = Number(layer.remainingQty) || 0
                const when = layer.createdAtIso
                  ? new Date(layer.createdAtIso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  : '—'
                return (
                  <button
                    key={layer.receiptId}
                    type="button"
                    className={`layer-pick-item ${layer.isActive ? 'active' : ''}`}
                    disabled={layerPickBusy || rem <= 0}
                    onClick={() => pickStockLayer(layer)}
                  >
                    <div className="lpi-top">
                      <span className="lpi-price">{retail.toFixed(2)} ЅМ</span>
                      {layer.isActive ? <span className="lpi-badge">FIFO</span> : null}
                    </div>
                    <div className="lpi-row">
                      <span>Закуп</span>
                      <b>{cost.toFixed(2)} ЅМ</b>
                    </div>
                    <div className="lpi-row">
                      <span>Остаток партии</span>
                      <b>{rem} {displaySellUnit(layerPickProduct)}</b>
                    </div>
                    <div className="lpi-row muted">
                      <span>{when}{layer.supplierName ? ` · ${layer.supplierName}` : ''}</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setLayerPickOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {tillMoveKind && activeShift && (
        <div className="overlay" onClick={() => !busy && setTillMoveKind(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{tillMoveKind === 'in' ? '⬇️ Внести в кассу' : '⬆️ Снять из кассы'}</h3>
            <div className="till-expected">
              Сейчас ожидается в кассе: <b>{fmtMoney(tillExpected)}</b>
              {tillMoveKind === 'out' ? (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>
                  Снятие списывается с кассы. Можно выбрать поставщика — долг уменьшится.
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>
                  Внесение увеличит ожидаемый остаток наличных в смене.
                </div>
              )}
            </div>

            {tillMoveKind === 'out' && (
              <>
                <div className="gate-label">Поставщик (необязательно)</div>
                <div className="till-supplier-grid">
                  <button
                    type="button"
                    className={`till-supplier-opt ${!tillSupplierId ? 'on' : ''}`}
                    onClick={() => setTillSupplierId('')}
                  >
                    <span>Без поставщика · просто снятие</span>
                  </button>
                  {tillSuppliers.slice(0, 12).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      className={`till-supplier-opt ${tillSupplierId === s.id ? 'on' : ''}`}
                      onClick={() => {
                        setTillSupplierId(s.id)
                        const debt = Number(s.payableAmount) || 0
                        if (debt > 0 && !tillAmountBuf) setTillAmountBuf(debt.toFixed(2))
                      }}
                    >
                      <span>{s.name}</span>
                      <span>{(Number(s.payableAmount) || 0) > 0 ? fmtMoney(s.payableAmount) : '—'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="kp-display">
              <div className="lbl">СУММА</div>
              <input
                ref={amountInputRef}
                className="kp-field"
                value={tillAmountBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setTillAmountBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0.00"
              />
            </div>
            <div className="kp-quick" style={{ marginBottom: 10 }}>
              {(tillMoveKind === 'out'
                ? [50, 100, 200, tillExpected].filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                : [50, 100, 200, 500]
              ).map(v => (
                <button key={v} type="button" onClick={() => setTillAmountBuf(Number(v).toFixed(2))}>
                  {v === tillExpected ? 'Всё' : String(v)}
                </button>
              ))}
            </div>
            <label className="gate-label">Заметка</label>
            <input
              className="gate-input"
              value={tillNote}
              onChange={e => setTillNote(e.target.value)}
              placeholder={tillMoveKind === 'out' ? 'За что / кому…' : 'Откуда деньги…'}
            />
            <div className="amount-pad-row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            {amountPad && (
              <Keypad onDigit={k => setTillAmountBuf(b => appendDigit(b, k))} onBack={() => setTillAmountBuf(b => b.slice(0, -1))} />
            )}
            {msg && <div className="pos-err">{msg}</div>}
            <div className="modal-card-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => { setTillMoveKind(null); setAmountPad(false); setMsg('') }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy}
                onClick={() => void submitTillMove()}
              >
                {busy ? 'Сохраняем…' : tillMoveKind === 'in' ? 'Внести' : 'Снять'}
              </button>
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
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>На баланс: вся сумма + % бонус по порогам</div>
            </div>
            <div className="kp-display">
              <div className="lbl">СУММА ПОПОЛНЕНИЯ</div>
              <input
                ref={amountInputRef}
                className="kp-field"
                value={topupBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setTopupBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0.00"
              />
            </div>
            <div className="amount-pad-row">
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
                title={amountPad ? 'Скрыть клавиатуру' : 'Экранная клавиатура'}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            {amountPad && (
              <Keypad onDigit={k => setTopupBuf(b => appendDigit(b, k))} onBack={() => setTopupBuf(b => b.slice(0, -1))} />
            )}
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Внесено</span><b className="mono">{topupCash.toFixed(2)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Сумма на баланс</span><b className="mono">+{topupPrincipal.toLocaleString('ru-RU')} ⭐</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)' }}><span>Бонус %</span><b className="mono">+{topupPercentBonus.toLocaleString('ru-RU')} ⭐</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', color: 'var(--gd)' }}>
                <span>Итого на карту</span><b className="mono">+{topupCredit.toLocaleString('ru-RU')} ⭐</b>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 8 }}>
                {topupTier ? cashDepositTierLabel(topupTier) : 'Ниже порога — только сумма без % бонуса'}
              </div>
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setTopupOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={busy || topupCredit <= 0} onClick={() => void submitTopup()}>Пополнить</button>
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
              <input
                ref={amountInputRef}
                className="kp-field"
                value={repayBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setRepayBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0.00"
              />
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Останется долг</span>
                <b className="mono" style={{ color: repayRemain > 0 ? 'var(--org)' : 'var(--gd)' }}>{repayRemain.toFixed(2)}</b>
              </div>
            </div>
            <div className="qty-edit-toolbar">
              <div className="kp-quick" style={{ margin: 0, flex: 1 }}>
                {clientDebt > 0 && <button type="button" onClick={() => setRepayBuf(String(clientDebt))}>Весь долг</button>}
              </div>
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
                title={amountPad ? 'Скрыть клавиатуру' : 'Экранная клавиатура'}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            <div className="repay-methods">
              <button type="button" className={`repay-m ${repayMethod === 'cash' ? 'on' : ''}`} onClick={() => setRepayMethod('cash')}>💵 Наличные</button>
              <button type="button" className={`repay-m ${repayMethod === 'card' ? 'on' : ''}`} onClick={() => setRepayMethod('card')}>💳 Карта</button>
            </div>
            {repayMethod === 'cash' && (
              <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12, textAlign: 'center' }}>
                {repayCashBonus > 0 ? (
                  <>За наличные на карту <b style={{ color: 'var(--gd)' }}>+{repayCashBonus} ⭐</b>
                    {repayCashTier ? ` · ${cashDepositTierLabel(repayCashTier)}` : ''}</>
                ) : (
                  <>Бонус по порогам наличных (если сумма ниже порога — 0)</>
                )}
              </div>
            )}
            {amountPad && (
              <Keypad onDigit={k => setRepayBuf(b => appendDigit(b, k))} onBack={() => setRepayBuf(b => b.slice(0, -1))} />
            )}
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

      {histOpen && client && loyalty && (
        <div className="overlay" onClick={() => setHistOpen(false)}>
          <div className="modal-card hist-card" onClick={e => e.stopPropagation()}>
            {histView === 'profile' ? (
              <>
                <h3>👤 {client.name}</h3>
                <div className="client-profile-meta">
                  <span>{client.phone || 'без телефона'}</span>
                  <span>·</span>
                  <span>{client.card || 'без карты'}</span>
                  <span>·</span>
                  <span style={{ color: CLIENT_LEVEL_COLORS[loyalty.level] }}>{levelLabel(loyalty.level)}</span>
                </div>

                <div className="client-kpis">
                  <div className="client-kpi">
                    <div className="l">Баланс (бонусы)</div>
                    <div className="v" style={{ color: 'var(--gd)' }}>⭐ {clientProfileStats.bonus}</div>
                  </div>
                  <div className="client-kpi">
                    <div className="l">Долг сейчас</div>
                    <div className="v" style={{ color: clientDebt > 0 ? 'var(--org)' : 'var(--t2)' }}>{fmtMoney(clientDebt)}</div>
                  </div>
                  <div className="client-kpi">
                    <div className="l">Лимит / доступно</div>
                    <div className="v">{debtLimit > 0 ? fmtMoney(availableDebt) : '—'}</div>
                  </div>
                  <div className="client-kpi">
                    <div className="l">Погашено долга</div>
                    <div className="v" style={{ color: 'var(--blue)' }}>{fmtMoney(clientProfileStats.repaid)}</div>
                  </div>
                  <div className="client-kpi">
                    <div className="l">Чеков в долг</div>
                    <div className="v">{clientProfileStats.creditSales}</div>
                  </div>
                </div>

                <div className="client-profile-actions three">
                  <button
                    type="button"
                    className="action-chip ac-repay"
                    onClick={() => {
                      setHistOpen(false)
                      if (clientDebt <= 0) { showToast('Нет долга', 'У клиента нет задолженности'); return }
                      setRepayBuf('')
                      setRepayMethod('cash')
                      setAmountPad(false)
                      setRepayOpen(true)
                    }}
                  >
                    <span className="ic-wrap">💳</span><span>Погасить</span>
                  </button>
                  <button
                    type="button"
                    className="action-chip ac-topup"
                    onClick={() => {
                      setHistOpen(false)
                      setTopupBuf('')
                      setAmountPad(false)
                      setTopupOpen(true)
                    }}
                  >
                    <span className="ic-wrap">💰</span><span>Пополнить</span>
                  </button>
                  <button
                    type="button"
                    className="action-chip ac-hist"
                    onClick={() => {
                      setHistTab(histActiveDebts.length ? 'debts' : 'checks')
                      setHistView('history')
                      setHistDetail(null)
                    }}
                  >
                    <span className="ic-wrap">📋</span><span>История</span>
                  </button>
                </div>

                <div className="hist-section">
                  <div className="hist-section-h">Активные долги</div>
                  <div className="hist-scroll profile">
                    {!histOpenDebts.length && <div className="hist-empty">Нет непогашенных долгов</div>}
                    <div className="hist-list compact">
                      {histOpenDebts.map(row => renderHistRow(row, { compact: true }))}
                    </div>
                    {histDebtsCount > 0 && (
                      <button type="button" className="hist-more" onClick={() => { setHistTab('debts'); setHistView('history') }}>
                        Вся история долгов ({histDebtsCount}) →
                      </button>
                    )}
                  </div>
                </div>

                <div className="modal-card-actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => {
                      setHistOpen(false)
                      setClientQ('')
                      setClientPick(client)
                      setClientOpen(true)
                    }}
                  >
                    Сменить
                  </button>
                  <button type="button" className="btn-confirm" onClick={() => setHistOpen(false)}>Закрыть</button>
                </div>
              </>
            ) : (
              <>
                <div className="hist-detail-head">
                  <button type="button" className="hist-back" onClick={() => setHistView('profile')}>← Назад</button>
                  <h3>История</h3>
                </div>

                <div className="hist-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={histTab === 'checks'}
                    className={`hist-tab ${histTab === 'checks' ? 'on' : ''}`}
                    onClick={() => setHistTab('checks')}
                  >
                    Чеки
                    <span className="n">{histChecks.length + histTopups.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={histTab === 'debts'}
                    className={`hist-tab ${histTab === 'debts' ? 'on' : ''}`}
                    onClick={() => setHistTab('debts')}
                  >
                    Долги
                    <span className="n">{histDebtsCount}</span>
                  </button>
                </div>

                <div className="hist-scroll">
                  {histTab === 'checks' && (
                    <>
                      {!histChecks.length && !histTopups.length && (
                        <div className="hist-empty">Покупок пока нет</div>
                      )}
                      {histChecks.length > 0 && (
                        <div className="hist-section">
                          <div className="hist-section-h">Оплаченные чеки</div>
                          <div className="hist-list compact">
                            {histChecks.map(row => renderHistRow(row))}
                          </div>
                        </div>
                      )}
                      {histTopups.length > 0 && (
                        <div className="hist-section">
                          <div className="hist-section-h">Пополнения</div>
                          <div className="hist-list compact">
                            {histTopups.map(row => renderHistRow(row))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {histTab === 'debts' && (
                    <>
                      {!histDebtOrders.length && !histRepays.length && (
                        <div className="hist-empty">Долгов и погашений нет</div>
                      )}
                      {histActiveDebts.length > 0 && (
                        <div className="hist-section">
                          <div className="hist-section-h">Активные (не погашены)</div>
                          <div className="hist-list compact">
                            {histActiveDebts.map(row => renderHistRow(row))}
                          </div>
                        </div>
                      )}
                      {histPaidDebts.length > 0 && (
                        <div className="hist-section">
                          <div className="hist-section-h">Погашенные заказы</div>
                          <div className="hist-list compact">
                            {histPaidDebts.map(row => renderHistRow(row))}
                          </div>
                        </div>
                      )}
                      {histRepays.length > 0 && (
                        <div className="hist-section">
                          <div className="hist-section-h">Платежи погашения</div>
                          <div className="hist-list compact">
                            {histRepays.map(row => renderHistRow(row))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="modal-card-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn-cancel" onClick={() => setHistView('profile')}>К профилю</button>
                  <button type="button" className="btn-confirm" onClick={() => setHistOpen(false)}>Закрыть</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {histDetail && (
        <div className="overlay hist-detail-overlay" onClick={() => setHistDetail(null)}>
          <div className="modal-card hist-detail-card" onClick={e => e.stopPropagation()}>
            <div className="hist-detail-head">
              <button type="button" className="hist-back" onClick={() => setHistDetail(null)}>← Назад</button>
              <h3>Детали</h3>
            </div>
            <div className="hist-detail-body">
              <div className="hist-title-row" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>{histDetail.title}</b>
                {histDetail.debtStatus === 'paid' && <span className="hist-badge paid">Полностью</span>}
                {histDetail.debtStatus === 'partial' && <span className="hist-badge partial">Частично</span>}
                {histDetail.debtStatus === 'open' && <span className="hist-badge open">Открыт</span>}
              </div>
              <div className="hist-when" style={{ marginBottom: 6 }}>{histDetail.when}</div>
              <div className="hist-sub" style={{ marginBottom: 12 }}>{histDetail.sub}</div>
              <div className="hist-detail-sum">{fmtMoney(histDetail.amount)}</div>
              {histDetail.debtStatus === 'partial' && histDetail.debtRemain != null && (
                <div className="hist-remain" style={{ marginTop: 6 }}>К погашению: {fmtMoney(histDetail.debtRemain)}</div>
              )}
              {histDetail.debtPaid != null && histDetail.debtPaid > 0 && (
                <div className="hist-sub" style={{ marginTop: 4 }}>Уже оплачено: {fmtMoney(histDetail.debtPaid)}</div>
              )}
              {(() => {
                const detailLines = (histDetail.lines && histDetail.lines.length)
                  ? histDetail.lines
                  : parseItemsSummary(histDetail.items)
                if (!detailLines.length) return null
                return (
                  <div className="hist-detail-items">
                    <div className="hist-section-h">Состав</div>
                    <div className="hist-lines">
                      {detailLines.map((line, i) => {
                        const q = Number.isInteger(line.qty)
                          ? String(line.qty)
                          : String(Math.round(line.qty * 1000) / 1000)
                        return (
                          <div key={`${line.name}-${i}`} className="hist-line">
                            <div className="hist-line-main">
                              <b>{line.name}</b>
                              <span className="hist-line-qty">× {q}</span>
                            </div>
                            <div className="hist-line-sum">
                              {line.sum > 0 ? fmtMoney(line.sum) : (line.price > 0 ? fmtMoney(line.price * line.qty) : '—')}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
              {(histDetail.tone === 'credit' || histDetail.tone === 'debt') && histDetail.debtStatus !== 'paid' && (
                <button
                  type="button"
                  className="action-chip ac-repay"
                  style={{ width: '100%', marginTop: 16 }}
                  onClick={() => {
                    const remain = histDetail.debtRemain ?? histDetail.amount
                    setHistDetail(null)
                    setHistOpen(false)
                    if (clientDebt <= 0) { showToast('Нет долга', 'У клиента нет задолженности'); return }
                    setRepayBuf(String(Math.min(remain, clientDebt)))
                    setRepayMethod('cash')
                    setAmountPad(false)
                    setRepayOpen(true)
                  }}
                >
                  <span className="ic-wrap">💳</span><span>Погасить этот долг</span>
                </button>
              )}
            </div>
            <div className="modal-card-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn-confirm" onClick={() => setHistDetail(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {cashierScreen === 'receipts' && activeShift && (
        <div className="cashier-screen">
          <div className="cashier-screen-inner wide">
            <div className="cashier-screen-top">
              <button
                type="button"
                className="hist-back"
                disabled={busy}
                onClick={() => {
                  if (receiptDetail) {
                    setReceiptSaleId(null)
                    setReturnQtyByIdx({})
                    return
                  }
                  setCashierScreen(null)
                }}
              >
                ← Назад
              </button>
              <div>
                <h2>{receiptDetail ? 'Чек' : 'История чеков'}</h2>
                <p>{receiptDetail ? saleNumberLabel(receiptDetail) : `${receiptList.length} чеков`}</p>
              </div>
            </div>

            {!receiptDetail ? (
              <>
                <div className="pos-search" style={{ marginBottom: 12 }}>
                  <span className="ic">🔍</span>
                  <input
                    ref={receiptSearchRef}
                    value={receiptQ}
                    onChange={e => setReceiptQ(e.target.value)}
                    placeholder="Скан товара, K-4863, клиент…"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== 'Tab') return
                      e.preventDefault()
                      const raw = (e.currentTarget as HTMLInputElement).value.trim()
                      if (raw) setReceiptQ(raw)
                    }}
                  />
                </div>
                {receiptProductHint && (
                  <div className="receipt-product-hint">
                    Товар: <b>{receiptProductHint.name}</b>
                    <span> · найдено {receiptProductHint.count}</span>
                  </div>
                )}
                <div className="receipt-filters">
                  {([
                    ['all', 'Все'],
                    ['cash', 'Нал'],
                    ['card', 'Карта'],
                    ['credit', 'Долг'],
                    ['returned', 'Возврат'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`receipt-filter ${receiptFilter === id ? 'on' : ''}`}
                      onClick={() => setReceiptFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="receipt-list">
                  {!receiptList.length && <div className="hist-empty">Чеков не найдено</div>}
                  {receiptList.map(s => {
                    const fully = isSaleFullyReturned(s)
                    const partial = isSalePartiallyReturned(s)
                    const when = new Date(s.createdAtIso)
                    const payLabel = fully
                      ? 'Возврат'
                      : partial
                        ? 'Частичный возврат'
                        : s.paymentMethod === 'cash'
                          ? 'Наличные'
                          : s.paymentMethod === 'card'
                            ? 'Карта'
                            : s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0
                              ? 'В долг'
                              : 'Смешанная'
                    const itemsPreview = (s.items || []).slice(0, 3).map(i => i.productName).filter(Boolean).join(', ')
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`receipt-row ${fully ? 'returned' : partial ? 'partial' : ''}`}
                        onClick={() => { setReturnQtyByIdx({}); setReceiptSaleId(s.id) }}
                      >
                        <div className="receipt-row-main">
                          <div className="hist-title-row">
                            <span className="receipt-num">{saleNumberLabel(s)}</span>
                            <b>{payLabel}</b>
                            {fully && <span className="hist-badge open">Возвращён</span>}
                            {partial && <span className="hist-badge">Часть</span>}
                          </div>
                          <span className="hist-when">
                            {Number.isNaN(when.getTime())
                              ? s.createdAtIso
                              : `${when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
                            {s.clientName ? ` · ${s.clientName}` : ''}
                          </span>
                          {itemsPreview ? <span className="hist-items">{itemsPreview}{(s.items || []).length > 3 ? '…' : ''}</span> : null}
                        </div>
                        <div className="hist-amt-col">
                          <div className="hist-amt">{fmtMoney(s.total)}</div>
                          {(Number(s.cashReceived) || 0) > 0.001 && (
                            <div className="hist-cash-meta">
                              <span>дал {fmtMoney(Number(s.cashReceived))}</span>
                              {(Number(s.changeGiven) || 0) > 0.001 && (
                                <span className="hist-change">сдача {fmtMoney(Number(s.changeGiven))}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="receipt-detail">
                <div className="receipt-detail-meta">
                  <div><span>Оплата</span><b>
                    {isSaleFullyReturned(receiptDetail)
                      ? 'Возврат'
                      : isSalePartiallyReturned(receiptDetail)
                        ? 'Частичный возврат'
                        : receiptDetail.paymentMethod === 'cash'
                          ? 'Наличные'
                          : receiptDetail.paymentMethod === 'card'
                            ? 'Карта'
                            : receiptDetail.paymentMethod === 'credit' || (Number(receiptDetail.debtAdded) || 0) > 0
                              ? 'В долг'
                              : 'Смешанная'}
                  </b></div>
                  <div><span>Сумма</span><b className="sum">{fmtMoney(receiptDetail.total)}</b></div>
                  {(Number(receiptDetail.cashReceived) || 0) > 0.001 && (
                    <div><span>Дал клиент</span><b className="bank-fig">{fmtMoney(Number(receiptDetail.cashReceived))}</b></div>
                  )}
                  {(Number(receiptDetail.changeGiven) || 0) > 0.001 && (
                    <div><span>Сдача</span><b className="sum">{fmtMoney(Number(receiptDetail.changeGiven))}</b></div>
                  )}
                  <div><span>Клиент</span><b>{receiptDetail.clientName || 'Без клиента'}</b></div>
                  <div><span>Кассир</span><b>{receiptDetail.cashierName || settings.cashierName}</b></div>
                </div>
                <div className="hist-section-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span>Состав</span>
                  {!isSaleFullyReturned(receiptDetail) && (
                    <button
                      type="button"
                      className="receipt-select-all"
                      disabled={busy}
                      onClick={() => selectAllReturnLines(receiptDetail)}
                    >
                      Выбрать все
                    </button>
                  )}
                </div>
                {!isSaleFullyReturned(receiptDetail) && (
                  <div className="receipt-return-hint">Отметьте позиции для возврата (можно часть количества)</div>
                )}
                <div className="hist-lines">
                  {(receiptDetail.items || []).map((line, i) => {
                    const left = saleLineLeft(line)
                    const returnedQty = Number(line.returnedQty) || 0
                    const selectedQty = Number(returnQtyByIdx[i]) || 0
                    const on = selectedQty > 0
                    const unit = Number(line.qty) > 0
                      ? (Number(line.lineTotal) || 0) / Number(line.qty)
                      : Number(line.price) || 0
                    const showSum = left > 0 ? unit * left : Number(line.lineTotal) || 0
                    const canReturn = left > 0 && !isSaleFullyReturned(receiptDetail)
                    return (
                      <div
                        key={`${line.productId}-${i}`}
                        className={`hist-line receipt-line ${on ? 'on' : ''} ${left <= 0 ? 'returned' : ''}`}
                        role={canReturn ? 'button' : undefined}
                        tabIndex={canReturn ? 0 : undefined}
                        onClick={() => { if (canReturn) toggleReturnLine(i, left) }}
                        onKeyDown={e => {
                          if (!canReturn) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleReturnLine(i, left)
                          }
                        }}
                      >
                        {canReturn && (
                          <span className={`receipt-check ${on ? 'on' : ''}`} aria-hidden>{on ? '✓' : ''}</span>
                        )}
                        <div className="hist-line-main">
                          <b>{line.productName || `#${line.productId}`}</b>
                          <span className="hist-line-qty">
                            {left > 0 ? `× ${left}` : 'возвращено'}
                            {returnedQty > 0 && left > 0 ? ` · уже возврат ${returnedQty}` : ''}
                            {returnedQty > 0 && left <= 0 ? ` × ${line.qty}` : ''}
                          </span>
                          {on && left > 1 && (
                            <div
                              className="receipt-qty-ctrl"
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={busy || selectedQty <= 0.01}
                                onClick={() => setReturnLineQty(i, selectedQty - 1, left)}
                              >−</button>
                              <span>{selectedQty}</span>
                              <button
                                type="button"
                                disabled={busy || selectedQty >= left}
                                onClick={() => setReturnLineQty(i, selectedQty + 1, left)}
                              >+</button>
                            </div>
                          )}
                        </div>
                        <div className="hist-line-sum">{fmtMoney(showSum)}</div>
                      </div>
                    )
                  })}
                  {!(receiptDetail.items || []).length && <div className="hist-empty">Нет позиций</div>}
                </div>
                {msg && <div className="pos-err" style={{ marginTop: 12 }}>{msg}</div>}
                <div className="receipt-actions">
                  <button
                    type="button"
                    className="action-chip ac-topup"
                    disabled={
                      busy
                      || printingSaleId === String(
                        receiptDetail.id || receiptDetail.orderId || receiptDetail.number || 'sale',
                      )
                    }
                    onClick={() => void printSaleOnce(receiptDetail)}
                  >
                    <span className="ic-wrap">🖨</span>
                    <span>
                      {printingSaleId === String(
                        receiptDetail.id || receiptDetail.orderId || receiptDetail.number || 'sale',
                      )
                        ? 'Печатаем…'
                        : 'Печатать чек'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="action-chip ac-topup"
                    disabled={busy}
                    onClick={() => refillCartFromSale(receiptDetail)}
                  >
                    <span className="ic-wrap">🛒</span><span>В текущий чек</span>
                  </button>
                  {!isSaleFullyReturned(receiptDetail) && (
                    <>
                      <button
                        type="button"
                        className="action-chip ac-repay"
                        disabled={busy || receiptReturnPreview.count === 0}
                        onClick={() => void returnReceipt(receiptDetail.id, 'selected')}
                      >
                        <span className="ic-wrap">↩️</span>
                        <span>
                          {receiptReturnPreview.count > 0
                            ? `Вернуть выбранное · ${fmtMoney(receiptReturnPreview.total)}`
                            : 'Вернуть выбранное'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="action-chip ac-repay receipt-return-all"
                        disabled={busy}
                        onClick={() => void returnReceipt(receiptDetail.id, 'all')}
                      >
                        <span className="ic-wrap">↩️</span><span>Вернуть всё</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cashierScreen && cashierScreen !== 'receipts' && activeShift && (
        <div className="cashier-screen">
          <div className="cashier-screen-inner">
            <div className="cashier-screen-top">
              <button
                type="button"
                className="hist-back"
                disabled={busy}
                onClick={() => { if (!busy) { setCashierScreen(null); setMsg('') } }}
              >
                ← Назад
              </button>
              <div>
                <h2>{cashierScreen === 'close' ? 'Закрытие смены' : 'Сменить кассира'}</h2>
                <p>{settings.cashierName} · смена открыта</p>
              </div>
            </div>

            <div className="z-grid cashier-screen-grid">
              <div className="z-stat"><div className="l">Продаж</div><div className="v">{activeShift.salesCount}</div></div>
              <div className="z-stat"><div className="l">Старт кассы</div><div className="v" style={{ color: 'var(--gd)' }}>{fmtMoney(activeShift.openingCash)}</div></div>
              <div className="z-stat"><div className="l">Наличные</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtMoney(activeShift.salesCash)}</div></div>
              <div className="z-stat"><div className="l">Карта</div><div className="v" style={{ color: 'var(--blue)' }}>{fmtMoney(activeShift.salesCard)}</div></div>
              <div className="z-stat"><div className="l">В долг</div><div className="v" style={{ color: 'var(--org)' }}>{fmtMoney(activeShift.salesCredit)}</div></div>
              <div className="z-stat"><div className="l">Ожид. в кассе</div><div className="v">{fmtMoney(expectedTillCash(activeShift))}</div></div>
            </div>

            {cashierScreen === 'switch' && (
              <div className="cashier-switch-block">
                <div className="gate-label">Новый кассир</div>
                <div className="cashier-grid switch-grid">
                  {cashierOptions.slice(0, 9).map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className={`cashier-opt ${switchCashierId === c.id ? 'on' : ''}`}
                      onClick={() => setSwitchCashierId(c.id)}
                    >
                      <div className="av">{initialsOf(c.name)}</div>
                      <span>{c.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="gate-label">Наличные сейчас в кассе</label>
            <input
              className="gate-input"
              value={closingCash}
              onChange={e => setClosingCash(sanitizeDecimalInput(e.target.value))}
              inputMode="decimal"
              placeholder="0.00"
            />
            <div className="kp-quick" style={{ marginBottom: 16 }}>
              {[0, expectedTillCash(activeShift), 100, 500].filter((v, i, a) => a.indexOf(v) === i).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setClosingCash(v === 0 ? '0.00' : Number(v).toFixed(2))}
                >
                  {v === 0 ? '0' : v === expectedTillCash(activeShift) ? 'Ожид.' : String(v)}
                </button>
              ))}
            </div>
            {msg && <div className="pos-err">{msg}</div>}
            <div className="cashier-screen-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => { setCashierScreen(null); setMsg('') }}
              >
                Отмена
              </button>
              {cashierScreen === 'close' ? (
                <button type="button" className="btn-confirm" disabled={busy} onClick={() => void closeShift()}>
                  {busy ? 'Закрываем…' : 'Закрыть смену'}
                </button>
              ) : (
                <button type="button" className="btn-confirm" disabled={busy} onClick={() => void switchCashier()}>
                  {busy ? 'Меняем…' : 'Сменить и открыть'}
                </button>
              )}
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
