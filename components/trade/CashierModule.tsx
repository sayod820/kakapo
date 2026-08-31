'use client'

import { backdropCloseProps } from '@/components/shared/backdropClose'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { api } from '@/lib/api'
import { useOfflineSync } from '@/lib/offlineSync'
import OfflineQueuePanel from '@/components/trade/OfflineQueuePanel'
import { newClientRef, isOnline } from '@/lib/offline'
import { allocPosOpSeq, ensurePosOpSeqReady } from '@/lib/posOpSeq'
import { getBoundPosIdSync, getBoundDeviceNameSync, getTradeDeviceIdSync } from '@/lib/tradeDevice'
import { pushBackHandler } from '@/lib/hardwareBack'
import { loadPosSessionState, savePosSessionState } from '@/lib/offlineBootstrap'
import { loadTradeEmployeeSession } from '@/lib/employeeSession'
import {
  openShiftSafe,
  closeShiftSafe,
  financeMoveSafe,
  cardTopupSafe,
  debtRepaySafe,
  chargeCashDebtFromOpenShift,
  returnSaleSafe,
  createSaleSafe,
  previewReturnPayout,
  createPosPointSafe,
  updatePosPointSafe,
  deletePosPointSafe,
  ensureCashierSafe,
} from '@/lib/offlinePosOps'
import { provisionLoyaltyCardSafe } from '@/lib/offlineClientOps'
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
import { CARD_STATUS_LABELS, cardNumsMatch, effectiveDebt, type AdminCard } from '@/lib/cardCrm'
import { syncCardsFromApi, useCardStore } from '@/lib/cardStore'
import {
  buildDebtOrderBalances,
  buildSaleDebtStatuses,
  cashDebtOrderId,
  debtOrderIdsMatch,
  ensureDebtHistoryOrderId,
  isLedgerCashHistoryDebt,
  isManualDebtHistoryEntry,
  loadBalanceTopups,
  loadDebtHistory,
  loadDebtHistoryForClient,
  debtAccountKey,
  recordBalanceTopup,
  recordStoreDebtCharge,
  recordStoreDebtRepayment,
  recordStoreDebtRepaymentFifo,
  recordStorePurchase,
  saleOpenCreditAmount,
  saleWasOnCredit,
  subscribeBalanceTopup,
  subscribeDebtHistory,
  syncDebtHistoryFromLedger,
  topupBalanceCredit,
  type DebtHistoryEntry,
  type DebtOrderBalance,
} from '@/lib/clientVipCredit'
import {
  calcCashDepositBonus,
  cashDepositTierForAmount,
  cashDepositTierLabel,
  resolveEffectiveDebtLimit,
} from '@/lib/loyaltyStatusConfig'
import {
  previewPosStatusCashBonus,
  statusFieldsAfterPosCashPurchase,
  type PosLoyaltyClientMeta,
} from '@/lib/posLoyaltySale'
import { resolveCardAuthoritativeLevel } from '@/lib/loyaltyAdminLock'
import { filterProductsBySearch, findProductsByExactBarcode, pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'
import { resolveProductPhoto } from '@/lib/productPhotos'
import { isWeighted, unitPriceSuffix } from '@/lib/productWeight'
import { effectiveUnitPriceFrom, activeBulkTierForQty, type BulkPriceTier } from '@/lib/productBulkPricing'
import { findProductsForScaleBarcode, parseScaleBarcode } from '@/lib/scaleBarcode'
import { softSyncPosAfterSale, syncPosFromApi, usePosStore } from '@/lib/posStore'
import { getOfflineV2Mode, isTradeLocalFirst, setOfflineV2Mode } from '@/lib/offlineV2'
import { beginCashierCritical, endCashierCritical, isCashierPaymentCritical, noteCashierSearchActivity, clearCashierSearchActivity } from '@/lib/cashierUiGate'
import {
  printPosReceipt,
  buildDemoReceiptSale,
  buildPosReceiptHtml,
  formatSaleOrderNo,
  rememberReceiptPrinterName,
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
import { hideTradeHardwareUi, isTradeMobileUi } from '@/lib/tradeAndroid'
import { isLikelyReceiptPrinter, pickReceiptPrinter, sortReceiptPrinters, XP58C_RECEIPT_MM } from '@/lib/printerPresets'
import { useProducts, useOrders } from '@/lib/store'
import type { Category, PosSale, Product, ProductStockLayer } from '@/lib/types'
import {
  categorySlug,
  countProductsInCategory,
  getCategoryBySlug,
  productMatchesCategoryFilter,
  useCategories,
} from '@/lib/useCategories'
import { fmtMoney, liveProductStock, sanitizeDecimalInput } from './warehouse/warehouseShared'
import { POS_MOCK_CSS } from './posMockCss'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'

const SETTINGS_KEY = 'kakapo_trade_pos_settings'
const THEME_KEY = 'kakapo_trade_pos_theme'
const FAV_KEY = 'kakapo_pos_favorites'

type ThemeName = 'dark' | 'light'
type PayMethod = 'cash' | 'card' | 'credit' | 'balance' | 'wallet' | 'mixed'
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
  /** Партия прихода (если кассир выбрал вручную одну партию) */
  receiptId?: string
  /** Цена группы партий: списание FIFO только среди приходов с этой розничной ценой */
  preferRetailPrice?: number
  /** Розница без опта — база для пересчёта при смене qty */
  retailBase?: number
  /** Оптовые уровни с партии / карточки */
  bulkPricing?: BulkPriceTier[]
  costPrice?: number
  supplierName?: string
}

/** Меньше 0.5 г — считаем, что вес не задан */
const MIN_WEIGHT_KG = 0.0005

function isZeroWeightLine(l: CartLine) {
  return l.weightKg != null && !(l.weightKg > MIN_WEIGHT_KG)
}

/** Весовая позиция без веса в чеке не хранится */
function dropZeroWeightLines(lines: CartLine[]) {
  return lines.some(isZeroWeightLine) ? lines.filter(l => !isZeroWeightLine(l)) : lines
}

type PriceLayerGroup = {
  key: string
  retailPrice: number
  costPrice: number
  remainingQty: number
  layers: ProductStockLayer[]
  isFifo: boolean
  oldest: ProductStockLayer
  bulkPricing: BulkPriceTier[]
}

/** Цена продажи для чека: не подставляем закуп, если в карточке уже есть нормальная розница */
function resolveCartSellPrice(opts: {
  catalogPrice: number
  layerRetail?: number | null
  costPrice?: number | null
}): number {
  const catalog = Math.round((Number(opts.catalogPrice) || 0) * 100) / 100
  const layerRetail = Math.round((Number(opts.layerRetail) || 0) * 100) / 100
  const cost = Math.round((Number(opts.costPrice) || 0) * 100) / 100
  let price = layerRetail > 0 ? layerRetail : catalog
  // В партии ошибочно записали розницу = закуп, а в товаре цена выше → продаём по карточке
  if (cost > 0 && price > 0 && Math.abs(price - cost) < 0.021 && catalog > price + 0.021) {
    price = catalog
  }
  if (!(price > 0) && catalog > 0) price = catalog
  return price
}

function resolveLineBulkPricing(
  primary?: BulkPriceTier[] | null,
  fallback?: BulkPriceTier[] | null,
): BulkPriceTier[] | undefined {
  if (Array.isArray(primary) && primary.length) return primary
  if (Array.isArray(fallback) && fallback.length) return fallback
  return undefined
}

/** Розница + опт для строки чека (шт: qty; вес: граммы). */
function cartUnitPriceForQty(
  retailBase: number,
  bulkPricing: BulkPriceTier[] | undefined,
  qty: number,
  weightKg?: number,
): number {
  const bulkQty = weightKg != null ? Math.round(weightKg * 1000) : qty
  return effectiveUnitPriceFrom(retailBase, bulkPricing, bulkQty)
}

/** Партии с одной ценой продажи → один пункт; списание потом FIFO по дате внутри группы */
function groupStockLayersByRetail(layers: ProductStockLayer[], productPrice = 0): PriceLayerGroup[] {
  const map = new Map<string, ProductStockLayer[]>()
  for (const layer of layers) {
    const retail = Math.round((Number(layer.retailPrice) || productPrice || 0) * 100) / 100
    const k = retail.toFixed(2)
    const arr = map.get(k) || []
    arr.push(layer)
    map.set(k, arr)
  }
  const groups: PriceLayerGroup[] = []
  for (const [k, arr] of map) {
    const sorted = [...arr].sort((a, b) =>
      String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')),
    )
    const oldest = sorted[0]
    // Опт с FIFO-партии; если пусто — с любой партии группы, где уровни заданы
    const withBulk = sorted.find(l => Array.isArray(l.bulkPricing) && l.bulkPricing.length > 0)
    groups.push({
      key: k,
      retailPrice: Number(k),
      costPrice: Number(oldest.costPrice) || 0,
      remainingQty: Math.round(arr.reduce((s, l) => s + (Number(l.remainingQty) || 0), 0) * 1000) / 1000,
      layers: sorted,
      isFifo: arr.some(l => l.isActive),
      oldest,
      bulkPricing: (withBulk?.bulkPricing || oldest.bulkPricing || []) as BulkPriceTier[],
    })
  }
  groups.sort((a, b) => {
    if (a.isFifo !== b.isFifo) return a.isFifo ? -1 : 1
    return a.retailPrice - b.retailPrice
  })
  return groups
}

function buildPosLoyaltyMeta(client: AdminClient, cardList: AdminCard[]): PosLoyaltyClientMeta {
  const card = (client.card
    ? cardList.find(c => cardNumsMatch(c.num, client.card!) && c.status !== 'unlinked')
    : undefined)
    || cardList.find(c => c.clientId === client.id && c.status !== 'unlinked')
  return {
    id: client.id,
    phone: client.phone,
    level: resolveCardAuthoritativeLevel(card, client),
    vip: !!(card?.vip ?? client.vip),
    levelValidUntil: card?.levelValidUntil ?? client.levelValidUntil,
    bonusEligibleFrom: card?.bonusEligibleFrom ?? client.bonusEligibleFrom,
    levelAssignMode: card?.levelAssignMode ?? client.levelAssignMode,
    accountGeneration: client.accountGeneration,
  }
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
  unit?: string
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
  /** Привязка к чеку — погашение именно этой позиции */
  saleId?: string
  orderId?: string
  debtEntryId?: string
}

function mapSaleLines(
  items: { productName?: string; productId?: number; qty?: number; price?: number; lineTotal?: number; unit?: string }[] | undefined,
  products: { id: number; name: string; price?: number; unit?: string; sellType?: string }[],
): ClientHistLine[] {
  if (!items?.length) return []
  return items.map(i => {
    const fromCatalog = i.productId ? products.find(p => p.id === i.productId) : undefined
    const name = String(i.productName || fromCatalog?.name || '').trim() || (i.productId ? `#${i.productId}` : 'товар')
    const qty = Number(i.qty) || 0
    const price = Number(i.price) || Number(fromCatalog?.price) || 0
    const sum = Number(i.lineTotal) || Math.round(price * qty * 100) / 100
    const unitFromItem = String(i.unit || '').trim()
    const unitFromCat = fromCatalog
      ? (String(fromCatalog.sellType || '').toLowerCase() === 'weight'
        ? 'кг'
        : String(fromCatalog.unit || '').trim())
      : ''
    const unit = unitFromItem || unitFromCat || (Number.isInteger(qty) ? 'шт' : 'кг')
    return { name, qty, price, sum, unit }
  })
}

function linesLabel(lines: ClientHistLine[]): string {
  if (!lines.length) return ''
  const parts = lines.slice(0, 5).map(l => {
    const q = Number.isInteger(l.qty) ? String(l.qty) : String(Math.round(l.qty * 1000) / 1000)
    const u = String(l.unit || '').trim()
    return u ? `${l.name} ${q} ${u}` : `${l.name} ×${q}`
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

/** Единица в строке чека: для веса всегда кг */
function cartLineUnit(line: Pick<CartLine, 'unit' | 'weightKg'>): string {
  if (line.weightKg != null) return 'кг'
  const u = String(line.unit || '').trim()
  return u || 'шт'
}

/** Фасовка из карточки (400 мл / 500 гр), если это не сама единица продажи */
function cartLinePack(line: Pick<CartLine, 'unit' | 'weightKg'>, productUnit?: string): string | undefined {
  if (line.weightKg != null) return undefined
  const pack = String(productUnit || '').trim()
  if (!pack) return undefined
  const sell = cartLineUnit(line).toLowerCase().replace(/\s+/g, '')
  const norm = pack.toLowerCase().replace(/\s+/g, '')
  if (!norm || norm === sell) return undefined
  // «шт» продаём, а в карточке «400 мл» / «10 кг» — это объём упаковки
  if (sell === 'шт' || sell === 'pcs') return pack
  if (norm !== sell && /\d/.test(pack)) return pack
  return undefined
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
  return formatSaleOrderNo(s)
}

/** Единица остатка на плитке: вес → кг; штучный (в т.ч. мешок 10/25 кг) → шт */
function stockUnitLabel(p: Product): string {
  if (isWeighted(p)) return 'кг'
  const u = displaySellUnit(p).toLowerCase().replace(/\s+/g, '')
  // Жидкость без фасовки «N л» в unit
  if (u === 'л' || u === 'мл') return displaySellUnit(p)
  // «10кг» / «25 кг» — это размер упаковки в цене, на складе считаем мешки/штуки
  return 'шт'
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'K'
}

function fmtBonus(value: number | string | null | undefined) {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2)
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

function roundMoney2(n: number) {
  return Math.round(n * 100) / 100
}

type ShiftReconcileLine = { ok: boolean; text: string; diff: number }

function reconcileDiffLabel(diff: number): ShiftReconcileLine {
  if (Math.abs(diff) < 0.009) return { ok: true, text: 'Совпадает', diff: 0 }
  if (diff > 0) return { ok: false, text: `Излишек +${diff.toFixed(2)} сом`, diff }
  return { ok: false, text: `Недостача ${Math.abs(diff).toFixed(2)} сом`, diff }
}

/** Сверка нал+карта: минус/плюс, либо перемещение если суммы взаимно закрылись */
function analyzeShiftReconcile(
  cashStr: string,
  cardStr: string,
  expectedCash: number,
  expectedCard: number,
): {
  ready: boolean
  err?: string
  cash: ShiftReconcileLine
  card: ShiftReconcileLine
  cashActual: number
  cardActual: number
  expectedCash: number
  expectedCard: number
  /** Взаимный перенос нал↔карта без общей недостачи/излишка */
  move?: { amount: number; from: 'cash' | 'card'; to: 'cash' | 'card'; text: string }
  summary: { ok: boolean; text: string; detail: string }
} {
  if (cashStr.trim() === '' || cardStr.trim() === '') {
    return {
      ready: false,
      err: 'Укажите обе суммы',
      cash: { ok: false, text: 'Укажите сумму', diff: 0 },
      card: { ok: false, text: 'Укажите сумму', diff: 0 },
      cashActual: 0,
      cardActual: 0,
      expectedCash,
      expectedCard,
      summary: { ok: false, text: 'Укажите нал и карту', detail: '' },
    }
  }
  const cashActual = Number(cashStr)
  const cardActual = Number(cardStr)
  if (!Number.isFinite(cashActual) || cashActual < 0 || !Number.isFinite(cardActual) || cardActual < 0) {
    return {
      ready: false,
      err: 'Неверная сумма',
      cash: { ok: false, text: 'Неверная сумма', diff: 0 },
      card: { ok: false, text: 'Неверная сумма', diff: 0 },
      cashActual: 0,
      cardActual: 0,
      expectedCash,
      expectedCard,
      summary: { ok: false, text: 'Неверная сумма', detail: '' },
    }
  }
  const cashDiff = roundMoney2(cashActual - expectedCash)
  const cardDiff = roundMoney2(cardActual - expectedCard)
  const cashLine = reconcileDiffLabel(cashDiff)
  const cardLine = reconcileDiffLabel(cardDiff)

  const net = roundMoney2(cashDiff + cardDiff)
  const moved = Math.abs(cashDiff) >= 0.009 && Math.abs(cardDiff) >= 0.009 && Math.abs(net) < 0.009
    && Math.sign(cashDiff) !== Math.sign(cardDiff)

  if (moved) {
    const amount = roundMoney2(Math.abs(cashDiff))
    const from: 'cash' | 'card' = cashDiff < 0 ? 'cash' : 'card'
    const to: 'cash' | 'card' = from === 'cash' ? 'card' : 'cash'
    const text = from === 'cash'
      ? `Переместили ${amount.toFixed(2)} сом с наличных на карту`
      : `Переместили ${amount.toFixed(2)} сом с карты на наличные`
    return {
      ready: true,
      cash: cashLine,
      card: cardLine,
      cashActual,
      cardActual,
      expectedCash,
      expectedCard,
      move: { amount, from, to, text },
      summary: {
        ok: true,
        text,
        detail: 'Общая сумма совпала — это не недостача и не излишек',
      },
    }
  }

  if (Math.abs(cashDiff) < 0.009 && Math.abs(cardDiff) < 0.009) {
    return {
      ready: true,
      cash: cashLine,
      card: cardLine,
      cashActual,
      cardActual,
      expectedCash,
      expectedCard,
      summary: {
        ok: true,
        text: 'Всё совпало',
        detail: 'Нал и карта как по чекам',
      },
    }
  }

  const parts: string[] = []
  if (Math.abs(cashDiff) >= 0.009) parts.push(`Нал: ${cashLine.text}`)
  if (Math.abs(cardDiff) >= 0.009) parts.push(`Карта: ${cardLine.text}`)
  const netLabel = Math.abs(net) < 0.009
    ? 'По сумме всё ровно'
    : net > 0
      ? `Общий излишек +${net.toFixed(2)} сом`
      : `Общая недостача ${Math.abs(net).toFixed(2)} сом`
  return {
    ready: true,
    cash: cashLine,
    card: cardLine,
    cashActual,
    cardActual,
    expectedCash,
    expectedCard,
    summary: { ok: false, text: netLabel, detail: parts.join(' · ') },
  }
}

function ShiftReconcileReport({ a }: { a: ReturnType<typeof analyzeShiftReconcile> }) {
  if (!a.ready) return null
  return (
    <div className="shift-rec-box">
      <div className="shift-rec-cols">
        <div className="shift-rec-col">
          <div className="shift-rec-col-h">Должно быть</div>
          <div className="shift-rec-line"><span>Нал</span><b>{fmtMoney(a.expectedCash)}</b></div>
          <div className="shift-rec-line"><span>Карта</span><b>{fmtMoney(a.expectedCard)}</b></div>
        </div>
        <div className="shift-rec-arrow" aria-hidden>→</div>
        <div className="shift-rec-col">
          <div className="shift-rec-col-h">Вы посчитали</div>
          <div className="shift-rec-line"><span>Нал</span><b>{fmtMoney(a.cashActual)}</b></div>
          <div className="shift-rec-line"><span>Карта</span><b>{fmtMoney(a.cardActual)}</b></div>
        </div>
      </div>
      <div className="shift-rec-checks">
        <div className={`shift-rec-check ${a.cash.ok ? 'ok' : 'warn'}`}>
          <span>Нал</span>
          <b>{a.cash.text}</b>
        </div>
        <div className={`shift-rec-check ${a.card.ok ? 'ok' : 'warn'}`}>
          <span>Карта</span>
          <b>{a.card.text}</b>
        </div>
      </div>
      <div className={`shift-rec-total ${a.summary.ok ? 'ok' : 'warn'}`}>
        <b>{a.move ? a.move.text : a.summary.text}</b>
        {a.summary.detail ? <small>{a.summary.detail}</small> : null}
      </div>
    </div>
  )
}

function loadSettings(): PosSettings {
  const empName = (() => {
    try { return String(loadTradeEmployeeSession()?.name || '').trim() } catch { return '' }
  })()
  if (typeof window === 'undefined') {
    return { cashierId: '', cashierName: empName || 'Кассир', initials: initialsOf(empName || 'К') }
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return { cashierId: '', cashierName: empName || 'Кассир', initials: initialsOf(empName || 'К') }
    }
    const p = JSON.parse(raw) as PosSettings
    const storedName = String(p.cashierName || '').trim()
    const name = (storedName && !/^кассир$/i.test(storedName)) ? storedName : (empName || storedName || 'Кассир')
    return {
      cashierId: String(p.cashierId || ''),
      cashierName: name,
      initials: String(p.initials || initialsOf(name)),
    }
  } catch {
    return { cashierId: '', cashierName: empName || 'Кассир', initials: initialsOf(empName || 'К') }
  }
}

function saveSettings(s: PosSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

function loadTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light'
  const t = localStorage.getItem(THEME_KEY)
  if (t === 'dark') return 'dark'
  return 'light'
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
        <button
          key={k}
          type="button"
          className={k === '⌫' ? 'kp-clear' : undefined}
          // Не забирать фокус у поля суммы — иначе физ. клавиатура перестаёт печатать
          onMouseDown={e => e.preventDefault()}
          onClick={() => (k === '⌫' ? onBack() : onDigit(k))}
        >
          {k}
        </button>
      ))}
    </div>
  )
}

/** Модалка слева + экранная клавиатура справа (как при оплате наличными) */
function PadShell({
  openPad,
  onHidePad,
  pad,
  children,
  className = '',
}: {
  openPad: boolean
  onHidePad: () => void
  pad: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`pad-shell ${openPad ? 'with-pad' : ''} ${className}`.trim()} onClick={e => e.stopPropagation()}>
      {children}
      {openPad && (
        <div className="pad-side">
          <div className="pad-side-title">Клавиатура</div>
          {pad}
          <button type="button" className="pad-side-hide" onClick={onHidePad}>
            Скрыть
          </button>
        </div>
      )}
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

type PosTileProps = {
  product: Product
  isFav: boolean
  photo?: string
  stock: number
  onAdd: (p: Product) => void
  onToggleFav: (id: number) => void
}

/** Уже показанные фото — после пробития плитки не гаснут при кратком remount */
const seenPosTilePhotos = new Set<string>()

const PosProductTile = memo(function PosProductTile({
  product: p,
  isFav,
  photo,
  stock,
  onAdd,
  onToggleFav,
}: PosTileProps) {
  const weighted = isWeighted(p)
  const sellUnit = displaySellUnit(p)
  const stockUnit = stockUnitLabel(p)
  const barcode = productBarcodes(p)[0] || ''
  const art = String(p.art || '').trim()
  const plu = String(p.plu || '').replace(/\D/g, '') || String(p.plu || '').trim()
  const photoRef = useRef<HTMLDivElement | null>(null)
  const photoSeenKey = photo ? `${p.id}|${photo}` : ''
  const [showPhoto, setShowPhoto] = useState(() => !!(photoSeenKey && seenPosTilePhotos.has(photoSeenKey)))

  // Грузим картинку только когда плитка реально на экране (как в веб-вьюере)
  useEffect(() => {
    if (!photo || !photoSeenKey) return
    if (seenPosTilePhotos.has(photoSeenKey)) {
      setShowPhoto(true)
      return
    }
    const el = photoRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      seenPosTilePhotos.add(photoSeenKey)
      setShowPhoto(true)
      return
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          seenPosTilePhotos.add(photoSeenKey)
          setShowPhoto(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [photo, photoSeenKey])

  return (
    <button
      type="button"
      className="p-tile"
      onClick={() => onAdd(p)}
    >
      <span
        className={`p-fav ${isFav ? 'on' : ''}`}
        title={isFav ? 'Убрать из избранного' : 'В избранное'}
        role="button"
        tabIndex={0}
        onClick={e => {
          e.stopPropagation()
          e.preventDefault()
          onToggleFav(p.id)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            e.preventDefault()
            onToggleFav(p.id)
          }
        }}
      >
        {isFav ? '★' : '☆'}
      </span>
      <div className="p-photo" ref={photoRef}>
        {photo && showPhoto ? (
          <img src={photo} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : photo ? null : (
          (p.e || '📦')
        )}
        {weighted && <span className="p-weight-tag">⚖ {sellUnit}</span>}
      </div>
      <div className="p-name">{p.name}</div>
      <div className="p-codes">
        {plu ? <span className="p-plu">PLU {plu}</span> : null}
        {art ? <span>арт. {art}</span> : null}
        {barcode ? <span>ш/к {barcode}</span> : null}
        {!plu && !art && !barcode ? <span className="muted">без кода</span> : null}
      </div>
      <div className="p-price">{(Number(p.price) || 0).toFixed(2)}<span className="p-unit"> ЅМ/{sellUnit}</span></div>
      <div className={`p-stock ${stock < 5 ? 'low' : ''}`}>В наличии: {stock} {stockUnit}</div>
    </button>
  )
}, (prev, next) => (
  prev.product.id === next.product.id
  && prev.isFav === next.isFav
  && prev.photo === next.photo
  && prev.stock === next.stock
  && prev.onAdd === next.onAdd
  && prev.onToggleFav === next.onToggleFav
  && Number(prev.product.price) === Number(next.product.price)
  && prev.product.name === next.product.name
))

/** Сетка товаров: все позиции в списке, в DOM только видимые ряды (без пропажи при скролле) */
function VirtualProductGrid({
  products,
  resetKey,
  renderTile,
}: {
  products: Product[]
  resetKey: string
  renderTile: (p: Product) => ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const metricsRef = useRef({ w: 800, h: 600, rowH: 260, startRow: 0 })
  const [version, setVersion] = useState(0)
  /** Анимация появления — только при смене поиска/категории, не после пробития */
  const [enterAnim, setEnterAnim] = useState(false)
  const prevResetKeyRef = useRef<string | null>(null)

  const GAP = 13
  const MIN_COL = 150
  const PAD_X = 40
  const OVERSCAN = 5

  const bump = useCallback(() => setVersion(v => v + 1), [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const readSize = () => {
      metricsRef.current.w = Math.max(MIN_COL, el.clientWidth - PAD_X)
      metricsRef.current.h = Math.max(1, el.clientHeight)
    }

    const onScroll = () => {
      const m = metricsRef.current
      const cols = Math.max(1, Math.floor((m.w + GAP) / (MIN_COL + GAP)))
      const stride = m.rowH + GAP
      const nextStart = Math.max(0, Math.floor(el.scrollTop / Math.max(1, stride)) - OVERSCAN)
      if (nextStart !== m.startRow) {
        m.startRow = nextStart
        bump()
      }
    }

    readSize()
    bump()
    el.addEventListener('scroll', onScroll, { passive: true })
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        readSize()
        onScroll()
        bump()
      })
      ro.observe(el)
    }
    const onResize = () => {
      readSize()
      bump()
    }
    window.addEventListener('resize', onResize)
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [bump])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    el.scrollTop = 0
    metricsRef.current.startRow = 0
    bump()
    const prev = prevResetKeyRef.current
    prevResetKeyRef.current = resetKey
    // Первый mount и смена поиска/категории — короткая анимация; обновление остатков после чека — нет
    if (prev === null || prev !== resetKey) {
      setEnterAnim(true)
      const t = window.setTimeout(() => setEnterAnim(false), 280)
      return () => window.clearTimeout(t)
    }
  }, [resetKey, bump])

  useLayoutEffect(() => {
    const tile = wrapRef.current?.querySelector('.p-tile') as HTMLElement | null
    if (!tile) return
    const h = Math.round(tile.getBoundingClientRect().height)
    if (h >= 120 && Math.abs(h - metricsRef.current.rowH) > 1) {
      metricsRef.current.rowH = h
      bump()
    }
  }, [products.length, version, bump])

  const gridEnterClass = enterAnim ? ' p-grid-enter' : ''

  if (products.length <= 60) {
    return (
      <div className="grid-wrap" ref={wrapRef}>
        <div className={`p-grid${gridEnterClass}`}>{products.map(p => renderTile(p))}</div>
      </div>
    )
  }

  void version
  const m = metricsRef.current
  const cols = Math.max(1, Math.floor((m.w + GAP) / (MIN_COL + GAP)))
  const stride = m.rowH + GAP
  const totalRows = Math.max(1, Math.ceil(products.length / cols))
  const totalHeight = Math.max(stride, totalRows * stride - GAP)
  const startRow = Math.min(m.startRow, Math.max(0, totalRows - 1))
  const visibleRows = Math.ceil(m.h / stride) + 1
  const endRow = Math.min(totalRows, startRow + visibleRows + OVERSCAN * 2)
  const startIndex = startRow * cols
  const endIndex = Math.min(products.length, endRow * cols)
  const slice = products.slice(startIndex, endIndex)
  const offsetY = startRow * stride

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div className="p-grid-spacer" style={{ height: totalHeight, position: 'relative' }}>
        <div
          className={`p-grid p-grid-virtual${gridEnterClass}`}
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0,
          }}
        >
          {slice.map(p => renderTile(p))}
        </div>
      </div>
    </div>
  )
}

/** Отдельный чип сети — syncing не перерисовывает поле поиска кассы */
const CashierNetChip = memo(function CashierNetChip({
  onlineCode,
  onOpenQueue,
}: {
  onlineCode?: string
  onOpenQueue: () => void
}) {
  const netOnline = useOfflineSync(s => s.online)
  const netPending = useOfflineSync(s => s.pending)
  const netFailed = useOfflineSync(s => s.failed)
  const netSyncing = useOfflineSync(s => s.syncing)
  const netProgress = useOfflineSync(s => s.progress)
  const title = netOnline
    ? (netPending > 0
        ? (netSyncing
            ? `Синхронизация ${netProgress.total > 0 ? `${netProgress.done} из ${netProgress.total}` : '…'}`
            : `Онлайн · ${netPending} в очереди`)
        : (onlineCode || 'Онлайн'))
    : `Офлайн${netPending > 0 ? ` · ${netPending} операц. ждут` : ''}${netFailed > 0 ? ` · повтор: ${netFailed}` : ''}`
  const label = netOnline
    ? (netPending > 0
        ? (netSyncing
            ? `↻ ${netProgress.total > 0 ? `${netProgress.done}/${netProgress.total}` : '…'}`
            : `очередь ${netPending}`)
        : (onlineCode || 'Онлайн'))
    : (netPending > 0 ? `офлайн · ${netPending}` : 'Офлайн')

  return (
    <>
      <span className="d" style={{ background: netOnline ? undefined : '#e11d48' }} />
      <span
        className="net-status-txt"
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        onClick={onOpenQueue}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpenQueue() }}
        title={title}
      >
        {label}
        {netFailed > 0 ? ` · ${netFailed}⚠` : ''}
      </span>
      {(!netOnline || netPending > 0 || netFailed > 0) && (
        <button
          type="button"
          className="net-sync-chip"
          onClick={onOpenQueue}
          title="Открыть очередь синхронизации"
        >
          {netSyncing ? '…' : (netOnline ? '⟳' : '⚠')}
        </button>
      )}
    </>
  )
})

export default function CashierModule({
  onExit,
  onNavigate: _onNavigate,
  embedded = false,
  active = true,
  onSurfaceChange,
  theme: themeProp,
  onThemeChange,
}: {
  onExit?: () => void
  onNavigate?: (page: NavTarget) => void
  /** Встроена в правую панель «Торговля» (с боковым меню) */
  embedded?: boolean
  /** false = раздел скрыт, но не размонтирован (быстрый переход на Склад/Товар) */
  active?: boolean
  onSurfaceChange?: (surface: 'dashboard' | 'register') => void
  theme?: ThemeName
  onThemeChange?: (theme: ThemeName) => void
}) {
  const hideHardware = hideTradeHardwareUi()
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const orders = useOrders(s => s.orders)
  const clients = useClientStore(s => s.clients)
  const cards = useCardStore(s => s.cards)
  // online/syncing — только в CashierNetChip, иначе каждый тик sync перерисовывает поиск
  const startNetSync = useOfflineSync(s => s.start)
  const [queueOpen, setQueueOpen] = useState(false)
  const shifts = usePosStore(s => s.shifts)
  const posPoints = usePosStore(s => s.posPoints)
  const cashiers = usePosStore(s => s.cashiers)
  const sales = usePosStore(s => s.sales)
  const receipts = usePosStore(s => s.receipts)
  const writeoffs = usePosStore(s => s.writeoffs)
  const revisions = usePosStore(s => s.revisions)
  const suppliers = usePosStore(s => s.suppliers)
  const apiReady = usePosStore(s => s.apiReady)
  const { categories, roots, childrenOf } = useCategories()
  const [settings, setSettings] = useState<PosSettings>(loadSettings)
  const [themeLocal] = useState<ThemeName>(loadTheme)
  const theme = themeProp ?? themeLocal
  const [q, setQ] = useState('')
  const qRef = useRef('')
  const scanCommitTimer = useRef<number | null>(null)
  const scanLastKeyTs = useRef(0)
  const scanBurstRef = useRef(false)
  const scanAccumRef = useRef('')
  /** Буфер скана с первого символа (до confirm burst) — не теряем char до onChange */
  const scanTypeBufRef = useRef('')
  /** Сколько раз удлиняли ожидание из‑за неполного штрихкода */
  const scanExtendRef = useRef(0)

  /** Пауза между символами USB/BT-сканера: раньше 70/180мс резали код пополам → «не найден». */
  const SCAN_IDLE_MS = 160
  const SCAN_GAP_FAST_MS = 85
  const SCAN_GAP_BURST_MS = 150
  const SCAN_GAP_RESET_MS = 380

  /** USB-сканер почти всегда шлёт цифры; быстрый набор названия — буквы. */
  function isScannerCodeText(raw: string): boolean {
    const t = String(raw || '').trim().replace(/\s+/g, '')
    if (t.length < 3) return false
    // Штрихкод / PLU / артикул-число
    if (/^\d+$/.test(t)) return true
    // Редкие коды с дефисом, без букв
    if (/^[\d-]+$/.test(t) && t.replace(/\D/g, '').length >= 6) return true
    return false
  }

  function looksIncompleteScannerCode(raw: string): boolean {
    const digits = String(raw || '').replace(/\D/g, '')
    // EAN-8/13, Code128 часто 8–14; обрезок 4–12 без точного hit — ждём остаток
    return digits.length >= 4 && digits.length < 12
  }

  function hasExactProductCode(raw: string): boolean {
    const t = String(raw || '').trim()
    if (!t) return false
    const digits = t.replace(/\D/g, '')
    if (findProductsByExactBarcode(products, t).length) return true
    if (productCodeIndex.get(t) || (digits && productCodeIndex.get(digits))) return true
    if (digits.length >= 1 && digits.length <= 4 && productCodeIndex.get(`plu:${digits}`)) return true
    return false
  }
  const [showFav, setShowFav] = useState(false)
  const [selectedCatSlugs, setSelectedCatSlugs] = useState<string[]>([])
  const [favIds, setFavIds] = useState<number[]>(loadFavIds)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [catModalQ, setCatModalQ] = useState('')
  const bootTicket = useRef(makeTicket(1)).current
  const [tickets, setTickets] = useState<PosTicket[]>([bootTicket])
  const [activeTicketId, setActiveTicketId] = useState(bootTicket.id)
  const [nextTicketSeq, setNextTicketSeq] = useState(2)
  const nextTicketSeqRef = useRef(2)
  nextTicketSeqRef.current = nextTicketSeq
  const ticketsHydratedRef = useRef(false)
  const ticketsRef = useRef(tickets)
  const activeTicketIdRef = useRef(activeTicketId)
  /** Чек, который сейчас пробивается — не трогаем активную вкладку, если кассир уже переключился */
  const sellingTicketIdRef = useRef<string | null>(null)
  ticketsRef.current = tickets
  activeTicketIdRef.current = activeTicketId

  // Восстановление открытых чеков после света / перезапуска
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = await loadPosSessionState<{
        tickets?: PosTicket[]
        activeTicketId?: string
        nextTicketSeq?: number
      }>()
      if (cancelled || !saved?.tickets?.length) {
        ticketsHydratedRef.current = true
        return
      }
      setTickets(saved.tickets)
      setActiveTicketId(saved.activeTicketId || saved.tickets[0].id)
      if (saved.nextTicketSeq) setNextTicketSeq(saved.nextTicketSeq)
      ticketsHydratedRef.current = true
    })()
    return () => { cancelled = true }
  }, [])

  // Сохраняем чеки на диск (локальная база) — переживает обрыв электричества
  useEffect(() => {
    if (!ticketsHydratedRef.current) return
    const t = window.setTimeout(() => {
      void savePosSessionState({
        tickets,
        activeTicketId,
        nextTicketSeq,
        savedAt: new Date().toISOString(),
      })
    }, 200)
    return () => window.clearTimeout(t)
  }, [tickets, activeTicketId, nextTicketSeq])

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
  async function ensureClientHasCard(c: AdminClient): Promise<AdminClient> {
    if (c.card) {
      const linked = useCardStore.getState().cards.find(x => cardNumsMatch(x.num, c.card!) && x.status !== 'unlinked')
      if (linked) return c
    }
    const res = await provisionLoyaltyCardSafe(c)
    const fresh = useClientStore.getState().clients.find(x => x.id === c.id) || res.data
    if (!fresh.card) throw new Error('Не удалось получить карту лояльности')
    setClient(fresh)
    return fresh
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

  /** Корзина + выделение одной записью — иначе выделение «залипает» на предыдущей строке */
  function setCartAndSelect(updater: (prev: CartLine[]) => CartLine[], selectKey: string | null) {
    flushSync(() => {
      setTickets(prev => prev.map(t => {
        if (t.id !== activeTicketId) return t
        const nextCart = updater(t.cart)
        return {
          ...t,
          cart: nextCart,
          selectedLineKey: selectKey != null ? selectKey : t.selectedLineKey,
        }
      }))
    })
    if (selectKey) pinCartToPunched(selectKey)
  }

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)
  /** Блокировка кассы после скана неизвестного штрихкода — пока не нажали Отмена / ✕ */
  const [scanBlockAlert, setScanBlockAlert] = useState<{ title: string; sub: string; code: string } | null>(null)
  const scanBlockAlertRef = useRef(false)
  /** Один штрихкод на несколько товаров — выбор кассира, без автопробития */
  const [barcodePick, setBarcodePick] = useState<{ code: string; products: Product[] } | null>(null)
  const barcodePickRef = useRef(false)
  const [clearCartConfirm, setClearCartConfirm] = useState(false)
  /** Закрытие вкладки чека с товарами — спросить подтверждение */
  const [closeTicketConfirmId, setCloseTicketConfirmId] = useState<string | null>(null)

  const [gateCash, setGateCash] = useState('0.00')
  const [gateName, setGateName] = useState(settings.cashierName)
  const [pickedCashierId, setPickedCashierId] = useState(settings.cashierId)

  const [clientOpen, setClientOpen] = useState(false)
  const [clientQ, setClientQ] = useState('')
  const [clientScanOpen, setClientScanOpen] = useState(false)
  const [clientScanBuf, setClientScanBuf] = useState('')
  const [camScanOpen, setCamScanOpen] = useState(false)
  const clientScanRef = useRef<HTMLInputElement>(null)
  const clientSearchRef = useRef<HTMLInputElement>(null)
  const [discOpen, setDiscOpen] = useState(false)
  const [discBuf, setDiscBuf] = useState('')
  const [discMode, setDiscMode] = useState<'all' | 'line'>('all')
  /** % или сумма в сомах — в обе скидки */
  const [discInputKind, setDiscInputKind] = useState<'pct' | 'sum'>('pct')
  /** В режиме «Новая цена» для строки: правим цену за ед. или итого строки */
  const [discEditTarget, setDiscEditTarget] = useState<'unit' | 'total'>('unit')
  /** Следующая цифра с экранной клавиатуры заменяет выделенное значение (не дописывает к 18→186) */
  const discWipeNextRef = useRef(false)
  const [discLineKey, setDiscLineKey] = useState<string | null>(null)
  const [discPickOpen, setDiscPickOpen] = useState(false)
  const [qtyEditOpen, setQtyEditOpen] = useState(false)
  const [qtyEditKey, setQtyEditKey] = useState<string | null>(null)
  const [qtyEditMode, setQtyEditMode] = useState<'qty' | 'sum'>('qty')
  const [qtyEditBuf, setQtyEditBuf] = useState('')
  const [qtyEditPad, setQtyEditPad] = useState(false)
  const qtyEditInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const commitPosSearchRef = useRef<(raw?: string, opts?: { fromScanner?: boolean }) => boolean>(() => false)
  const cartItemsRef = useRef<HTMLDivElement>(null)
  const cartEndRef = useRef<HTMLDivElement>(null)
  /** Ключ только что пробитой строки — пока не null, чек держим на ней */
  const revealLineKeyRef = useRef<string | null>(null)
  const cartScrollTimersRef = useRef<number[]>([])
  /** Актуальный чек для склейки без гонок при быстрых кликах */
  const cartRef = useRef<CartLine[]>(cart)
  cartRef.current = cart
  /** Инкремент → useLayoutEffect гарантированно крутит к пробитой строке */
  const [cartPinGen, setCartPinGen] = useState(0)
  /** Пока грузятся партии — не плодим параллельные add одного товара */
  const addInflightRef = useRef(new Set<number>())
  const addPendingBumpRef = useRef(new Map<number, number>())
  const lastPieceAddRef = useRef<{ id: number; t: number }>({ id: 0, t: 0 })
  /** Кэш групп цен по партиям — без ожидания API на каждое пробитие */
  const layerGroupsCacheRef = useRef(new Map<number, PriceLayerGroup[]>())
  const [stockLayersByProduct, setStockLayersByProduct] = useState<Record<number, ProductStockLayer[]>>({})
  const [stockLayersLoaded, setStockLayersLoaded] = useState(false)
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
  const receiptQDeferred = useDeferredValue(receiptQ)
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'cash' | 'card' | 'credit' | 'returned'>('all')
  /** Касса: по умолчанию только текущая смена */
  const [receiptScope, setReceiptScope] = useState<'shift' | 'other'>('shift')
  const [receiptLimit, setReceiptLimit] = useState(50)
  const [receiptFrom, setReceiptFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [receiptTo, setReceiptTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const receiptSearchRef = useRef<HTMLInputElement>(null)
  const receiptScanBurstRef = useRef(false)
  const receiptScanAccumRef = useRef('')
  const receiptScanLastTsRef = useRef(0)
  const receiptScanTimerRef = useRef<number | null>(null)
  /** index позиции → qty к возврату (0 = не выбрано) */
  const [returnQtyByIdx, setReturnQtyByIdx] = useState<Record<number, number>>({})
  const [closingCash, setClosingCash] = useState('')
  const [closingCard, setClosingCard] = useState('')
  const [shiftReconcileOpen, setShiftReconcileOpen] = useState(false)
  /** Сверка подтверждена «ОК» — смена ещё открыта, видны +/− */
  const [shiftReconciled, setShiftReconciled] = useState(false)
  const [tillMoveKind, setTillMoveKind] = useState<null | 'in' | 'out'>(null)
  const [tillAmountBuf, setTillAmountBuf] = useState('')
  const [tillNote, setTillNote] = useState('')
  const [tillSupplierId, setTillSupplierId] = useState('')
  const [layerPickOpen, setLayerPickOpen] = useState(false)
  const [layerPickProduct, setLayerPickProduct] = useState<Product | null>(null)
  const [layerPickGroups, setLayerPickGroups] = useState<PriceLayerGroup[]>([])
  const [layerPickWeightKg, setLayerPickWeightKg] = useState<number | undefined>(undefined)
  const [layerPickBusy, setLayerPickBusy] = useState(false)
  /** На телефоне: товары или чек (полноэкранные панели) */
  const [posMobPanel, setPosMobPanel] = useState<'shop' | 'cart'>('shop')
  const [headerNow, setHeaderNow] = useState(() => new Date())
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupBuf, setTopupBuf] = useState('')
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayBuf, setRepayBuf] = useState('')
  const [repayMethod, setRepayMethod] = useState<'cash' | 'card'>('cash')
  const [repayTarget, setRepayTarget] = useState<{
    orderId: string
    label: string
    maxAmount: number
    debtEntryId?: string
    kind?: 'sale' | 'cash'
  } | null>(null)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeBuf, setChargeBuf] = useState('')
  /** Погасить старый долг вместе с текущим чеком (только если долг > 0) */
  const [payDebtOn, setPayDebtOn] = useState(false)
  const [payDebtBuf, setPayDebtBuf] = useState('')
  /** Сколько дал клиент (чек + долг): сначала закрываем чек, остаток → погашение */
  const [payGivenBuf, setPayGivenBuf] = useState('')
  const [histOpen, setHistOpen] = useState(false)
  const [histTab, setHistTab] = useState<'history' | 'pos' | 'cash' | 'pay'>('pos')
  const [histDetail, setHistDetail] = useState<ClientHistRow | null>(null)
  const [payGroupDetail, setPayGroupDetail] = useState<{
    id: string
    when: string
    ts: number
    amount: number
    isReturn: boolean
    parts: { id: string; when: string; amount: number; desc: string; checkLabel: string; items?: string; saleId?: string; isReturn: boolean; partKind?: 'check' | 'cash' | 'other' }[]
    checkCount: number
    cashCount?: number
    methodHint: string
    coverHint?: string
  } | null>(null)
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
  /** Вопрос «печатать?» ДО пробития чека — чек проходит только после Нет/Печатать */
  const [saleConfirm, setSaleConfirm] = useState<{
    ticketId: string
    paidCash: number
    method?: PayMethod
    bonusSpend?: number
    paidCard?: number
    debtAmt?: number
    /** Погашение старого долга вместе с чеком (снимок на момент подтверждения) */
    debtRepayAmt?: number
    saleNote?: string
    returnTo: 'payPick' | 'cash' | 'splitCard' | 'creditNote'
    previewTotal: number
    clientName?: string
  } | null>(null)
  const printChoiceLockedRef = useRef(false)
  const printingSaleIdsRef = useRef(new Set<string>())
  const [printingSaleId, setPrintingSaleId] = useState<string | null>(null)
  /** Подтверждение возврата — без window.confirm/prompt (Electron иначе блокирует ввод) */
  const [returnConfirm, setReturnConfirm] = useState<{
    saleId: string
    mode: 'selected' | 'all'
    title: string
    body: string
    total: number
    /** Сколько выдать клиенту (нал+карта). При всём долге = 0 */
    giveMoney?: number
    cutDebt?: number
    payloadItems?: { index: number; qty: number }[]
    needAdmin: boolean
    step: 'confirm' | 'admin'
    adminCode: string
  } | null>(null)
  const returnConfirmRef = useRef(returnConfirm)
  returnConfirmRef.current = returnConfirm
  const [deskPrinters, setDeskPrinters] = useState<DesktopPrinter[]>([])
  const [deskPrinterName, setDeskPrinterName] = useState('')
  const [deskPaperMm, setDeskPaperMm] = useState<58 | 80>(XP58C_RECEIPT_MM)
  const [deskScaleMode, setDeskScaleMode] = useState<'none' | 'plu-label'>('plu-label')
  const [deskScaleHost, setDeskScaleHost] = useState('')
  const [deskLocalIps, setDeskLocalIps] = useState<string[]>([])
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
  const deskScaleModeRef = useRef<'none' | 'plu-label'>('plu-label')
  const deskScaleHostRef = useRef('')
  const deskScalePortRef = useRef(20304)
  const casMonitorWantedRef = useRef(false)
  const qtyEditOpenRef = useRef(false)
  const qtyEditIsWeightRef = useRef(false)
  const qtyEditKeyRef = useRef<string | null>(null)
  /** Пусто на платформе: меньше 1 деления (5 г) */
  const SCALE_ZERO_KG = 0.005
  const SCALE_STEP_G = 5
  const lastHeldKgRef = useRef(0)
  /** Было обнуление платформы после сохранённого веса */
  const scaleSawZeroRef = useRef(false)
  /** Итоговый вес в поле кассы (граммы) */
  const lastCommittedGramsRef = useRef(0)
  /** Сколько граммов на платформе было в момент последнего commit */
  const platterBaselineGramsRef = useRef(0)
  /** Сброс буфера семплов при каждом новом открытии окна веса */
  const scaleSamplesEpochRef = useRef(0)
  const [scaleHolding, setScaleHolding] = useState(false)
  const [scaleMoving, setScaleMoving] = useState(false)
  const [receiptTemplateOpen, setReceiptTemplateOpen] = useState(false)
  const [receiptTemplateDraft, setReceiptTemplateDraft] = useState<ReceiptStoreConfig>(() => ({
    ...DEFAULT_RECEIPT_STORE,
  }))
  const [qtyEditDraftKey, setQtyEditDraftKey] = useState<string | null>(null)

  useEffect(() => {
    return pushBackHandler(() => {
      if (camScanOpen) { setCamScanOpen(false); return true }
      if (clientScanOpen) { setClientScanOpen(false); return true }
      if (qtyEditOpen) { setQtyEditOpen(false); return true }
      if (amountPad) { setAmountPad(false); return true }
      if (payPickOpen) { setPayPickOpen(false); return true }
      if (cashOpen) { setCashOpen(false); return true }
      if (splitCardOpen) { setSplitCardOpen(false); return true }
      if (discPickOpen) { setDiscPickOpen(false); return true }
      if (discOpen) { setDiscOpen(false); return true }
      if (clientOpen) { setClientOpen(false); return true }
      if (catModalOpen) { setCatModalOpen(false); return true }
      if (layerPickOpen) { setLayerPickOpen(false); return true }
      if (topupOpen) { setTopupOpen(false); return true }
      if (repayOpen) { setRepayOpen(false); setRepayTarget(null); return true }
      if (chargeOpen) { setChargeOpen(false); return true }
      if (payGroupDetail) { setPayGroupDetail(null); return true }
      if (histDetail) { setHistDetail(null); return true }
      if (histOpen) { setHistOpen(false); setHistDetail(null); setPayGroupDetail(null); return true }
      if (creditNoteOpen) { setCreditNoteOpen(false); return true }
      if (openShiftModal) { setOpenShiftModal(false); return true }
      if (createPosModal) { setCreatePosModal(false); return true }
      if (cashierMenuOpen) { setCashierMenuOpen(false); return true }
      if (queueOpen) { setQueueOpen(false); return true }
      if (receiptTemplateOpen) { setReceiptTemplateOpen(false); return true }
      if (returnConfirmRef.current) { setReturnConfirm(null); return true }
      if (clearCartConfirm) { setClearCartConfirm(false); return true }
      if (showFav) { setShowFav(false); return true }
      return false
    })
  })

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

  // При старте — лёгкий sync, без ожидания всего склада/финансов (иначе слабый интернет = долгий чёрный экран)
  useEffect(() => {
    void softSyncPosAfterSale()
    void fetchProducts()
    void syncClientsFromApi()
    void syncCardsFromApi()
  }, [fetchProducts])

  // Имя сотрудника Trade → кассир (если в настройках ещё «Кассир»)
  useEffect(() => {
    try {
      const emp = String(loadTradeEmployeeSession()?.name || '').trim()
      if (!emp) return
      setSettings(prev => {
        if (prev.cashierName && !/^кассир$/i.test(prev.cashierName)) return prev
        const next = { ...prev, cashierName: emp, initials: initialsOf(emp) }
        saveSettings(next)
        return next
      })
      setGateName(prev => (!prev || /^кассир$/i.test(prev) ? emp : prev))
    } catch { /* ignore */ }
  }, [])

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

  useEffect(() => { startNetSync() }, [startNetSync])

  /** Пока идёт оплата/пробитие — не гоняем тяжёлый sync в фоне (иначе поиск «замирает»).
   *  Важно: только когда касса ВИДНА. Keep-alive в фоне не должен блокировать автосинк на Складе. */
  useEffect(() => {
    if (!active) {
      clearCashierSearchActivity()
      return
    }
    const critical =
      busy
      || !!saleConfirm
      || payPickOpen
      || cashOpen
      || splitCardOpen
      || creditNoteOpen
      || topupOpen
      || repayOpen
      || chargeOpen
      || !!tillMoveKind
    if (!critical) return
    beginCashierCritical()
    return () => { endCashierCritical() }
  }, [
    active,
    busy,
    saleConfirm,
    payPickOpen,
    cashOpen,
    splitCardOpen,
    creditNoteOpen,
    topupOpen,
    repayOpen,
    chargeOpen,
    tillMoveKind,
  ])

  /** Ушли со кассы — сразу догоняем очередь (чеки после пробития) */
  useEffect(() => {
    if (active) return
    clearCashierSearchActivity()
    const t = window.setTimeout(() => {
      void useOfflineSync.getState().syncNow()
    }, 400)
    return () => window.clearTimeout(t)
  }, [active])

  /** После окончания пробития — автоотправка очереди (не ждать ручную кнопку) */
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (busy) {
      wasBusyRef.current = true
      return
    }
    if (!wasBusyRef.current) return
    wasBusyRef.current = false
    const t = window.setTimeout(() => {
      void useOfflineSync.getState().syncNow()
    }, 350)
    return () => window.clearTimeout(t)
  }, [busy])

  /** Очередь офлайна — без дубля softSync (его уже тянет useApiSync / WS) */
  useEffect(() => {
    if (!USE_API || !active) return
    let cancelled = false
    const kickQueue = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      if (isCashierPaymentCritical()) return
      const net = useOfflineSync.getState()
      if (!net.online || net.pending > 0 || net.failed > 0) {
        void net.syncNow()
      }
    }
    kickQueue()
    const id = window.setInterval(kickQueue, 25000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') kickQueue()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!scanBlockAlert) return
    const onKey = (e: KeyboardEvent) => {
      // Глотаем весь ввод сканера, пока окно открыто (Enter не закрывает — сканер шлёт Enter)
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') closeScanBlockAlert()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeScanBlockAlert стабилен по смыслу
  }, [scanBlockAlert])
  useEffect(() => {
    if (!barcodePick) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') closeBarcodePick()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeBarcodePick стабилен по смыслу
  }, [barcodePick])
  useEffect(() => {
    const bump = () => setHistTick(n => n + 1)
    const offDebt = subscribeDebtHistory(bump)
    const offTopup = subscribeBalanceTopup(bump)
    return () => { offDebt(); offTopup() }
  }, [])
  useEffect(() => {
    const phone = client?.phone
    if (!phone) return
    void syncDebtHistoryFromLedger(phone)
  }, [client?.phone])
  const prevClientIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = client?.id || null
    if (prevClientIdRef.current && prevClientIdRef.current !== id) {
      setPayDebtOn(false)
      setPayDebtBuf('')
      setPayGivenBuf('')
      setRepayTarget(null)
    }
    prevClientIdRef.current = id
  }, [client?.id])
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
    const open = discOpen || cashOpen || splitCardOpen || topupOpen || repayOpen || chargeOpen || !!tillMoveKind
    if (!open) return
    const t = window.setTimeout(() => {
      const el = amountInputRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [discOpen, cashOpen, splitCardOpen, topupOpen, repayOpen, chargeOpen, tillMoveKind, amountPad])

  /** Пока открыто окно суммы: цифры с физ. клавиатуры всегда в поле, даже после клика по кнопкам */
  useEffect(() => {
    const open = discOpen || cashOpen || splitCardOpen || topupOpen || repayOpen || chargeOpen || !!tillMoveKind
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = amountInputRef.current
      if (!el) return
      const active = document.activeElement as HTMLElement | null
      if (active === el) return
      if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      // Другое текстовое поле (не сумма) — не перехватываем
      if (active?.tagName === 'INPUT' && active !== el) {
        const type = (active as HTMLInputElement).type || 'text'
        if (type === 'text' || type === 'search' || type === 'tel' || type === 'number' || type === '') return
      }

      const isDigit = e.key.length === 1 && /[0-9.,]/.test(e.key)
      const isEdit = e.key === 'Backspace' || e.key === 'Delete'
      if (!isDigit && !isEdit) return

      e.preventDefault()
      e.stopPropagation()
      el.focus()

      if (discOpen) {
        if (isEdit) {
          setDiscBuf(b => b.slice(0, -1))
          return
        }
        typeDiscDigit(e.key === ',' ? '.' : e.key)
        return
      }

      const apply = (setter: (fn: (b: string) => string) => void) => {
        if (isEdit) setter(b => b.slice(0, -1))
        else setter(b => appendDigit(b, e.key === ',' ? '.' : e.key))
      }
      if (cashOpen) apply(setCashBuf)
      else if (splitCardOpen) apply(setSplitCardBuf)
      else if (topupOpen) apply(setTopupBuf)
      else if (repayOpen) apply(setRepayBuf)
      else if (chargeOpen) apply(setChargeBuf)
      else if (tillMoveKind) apply(setTillAmountBuf)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [discOpen, cashOpen, splitCardOpen, topupOpen, repayOpen, chargeOpen, tillMoveKind])

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
    const bound = getBoundPosIdSync()
    const id = activeShift?.posId || bound
    if (!id) return posPoints[0] || null
    return posPoints.find(p => p.id === id) || posPoints[0] || null
  }, [activeShift?.posId, posPoints])

  const visiblePosPoints = useMemo(() => {
    const list = (posPoints.length ? posPoints : []).filter(p => p.active !== false)
    const bound = getBoundPosIdSync()
    if (!bound) return list
    const only = list.filter(p => p.id === bound)
    return only.length ? only : list
  }, [posPoints])

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
    !active
    || posSurface !== 'register'
    || !activeShift
    || openShiftModal
    || createPosModal
    || !!editPosId
    || !!deletePosId
    || !!cashierScreen
    || catModalOpen || clientOpen || clientScanOpen || camScanOpen || discOpen || discPickOpen
    || qtyEditOpen || cashOpen || splitCardOpen || topupOpen || repayOpen || chargeOpen
    || !!tillMoveKind || layerPickOpen
    || histOpen || payPickOpen || creditNoteOpen || receiptTemplateOpen || !!saleConfirm
    || !!returnConfirm
    || !!dashMenuPosId
    || !!scanBlockAlert
    || !!barcodePick
    || clearCartConfirm
    || !!closeTicketConfirmId

  function focusProductSearch() {
    if (isTradeMobileUi()) return
    const el = searchInputRef.current
    if (!el) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      el.focus()
    }
  }

  /** Прокрутка чека к пробитой строке — только scrollTop своего .cart-items */
  function scrollCartToPunched(key?: string | null) {
    const box = cartItemsRef.current
    if (!box) return false
    const want = key || revealLineKeyRef.current
    let row: HTMLElement | null = null
    if (want) {
      for (const el of box.querySelectorAll('[data-line-key]')) {
        if (el.getAttribute('data-line-key') === want) {
          row = el as HTMLElement
          break
        }
      }
    }
    // Сначала в самый низ (пробитый всегда в конце)
    box.scrollTop = box.scrollHeight
    const end = cartEndRef.current
    if (end) {
      const br = box.getBoundingClientRect()
      const er = end.getBoundingClientRect()
      if (er.bottom > br.bottom) box.scrollTop += er.bottom - br.bottom + 4
    }
    if (row) {
      const br = box.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      if (rr.bottom > br.bottom - 4) box.scrollTop += rr.bottom - br.bottom + 8
      else if (rr.top < br.top + 4) box.scrollTop += rr.top - br.top - 8
      const rr2 = row.getBoundingClientRect()
      const br2 = box.getBoundingClientRect()
      return rr2.top >= br2.top - 2 && rr2.bottom <= br2.bottom + 2
    }
    return true
  }

  function clearCartScrollTimers() {
    for (const id of cartScrollTimersRef.current) {
      window.clearTimeout(id)
      window.cancelAnimationFrame(id)
    }
    cartScrollTimersRef.current = []
  }

  /** После пробития: выделить + несколько попыток скролла (Electron/flex) */
  function pinCartToPunched(key: string | null | undefined) {
    if (!key) return
    revealLineKeyRef.current = key
    setCartPinGen(g => g + 1)
    clearCartScrollTimers()
    const run = () => {
      if (revealLineKeyRef.current !== key) return
      scrollCartToPunched(key)
    }
    run()
    const raf1 = window.requestAnimationFrame(() => {
      run()
      cartScrollTimersRef.current.push(window.requestAnimationFrame(run))
    })
    cartScrollTimersRef.current.push(raf1)
    for (const ms of [0, 40, 120]) {
      cartScrollTimersRef.current.push(window.setTimeout(run, ms))
    }
    cartScrollTimersRef.current.push(window.setTimeout(() => {
      if (revealLineKeyRef.current === key) revealLineKeyRef.current = null
    }, 180))
  }

  function revealCartLine(key: string | null | undefined) {
    if (!key) return
    setSelectedLineKey(key)
    pinCartToPunched(key)
  }

  useLayoutEffect(() => {
    const key = revealLineKeyRef.current
    if (!key) return
    scrollCartToPunched(key)
  }, [cart, selectedLineKey, cartPinGen])

  const overlayBlocksSearchRef = useRef(overlayBlocksSearch)
  useEffect(() => {
    overlayBlocksSearchRef.current = overlayBlocksSearch
  }, [overlayBlocksSearch])

  useEffect(() => () => {
    if (scanCommitTimer.current) window.clearTimeout(scanCommitTimer.current)
  }, [])

  useEffect(() => {
    deskScaleLiveWeightRef.current = deskScaleLiveWeight
  }, [deskScaleLiveWeight])

  useEffect(() => {
    deskScaleModeRef.current = deskScaleMode
  }, [deskScaleMode])

  useEffect(() => {
    deskScaleHostRef.current = deskScaleHost.trim()
  }, [deskScaleHost])

  useEffect(() => {
    deskScalePortRef.current = Number(deskScalePort) || 20304
  }, [deskScalePort])

  useEffect(() => {
    qtyEditOpenRef.current = qtyEditOpen
  }, [qtyEditOpen])

  useEffect(() => {
    qtyEditKeyRef.current = qtyEditKey
  }, [qtyEditKey])

  /** Загрузить настройки весов при старте desktop-кассы */
  useEffect(() => {
    if (!isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    if (!desk) return
    void desk.getLocalIpv4?.().then(res => {
      const ips = (res?.list || []).map(i => i.address).filter(Boolean)
      setDeskLocalIps(ips)
    }).catch(() => undefined)
    void desk.getPrinterSettings().then(async settings => {
      const mode = settings?.scaleMode === 'none' ? 'none' : 'plu-label'
      // Если IP пустой — подставляем типичный адрес CAS и сохраняем
      let host = String(settings?.scaleHost || '').trim()
      if (!host) host = '192.168.1.10'
      const port = Number(settings?.scalePort) || 20304
      const live = settings?.scaleLiveWeight !== false
      setDeskScaleMode(mode)
      setDeskScaleHost(host)
      setDeskScalePort(String(port))
      setDeskScaleDept(String(settings?.scaleDept || 1))
      setDeskScaleLiveWeight(live)
      deskScaleHostRef.current = host
      deskScalePortRef.current = port

      if (!String(settings?.scaleHost || '').trim() && desk.savePrinterSettings) {
        try {
          await desk.savePrinterSettings({
            ...settings,
            scaleMode: mode,
            scaleHost: host,
            scalePort: port,
            scaleDept: Number(settings?.scaleDept) || 1,
            scaleLiveWeight: live,
          })
        } catch { /* ignore */ }
      }

      if (mode !== 'none' && live && host && desk.startCasWeight) {
        casMonitorWantedRef.current = true
        void desk.startCasWeight({ host, port }).catch(e => {
          setCasWeight(prev => ({
            ...prev,
            connected: false,
            running: false,
            error: e instanceof Error ? e.message : 'Нет связи с весами',
          }))
        })
      }
    }).catch(() => undefined)
  }, [])

  // Модалка веса открыта → поднять TCP-монитор
  useEffect(() => {
    if (!qtyEditOpen) return
    if (!qtyEditIsWeightRef.current) return
    if (deskScaleMode === 'none' || !deskScaleLiveWeight) return
    if (!isKakapoDesktop()) return
    void ensureCasWeightMonitor(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtyEditOpen, deskScaleHost, deskScalePort, deskScaleLiveWeight, deskScaleMode])

  /**
   * Живой вес CAS (как на кассе):
   * 1) Пока платформа дрожит — в чек НЕ пишем (только «сейчас N г · ждём STOP»)
   * 2) STOP (разброс ≤ ±2 г ≥ 500 мс) → пишем точный вес в поле и в строку чека
   * 3) Сняли товар (≈0 г) → вес в чеке остаётся
   * 4) Положили другой после нуля → замена
   * 5) Не снимали, досыпали → новый абсолютный вес платформы
   */
  useEffect(() => {
    if (!isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    if (!desk) return

    const STABLE_TOLERANCE_G = 2
    const STABLE_DURATION_MS = 500
    const STABLE_BUFFER_MS = 700
    const EMPTY_G = 5
    /** @type {{ grams: number, t: number }[]} */
    let samples: { grams: number, t: number }[] = []
    let pollBusy = false
    let samplesEpoch = scaleSamplesEpochRef.current

    const resetSamplesIfNeeded = () => {
      const ep = scaleSamplesEpochRef.current
      if (ep !== samplesEpoch) {
        samplesEpoch = ep
        samples = []
      }
    }

    const evaluateUiStable = (now: number) => {
      const cutoff = now - STABLE_BUFFER_MS
      samples = samples.filter(s => s.t >= cutoff)
      if (samples.length < 2) {
        return { stable: false, grams: samples.length ? samples[samples.length - 1].grams : 0 }
      }
      const newest = samples[samples.length - 1]
      if (newest.t - samples[0].t < STABLE_DURATION_MS) {
        return { stable: false, grams: newest.grams }
      }
      const windowStart = newest.t - STABLE_DURATION_MS
      const inWindow = samples.filter(s => s.t >= windowStart)
      if (inWindow.length < 2) return { stable: false, grams: newest.grams }
      let min = inWindow[0].grams
      let max = inWindow[0].grams
      let sum = 0
      for (const s of inWindow) {
        if (s.grams < min) min = s.grams
        if (s.grams > max) max = s.grams
        sum += s.grams
      }
      return {
        stable: (max - min) <= STABLE_TOLERANCE_G,
        grams: Math.round(sum / inWindow.length),
      }
    }

    /** Округление к цене деления весов 5 г */
    const roundStep = (g: number) => Math.round(Math.max(0, g) / SCALE_STEP_G) * SCALE_STEP_G

    const commitPlatterGrams = (platterGrams: number) => {
      const g = roundStep(platterGrams)
      if (g < EMPTY_G) return
      const exact = (g / 1000).toFixed(3)
      lastHeldKgRef.current = g / 1000
      lastCommittedGramsRef.current = g
      platterBaselineGramsRef.current = g
      scaleSawZeroRef.current = false
      setQtyEditMode('qty')
      setQtyEditBuf(exact)
      setScaleMoving(false)
      setScaleHolding(false)
      const key = qtyEditKeyRef.current
      if (key) {
        const w = g / 1000
        setCart(prev => prev.map(l => {
          if (l.key !== key || l.weightKg == null) return l
          return { ...l, weightKg: w, qty: 1 }
        }))
      }
    }

    const handleReading = (payload: {
      weightKg?: number
      grams?: number
      connected?: boolean
      error?: string
      raw?: string
      price?: number | null
      host?: string
      port?: number
      stable?: boolean
    }) => {
      resetSamplesIfNeeded()
      const now = Date.now()
      const kgIn = Math.round((Number(payload.weightKg) || 0) * 1000) / 1000
      const rawG = Number.isFinite(Number(payload.grams))
        ? Math.round(Number(payload.grams))
        : Math.round(kgIn * 1000)
      const grams = Math.max(0, rawG)

      samples.push({ grams, t: now })
      const ev = evaluateUiStable(now)
      // В чек — только по локальному STOP (не по одиночному флагу монитора)
      const stopped = ev.stable
      const liveG = grams
      const commitG = stopped ? roundStep(ev.grams) : liveG

      setCasWeight(prev => ({
        ...prev,
        connected: payload.connected !== false,
        running: true,
        weightKg: liveG / 1000,
        grams: liveG,
        price: payload.price ?? prev.price,
        error: payload.error || '',
        host: payload.host || prev.host,
        port: payload.port || prev.port,
        raw: payload.raw,
        stable: stopped,
        ts: now,
      }))

      if (!deskScaleLiveWeightRef.current) return
      if (deskScaleModeRef.current === 'none') return
      if (!qtyEditOpenRef.current || !qtyEditIsWeightRef.current) return

      const empty = liveG < EMPTY_G
      const saved = lastCommittedGramsRef.current

      // Сняли с платформы → вес в чеке/поле остаётся
      if (empty) {
        samples = []
        setScaleMoving(false)
        platterBaselineGramsRef.current = 0
        if (saved > 0) {
          scaleSawZeroRef.current = true
          setScaleHolding(true)
          setQtyEditMode('qty')
          setQtyEditBuf((saved / 1000).toFixed(3))
        } else {
          // Готовы принять следующий вес как «первый» (после сохранения / нового товара)
          scaleSawZeroRef.current = true
          setScaleHolding(false)
        }
        return
      }

      // Движение / рука — в чек НЕ пишем, поле не трогаем (живьём видно в подсказке)
      if (!stopped) {
        setScaleMoving(true)
        setScaleHolding(false)
        return
      }

      // STOP
      const afterRemove = scaleSawZeroRef.current
      const baseline = platterBaselineGramsRef.current

      if (saved <= 0 || afterRemove) {
        commitPlatterGrams(commitG)
        return
      }
      // Досып без снятия (или убрали часть) — абсолютный вес платформы, шаг 5 г
      if (Math.abs(commitG - baseline) >= SCALE_STEP_G) {
        commitPlatterGrams(commitG)
        return
      }
      setScaleMoving(false)
      setScaleHolding(false)
    }

    // События монитора (stable уже с допуском ±2 г / 350 мс)
    const off = desk.onCasWeight?.(payload => {
      handleReading(payload)
    })

    // Запасной опрос, если событие монитора редкое
    const pollId = window.setInterval(() => {
      if (pollBusy) return
      if (!qtyEditOpenRef.current || !qtyEditIsWeightRef.current) return
      if (!deskScaleLiveWeightRef.current) return
      if (deskScaleModeRef.current === 'none') return
      const host = deskScaleHostRef.current.trim()
      if (!host || !desk.readCasWeight) return
      pollBusy = true
      void desk.readCasWeight({
        host,
        port: deskScalePortRef.current,
        timeoutMs: 2200,
        forceDirect: false,
      }).then(res => {
        handleReading({
          connected: true,
          weightKg: res.weightKg,
          grams: res.grams,
          price: res.price,
          raw: res.raw,
          host: res.host,
          port: res.port,
        })
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setCasWeight(prev => ({
          ...prev,
          connected: false,
          error: msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, ''),
        }))
      }).finally(() => {
        pollBusy = false
      })
    }, 450)

    return () => {
      off?.()
      window.clearInterval(pollId)
    }
  }, [])

  useEffect(() => () => {
    const desk = getKakapoDesktop()
    void desk?.stopCasWeight?.()
  }, [])

  // Раздел скрыт (перешли на Склад/Товар) — стоп весов; при возврате — снова старт
  useEffect(() => {
    if (!active) {
      void ensureCasWeightMonitor(false)
      return
    }
    if (deskScaleMode !== 'none' && deskScaleLiveWeight && deskScaleHost.trim()) {
      void ensureCasWeightMonitor(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /**
   * Desktop: поиск товара всегда в фокусе (сканер).
   * Мобильный: без автофокуса — иначе сразу открывается клавиатура.
   */
  useEffect(() => {
    if (overlayBlocksSearch) return
    if (isTradeMobileUi()) return

    const scheduleFocus = (delay = 0) => {
      window.setTimeout(() => {
        if (overlayBlocksSearchRef.current) return
        if (document.activeElement === searchInputRef.current) return
        focusProductSearch()
      }, delay)
    }

    scheduleFocus(40)

    const onPointer = (e: PointerEvent) => {
      if (overlayBlocksSearchRef.current) return
      const t = e.target as HTMLElement | null
      if (!t) return
      // Модалки / другие поля ввода — не трогаем
      if (t.closest('.modal-card, .overlay, .pad-shell, .cash-checkout-shell, .cashier-menu, .pos-settings-fs, .k-modal-bg, .k-modal')) return
      if (t.closest('textarea, select, [contenteditable="true"]')) return
      // Другой input (не поиск) — не перехватываем, пока пользователь вводит
      const input = t.closest('input')
      if (input && input !== searchInputRef.current) return
      // Клик по плитке/кнопке/чеку/пустому месту → вернуть фокус в поиск
      scheduleFocus(30)
    }

    const onBlurCapture = (e: FocusEvent) => {
      if (overlayBlocksSearchRef.current) return
      if (e.target !== searchInputRef.current) return
      scheduleFocus(40)
    }

    // Сканер шлёт клавиши: если фокус ушёл — вернуть в поиск и не потерять символ
    const onKeyDown = (e: KeyboardEvent) => {
      if (overlayBlocksSearchRef.current) return
      if (document.activeElement === searchInputRef.current) return
      const active = document.activeElement as HTMLElement | null
      if (active?.closest?.('.modal-card, .overlay, .pad-shell, .cash-checkout-shell, .pos-settings-fs, .k-modal-bg, .k-modal')) return
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const now = performance.now()
      const gap = now - scanLastKeyTs.current
      scanLastKeyTs.current = now

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!scanBurstRef.current && !scanAccumRef.current) {
          if (e.key === 'Enter') focusProductSearch()
          return
        }
        const raw = String(scanAccumRef.current || qRef.current || '').trim()
        const isScanner = scanBurstRef.current && isScannerCodeText(raw)
        if (!isScanner) {
          if (e.key === 'Enter') focusProductSearch()
          return
        }
        e.preventDefault()
        focusProductSearch()
        if (scanCommitTimer.current) {
          window.clearTimeout(scanCommitTimer.current)
          scanCommitTimer.current = null
        }
        commitPosSearchRef.current(raw, { fromScanner: true })
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        const next = String(scanAccumRef.current || qRef.current || '').slice(0, -1)
        scanAccumRef.current = next
        qRef.current = next
        setQ(next)
        focusProductSearch()
        return
      }
      if (e.key.length === 1) {
        e.preventDefault()
        const isDigitKey = /^\d$/.test(e.key)

        // Буквы = поиск по названию, не сканер
        if (!isDigitKey) {
          if (scanCommitTimer.current) {
            window.clearTimeout(scanCommitTimer.current)
            scanCommitTimer.current = null
          }
          scanBurstRef.current = false
          scanAccumRef.current = ''
          scanTypeBufRef.current = ''
          const next = String(qRef.current || '') + e.key
          qRef.current = next
          setQ(next)
          focusProductSearch()
          return
        }

        // Продолжаем текущий штрихкод, если уже копим цифры и пауза не огромная
        const pendingDigits = String(scanTypeBufRef.current || scanAccumRef.current || '').replace(/\D/g, '')
        const continueBurst =
          (scanBurstRef.current || pendingDigits.length >= 3)
          && gap < 520

        if (!continueBurst && gap >= SCAN_GAP_RESET_MS) {
          scanBurstRef.current = false
          scanAccumRef.current = ''
          scanTypeBufRef.current = e.key
          const next = String(qRef.current || '') + e.key
          qRef.current = next
          setQ(next)
          focusProductSearch()
          return
        }
        const fast = continueBurst || gap < SCAN_GAP_FAST_MS || (scanBurstRef.current && gap < SCAN_GAP_BURST_MS)
        if (fast) {
          const prior = String(qRef.current || '')
          if (/[^\d\s-]/.test(prior) && !scanBurstRef.current && pendingDigits.length < 3) {
            scanBurstRef.current = false
            scanAccumRef.current = ''
            scanTypeBufRef.current = ''
            const next = prior + e.key
            qRef.current = next
            setQ(next)
            focusProductSearch()
            return
          }
          scanBurstRef.current = true
          if (!scanTypeBufRef.current) scanTypeBufRef.current = prior.replace(/[^\d-]/g, '')
          scanTypeBufRef.current += e.key
          scanAccumRef.current = scanTypeBufRef.current
          qRef.current = scanAccumRef.current
          scanExtendRef.current = 0
          if (scanCommitTimer.current) window.clearTimeout(scanCommitTimer.current)
          scanCommitTimer.current = window.setTimeout(() => {
            scanCommitTimer.current = null
            if (scanBlockAlertRef.current || barcodePickRef.current) return
            if (!scanBurstRef.current) return
            const live = String(scanAccumRef.current || scanTypeBufRef.current || '').trim()
            if (!isScannerCodeText(live)) {
              scanBurstRef.current = false
              scanAccumRef.current = ''
              scanTypeBufRef.current = ''
              return
            }
            commitPosSearchRef.current(live, { fromScanner: true })
          }, SCAN_IDLE_MS)
          return
        }
        // Средний темп — обычный ручной ввод
        scanBurstRef.current = false
        scanAccumRef.current = ''
        scanTypeBufRef.current = ''
        const next = String(qRef.current || '') + e.key
        qRef.current = next
        setQ(next)
        focusProductSearch()
      }
    }

    // Страховка: раз в полсекунды, если фокус потерян
    const tick = window.setInterval(() => {
      if (overlayBlocksSearchRef.current) return
      if (document.activeElement === searchInputRef.current) return
      const active = document.activeElement as HTMLElement | null
      if (active?.closest?.('.modal-card, .overlay, .pad-shell, .cash-checkout-shell, .pos-settings-fs, .k-modal-bg, .k-modal')) return
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return
      focusProductSearch()
    }, 450)

    document.addEventListener('pointerup', onPointer)
    document.addEventListener('focusout', onBlurCapture, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerup', onPointer)
      document.removeEventListener('focusout', onBlurCapture, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.clearInterval(tick)
    }
  }, [
    overlayBlocksSearch,
    activeShift?.id,
    activeTicketId,
  ])

  const cashierOptions = useMemo(() => {
    if (cashiers.length) return cashiers.filter(c => c.active !== false)
    return [{ id: 'local', name: settings.cashierName || 'Кассир', pin: '0000', active: true, salesCount: 0, salesTotal: 0 }]
  }, [cashiers, settings.cashierName])

  const search = q
  const deferredSearch = useDeferredValue(search)
  const liveStockForProduct = useCallback((p: Product | null | undefined) => {
    if (!p) return 0
    return liveProductStock(p, stockLayersByProduct[p.id], stockLayersLoaded)
  }, [stockLayersByProduct, stockLayersLoaded])

  useEffect(() => {
    let cancelled = false

    const applyLayers = (layers: ProductStockLayer[]) => {
      if (cancelled) return
      const nextByProduct: Record<number, ProductStockLayer[]> = {}
      const nextGroups = new Map<number, PriceLayerGroup[]>()
      for (const layer of layers || []) {
        const pid = Number(layer.productId) || 0
        if (!pid) continue
        const arr = nextByProduct[pid] || []
        arr.push(layer)
        nextByProduct[pid] = arr
      }
      for (const p of products) {
        const open = (nextByProduct[p.id] || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
        if (open.length) nextGroups.set(p.id, groupStockLayersByRetail(open, Number(p.price) || 0))
      }
      layerGroupsCacheRef.current = nextGroups
      setStockLayersByProduct(nextByProduct)
      setStockLayersLoaded(true)
    }

    void import('@/lib/stockLayersLocal')
      .then(m => m.loadStockLayersCacheFirst(applyLayers))
      .then(applyLayers)
      .catch(() => {
        if (!cancelled) setStockLayersLoaded(true)
      })

    const onLayersEvent = () => {
      void import('@/lib/stockLayersLocal')
        .then(m => m.readCachedStockLayers())
        .then(applyLayers)
        .catch(() => {})
    }
    window.addEventListener('kakapo:stock-layers', onLayersEvent)

    return () => {
      cancelled = true
      window.removeEventListener('kakapo:stock-layers', onLayersEvent)
    }
  }, [products, receipts.length, revisions.length, sales.length, writeoffs.length])

  /**
   * Сетка фильтрует и по названию, и по хвосту штрихкода (последние цифры).
   * Полный скан USB не пишет в `q` во время burst — мигания нет.
   */
  const gridSearch = useMemo(() => deferredSearch.trim(), [deferredSearch])
  const favSet = useMemo(() => new Set(favIds), [favIds])
  const inStockProducts = useMemo(
    () => products
      .filter(p => liveStockForProduct(p) > 0)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [products, liveStockForProduct],
  )
  /** Быстрый индекс штрихкод/артикул/PLU → товар (сканер без полного перебора) */
  const productCodeIndex = useMemo(() => {
    const map = new Map<string, Product>()
    const put = (key: string, p: Product) => {
      const k = key.trim()
      if (!k || map.has(k)) return
      map.set(k, p)
    }
    for (const p of products) {
      for (const c of productBarcodes(p)) {
        put(c, p)
        const d = c.replace(/\D/g, '')
        if (d) put(d, p)
      }
      const art = String(p.art || '').trim()
      if (art) {
        put(art, p)
        const ad = art.replace(/\D/g, '')
        if (ad) put(ad, p)
      }
      const plu = String(p.plu || '').replace(/\D/g, '')
      if (plu) put(`plu:${plu}`, p)
    }
    return map
  }, [products])
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
    const searching = !!gridSearch.trim()
    // При поиске — по всему каталогу в наличии (избранное/категория не режут выдачу)
    if (!searching) {
      if (showFav) list = list.filter(p => favSet.has(p.id))
      else if (selectedCatSlugs.length > 0) {
        list = list.filter(p => selectedCatSlugs.some(slug =>
          productMatchesCategoryFilter(p.catId, slug, categories)
          || productMatchesCategoryFilter(p.cat, slug, categories),
        ))
      }
    }
    if (searching) {
      // Порядок по релевантности (хвост штрихкода / название), не алфавит
      return filterProductsBySearch(list, gridSearch.trim(), 80)
    }
    // inStockProducts уже отсортирован по имени — повторный sort не нужен
    return list
  }, [inStockProducts, showFav, favSet, selectedCatSlugs, categories, gridSearch])

  const addProductRef = useRef<(p: Product, weightKg?: number, opts?: { fromScanner?: boolean }) => void>(() => {})
  const toggleFavoriteRef = useRef<(id: number) => void>(() => {})

  const onAddProductTile = useCallback((p: Product) => {
    addProductRef.current(p)
  }, [])

  const onToggleFavoriteTile = useCallback((id: number) => {
    toggleFavoriteRef.current(id)
  }, [])

  const renderProductTile = useCallback((p: Product) => {
    // Только URL миниатюры с сервера (как в браузере). Локальные base64 не используем —
    // иначе Electron раздувает память и диск на тысячах фото.
    const photo = resolveProductPhoto(p, { preferThumb: true })
    return (
      <PosProductTile
        key={p.id}
        product={p}
        isFav={favSet.has(p.id)}
        photo={photo}
        stock={liveStockForProduct(p)}
        onAdd={onAddProductTile}
        onToggleFav={onToggleFavoriteTile}
      />
    )
  }, [favSet, liveStockForProduct, onAddProductTile, onToggleFavoriteTile])

  function toggleFavorite(productId: number) {
    setFavIds(prev => {
      const next = prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
      saveFavIds(next)
      return next
    })
  }
  toggleFavoriteRef.current = toggleFavorite

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

  function pickClientInPos(c: AdminClient, toast = true) {
    setClient(c)
    setBonusUsed(0)
    setPayDebtOn(false)
    setPayDebtBuf('')
    setPayGivenBuf('')
    setRepayTarget(null)
    setClientOpen(false)
    setClientScanOpen(false)
    setClientScanBuf('')
    setClientQ('')
    if (toast) showToast('Клиент выбран', c.name)
  }

  const clientHits = useMemo(() => {
    const query = clientQ.trim().toLowerCase()
    const qDigits = query.replace(/\s/g, '')
    const debtOf = (c: AdminClient) => {
      const card = c.card ? cards.find(x => cardNumsMatch(x.num, c.card)) : undefined
      return effectiveDebt(card, c)
    }
    if (!query) {
      return [...clients]
        .filter(c => debtOf(c) > 0.001)
        .sort((a, b) => debtOf(b) - debtOf(a))
        .slice(0, 12)
    }
    return clients
      .filter(c =>
        c.name.toLowerCase().includes(query)
        || (c.phone || '').replace(/\s/g, '').includes(qDigits)
        || (c.card || '').toLowerCase().includes(query),
      )
      .sort((a, b) => debtOf(b) - debtOf(a) || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 20)
  }, [clients, clientQ, cards])

  const loyalty = useMemo(() => (client ? loyaltySummaryForClient(client, cards) : null), [client, cards])
  const debtLimit = loyalty ? resolveEffectiveDebtLimit(loyalty) : 0
  const availableDebt = loyalty ? Math.max(0, debtLimit - (Number(loyalty.debt) || 0)) : 0
  const clientDebt = Number(loyalty?.debt) || 0
  const clientDebtBlocked = !!(client?.debtCreditBlocked || loyalty?.debtCreditBlocked)

  function showDebtBlockedToast() {
    showToast('Долг закрыт', 'Повторная просрочка — новый долг недоступен. Клиент должен погасить текущий долг.')
  }

  const cashierDebtPanel = useMemo(() => {
    void histTick
    const empty = {
      posOriginal: 0,
      posRemain: 0,
      cashOnCard: 0,
      residualCash: 0,
      openChecks: 0,
      totalChecks: 0,
      openCash: 0,
      cashRows: [] as DebtHistoryEntry[],
      cashView: [] as {
        id: string
        label: string
        when: string
        debtAdded: number
        paid: number
        remain: number
        status: 'open' | 'partial' | 'paid'
        ts: number
        orderId: string
        debtEntryId?: string
        isResidual?: boolean
      }[],
      payRows: [] as DebtHistoryEntry[],
      payView: [] as { id: string; when: string; amount: number; desc: string; checkLabel: string; items?: string; saleId?: string; isReturn: boolean; partKind: 'check' | 'cash' | 'other'; batchId?: string; ts: number; source?: string }[],
      payGroups: [] as {
        id: string
        when: string
        ts: number
        amount: number
        isReturn: boolean
        parts: { id: string; when: string; amount: number; desc: string; checkLabel: string; items?: string; saleId?: string; isReturn: boolean; partKind: 'check' | 'cash' | 'other' }[]
        checkCount: number
        cashCount: number
        methodHint: string
        coverHint: string
      }[],
      feed: [] as { key: string; when: string; kind: 'pos' | 'cash' | 'pay'; desc: string; amount: number; balance: number; saleId?: string }[],
      creditSales: [] as { id: string; label: string; when: string; items: string; debtAdded: number; remain: number; paid: number; status: 'open' | 'partial' | 'paid'; ts: number }[],
    }
    if (!client) return empty

    const history = loadDebtHistoryForClient(client)
    const clientSales = sales.filter(s => {
      const matchId = client.id && s.clientId === client.id
      const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
      return !!(matchId || matchPhone)
    })
    const posSales = clientSales
      .filter(s => saleWasOnCredit(s))
      .map(s => {
        const remain = saleOpenCreditAmount(s)
        const orig = remain > 0.001
          ? remain
          : Math.max(
            remain,
            Number((s as { originalTotal?: number }).originalTotal) || 0,
            Number(s.lastReturnTotal) || 0,
          )
        return {
          id: s.id,
          orderId: s.orderId,
          number: s.number,
          dateIso: s.createdAtIso,
          debtAdded: orig,
          items: mapSaleLines(s.items, products),
        }
      })
      .filter(s => s.debtAdded > 0.001)
      .sort((a, b) => String(b.dateIso).localeCompare(String(a.dateIso)))

    const cardDebt = Math.max(0, Math.round(clientDebt * 100) / 100)
    const { saleStatus, posOriginal, posRemain, cashOnCard } = buildSaleDebtStatuses(
      posSales,
      history,
      cardDebt,
    )

    const manual = history.filter(isManualDebtHistoryEntry)
    const cashRows = history.filter(r => isLedgerCashHistoryDebt(r, clientSales))
    const checkPays = history.filter(r => r.type === 'pay' && !isManualDebtHistoryEntry(r))
    const manualPays = manual.filter(r => r.type === 'pay')
    const cashChargeSum = Math.round(
      cashRows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) * 100,
    ) / 100
    const residualCash = Math.max(0, Math.round((cashOnCard - cashChargeSum) * 100) / 100)

    const { unpaid: unpaidDebtBal, paid: paidDebtRows } = buildDebtOrderBalances(history)
    const cashIdSet = new Set(cashRows.map(r => r.id))
    const cashView: {
      id: string
      label: string
      when: string
      debtAdded: number
      paid: number
      remain: number
      status: 'open' | 'partial' | 'paid'
      ts: number
      orderId: string
      debtEntryId?: string
      isResidual?: boolean
    }[] = []
    for (const d of unpaidDebtBal) {
      if (!cashIdSet.has(d.id)) continue
      const orig = Math.round(Math.abs(Number(d.originalAmount ?? d.amount) || 0) * 100) / 100
      const paidAmt = Math.round((Number(d.paidAmount) || 0) * 100) / 100
      const rem = Math.round((Number(d.remainingAmount) || 0) * 100) / 100
      cashView.push({
        id: d.id,
        label: d.desc || 'Наличные',
        when: `${d.date}${d.time ? ` · ${d.time}` : ''}`,
        debtAdded: orig,
        paid: paidAmt,
        remain: rem,
        status: d.partial || paidAmt > 0.001 ? 'partial' : 'open',
        ts: Number(d.ts) || 0,
        orderId: cashDebtOrderId(d),
        debtEntryId: d.id,
      })
    }
    for (const d of paidDebtRows) {
      if (!cashIdSet.has(d.id)) continue
      const orig = Math.round(Math.abs(Number(d.amount) || 0) * 100) / 100
      cashView.push({
        id: d.id,
        label: d.desc || 'Наличные',
        when: `${d.date}${d.time ? ` · ${d.time}` : ''}`,
        debtAdded: orig,
        paid: orig,
        remain: 0,
        status: 'paid',
        ts: Number(d.ts) || 0,
        orderId: cashDebtOrderId(d),
        debtEntryId: d.id,
      })
    }
    if (residualCash > 0.005) {
      cashView.push({
        id: 'residual-cash',
        label: 'Ручной долг на карте',
        when: 'раньше',
        debtAdded: residualCash,
        paid: 0,
        remain: residualCash,
        status: 'open',
        ts: 1,
        orderId: '',
        isResidual: true,
      })
    }
    cashView.sort((a, b) => b.ts - a.ts)

    const payRows = [...checkPays, ...manualPays].sort((a, b) => (b.ts || 0) - (a.ts || 0))

    const creditSales = posSales.map(s => {
      const st = saleStatus[s.id] || { status: 'open' as const, paid: 0, remain: s.debtAdded }
      const ts = Date.parse(s.dateIso) || 0
      const label = s.number != null && Number(s.number) > 0
        ? `Чек №${s.number}`
        : (s.orderId ? `Заказ ${s.orderId}` : `Чек ${s.id.slice(-6)}`)
      const when = ts
        ? `${new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}, ${new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
        : s.dateIso
      const paid = Math.max(0, Math.round((Number(st.paid) || Math.max(0, s.debtAdded - st.remain)) * 100) / 100)
      return {
        id: s.id,
        label,
        when,
        items: linesLabel(s.items),
        debtAdded: s.debtAdded,
        remain: st.remain,
        paid,
        status: st.status,
        ts,
      }
    })

    const payView = payRows.map(r => {
      const sid = String(r.orderId || '').trim()
      const sale = sid
        ? creditSales.find(s => debtOrderIdsMatch(s.id, sid.replace(/^sale-/, '')) || debtOrderIdsMatch(s.id, r.orderId))
        : undefined
      const cash = !sale && sid
        ? cashView.find(c =>
          !c.isResidual
          && (debtOrderIdsMatch(c.orderId, sid)
            || debtOrderIdsMatch(c.id, sid)
            || debtOrderIdsMatch(`cash-${c.id}`, sid)))
        : undefined
      const isCashPart = !sale && (!!cash || sid.startsWith('cash-'))
      const isReturn = /возврат/i.test(String(r.desc || ''))
      return {
        id: r.id,
        when: `${r.date}${r.time ? ` · ${r.time}` : ''}`,
        amount: Math.abs(Number(r.amount) || 0),
        desc: r.desc || (isReturn ? 'Возврат товара' : 'Погашение долга'),
        checkLabel: sale
          ? sale.label
          : cash
            ? cash.label
            : sid
              ? (sid.startsWith('cash-') ? 'Наличные' : `Чек ${sid.replace(/^sale-/, '').slice(-8)}`)
              : 'Без привязки',
        items: sale?.items || r.itemsSummary || undefined,
        saleId: sale?.id || (sid && !sid.startsWith('cash-') ? sid.replace(/^sale-/, '') : undefined),
        isReturn,
        partKind: (sale ? 'check' : isCashPart ? 'cash' : 'other') as 'check' | 'cash' | 'other',
        batchId: r.batchId || undefined,
        ts: Number(r.ts) || 0,
        source: r.source,
      }
    })

    // Одна оплата клиента (100 сом) → одна строка; внутри — разбивка по чекам / нал. выдачам.
    // Новые записи: batchId. Старые FIFO без batchId: склеиваем по времени (~2.5 с).
    type PayPart = typeof payView[number]
    type PayGroup = {
      id: string
      when: string
      ts: number
      amount: number
      isReturn: boolean
      parts: PayPart[]
      checkCount: number
      cashCount: number
      methodHint: string
      coverHint: string
    }
    const PAY_CLUSTER_MS = 2500
    const paySortedAsc = [...payView].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    const payGroups: PayGroup[] = []
    let cluster: PayPart[] = []
    const flushCluster = () => {
      if (!cluster.length) return
      const parts = [...cluster]
      cluster = []
      const amount = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100
      const newest = parts[parts.length - 1]
      const active = parts.filter(p => !p.isReturn)
      const checkParts = active.filter(p => p.partKind === 'check')
      const cashParts = active.filter(p => p.partKind === 'cash')
      const checkCount = new Set(checkParts.map(p => p.checkLabel)).size || checkParts.length
      const cashCount = new Set(cashParts.map(p => p.checkLabel)).size || cashParts.length
      const methodHint = /карта/i.test(parts.map(p => p.desc).join(' '))
        ? 'карта'
        : /наличн/i.test(parts.map(p => p.desc).join(' '))
          ? 'наличные'
          : ''
      const bits: string[] = []
      if (checkCount > 0) {
        bits.push(checkCount === 1
          ? (checkParts[0]?.checkLabel || '1 чек')
          : `${checkCount} чек${checkCount < 5 ? 'а' : 'ов'}`)
      }
      if (cashCount > 0) {
        bits.push(cashCount === 1
          ? 'нал. выдача'
          : `${cashCount} нал. выдач`)
      }
      if (!bits.length && active[0]) bits.push(active[0].checkLabel)
      payGroups.push({
        id: parts[0].batchId || `cluster-${parts[0].id}`,
        when: newest.when,
        ts: newest.ts,
        amount,
        isReturn: parts.every(p => p.isReturn),
        parts,
        checkCount,
        cashCount,
        methodHint,
        coverHint: bits.join(' + '),
      })
    }
    for (const row of paySortedAsc) {
      if (row.isReturn) {
        flushCluster()
        payGroups.push({
          id: row.id,
          when: row.when,
          ts: row.ts,
          amount: row.amount,
          isReturn: true,
          parts: [row],
          checkCount: row.partKind === 'check' ? 1 : 0,
          cashCount: row.partKind === 'cash' ? 1 : 0,
          methodHint: '',
          coverHint: row.checkLabel,
        })
        continue
      }
      const last = cluster[cluster.length - 1]
      const sameBatch = !!(row.batchId && last?.batchId && row.batchId === last.batchId)
      const closeInTime = !row.batchId && !last?.batchId && last
        && Math.abs(row.ts - last.ts) <= PAY_CLUSTER_MS
      if (!cluster.length || sameBatch || closeInTime) {
        cluster.push(row)
      } else {
        flushCluster()
        cluster.push(row)
      }
    }
    flushCluster()
    payGroups.sort((a, b) => b.ts - a.ts)

    const cashRemainById = new Map(cashView.filter(c => !c.isResidual).map(c => [c.id, c.remain]))
    const feedSrc: { key: string; ts: number; when: string; kind: 'pos' | 'cash' | 'pay'; desc: string; amount: number; saleId?: string }[] = [
      ...creditSales
        .filter(s => s.remain > 0.001)
        .map(s => ({
          key: `p-${s.id}`,
          ts: s.ts,
          when: s.when,
          kind: 'pos' as const,
          // В ленте — текущий остаток по чеку (как в «Товары»), не полная сумма до оплат.
          // Иначе «Остаток» внизу разъезжается с «Итого» на карте.
          desc: `${s.label}${s.status === 'partial' ? ` · остаток ${fmtMoney(s.remain)}` : ` · к оплате ${fmtMoney(s.remain)}`}${s.debtAdded > s.remain + 0.05 ? ` · было ${fmtMoney(s.debtAdded)}` : ''}${s.items ? ` · ${s.items}` : ''}`,
          amount: s.remain,
          saleId: s.id,
        })),
      ...cashView
        .filter(c => c.remain > 0.001)
        .map(c => ({
          key: `c-${c.id}`,
          ts: c.ts,
          when: c.when,
          kind: 'cash' as const,
          desc: c.isResidual
            ? 'Ручной долг на карте (без записи в истории)'
            : `${c.label}${c.status === 'partial' ? ` · остаток ${fmtMoney(c.remain)}` : ` · к оплате ${fmtMoney(c.remain)}`}${c.debtAdded > c.remain + 0.05 ? ` · было ${fmtMoney(c.debtAdded)}` : ''}`,
          amount: c.remain,
        })),
      // Погашения по открытым чекам уже сидят в remain — в ленту не дублируем.
      // Оставляем только оплаты без привязки к чеку (и возвраты без open-sale).
      ...payRows
        .filter(r => {
          const sid = String(r.orderId || '').trim()
          if (!sid) return true
          if (sid.startsWith('cash-') || cashRemainById.has(sid) || cashView.some(c => cashDebtOrderId(c) === sid)) {
            return false
          }
          const sale = creditSales.find(s => debtOrderIdsMatch(s.id, sid.replace(/^sale-/, '')) || debtOrderIdsMatch(s.id, r.orderId))
          return !sale
        })
        .map(r => {
        const isReturn = /возврат/i.test(String(r.desc || ''))
        return {
          key: `pay-${r.id}`,
          ts: Number(r.ts) || 0,
          when: `${r.date}${r.time ? ` · ${r.time}` : ''}`,
          kind: 'pay' as const,
          desc: r.desc || (isReturn ? 'Возврат товара' : 'Погашение долга'),
          amount: -Math.abs(Number(r.amount) || 0),
          saleId: r.orderId?.replace(/^sale-/, ''),
        }
      }),
    ]
    // residual already in cashView — no duplicate feed push
    const chrono = [...feedSrc].sort((a, b) => a.ts - b.ts)
    let bal = 0
    let feed = chrono.map(row => {
      bal = Math.round((bal + row.amount) * 100) / 100
      return { ...row, balance: Math.max(0, bal) }
    })
    // Последний «Остаток» должен совпасть с долгом на карте («Итого»)
    const targetDebt = Math.max(0, Math.round(cardDebt * 100) / 100)
    const lastBal = feed.length ? feed[feed.length - 1].balance : 0
    const drift = Math.round((targetDebt - lastBal) * 100) / 100
    if (Math.abs(drift) > 0.05) {
      feed.push({
        key: 'debt-reconcile',
        ts: Date.now(),
        when: 'сейчас',
        kind: drift > 0 ? 'cash' : 'pay',
        desc: drift > 0
          ? 'Корректировка до долга на карте'
          : 'Учтены оплаты / списание до долга на карте',
        amount: drift,
        balance: targetDebt,
      })
    }
    feed = feed.reverse()

    return {
      posOriginal,
      posRemain,
      cashOnCard,
      residualCash,
      openChecks: creditSales.filter(s => s.remain > 0.001).length,
      totalChecks: creditSales.length,
      openCash: cashView.filter(c => c.remain > 0.001).length,
      cashRows,
      cashView,
      payRows,
      payView,
      payGroups,
      feed,
      creditSales,
    }
  }, [client, sales, clientDebt, histTick, products])

  const histActiveDebts = useMemo(() => {
    if (!client) return [] as ClientHistRow[]
    const history = loadDebtHistoryForClient(client)
    const { unpaid } = buildDebtOrderBalances(history)
    const findDebtEntryId = (saleId: string, orderId?: string) => {
      const keys = [saleId, orderId, saleId ? `sale-${saleId}` : ''].filter(Boolean) as string[]
      return unpaid.find(d => keys.some(k => debtOrderIdsMatch(d.orderId, k)))?.id
    }
    const active: ClientHistRow[] = cashierDebtPanel.creditSales
      .filter(s => s.remain > 0.001)
      .map(s => {
        const sale = sales.find(x => x.id === s.id)
        const lines = sale ? mapSaleLines(sale.items, products) : []
        const partial = s.status === 'partial'
        return {
          id: `active-sale-${s.id}`,
          ts: s.ts,
          when: s.when,
          title: partial ? `${s.label} · частично` : `${s.label} · к оплате`,
          sub: partial
            ? `Остаток ${fmtMoney(s.remain)} из ${fmtMoney(s.debtAdded)}`
            : `Ещё не погашен · ${fmtMoney(s.remain)}`,
          items: s.items || undefined,
          lines: lines.length ? lines : undefined,
          amount: s.remain,
          tone: 'debt' as const,
          debtStatus: (partial ? 'partial' : 'open') as ClientHistRow['debtStatus'],
          debtPaid: Math.max(0, Math.round((s.debtAdded - s.remain) * 100) / 100),
          debtRemain: s.remain,
          saleId: s.id,
          orderId: sale?.orderId || s.id,
          debtEntryId: findDebtEntryId(s.id, sale?.orderId),
        }
      })
    const unpaidSum = active.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    for (const c of cashierDebtPanel.cashView.filter(x => x.remain > 0.001)) {
      active.push({
        id: `active-cash-${c.id}`,
        ts: c.ts,
        when: c.when,
        title: c.status === 'partial' ? `${c.label} · частично` : `${c.label} · к оплате`,
        sub: c.isResidual
          ? `На карте без строки · ${fmtMoney(c.remain)}`
          : c.status === 'partial'
            ? `Остаток ${fmtMoney(c.remain)} из ${fmtMoney(c.debtAdded)}`
            : `Ещё не погашен · ${fmtMoney(c.remain)}`,
        amount: c.remain,
        tone: 'debt',
        debtStatus: (c.status === 'partial' ? 'partial' : 'open') as ClientHistRow['debtStatus'],
        debtPaid: c.paid,
        debtRemain: c.remain,
        orderId: c.orderId || undefined,
        debtEntryId: c.debtEntryId,
      })
    }
    const cashOpenSum = cashierDebtPanel.cashView
      .filter(c => c.remain > 0.001)
      .reduce((s, c) => s + c.remain, 0)
    const gap = Math.round((clientDebt - unpaidSum - cashOpenSum) * 100) / 100
    if (gap > 0.5) {
      active.push({
        id: 'active-balance-gap',
        ts: Date.now(),
        when: 'сейчас',
        title: 'Прочий долг',
        sub: `В балансе есть, в деталях нет · ${fmtMoney(gap)}`,
        amount: gap,
        tone: 'debt',
        debtStatus: 'open',
        debtPaid: 0,
        debtRemain: gap,
      })
    }
    return active.sort((a, b) => a.ts - b.ts)
  }, [client, cashierDebtPanel.creditSales, cashierDebtPanel.cashView, sales, products, clientDebt])

  const histPaidDebts = useMemo((): ClientHistRow[] => (
    cashierDebtPanel.creditSales
      .filter(s => s.status === 'paid')
      .map(s => {
        const sale = sales.find(x => x.id === s.id)
        const lines = sale ? mapSaleLines(sale.items, products) : []
        return {
          id: `sale-${s.id}`,
          ts: s.ts,
          when: s.when,
          title: `${s.label} · долг погашен`,
          sub: 'оплачен полностью',
          items: s.items || undefined,
          lines: lines.length ? lines : undefined,
          amount: s.debtAdded,
          tone: 'credit' as const,
          debtStatus: 'paid' as const,
          debtPaid: s.debtAdded,
          debtRemain: 0,
          saleId: s.id,
          orderId: sale?.orderId || s.id,
        }
      })
  ), [cashierDebtPanel.creditSales, sales, products])

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
            {row.debtStatus === 'paid' && <span className="hist-badge paid">Погашен</span>}
            {row.debtStatus === 'partial' && <span className="hist-badge partial">Частично</span>}
            {row.debtStatus === 'open' && (row.tone === 'credit' || row.tone === 'debt') && (
              <span className="hist-badge open">К оплате</span>
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
          {row.debtStatus === 'open' && row.debtRemain != null && row.debtRemain > 0 && opts?.compact && (
            <div className="hist-remain">к оплате</div>
          )}
        </div>
      </button>
    )
  }

  // Единый баланс: пополнение наличными и % идут в Бонусы ⭐ (сервер — источник правды).
  // Старое «восстановление баланса по истории» удалено.

  const clientProfileStats = useMemo(() => {
    void histTick
    const bonus = Number(loyalty?.bonus) || 0
    let repaid = 0
    let charged = 0
    if (client) {
      for (const h of loadDebtHistoryForClient(client)) {
        if (h.type === 'pay') repaid += Number(h.amount) || 0
        else charged += Math.abs(Number(h.amount) || 0)
      }
    }
    const creditSales = cashierDebtPanel.totalChecks
    return { bonus, repaid, charged, creditSales }
  }, [client, loyalty, histTick, cashierDebtPanel.totalChecks])

  const subtotalGross = useMemo(() => cart.reduce((s, l) => s + lineGross(l), 0), [cart])
  const cartStockBlocked = useMemo(
    () => cartStockShortfalls(cart),
    // liveStockForProduct зависит от партий и каталога
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, products, stockLayersByProduct, stockLayersLoaded],
  )
  const payBlockedByStock = cartStockBlocked.length > 0
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

  /** Наличные + погашение долга: из «получено» сначала чек, остаток — в долг */
  useEffect(() => {
    if (!cashOpen || !payDebtOn || clientDebt <= 0.001) return
    const given = Math.round(Math.max(0, Number(cashBuf) || 0) * 100) / 100
    const sale = Math.round(Math.max(0, total) * 100) / 100
    const debtPart = Math.min(
      Math.round(clientDebt * 100) / 100,
      Math.round(Math.max(0, given - sale) * 100) / 100,
    )
    setPayDebtBuf(prev => {
      const cur = Math.round((Number(prev) || 0) * 100) / 100
      if (Math.abs(cur - debtPart) < 0.001) return prev
      return debtPart > 0 ? String(debtPart) : ''
    })
    setPayGivenBuf(prev => {
      const prevN = Math.round((Number(prev) || 0) * 100) / 100
      if (Math.abs(prevN - given) < 0.001) return prev
      return given > 0 ? String(given) : ''
    })
  }, [cashOpen, cashBuf, payDebtOn, clientDebt, total])

  function showToast(title: string, sub: string) {
    setToast({ title, sub })
  }

  function openScanBlockAlert(title: string, sub: string, code = '') {
    scanBlockAlertRef.current = true
    if (scanCommitTimer.current) {
      window.clearTimeout(scanCommitTimer.current)
      scanCommitTimer.current = null
    }
    scanBurstRef.current = false
    scanAccumRef.current = ''
    scanTypeBufRef.current = ''
    qRef.current = ''
    setQ('')
    if (searchInputRef.current) searchInputRef.current.value = ''
    try { searchInputRef.current?.blur() } catch { /* ignore */ }
    setScanBlockAlert({ title, sub, code })
  }

  function productScanCode(p: Product): string {
    return productBarcodes(p)[0] || String(p.art || '').trim()
  }

  function cartNeedByProduct(lines: CartLine[]): Map<number, number> {
    const m = new Map<number, number>()
    for (const line of lines) {
      const q = line.weightKg != null ? (Number(line.weightKg) || 0) : (Number(line.qty) || 0)
      if (!(q > 0)) continue
      m.set(line.productId, Math.round(((m.get(line.productId) || 0) + q) * 1000) / 1000)
    }
    return m
  }

  /** Позиции чека, где в чеке больше, чем живой остаток на складе */
  function cartStockShortfalls(lines: CartLine[]): Array<{
    product: Product
    need: number
    have: number
  }> {
    const need = cartNeedByProduct(lines)
    const out: Array<{ product: Product; need: number; have: number }> = []
    for (const [pid, qty] of need) {
      const p = products.find(x => x.id === pid)
      if (!p) continue
      const have = liveStockForProduct(p)
      if (qty > have + 0.001) out.push({ product: p, need: qty, have })
    }
    return out
  }

  function openPayBlockedStockAlert(shortfalls: ReturnType<typeof cartStockShortfalls>) {
    const first = shortfalls[0]
    if (!first) return
    const unit = displaySellUnit(first.product)
    const more = shortfalls.length > 1 ? ` · ещё ${shortfalls.length - 1}` : ''
    openScanBlockAlert(
      'Не хватает на складе',
      `${first.product.name}: в чеке ${fmtQty(first.need)} ${unit}, на складе ${fmtQty(first.have)} ${unit}${more}. `
        + 'В чек уже добавлено. Пробить нельзя, пока не добавят остаток на склад.',
      productScanCode(first.product),
    )
  }

  function blockIfCartOverLiveStock(lines: CartLine[]): boolean {
    const shortfalls = cartStockShortfalls(lines)
    if (!shortfalls.length) return false
    openPayBlockedStockAlert(shortfalls)
    return true
  }

  function closeScanBlockAlert() {
    scanBlockAlertRef.current = false
    setScanBlockAlert(null)
    window.setTimeout(focusProductSearch, 40)
  }

  function openBarcodePick(code: string, list: Product[]) {
    barcodePickRef.current = true
    if (scanCommitTimer.current) {
      window.clearTimeout(scanCommitTimer.current)
      scanCommitTimer.current = null
    }
    scanBurstRef.current = false
    scanAccumRef.current = ''
    scanTypeBufRef.current = ''
    qRef.current = ''
    setQ('')
    if (searchInputRef.current) searchInputRef.current.value = ''
    try { searchInputRef.current?.blur() } catch { /* ignore */ }
    const sorted = list.slice().sort((a, b) => {
      const sa = liveStockForProduct(a) > 0 ? 1 : 0
      const sb = liveStockForProduct(b) > 0 ? 1 : 0
      if (sa !== sb) return sb - sa
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru')
    })
    setBarcodePick({ code, products: sorted })
  }

  function closeBarcodePick() {
    barcodePickRef.current = false
    setBarcodePick(null)
    window.setTimeout(focusProductSearch, 40)
  }

  function confirmBarcodePick(p: Product) {
    closeBarcodePick()
    addProduct(p, undefined, { fromScanner: true })
    window.setTimeout(focusProductSearch, 0)
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
    pickClientInPos(found)
    return true
  }

  /** Сканер / Enter: положить товар в чек. Ручной ввод без Enter — только фильтр (не сюда). */
  function commitPosSearch(rawIn?: string, opts?: { fromScanner?: boolean }): boolean {
    if (scanBlockAlertRef.current || barcodePickRef.current) return false
    const fromScanner = !!opts?.fromScanner || scanBurstRef.current
    const raw = String(
      rawIn
      || scanAccumRef.current
      || searchInputRef.current?.value
      || qRef.current
      || '',
    ).trim()
    if (!raw) return false
    scanAccumRef.current = ''
    scanTypeBufRef.current = ''

    const clientHit = findClientByScan(raw)
    const looksLikeClientCard = /какапо/i.test(raw) || /^k-?\d+/i.test(raw)
    if (clientHit && (looksLikeClientCard || !(
      findProductsByExactBarcode(products, raw).length
      || productCodeIndex.get(raw)
      || productCodeIndex.get(raw.replace(/\D/g, ''))
      || pickProductBySearch(products, raw)
    ))) {
      applyClientScan(raw)
      qRef.current = ''
      setQ('')
      scanBurstRef.current = false
      window.setTimeout(focusProductSearch, 0)
      return true
    }

    const digits = raw.replace(/\D/g, '')
    const pool = inStockProducts.length ? inStockProducts : products

    // 1a) Точный штрихкод: если 2+ товара — выбор, без автопробития
    const barcodeHits = findProductsByExactBarcode(products, raw) as Product[]
    if (barcodeHits.length > 1) {
      openBarcodePick(raw, barcodeHits)
      scanBurstRef.current = false
      return true
    }

    // 1b) Один штрихкод — обычные товары с 22… не путать с весом
    // Артикул/PLU через индекс — только если ключ не конфликтует с другим товаром
    let productHit: Product | null =
      (barcodeHits.length === 1 ? barcodeHits[0] : null)
      || null

    if (!productHit) {
      const byCode =
        productCodeIndex.get(raw)
        || (digits ? productCodeIndex.get(digits) : undefined)
        || (digits.length >= 1 && digits.length <= 4 && /^\d+$/.test(raw)
          ? productCodeIndex.get(`plu:${digits}`)
          : undefined)
        || null
      if (byCode && digits) {
        // Конфликт: у одного art=80, у другого plu=80 (Шакар / Milkiway)
        const codeNum = Number(digits)
        const conflict = products.filter(p => {
          const art = String(p.art || '').trim()
          const ad = art.replace(/\D/g, '')
          const plu = String(p.plu || '').replace(/\D/g, '')
          return art === raw
            || (ad && ad === digits)
            || (plu && plu === digits)
            || (Number.isFinite(codeNum) && codeNum > 0 && (
              Number(ad) === codeNum || Number(plu) === codeNum
            ))
        }) as Product[]
        const uniq = [...new Map(conflict.map(p => [p.id, p])).values()]
        if (uniq.length > 1) {
          openBarcodePick(raw, uniq)
          scanBurstRef.current = false
          return true
        }
      }
      if (byCode) productHit = byCode
    }

    if (!productHit) {
      productHit =
        (pool.find(p => String(p.art || '').trim() === raw || String(p.art || '').replace(/\D/g, '') === digits) as Product | undefined)
        || (digits.length >= 1 && digits.length <= 4 && /^\d+$/.test(raw)
          ? (pool.find(p => String(p.plu || '').replace(/\D/g, '') === digits) as Product | undefined)
          : undefined)
        || null
    }

    // 2) Весовая этикетка только 21 IIIII WWWWW C (после точного штриха)
    if (!productHit) {
      const scaleLabel = parseScaleBarcode(raw)
      if (scaleLabel) {
        const scaleHits = findProductsForScaleBarcode(pool, scaleLabel)
        const scaleHitsAll = scaleHits.length
          ? scaleHits
          : findProductsForScaleBarcode(products, scaleLabel)
        if (scaleHitsAll.length > 1) {
          openBarcodePick(raw, scaleHitsAll as Product[])
          scanBurstRef.current = false
          return true
        }
        const scaleHit = scaleHitsAll[0] || null
        if (!scaleHit) {
          openScanBlockAlert(
            'Этикетка не найдена',
            `PLU ${scaleLabel.itemCode} · ${scaleLabel.grams} г — проверьте выгрузку PLU на весы`,
            raw,
          )
          scanBurstRef.current = false
          return true
        }
        if (!isWeighted(scaleHit)) {
          openScanBlockAlert(
            'Не весовой товар',
            `${scaleHit.name} — в карточке тип не «вес». Касса остановлена — нажмите «Отмена».`,
            raw,
          )
          scanBurstRef.current = false
          return true
        }
        addProduct(scaleHit as Product, scaleLabel.weightKg, { fromScanner: true })
        qRef.current = ''
        setQ('')
        scanBurstRef.current = false
        window.setTimeout(focusProductSearch, 0)
        return true
      }
    }

    // Точный код не сработал — однозначный поиск по имени/коду (и для сканера, и для Enter)
    if (!productHit) {
      productHit =
        (pickProductBySearch(pool, raw) as Product | null)
        || (pickProductBySearch(products, raw) as Product | null)
        || null
    }

    if (!productHit) {
      // Скан / длинный цифровой код — блокируем кассу
      const looksNumericCode = digits.length >= 6 && /^\d[\d\s\-]*$/.test(raw)
      // Неполный штрих (сканер ещё шлёт) — не пугаем «не найден» и не стопорим кассу
      if (fromScanner && looksIncompleteScannerCode(raw) && !hasExactProductCode(raw) && scanExtendRef.current < 2) {
        scanAccumRef.current = raw.replace(/\D/g, '')
        scanTypeBufRef.current = scanAccumRef.current
        scanBurstRef.current = true
        qRef.current = scanAccumRef.current
        setQ(scanAccumRef.current)
        scheduleScanCommit(SCAN_IDLE_MS)
      return false
      }
      if (fromScanner || looksNumericCode) {
        openScanBlockAlert(
          'Товар не найден',
          'Штрихкода нет в базе. Касса остановлена — нажмите «Отмена», затем сканируйте снова.',
          raw,
        )
        scanBurstRef.current = false
        return true
      }
      scanBurstRef.current = false
      return false
    }
    addProduct(productHit, undefined, { fromScanner: true })
    qRef.current = ''
    setQ('')
    scanBurstRef.current = false
    window.setTimeout(focusProductSearch, 0)
    return true
  }
  commitPosSearchRef.current = commitPosSearch

  function scheduleScanCommit(delayMs: number) {
    if (scanCommitTimer.current) {
      window.clearTimeout(scanCommitTimer.current)
      scanCommitTimer.current = null
    }
    scanCommitTimer.current = window.setTimeout(() => {
      scanCommitTimer.current = null
      if (scanBlockAlertRef.current || barcodePickRef.current) return
      if (!scanBurstRef.current) return
      const live = String(
        scanAccumRef.current
        || searchInputRef.current?.value
        || qRef.current
        || '',
      ).trim()
      // Не пробиваем быстрый набор названия («нон», «молоко») — только коды сканера
      if (!isScannerCodeText(live)) {
        scanBurstRef.current = false
        scanAccumRef.current = ''
        scanTypeBufRef.current = ''
        scanExtendRef.current = 0
        return
      }
      // Неполный код без точного hit — ждём ещё немного (сканер досылает хвост)
      if (
        looksIncompleteScannerCode(live)
        && !hasExactProductCode(live)
        && scanExtendRef.current < 2
      ) {
        scanExtendRef.current += 1
        scheduleScanCommit(SCAN_IDLE_MS)
        return
      }
      scanExtendRef.current = 0
      commitPosSearch(live, { fromScanner: true })
    }, delayMs)
  }

  function onProductSearchChange(value: string) {
    noteCashierSearchActivity()
    // Во время burst сканера поле/сетку не трогаем — код копится в scanAccumRef
    if (scanBurstRef.current) {
      qRef.current = scanAccumRef.current || qRef.current
      return
    }
    qRef.current = value
    setQ(value)
  }

  function onProductSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    noteCashierSearchActivity()
    if (scanBlockAlertRef.current || barcodePickRef.current) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        if (barcodePickRef.current) closeBarcodePick()
        else closeScanBlockAlert()
      }
      return
    }
    const now = performance.now()
    const gap = now - scanLastKeyTs.current
    scanLastKeyTs.current = now

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const isDigitKey = /^\d$/.test(e.key)

      // Буквы / символы = ручной поиск, даже при очень быстром наборе
      if (!isDigitKey) {
        if (scanCommitTimer.current) {
          window.clearTimeout(scanCommitTimer.current)
          scanCommitTimer.current = null
        }
        scanBurstRef.current = false
        scanAccumRef.current = ''
        scanTypeBufRef.current = ''
        scanExtendRef.current = 0
        return
      }

      const pendingDigits = String(scanTypeBufRef.current || scanAccumRef.current || '').replace(/\D/g, '')
      const continueBurst =
        (scanBurstRef.current || pendingDigits.length >= 3)
        && gap < 520

      // Пауза большая и это не продолжение штрихкода — новый ввод
      if (!continueBurst && gap >= SCAN_GAP_RESET_MS) {
        scanBurstRef.current = false
        scanAccumRef.current = ''
        scanTypeBufRef.current = e.key
        scanExtendRef.current = 0
        // дальше onChange обновит поле — без preventDefault
        return
      }
      // Быстрый поток цифр = USB-сканер (не путать с набором названия)
      const fast = continueBurst || gap < SCAN_GAP_FAST_MS || (scanBurstRef.current && gap < SCAN_GAP_BURST_MS)
      if (fast) {
        const prior = String(qRef.current || searchInputRef.current?.value || '')
        // В поле уже название буквами — продолжаем ручной ввод
        if (/[^\d\s-]/.test(prior) && !scanBurstRef.current && pendingDigits.length < 3) {
          scanBurstRef.current = false
          scanAccumRef.current = ''
          scanTypeBufRef.current = ''
          return
        }
        scanBurstRef.current = true
        if (!scanTypeBufRef.current) {
          scanTypeBufRef.current = prior.replace(/[^\d-]/g, '')
        }
        scanTypeBufRef.current += e.key
        scanAccumRef.current = scanTypeBufRef.current
        qRef.current = scanAccumRef.current
        scanExtendRef.current = 0
        e.preventDefault()
        scheduleScanCommit(SCAN_IDLE_MS)
        return
      }
      // Средний темп цифр — ручной PLU/поиск
      scanBurstRef.current = false
      scanAccumRef.current = ''
      scanTypeBufRef.current = ''
      scanExtendRef.current = 0
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      const accum = String(scanAccumRef.current || scanTypeBufRef.current || '').trim()
      const isScanner = scanBurstRef.current && isScannerCodeText(accum)
      const fromAccum = isScanner ? accum : ''
      const raw = (
        fromAccum
        || (e.currentTarget as HTMLInputElement).value
        || qRef.current
        || ''
      ).trim()
      if (!raw) return
      if (e.key === 'Tab' && !isScanner) return
      e.preventDefault()
      if (scanCommitTimer.current) {
        window.clearTimeout(scanCommitTimer.current)
        scanCommitTimer.current = null
      }
      scanTypeBufRef.current = ''
      scanAccumRef.current = ''
      scanBurstRef.current = false
      scanExtendRef.current = 0
      // Enter по названию — пробитие только если однозначный код/штрих, иначе фильтр уже в сетке
      commitPosSearch(raw, { fromScanner: isScanner })
    }
  }

  function appendDigit(buf: string, k: string, maxLen = 8) {
    if (k === '.' && buf.includes('.')) return buf
    if (buf.replace('.', '').length >= maxLen) return buf
    return buf + k
  }

  async function ensureCashier(name: string, preferredId?: string) {
    const res = await ensureCashierSafe({ name, preferredId })
    return res.data
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
      const opened = await openShiftSafe({
        cashierId: cashier.id,
        cashierName: cashier.name,
        openingCash: cash,
        posId,
      })
      void useOfflineSync.getState().syncNow()
      if (!opened.offline) void refresh()
      setCart([])
      setClient(null)
      setDiscountPct(0)
      setBonusUsed(0)
      setPay('cash')
      setOpenShiftModal(false)
      setOpeningPosId(null)
      setPosSurface('register')
      showToast(
        'Смена открыта',
        opened.offline ? `${cashier.name} · отправится в фоне` : cashier.name,
      )
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
      await createPosPointSafe({ name, code: newPosCode.trim() || undefined })
      setCreatePosModal(false)
      setNewPosName('')
      setNewPosCode('')
      showToast('Точка создана', `${name} · отправится в фоне`)
      void useOfflineSync.getState().syncNow()
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
        if (name) rememberReceiptPrinterName(name)
        setDeskPaperMm(XP58C_RECEIPT_MM)
        setDeskScaleMode(settings?.scaleMode === 'none' ? 'none' : 'plu-label')
        setDeskScaleHost(settings?.scaleHost || '')
        setDeskScalePort(String(settings?.scalePort || 20304))
        setDeskScaleDept(String(settings?.scaleDept || 1))
        setDeskScaleLiveWeight(settings?.scaleLiveWeight !== false)
        if (name && desk) {
          // Не затираем IP/порт весов при автосохранении принтера
          void desk.savePrinterSettings({
            printerName: name,
            paperWidthMm: XP58C_RECEIPT_MM,
            scaleMode: settings?.scaleMode === 'none' ? 'none' : 'plu-label',
            scaleHost: settings?.scaleHost || '',
            scalePort: Number(settings?.scalePort) || 20304,
            scaleDept: Number(settings?.scaleDept) || 1,
            scaleLiveWeight: settings?.scaleLiveWeight !== false,
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
      await updatePosPointSafe(editPosId, {
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
        const cur = await desk?.getPrinterSettings()
        // Весы сохраняем всегда; принтер — если выбран
        await desk?.savePrinterSettings({
          ...cur,
          ...(printerName ? { printerName, paperWidthMm: XP58C_RECEIPT_MM } : {}),
          scaleMode: deskScaleMode,
          scaleHost: deskScaleHost.trim(),
          scalePort: Number(deskScalePort) || 20304,
          scaleDept: Number(deskScaleDept) || 1,
          scaleLiveWeight: deskScaleLiveWeight,
        })
        if (printerName) {
        setDeskPrinterName(printerName)
        setDeskPaperMm(XP58C_RECEIPT_MM)
      }
        if (deskScaleMode === 'plu-label' && deskScaleLiveWeight && deskScaleHost.trim()) {
          void ensureCasWeightMonitor(true)
        } else {
          void ensureCasWeightMonitor(false)
        }
      }
      setEditPosId(null)
      showToast('Сохранено', `${name} · отправится в фоне`)
      void useOfflineSync.getState().syncNow()
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
        desk.getPrinters(true),
        desk.getPrinterSettings().catch(() => null),
      ])
      const list = sortReceiptPrinters(printers || [])
      setDeskPrinters(list)
      const saved = String(settings?.printerName || deskPrinterName || '').trim()
      const savedOk = saved && list.some(p => p.name === saved)
      const auto = pickReceiptPrinter(list)
      const name = (savedOk ? saved : '') || auto || ''
      setDeskPrinterName(name)
      if (name) rememberReceiptPrinterName(name)
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
      const name = posPoints.find(p => p.id === deletePosId)?.name || 'Точка'
      await deletePosPointSafe(deletePosId)
      setDeletePosId(null)
      showToast('Удалено', `${name} · отправится в фоне`)
      void useOfflineSync.getState().syncNow()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  async function closeShift() {
    if (!activeShift) return
    if (!shiftReconciled) {
      setMsg('Сначала сделайте сверку нал и карта')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const cash = Number(closingCash)
      const card = Number(closingCard)
      if (!(cash >= 0) || closingCash === '') throw new Error('Укажите сумму наличных в кассе')
      if (!(card >= 0) || closingCard === '') throw new Error('Укажите сумму по карте / переводам')
      const rec = analyzeShiftReconcile(
        closingCash,
        closingCard,
        expectedTillCash(activeShift),
        Number(activeShift.salesCard) || 0,
      )
      const closed = await closeShiftSafe(activeShift.id, {
        closingCash: cash,
        closingCard: card,
        note: rec.move?.text || rec.summary.text,
      })
      if (!closed.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      setShiftReconcileOpen(false)
      setShiftReconciled(false)
      setCashierScreen(null)
      setCashierMenuOpen(false)
      setPosSurface('dashboard')
      setCart([])
      setClient(null)
      setGateCash(String(cash.toFixed(2)))
      const diffNote = rec.move?.text || rec.summary.text
      showToast(
        'Смена закрыта',
        closed.offline
          ? `${fmtMoney(cash)} нал · ${fmtMoney(card)} карта · в ящик${diffNote ? ` · ${diffNote}` : ''}`
          : `${fmtMoney(cash)} нал · ${fmtMoney(card)} карта · основной ящик${diffNote ? ` · ${diffNote}` : ''}`,
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось закрыть смену')
    } finally {
      setBusy(false)
    }
  }

  function applyShiftReconcile() {
    setMsg('')
    if (closingCash === '' || !(Number(closingCash) >= 0)) {
      setMsg('Укажите сумму наличных')
      return
    }
    if (closingCard === '' || !(Number(closingCard) >= 0)) {
      setMsg('Укажите сумму по карте / переводам')
      return
    }
    setShiftReconciled(true)
    setShiftReconcileOpen(false)
  }

  async function switchCashier() {
    if (!activeShift) return
    const next = cashierOptions.find(c => c.id === switchCashierId)
    if (!next) {
      setMsg('Выберите кассира')
      return
    }
    if (!shiftReconciled) {
      setMsg('Сначала сделайте сверку нал и карта')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const cash = Number(closingCash)
      const card = Number(closingCard)
      if (!(cash >= 0) || closingCash === '') throw new Error('Укажите сумму наличных в кассе')
      if (!(card >= 0) || closingCard === '') throw new Error('Укажите сумму по карте / переводам')
      const rec = analyzeShiftReconcile(
        closingCash,
        closingCard,
        expectedTillCash(activeShift),
        Number(activeShift.salesCard) || 0,
      )
      const closed = await closeShiftSafe(activeShift.id, {
        closingCash: cash,
        closingCard: card,
        note: rec.move?.text || rec.summary.text,
      })
      const cashier = await ensureCashier(next.name, next.id)
      const s = { cashierId: cashier.id, cashierName: cashier.name, initials: initialsOf(cashier.name) }
      saveSettings(s)
      setSettings(s)
      const opened = await openShiftSafe({
        cashierId: cashier.id,
        cashierName: cashier.name,
        openingCash: cash,
        posId: activeShift.posId || activePosPoint?.id,
      })
      if (!closed.offline && !opened.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      setShiftReconcileOpen(false)
      setShiftReconciled(false)
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
      void refresh()
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
      setReceiptScope('shift')
      setReceiptLimit(50)
      setReceiptSaleId(null)
      setReturnQtyByIdx({})
      setCashierScreen('receipts')
      void refresh()
      return
    }
    const expected = activeShift ? expectedTillCash(activeShift) : 0
    const expectedCard = activeShift ? (Number(activeShift.salesCard) || 0) : 0
    setClosingCash(expected > 0 ? expected.toFixed(2) : '0.00')
    setClosingCard(expectedCard > 0 ? expectedCard.toFixed(2) : '0.00')
    setShiftReconcileOpen(false)
    setShiftReconciled(false)
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
      const moved = await financeMoveSafe({
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
      if (!moved.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      const kindLabel = tillMoveKind === 'in' ? 'Внесено' : 'Снято'
      const supplierName = tillSupplierId
        ? suppliers.find(s => s.id === tillSupplierId)?.name
        : ''
      const offlineNote = moved.offline ? ' · отправится в фоне' : ''
      showToast(
        kindLabel,
        (supplierName ? `${fmtMoney(amount)} · ${supplierName}` : fmtMoney(amount)) + offlineNote,
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
    return Math.max(0, Math.round(((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)) * 1000) / 1000)
  }

  const RETURN_WEIGHT_STEP_KG = 0.05

  function isSaleLineWeighted(
    line: { unit?: string; qty?: number; productId?: number },
    product?: Product | null,
  ): boolean {
    const u = String(line.unit || '').trim().toLowerCase()
    if (u === 'кг' || u === 'kg') return true
    if (product && isWeighted(product)) return true
    return false
  }

  function returnQtyStep(weighted: boolean): number {
    return weighted ? RETURN_WEIGHT_STEP_KG : 1
  }

  function formatReturnQty(n: number, unitLabel: string, weighted: boolean): string {
    const u = unitLabel.toLowerCase()
    if (weighted && (u === 'кг' || u === 'kg') && n > 0 && n < 1) {
      return `${Math.round(n * 1000)} г`
    }
    const q = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
    return `${q} ${unitLabel}`
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

  /** Отсортированные чеки точки — один раз, не на каждый символ сканера */
  const receiptsSorted = useMemo(() => {
    const posId = activeShift?.posId
    return [...sales]
      .filter(s => {
        if (!posId) return true
        if (s.posId) return s.posId === posId
        // Без posId — только чеки текущей/известных смен этой точки (не чужие кассы)
        if (s.shiftId && activeShift?.id && s.shiftId === activeShift.id) return true
        if (s.shiftId && shifts.some(sh => sh.id === s.shiftId && sh.posId === posId)) return true
        if (!s.shiftId) return true
        return false
      })
      .sort((a, b) => {
        // Сначала — свежесть по createdAtIso, иначе «временные» офлайн-чеки
        // (когда orderId ещё без цифровой части) могут уйти за лимит списка.
        const tb = Date.parse(String(b.createdAtIso || '')) || 0
        const ta = Date.parse(String(a.createdAtIso || '')) || 0
        if (tb !== ta) return tb - ta

        // Потом — привычная сортировка по номеру/порядковому хвосту orderId.
        const nb = saleOrderSeq(b)
        const na = saleOrderSeq(a)
        if (nb !== na) return nb - na

        // И наконец — детерминированный тай-брейкер.
        return String(b.id || '').localeCompare(String(a.id || ''))
      })
  }, [sales, activeShift?.posId, activeShift?.id, shifts])

  /** Штрихкод / PLU / арт → productId + готовые коды по id */
  const receiptBarcodeIndex = useMemo(() => {
    const exact = new Map<string, number>()
    const digits = new Map<string, number>()
    const codesById = new Map<number, { art: string; barcode: string; plu: string }>()
    for (const p of products) {
      const id = Number(p.id)
      if (!Number.isFinite(id)) continue
      const codes = productBarcodes(p)
      const art = String(p.art || '').trim()
      const plu = String(p.plu || '').trim()
      const barcode = codes[0] || ''
      codesById.set(id, { art, barcode, plu })
      for (const c of codes) {
        const raw = String(c || '').trim()
        if (!raw) continue
        exact.set(raw, id)
        exact.set(raw.toLowerCase(), id)
        const d = raw.replace(/\D/g, '')
        if (d.length >= 4) digits.set(d, id)
      }
      if (art) {
        exact.set(art, id)
        exact.set(art.toLowerCase(), id)
      }
      const pluDigits = plu.replace(/\D/g, '')
      if (pluDigits) digits.set(pluDigits, id)
    }
    return { exact, digits, codesById }
  }, [products])

  function resolveReceiptProductIds(qRaw: string): Set<number> {
    const ids = new Set<number>()
    const q = qRaw.trim()
    if (!q) return ids
    const qDigits = q.replace(/\D/g, '')
    const looksOrderNum = /^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(q)
    const fromExact = receiptBarcodeIndex.exact.get(q) ?? receiptBarcodeIndex.exact.get(q.toLowerCase())
    if (fromExact != null) ids.add(fromExact)
    if (qDigits) {
      const fromDigits = receiptBarcodeIndex.digits.get(qDigits)
      if (fromDigits != null) ids.add(fromDigits)
    }
    // Полный штрихкод / несколько карточек с одним кодом
    if (qDigits.length >= 8 || q.length >= 8) {
      for (const p of findProductsByExactBarcode(products, q)) {
        if (p.id != null) ids.add(Number(p.id))
      }
    }
    // Хвост штрихкода (последние 4–7 цифр) — как на кассе
    if (!ids.size && qDigits.length >= 4 && qDigits.length <= 13 && /^\d+$/.test(q.replace(/[\s\-]/g, ''))) {
      for (const p of products) {
        const id = Number(p.id)
        if (!Number.isFinite(id)) continue
        const hit = productBarcodes(p).some(c => {
          const cd = c.replace(/\D/g, '')
          return cd.length >= qDigits.length && cd.endsWith(qDigits)
        })
        if (hit) ids.add(id)
      }
    }
    // Поиск по названию товара → id (чтобы в истории остались только чеки с ним)
    if (!ids.size && !looksOrderNum && q.length >= 2) {
      for (const p of filterProductsBySearch(products, q, 40)) {
        if (p.id != null) ids.add(Number(p.id))
      }
    }
    return ids
  }

  /** Чек содержит один из товаров (по id или имени строки — на случай рассинхрона id) */
  function saleHasAnyProduct(
    s: (typeof sales)[number],
    productIds: Set<number>,
    nameHints: Set<string>,
    qHint = '',
  ): boolean {
    if (!productIds.size) return false
    const qn = qHint.toLowerCase().trim()
    for (const it of s.items || []) {
      if (productIds.has(Number(it.productId))) return true
      const nm = String(it.productName || '').toLowerCase().trim()
      if (nm && nameHints.has(nm)) return true
      if (qn.length >= 2 && nm.includes(qn)) return true
    }
    return false
  }

  function saleMatchesReceiptFilter(s: (typeof sales)[number], filter: typeof receiptFilter) {
        const fully = isSaleFullyReturned(s)
        const partial = isSalePartiallyReturned(s)
    if (filter === 'returned') return fully || partial
    if (filter === 'cash') return !fully && s.paymentMethod === 'cash'
    if (filter === 'card') return !fully && (s.paymentMethod === 'card' || s.paymentMethod === 'mixed')
    if (filter === 'credit') return !fully && (s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0)
        return true
  }

  function receiptPeriodBounds(fromStr: string, toStr: string): { fromMs: number; toMs: number } | null {
    const startOfDay = (d: Date) => {
      const x = new Date(d)
      x.setHours(0, 0, 0, 0)
      return x.getTime()
    }
    const endOfDay = (d: Date) => {
      const x = new Date(d)
      x.setHours(23, 59, 59, 999)
      return x.getTime()
    }
    const from = new Date(fromStr)
    const to = new Date(toStr)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
    const a = startOfDay(from)
    const b = endOfDay(to)
    return a <= b ? { fromMs: a, toMs: b } : { fromMs: startOfDay(to), toMs: endOfDay(from) }
  }

  function saleInReceiptPeriod(s: (typeof sales)[number], bounds: { fromMs: number; toMs: number } | null) {
    if (!bounds) return true
    const t = new Date(s.createdAtIso).getTime()
    if (Number.isNaN(t)) return true
    return t >= bounds.fromMs && t <= bounds.toMs
  }

  /** Чек относится к текущей открытой смене */
  function saleInCurrentShift(s: (typeof sales)[number]) {
    if (!activeShift) return false
    const curId = String(activeShift.id || '').trim()
    const saleShiftId = String(s.shiftId || '').trim()
    // Явный shiftId — единственный надёжный критерий
    if (saleShiftId && curId) return saleShiftId === curId

    // Старые чеки без shiftId: только после открытия текущей смены
    // и не внутри интервала другой известной смены той же точки
    const t = new Date(s.createdAtIso).getTime()
    const open = new Date(activeShift.openedAtIso).getTime()
    if (Number.isNaN(t) || Number.isNaN(open) || t < open) return false

    const posId = String(activeShift.posId || '').trim()
    for (const sh of shifts) {
      if (!sh) continue
      const shId = String(sh.id || '').trim()
      if (!shId || shId === curId) continue
      if (posId && sh.posId && String(sh.posId) !== posId) continue
      const shOpen = new Date(sh.openedAtIso).getTime()
      if (Number.isNaN(shOpen) || t < shOpen) continue
      const closedRaw = sh.closedAtIso
      if (closedRaw) {
        const shClose = new Date(closedRaw).getTime()
        if (!Number.isNaN(shClose) && t > shClose) continue
      } else if (sh.status === 'closed') {
        continue
      }
      // Чек попадает в чужую смену
      return false
    }
    return true
  }

  function saleMatchesReceiptScope(s: (typeof sales)[number], scope: typeof receiptScope) {
    const inShift = saleInCurrentShift(s)
    if (scope === 'shift') return inShift
    // «Другие смены» — только выбранный период дат, без текущей смены
    if (!saleInReceiptPeriod(s, receiptPeriodBounds(receiptFrom, receiptTo))) return false
    return !inShift
  }

  /** Все чеки в выбранной вкладке (смена / период) — поиск только внутри этого набора */
  const scopedReceipts = useMemo(
    () => receiptsSorted.filter(s => saleMatchesReceiptScope(s, receiptScope)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receiptsSorted, receiptScope, receiptFrom, receiptTo, activeShift?.id, activeShift?.openedAtIso, shifts],
  )

  function productCodesForId(productId: number | undefined | null) {
    if (productId == null) return { art: '', barcode: '', plu: '' }
    return receiptBarcodeIndex.codesById.get(Number(productId)) || { art: '', barcode: '', plu: '' }
  }

  function shiftLabelForSale(s: (typeof sales)[number]) {
    const sh = s.shiftId ? shifts.find(x => x.id === s.shiftId) : null
    if (sh) {
      const opened = new Date(sh.openedAtIso)
      const time = Number.isNaN(opened.getTime())
        ? ''
        : opened.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return `${sh.cashierName || 'Смена'}${time ? ` · с ${time}` : ''}${sh.status === 'closed' ? ' · закрыта' : ''}`
    }
    if (activeShift && saleInCurrentShift(s)) {
      const opened = new Date(activeShift.openedAtIso)
      const time = Number.isNaN(opened.getTime())
        ? ''
        : opened.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return `${activeShift.cashierName || settings.cashierName}${time ? ` · с ${time}` : ''}`
    }
    return 'Другая смена'
  }

  function needsAdminReturnConfirm(sale: (typeof sales)[number]) {
    if (!activeShift) return true
    if (sale.shiftId && sale.shiftId !== activeShift.id) return true
    return !saleInCurrentShift(sale)
  }

  /** Быстрый поиск чеков: штрихкод / номер — без тяжёлого hay на каждый символ */
  function findReceiptsByQuery(
    qRawIn: string,
    filter: typeof receiptFilter,
    scope: typeof receiptScope,
    limit = 0,
  ) {
    const qRaw = qRawIn.trim()
    const q = qRaw.toLowerCase()
    const qDigits = qRaw.replace(/[^\d]/g, '')
    const looksOrderNum = /^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(qRaw)
    const productIds = qRaw && !looksOrderNum ? resolveReceiptProductIds(qRaw) : new Set<number>()
    const isBarcodeLike = productIds.size > 0 || qDigits.length >= 8

    const nameHints = new Set<string>()
    if (productIds.size) {
      for (const id of productIds) {
        const p = products.find(x => Number(x.id) === id)
        const nm = String(p?.name || '').toLowerCase().trim()
        if (nm) nameHints.add(nm)
      }
    }

    // Длинный штрихкод без товара — сразу пусто, без тяжёлого текстового поиска
    if (qDigits.length >= 8 && productIds.size === 0 && !looksOrderNum) {
      return [] as typeof sales
    }

    const out: typeof sales = []
    // Ищем только внутри переданного scope (эта смена / период дат)
    const base = scope === receiptScope
      ? scopedReceipts
      : receiptsSorted.filter(s => saleMatchesReceiptScope(s, scope))
    for (const s of base) {
      if (!saleMatchesReceiptFilter(s, filter)) continue
      if (!q) {
        out.push(s)
        if (limit > 0 && out.length >= limit) break
        continue
      }

      const items = s.items || []
        const seq = saleOrderSeq(s)
        const label = saleNumberLabel(s)

      // Товар (штрих / название / арт) — строго только чеки с этим товаром
      if (productIds.size > 0) {
        if (saleHasAnyProduct(s, productIds, nameHints, q)) {
          out.push(s)
          if (limit > 0 && out.length >= limit) break
        }
        continue
      }

        if (looksOrderNum && qDigits) {
        if (
          String(seq) === qDigits
          || label.toLowerCase() === q
          || label.replace(/^k-/i, '') === qDigits
          || String(s.number || '') === qDigits
        ) {
          out.push(s)
          if (limit > 0 && out.length >= limit) break
        }
        continue
      }

      // Текст: сначала строки чека (название / коды товара)
      if (items.some(i => (i.productName || '').toLowerCase().includes(q))) {
        out.push(s)
        if (limit > 0 && out.length >= limit) break
        continue
      }

      if (q.length >= 2 && items.some(i => {
        const codes = productCodesForId(i.productId)
        return (
          codes.art.toLowerCase().includes(q)
          || codes.barcode.toLowerCase().includes(q)
          || (qDigits.length >= 4 && codes.barcode.replace(/\D/g, '').endsWith(qDigits))
          || codes.plu === qDigits
        )
      })) {
        out.push(s)
        if (limit > 0 && out.length >= limit) break
        continue
      }

      // Клиент / номер чека — только если это не «товарный» запрос
      if (!isBarcodeLike) {
        const hay = [
          label,
          seq > 0 ? String(seq) : '',
          s.orderId,
          s.id,
          s.clientName,
          s.clientPhone,
          s.cardNum,
          s.cashierName,
        ].join(' ').toLowerCase()
        if (hay.includes(q)) {
          out.push(s)
          if (limit > 0 && out.length >= limit) break
        }
      }
    }
    return out
  }

  const receiptMatches = useMemo(
    () => findReceiptsByQuery(receiptQDeferred, receiptFilter, receiptScope, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers close over scopedReceipts/products
    [receiptQDeferred, receiptFilter, receiptScope, scopedReceipts, products, receiptBarcodeIndex],
  )

  const receiptList = useMemo(
    () => receiptMatches.slice(0, receiptLimit),
    [receiptMatches, receiptLimit],
  )

  const receiptListTotalCount = receiptMatches.length

  const receiptPeriodSum = useMemo(() => {
    let sum = 0
    for (const s of receiptMatches) {
      if (isSaleFullyReturned(s)) continue
      sum += Number(s.total) || 0
    }
    return Math.round(sum * 100) / 100
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptMatches])

  const receiptShiftHeader = useMemo(() => {
    if (!activeShift) return null
    const opened = new Date(activeShift.openedAtIso)
    const time = Number.isNaN(opened.getTime())
      ? '—'
      : opened.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const shortId = String(activeShift.id || '').replace(/\D/g, '').slice(-4)
      || String(activeShift.id || '').slice(-4)
    return {
      title: `Смена${shortId ? ` · ${shortId}` : ''} · ${activeShift.cashierName || settings.cashierName}`,
      openedLabel: `открыта ${time}`,
    }
  }, [activeShift, settings.cashierName])

  const receiptProductHint = useMemo(() => {
    const qRaw = receiptQDeferred.trim()
    if (!qRaw) return null
    if (/^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(qRaw)) return null
    const ids = resolveReceiptProductIds(qRaw)
    let hitName = ''
    let hitId: number | null = null
    let codes = { art: '', barcode: '', plu: '' }
    if (ids.size) {
      hitId = [...ids][0]
      const p = products.find(x => Number(x.id) === hitId)
      hitName = p?.name || ''
      codes = productCodesForId(hitId)
    } else {
    const hit = pickProductBySearch(products, qRaw)
    if (!hit) return null
      hitId = Number(hit.id)
      hitName = hit.name
      codes = productCodesForId(hitId)
    }
    if (hitId == null || !hitName) return null
    const nameHints = new Set([hitName.toLowerCase().trim()].filter(Boolean))
    const idSet = new Set<number>([hitId])
    const n = receiptMatches.filter(s => saleHasAnyProduct(s, idSet, nameHints, qRaw.toLowerCase())).length
    return { name: hitName, count: n, art: codes.art, barcode: codes.barcode, plu: codes.plu }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptQDeferred, products, receiptMatches, receiptBarcodeIndex])

  function resolveCashierName(opts?: {
    cashierId?: string
    cashierName?: string
    shiftId?: string
  } | null): string {
    const fromSale = cashierDisplayName(opts || null)
    if (fromSale && fromSale !== '—' && !/^кассир$/i.test(fromSale)) return fromSale
    const fromShift = String(activeShift?.cashierName || '').trim()
    if (fromShift && !/^кассир$/i.test(fromShift)) return fromShift
    const fromSettings = String(settings.cashierName || '').trim()
    if (fromSettings && !/^кассир$/i.test(fromSettings)) return fromSettings
    try {
      const emp = String(loadTradeEmployeeSession()?.name || '').trim()
      if (emp) return emp
    } catch { /* ignore */ }
    return fromSale !== '—' ? fromSale : (fromSettings || 'Кассир')
  }

  function cashierDisplayName(s: { cashierId?: string; cashierName?: string; shiftId?: string } | null | undefined): string {
    if (!s) {
      try {
        const emp = String(loadTradeEmployeeSession()?.name || '').trim()
        if (emp) return emp
      } catch { /* ignore */ }
      return '—'
    }
    const raw = String(s.cashierName || '').trim()
    const isGeneric = !raw || /^кассир$/i.test(raw)
    if (!isGeneric) return raw
    if (s.cashierId) {
      const fromList = cashiers.find(c => c.id === s.cashierId)
      if (fromList?.name?.trim() && !/^кассир$/i.test(fromList.name.trim())) return fromList.name.trim()
    }
    if (s.shiftId) {
      const fromShift = shifts.find(x => x.id === s.shiftId)
      const sn = String(fromShift?.cashierName || '').trim()
      if (sn && !/^кассир$/i.test(sn)) return sn
    }
    if (s.cashierId) {
      const fromShiftByCashier = shifts.find(x => x.cashierId === s.cashierId)
      const sn = String(fromShiftByCashier?.cashierName || '').trim()
      if (sn && !/^кассир$/i.test(sn)) return sn
    }
    const fallback = String(settings.cashierName || '').trim()
    if (fallback && !/^кассир$/i.test(fallback)) return fallback
    try {
      const emp = String(loadTradeEmployeeSession()?.name || '').trim()
      if (emp) return emp
    } catch { /* ignore */ }
    return raw || '—'
  }

  function commitReceiptSearch(rawIn: string, opts?: { openIfUnique?: boolean }) {
    const raw = String(rawIn || '').trim()
    setReceiptQ(raw)
    if (!raw || !opts?.openIfUnique) return
    // Скан товара — только фильтр списка чеков, не открываем единственный чек
    const productIds = resolveReceiptProductIds(raw)
    if (productIds.size > 0) return
    const looksOrderNum = /^(?:k-?\s*)?[#№]?\s*\d{1,6}$/i.test(raw)
    if (!looksOrderNum) return
    const hits = findReceiptsByQuery(raw, receiptFilter, receiptScope, 5)
    if (hits.length === 1) {
      setReturnQtyByIdx({})
      setReceiptSaleId(hits[0].id)
    }
  }

  function onReceiptSearchChange(value: string) {
    if (receiptScanBurstRef.current && receiptScanAccumRef.current) {
      return
    }
    setReceiptQ(value)
  }

  function onReceiptSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const now = performance.now()
    const gap = now - receiptScanLastTsRef.current
    receiptScanLastTsRef.current = now

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (receiptScanTimerRef.current) {
        window.clearTimeout(receiptScanTimerRef.current)
        receiptScanTimerRef.current = null
      }
      const raw = String(
        receiptScanAccumRef.current || (e.currentTarget as HTMLInputElement).value || receiptQ || '',
      ).trim()
      receiptScanBurstRef.current = false
      receiptScanAccumRef.current = ''
      commitReceiptSearch(raw, { openIfUnique: true })
      return
    }

    if (e.key === 'Escape') {
      receiptScanBurstRef.current = false
      receiptScanAccumRef.current = ''
      setReceiptQ('')
      return
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (gap >= 180) {
        receiptScanBurstRef.current = false
        receiptScanAccumRef.current = e.key
        return
      }
      const fast = gap < 90 || receiptScanBurstRef.current
      if (fast) {
        receiptScanBurstRef.current = true
        if (!receiptScanAccumRef.current) {
          receiptScanAccumRef.current = String(receiptQ || e.currentTarget.value || '')
        }
        receiptScanAccumRef.current += e.key
        e.preventDefault()
        if (receiptScanTimerRef.current) window.clearTimeout(receiptScanTimerRef.current)
        receiptScanTimerRef.current = window.setTimeout(() => {
          receiptScanTimerRef.current = null
          if (!receiptScanBurstRef.current) return
          const live = String(receiptScanAccumRef.current || '').trim()
          receiptScanBurstRef.current = false
          receiptScanAccumRef.current = ''
          if (live.length >= 3) commitReceiptSearch(live, { openIfUnique: true })
        }, 45)
        return
      }
      receiptScanBurstRef.current = false
      receiptScanAccumRef.current = ''
    }
  }

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
    if (!receiptDetail) {
      return {
        count: 0,
        total: 0,
        giveMoney: 0,
        giveCash: 0,
        giveCard: 0,
        cutDebt: 0,
        items: [] as { index: number; qty: number }[],
      }
    }
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
    const goods = Math.round(total * 100) / 100
    const payout = goods > 0.001
      ? previewReturnPayout(receiptDetail, goods)
      : { giveMoney: 0, giveCash: 0, giveCard: 0, cutDebt: 0 }
    return {
      count: items.length,
      total: goods,
      giveMoney: payout.giveMoney,
      giveCash: payout.giveCash,
      giveCard: payout.giveCard,
      cutDebt: payout.cutDebt,
      items,
    }
  }, [receiptDetail, returnQtyByIdx])

  function returnPayoutHint(p: {
    giveMoney: number
    giveCash: number
    giveCard: number
    cutDebt: number
    total: number
  }) {
    const parts: string[] = []
    parts.push(`К выдаче ${fmtMoney(p.giveMoney)}`)
    if (p.giveCash > 0.001 && p.giveCard > 0.001) {
      parts.push(`нал ${fmtMoney(p.giveCash)} · карта ${fmtMoney(p.giveCard)}`)
    } else if (p.giveCard > 0.001 && p.giveCash < 0.001) {
      parts.push('на карту')
    }
    if (p.cutDebt > 0.001) parts.push(`долг −${fmtMoney(p.cutDebt)}`)
    if (p.total > 0.001 && Math.abs(p.total - p.giveMoney - p.cutDebt) > 0.05) {
      parts.push(`товары ${fmtMoney(p.total)}`)
    }
    return parts.join(' · ')
  }

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

  function setReturnLineQty(index: number, qty: number, left: number, weighted = false) {
    const prec = weighted ? 1000 : 100
    const q = Math.max(0, Math.min(left, Math.round(qty * prec) / prec))
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
    let title = ''
    let body = ''

    if (mode === 'all') {
      const all = (sale.items || []).map((line, index) => ({ index, qty: saleLineLeft(line) })).filter(x => x.qty > 0)
      if (!all.length) {
        showToast('Нечего возвращать', 'Все позиции уже возвращены')
        return
      }
      payloadItems = undefined
      confirmTotal = Number(sale.total) || 0
      const payout = previewReturnPayout(sale, confirmTotal)
      title = 'Вернуть весь чек?'
      body = `${returnPayoutHint({
        ...payout,
        total: confirmTotal,
      })}. Все оставшиеся товары вернутся на склад.`
      setReturnConfirm({
        saleId,
        mode,
        title,
        body,
        total: confirmTotal,
        giveMoney: payout.giveMoney,
        cutDebt: payout.cutDebt,
        payloadItems,
        needAdmin: needsAdminReturnConfirm(sale),
        step: 'confirm',
        adminCode: '',
      })
      return
    }
    const selected = receiptReturnPreview.items
    if (!selected.length) {
      showToast('Выберите товары', 'Отметьте позиции для возврата')
      return
    }
    payloadItems = selected
    confirmTotal = receiptReturnPreview.total
    title = `Вернуть ${selected.length} позиц.?`
    body = `${returnPayoutHint(receiptReturnPreview)}. Товары вернутся на склад.`
    setReturnConfirm({
      saleId,
      mode,
      title,
      body,
      total: confirmTotal,
      giveMoney: receiptReturnPreview.giveMoney,
      cutDebt: receiptReturnPreview.cutDebt,
      payloadItems,
      needAdmin: needsAdminReturnConfirm(sale),
      step: 'confirm',
      adminCode: '',
    })
  }

  async function executeReturnConfirm() {
    const pending = returnConfirm
    if (!pending || busy) return
    if (pending.step === 'confirm' && pending.needAdmin) {
      setReturnConfirm({ ...pending, step: 'admin', adminCode: '' })
      return
    }
    if (pending.step === 'admin') {
      if (String(pending.adminCode || '').trim().toUpperCase() !== 'АДМИН') {
        showToast('Нужен код админа', 'Возврат из чужой смены отменён')
        return
      }
    }
    const sale = sales.find(s => s.id === pending.saleId)
    if (!sale) {
      setReturnConfirm(null)
      return
    }
    setReturnConfirm(null)
    setBusy(true)
    setMsg('')
    try {
      const debtBefore = Math.max(
        0,
        Number(sale.debtAdded) || 0,
        sale.paymentMethod === 'credit' ? (Number(sale.total) || 0) : 0,
        sale.paymentMethod === 'mixed'
          ? Math.max(
            0,
            (Number(sale.total) || 0)
            - (Number(sale.paidCash) || 0)
            - (Number(sale.paidCard) || 0)
            - (Number(sale.paidWallet) || 0),
          )
          : 0,
      )
      const res = await returnSaleSafe(sale, {
        note: pending.mode === 'all' ? 'Полный возврат с кассы' : 'Частичный возврат с кассы',
        cashierId: settings.cashierId || activeShift?.cashierId,
        ...(pending.payloadItems ? { items: pending.payloadItems } : {}),
      })
      const updated = res.data
      if (!res.offline) {
        void Promise.allSettled([refresh(), fetchProducts()])
      } else {
        void useOfflineSync.getState().syncNow()
      }
      setReturnQtyByIdx({})
      const lastRet = Array.isArray(updated.returns) && updated.returns.length
        ? updated.returns[updated.returns.length - 1]
        : null
      const giveMoney = lastRet
        ? Math.round(((Number(lastRet.cutCash) || 0) + (Number(lastRet.cutCard) || 0)) * 100) / 100
        : Math.max(0, (Number(pending.giveMoney) || 0))
      const debtCut = lastRet
        ? Math.round((Number(lastRet.cutDebt) || 0) * 100) / 100
        : Math.max(0, debtBefore - (Number(updated.debtAdded) || 0))
      const toastParts = [`К выдаче ${fmtMoney(giveMoney)}`]
      if (debtCut > 0.001) toastParts.push(`долг −${fmtMoney(debtCut)}`)
      toastParts.push('товары на складе')
      if (res.offline) toastParts.push('отправится в фоне')
      showToast(
        updated.status === 'returned' ? 'Чек возвращён' : 'Частичный возврат',
        toastParts.join(' · '),
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

  function clearProductSearch() {
    qRef.current = ''
    setQ('')
    scanAccumRef.current = ''
    scanTypeBufRef.current = ''
    scanBurstRef.current = false
    if (searchInputRef.current) searchInputRef.current.value = ''
    window.setTimeout(focusProductSearch, 0)
  }

  function addProduct(p: Product, weightKg?: number, opts?: { fromScanner?: boolean }) {
    if (!activeShift) {
      showToast('Смена не открыта', 'Сначала откройте смену')
      setOpenShiftModal(true)
      return
    }

    // После выбора/скана — сразу чистим поиск, как на обычной кассе
    clearProductSearch()

    // Штучный: если уже в чеке — сразу +1, без повторного запроса партий
    if (weightKg == null && !isWeighted(p)) {
      const now = performance.now()
      const existing = cartRef.current.find(l => l.productId === p.id && l.weightKg == null)

      if (existing) {
        lastPieceAddRef.current = { id: p.id, t: now }
      pushProductToCart(p, weightKg)
      return
    }

      if (addInflightRef.current.has(p.id)) {
        addPendingBumpRef.current.set(p.id, (addPendingBumpRef.current.get(p.id) || 0) + 1)
        return
      }

      // Дребезг клика мыши — не для сканера (иначе второй скан «съедается»)
      if (!opts?.fromScanner && lastPieceAddRef.current.id === p.id && now - lastPieceAddRef.current.t < 60) {
        return
      }
      lastPieceAddRef.current = { id: p.id, t: now }
    }

    void addProductWithLayers(p, weightKg, opts)
  }
  addProductRef.current = addProduct

  /** Сканер никогда не ждёт сеть — товар в чек сразу, партии/цены в фоне */
  async function addProductWithLayers(
    p: Product,
    weightKg?: number,
    opts?: { fromScanner?: boolean },
  ) {
    const fromScanner = !!opts?.fromScanner
    const piece = weightKg == null && !isWeighted(p)
    if (piece) addInflightRef.current.add(p.id)

    const finishBumps = () => {
      if (!piece) return
      const bumps = addPendingBumpRef.current.get(p.id) || 0
      addPendingBumpRef.current.delete(p.id)
      addInflightRef.current.delete(p.id)
      for (let i = 0; i < bumps; i++) pushProductToCart(p, weightKg)
    }

    const pushDefault = () => {
      pushProductToCart(p, weightKg)
      finishBumps()
    }

    const applyGroupsOrPush = (groups: PriceLayerGroup[], allowModal: boolean) => {
      if (groups.length > 1 && allowModal && !fromScanner) {
        setLayerPickProduct(p)
        setLayerPickGroups(groups)
        setLayerPickWeightKg(weightKg)
        setLayerPickOpen(true)
        if (piece) {
          addPendingBumpRef.current.delete(p.id)
          addInflightRef.current.delete(p.id)
        }
        return
      }
      if (groups.length >= 1) {
        const g = groups[0]
        pushProductToCart(p, weightKg, undefined, {
          preferRetailPrice: g.retailPrice,
          stock: g.remainingQty,
          costPrice: g.costPrice,
          supplierName: g.oldest.supplierName,
          bulkPricing: g.bulkPricing,
        })
        finishBumps()
        return
      }
      pushDefault()
    }

    // Весовой без кг — сразу модалка веса, API не ждём
    if (isWeighted(p) && weightKg == null) {
      pushProductToCart(p, weightKg)
      if (piece) addInflightRef.current.delete(p.id)
      return
    }

    // Офлайн / сканер / без API — мгновенно в чек
    if (!USE_API || !isOnline() || fromScanner) {
      const cached = layerGroupsCacheRef.current.get(p.id)
      if (cached?.length) applyGroupsOrPush(cached, false)
      else pushDefault()
      // фоном обновим партии (не блокируем сканер)
      if (USE_API && isOnline()) {
        void api.getProductStockLayers(p.id).then(layers => {
          const open = (layers || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
          layerGroupsCacheRef.current.set(p.id, groupStockLayersByRetail(open, Number(p.price) || 0))
        }).catch(() => {})
      }
      return
    }

    // Кэш групп цен — без сетевой задержки
    const cached = layerGroupsCacheRef.current.get(p.id)
    if (cached) {
      applyGroupsOrPush(cached, true)
      void api.getProductStockLayers(p.id).then(layers => {
        const open = (layers || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
        layerGroupsCacheRef.current.set(p.id, groupStockLayersByRetail(open, Number(p.price) || 0))
      }).catch(() => {})
      return
    }

    // Штучный без кэша — сразу в чек
    if (piece) {
      pushDefault()
      void api.getProductStockLayers(p.id).then(layers => {
        const open = (layers || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
        layerGroupsCacheRef.current.set(p.id, groupStockLayersByRetail(open, Number(p.price) || 0))
      }).catch(() => {})
      return
    }

    // Весовой с весом (клик, не сканер) — тоже не ждём сеть дольше мгновения
    pushDefault()
    void api.getProductStockLayers(p.id).then(layers => {
      const open = (layers || []).filter(l => (Number(l.remainingQty) || 0) > 0.0001)
      layerGroupsCacheRef.current.set(p.id, groupStockLayersByRetail(open, Number(p.price) || 0))
    }).catch(() => {})
  }

  function cartLineKey(productId: number, receiptId?: string, weightKg?: number, preferRetailPrice?: number) {
    if (weightKg != null) return `${productId}-w-${Date.now()}`
    // Штучный: один ключ на товар — повторное пробитие увеличивает qty
    return String(productId)
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
      let host = deskScaleHost.trim()
      let port = Number(deskScalePort) || 20304
      if (!host && desk.getPrinterSettings) {
        const settings = await desk.getPrinterSettings().catch(() => null)
        host = String(settings?.scaleHost || '').trim()
        port = Number(settings?.scalePort) || port
        if (host) {
          setDeskScaleHost(host)
          setDeskScalePort(String(port))
          if (settings?.scaleMode === 'none') setDeskScaleMode('none')
          if (settings?.scaleLiveWeight === false) setDeskScaleLiveWeight(false)
        }
      }
      if (!host) {
        host = '192.168.1.10'
        setDeskScaleHost(host)
        deskScaleHostRef.current = host
      }
      if (!host || !desk.startCasWeight) {
        setCasWeight(prev => ({
          ...prev,
          connected: false,
          running: false,
          error: host ? prev.error : 'Укажите IP весов в настройках и нажмите Сохранить',
        }))
        return
      }
      await desk.startCasWeight({ host, port })
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
    return deskScaleMode !== 'none'
      && deskScaleLiveWeightRef.current
      && deskScaleLiveWeight
      && isKakapoDesktop()
      && !!deskScaleHost.trim()
  }

  function applyScaleKgToModal(kg: number, grams?: number) {
    const raw = Number.isFinite(grams) ? Math.round(Number(grams)) : Math.round((Number(kg) || 0) * 1000)
    const g = Math.round(raw / SCALE_STEP_G) * SCALE_STEP_G
    if (!(g >= SCALE_STEP_G)) return
    const exact = (g / 1000).toFixed(3)
    lastHeldKgRef.current = g / 1000
    lastCommittedGramsRef.current = g
    platterBaselineGramsRef.current = g
    scaleSawZeroRef.current = false
    setScaleHolding(false)
    setScaleMoving(false)
    setQtyEditMode('qty')
    setQtyEditBuf(exact)
    const key = qtyEditKeyRef.current
    if (key) {
      const w = g / 1000
      setCart(prev => prev.map(l => {
        if (l.key !== key || l.weightKg == null) return l
        return { ...l, weightKg: w, qty: 1 }
      }))
    }
  }

  function startWeightModalMonitor(seedKg?: number) {
    // Важно: ставим refs СРАЗУ — иначе первый вес с монитора отбрасывается,
    // пока React ещё не успел выполнить useEffect для qtyEditOpen.
    qtyEditIsWeightRef.current = true
    qtyEditOpenRef.current = true
    setScaleHolding(false)
    setScaleMoving(false)

    // Каждое открытие окна — как новый сеанс (после «Сохранить» второй товар тоже берёт вес)
    scaleSamplesEpochRef.current += 1
    lastCommittedGramsRef.current = 0
    lastHeldKgRef.current = 0
    platterBaselineGramsRef.current = 0
    scaleSawZeroRef.current = true

    const seedG = Math.round((Number(seedKg) || 0) * 1000)
    // Не требуем флаг stable — после сохранения он часто «залипает» и блокирует повтор
    const liveKg = Number(casWeight.weightKg) || 0
    const liveG = Number.isFinite(Number(casWeight.grams))
      ? Math.round(Number(casWeight.grams))
      : Math.round(liveKg * 1000)
    const scaleG = liveG >= SCALE_STEP_G || liveKg > SCALE_ZERO_KG ? Math.max(liveG, Math.round(liveKg * 1000)) : 0

    if (scaleG >= SCALE_STEP_G) {
      applyScaleKgToModal(scaleG / 1000, scaleG)
    } else if (seedG >= SCALE_STEP_G) {
      // Показать прошлый вес в поле, но ждать новый STOP с весов
      setQtyEditMode('qty')
      setQtyEditBuf((seedG / 1000).toFixed(3))
    } else {
      setQtyEditMode('qty')
      setQtyEditBuf('')
    }

    if (!liveWeightEnabled()) return
    void ensureCasWeightMonitor(true)
    // Сразу один опрос — не ждать интервал 450 мс
    const desk = getKakapoDesktop()
    const host = deskScaleHostRef.current.trim()
    if (desk?.readCasWeight && host) {
      void desk.readCasWeight({
        host,
        port: deskScalePortRef.current,
        timeoutMs: 2200,
        forceDirect: false,
      }).then(res => {
        if (!qtyEditOpenRef.current || !qtyEditIsWeightRef.current) return
        const g = Number.isFinite(Number(res.grams))
          ? Math.round(Number(res.grams))
          : Math.round((Number(res.weightKg) || 0) * 1000)
        if (g >= SCALE_STEP_G) {
          applyScaleKgToModal((Number(res.weightKg) || g / 1000), g)
        }
      }).catch(() => undefined)
    }
  }

  function stopWeightModalMonitor() {
    qtyEditIsWeightRef.current = false
    qtyEditOpenRef.current = false
    lastHeldKgRef.current = 0
    lastCommittedGramsRef.current = 0
    platterBaselineGramsRef.current = 0
    scaleSawZeroRef.current = true
    scaleSamplesEpochRef.current += 1
    setScaleHolding(false)
    setScaleMoving(false)
  }

  function pushProductToCart(
    p: Product,
    weightKg?: number,
    layer?: ProductStockLayer,
    opts?: {
      preferRetailPrice?: number
      stock?: number
      costPrice?: number
      supplierName?: string
      bulkPricing?: BulkPriceTier[]
    },
  ) {
    const stockTotal = liveStockForProduct(p)
    const preferRetailPrice = opts?.preferRetailPrice
    const layerStock = opts?.stock != null
      ? Number(opts.stock) || 0
      : (layer ? Number(layer.remainingQty) || 0 : stockTotal)
    // При выборе цены — не фиксируем одну партию, списание FIFO внутри цены
    const receiptId = preferRetailPrice != null ? undefined : layer?.receiptId
    const costPrice = opts?.costPrice != null
      ? opts.costPrice
      : (layer ? Number(layer.costPrice) || 0 : undefined)
    const supplierName = opts?.supplierName || layer?.supplierName || undefined
    const bulkPricing = resolveLineBulkPricing(
      opts?.bulkPricing,
      resolveLineBulkPricing(
        layer?.bulkPricing,
        resolveLineBulkPricing(
          layerGroupsCacheRef.current.get(p.id)?.find(g =>
            preferRetailPrice == null || Math.abs(g.retailPrice - preferRetailPrice) < 0.011,
          )?.bulkPricing,
          p.bulkPricing,
        ),
      ),
    )
    const retailBase = resolveCartSellPrice({
      catalogPrice: Number(p.price) || 0,
      layerRetail: preferRetailPrice != null && preferRetailPrice > 0
        ? preferRetailPrice
        : (layer ? Number(layer.retailPrice) || 0 : 0),
      costPrice,
    })
    // stock на строке = живой остаток (для подсказки), количество в чек не режем
    const stockHint = Math.max(0, layerStock > 0 ? layerStock : stockTotal)

    if (isWeighted(p) && weightKg == null) {
      const key = cartLineKey(p.id, receiptId, 0, preferRetailPrice)
      const art = String(p.art || '').trim()
      const barcode = productBarcodes(p)[0] || ''
      const price = cartUnitPriceForQty(retailBase, bulkPricing, 1, 0)
      setCartAndSelect(prev => [...dropZeroWeightLines(prev), {
        key,
        productId: p.id,
        name: p.name,
        emoji: p.e || '📦',
        price,
        qty: 1,
        stock: stockHint,
        unit: displaySellUnit(p),
        art,
        barcode,
        weightKg: 0,
        receiptId,
        preferRetailPrice,
        retailBase,
        bulkPricing,
        costPrice,
        supplierName,
      }], key)
      setQtyEditDraftKey(key)
      setQtyEditKey(key)
      qtyEditKeyRef.current = key
      setQtyEditMode('qty')
      setQtyEditBuf('')
      setQtyEditPad(false)
      setQtyEditOpen(true)
      qtyEditOpenRef.current = true
      startWeightModalMonitor(0)
      setLayerPickOpen(false)
      setLayerPickProduct(null)
      setLayerPickGroups([])
      return
    }

      const art = String(p.art || '').trim()
      const barcode = productBarcodes(p)[0] || ''

      if (weightKg != null) {
      if (!(weightKg > MIN_WEIGHT_KG)) {
        setLayerPickOpen(false)
        setLayerPickProduct(null)
        setLayerPickGroups([])
        window.setTimeout(focusProductSearch, 0)
        return
      }
      const key = cartLineKey(p.id, receiptId, weightKg, preferRetailPrice)
      const price = cartUnitPriceForQty(retailBase, bulkPricing, 1, weightKg)
      setCartAndSelect(prev => [...dropZeroWeightLines(prev), {
        key,
          productId: p.id,
          name: p.name,
          emoji: p.e || '📦',
          price,
          qty: 1,
          stock: stockHint,
        unit: displaySellUnit(p),
          art,
          barcode,
          weightKg,
          receiptId,
        preferRetailPrice,
          retailBase,
          bulkPricing,
          costPrice,
          supplierName,
      }], key)
      setLayerPickOpen(false)
      setLayerPickProduct(null)
      setLayerPickGroups([])
      window.setTimeout(focusProductSearch, 0)
      return
    }

    // Штучный: всегда одна строка на товар — qty++ внутри setCart (без гонок)
    let revealKey: string | null = null
    flushSync(() => {
      setTickets(prevTickets => prevTickets.map(t => {
        if (t.id !== activeTicketId) return t
        const prev = dropZeroWeightLines(t.cart)
        const idx = prev.findIndex(l => l.productId === p.id && l.weightKg == null)
      if (idx >= 0) {
          const nextQty = prev[idx].qty + 1
          const lineBulk = resolveLineBulkPricing(bulkPricing, prev[idx].bulkPricing)
          const lineBase = preferRetailPrice != null && preferRetailPrice > 0
            ? preferRetailPrice
            : (prev[idx].retailBase ?? prev[idx].preferRetailPrice ?? retailBase)
          const updated = {
            ...prev[idx],
            qty: nextQty,
            price: cartUnitPriceForQty(lineBase, lineBulk, nextQty),
            stock: stockHint,
            retailBase: lineBase,
            bulkPricing: lineBulk,
            ...(preferRetailPrice != null ? { preferRetailPrice, costPrice, supplierName } : {}),
          }
          revealKey = updated.key
          // Повторное пробитие — строка уходит в конец чека
          const next = prev.slice()
          next.splice(idx, 1)
          next.push(updated)
          cartRef.current = next
          return {
            ...t,
            cart: next,
            selectedLineKey: updated.key,
          }
        }
        const key = cartLineKey(p.id, receiptId, undefined, preferRetailPrice)
        revealKey = key
        const price = cartUnitPriceForQty(retailBase, bulkPricing, 1)
        const next = [...prev, {
          key,
        productId: p.id,
        name: p.name,
        emoji: p.e || '📦',
        price,
        qty: 1,
        stock: stockHint,
        unit: displaySellUnit(p),
        art,
        barcode,
        receiptId,
          preferRetailPrice,
        retailBase,
        bulkPricing,
        costPrice,
        supplierName,
      }]
        cartRef.current = next
        return {
          ...t,
          cart: next,
          selectedLineKey: key,
        }
      }))
    })
    if (revealKey) {
      // DOM уже обновлён (flushSync) — крутим сразу, потом ещё раз после фокуса поиска
      pinCartToPunched(revealKey)
      window.setTimeout(() => {
        focusProductSearch()
        scrollCartToPunched(revealKey)
      }, 0)
    } else {
      window.setTimeout(focusProductSearch, 0)
    }
    setLayerPickOpen(false)
    setLayerPickProduct(null)
    setLayerPickGroups([])
  }

  function pickPriceGroup(group: PriceLayerGroup) {
    if (!layerPickProduct) return
    pushProductToCart(layerPickProduct, layerPickWeightKg, undefined, {
      preferRetailPrice: group.retailPrice,
      stock: group.remainingQty,
      costPrice: group.costPrice,
      supplierName: group.oldest.supplierName,
      bulkPricing: group.bulkPricing,
    })
  }

  function setQty(key: string, qty: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      const q = Math.round(Math.max(0, qty) * 1000) / 1000
      const p = products.find(x => x.id === l.productId)
      const base = l.retailBase ?? l.preferRetailPrice ?? (Number(p?.price) || l.price)
      const bulk = resolveLineBulkPricing(l.bulkPricing, p?.bulkPricing)
      return {
        ...l,
        qty: q,
        retailBase: base,
        bulkPricing: bulk,
        price: cartUnitPriceForQty(base, bulk, q, l.weightKg),
      }
    }).filter(l => l.qty > 0 || (l.weightKg != null && l.weightKg > 0)))
  }

  function setLineWeight(key: string, weightKg: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      const w = Math.max(0, Math.round(weightKg * 1000) / 1000)
      const base = l.retailBase ?? l.preferRetailPrice ?? l.price
      return {
        ...l,
        weightKg: w,
        qty: 1,
        retailBase: base,
        price: cartUnitPriceForQty(base, l.bulkPricing, 1, w),
      }
    }).filter(l => (l.weightKg != null ? l.weightKg > 0 : l.qty > 0)))
  }

  /** Убирает недозаполненную весовую строку, чтобы в чеке не оставалось 0.000 кг */
  function discardWeightDraft(discardDraft = true) {
    const draftKey = qtyEditDraftKey
    setCart(prev => {
      const next = prev.filter(l => !isZeroWeightLine(l) && !(discardDraft && draftKey && l.key === draftKey))
      return next.length === prev.length ? prev : next
    })
  }

  function openQtyEdit(line: CartLine) {
    setSelectedLineKey(line.key)
    setQtyEditDraftKey(null)
    setQtyEditKey(line.key)
    qtyEditKeyRef.current = line.key
    setQtyEditMode('qty')
    setQtyEditBuf(line.weightKg != null ? String(line.weightKg) : String(line.qty))
    setQtyEditPad(false)
    setQtyEditOpen(true)
    qtyEditOpenRef.current = true
    if (line.weightKg != null) startWeightModalMonitor(line.weightKg > 0 ? line.weightKg : 0)
    else {
      qtyEditIsWeightRef.current = false
    }
  }

  function closeQtyEdit(discardDraft = true) {
    discardWeightDraft(discardDraft)
    setQtyEditDraftKey(null)
    setQtyEditOpen(false)
    qtyEditOpenRef.current = false
    setQtyEditKey(null)
    qtyEditKeyRef.current = null
    setQtyEditPad(false)
    stopWeightModalMonitor()
  }

  function resolveQtyEdit(line: CartLine, mode: 'qty' | 'sum', raw: string) {
    const base = line.retailBase ?? line.preferRetailPrice ?? line.price
    const val = Number(raw) || 0
    const isWeight = line.weightKg != null
    if (mode === 'sum') {
      const amount = val
      // Для суммы считаем от текущей ед. цены строки (уже с оптом, если он включён)
      const price = Number(line.price) || 0
      const qty = price > 0 ? Math.round((amount / price) * 1000) / 1000 : 0
      return { qty, amount, price, isWeight }
    }
    const qty = isWeight ? Math.round(val * 1000) / 1000 : Math.round(val * 1000) / 1000
    const price = cartUnitPriceForQty(base, line.bulkPricing, isWeight ? 1 : qty, isWeight ? qty : undefined)
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
    if (isWeight) setLineWeight(qtyEditKey, qty)
    else setQty(qtyEditKey, qty)
    const savedKey = qtyEditKey
    setQtyEditDraftKey(null)
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setQtyEditPad(false)
    stopWeightModalMonitor()
    revealCartLine(savedKey)
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
    if (!cart.length && discountPct <= 0) return
    setClearCartConfirm(true)
  }

  function confirmClearCart() {
    setClearCartConfirm(false)
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
    setPosMobPanel('shop')
    window.setTimeout(focusProductSearch, 40)
  }

  function addTicket() {
    if (tickets.length >= MAX_TICKETS) {
      showToast('Лимит чеков', `Можно открыть не больше ${MAX_TICKETS}`)
      return
    }
    const t = makeTicket(nextTicketSeq)
    discardWeightDraft()
    setQtyEditDraftKey(null)
    setNextTicketSeq(s => s + 1)
    setTickets(prev => [...prev, t])
    setActiveTicketId(t.id)
    setPayPickOpen(false)
    setCashOpen(false)
    setDiscOpen(false)
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setSaleConfirm(null)
    printChoiceLockedRef.current = false
    showToast('Новый чек', `Чек ${tickets.length + 1}`)
    // после клика по «+» фокус остаётся на кнопке — вернуть в поиск
    window.setTimeout(focusProductSearch, 0)
    window.setTimeout(focusProductSearch, 60)
  }

  function switchTicket(id: string) {
    if (id === activeTicketId) return
    discardWeightDraft()
      setQtyEditDraftKey(null)
    setQtyEditOpen(false)
    setQtyEditKey(null)
    setPayPickOpen(false)
    setCashOpen(false)
    setSplitCardOpen(false)
    setDiscOpen(false)
    setDiscPickOpen(false)
    setCreditNoteOpen(false)
    setSaleConfirm(null)
    printChoiceLockedRef.current = false
    setActiveTicketId(id)
    window.setTimeout(focusProductSearch, 0)
    window.setTimeout(focusProductSearch, 60)
  }

  function closeTicket(id: string) {
    if (sellingTicketIdRef.current === id) {
      showToast('Чек пробивается', 'Дождитесь завершения продажи')
      return
    }
    const cur = tickets.find(x => x.id === id)
    if (cur && cur.cart.length > 0) {
      showToast('Нельзя закрыть', 'В чеке есть товары — уберите их или пробейте чек')
      setCloseTicketConfirmId(null)
      return
    }
    if (saleConfirm?.ticketId === id) {
      setSaleConfirm(null)
      printChoiceLockedRef.current = false
    }
    if (qtyEditDraftKey && id === activeTicketId) {
      setQtyEditDraftKey(null)
      setQtyEditOpen(false)
    }
    setCloseTicketConfirmId(null)
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

  function requestCloseTicket(id: string) {
    const t = tickets.find(x => x.id === id)
    if (!t) return
    if (t.cart.length > 0) {
      showToast('Нельзя закрыть', 'В чеке есть товары — уберите их или пробейте чек')
      return
    }
    const hasItems = !!t.client || (Number(t.discountPct) || 0) > 0 || (Number(t.bonusUsed) || 0) > 0
    if (hasItems) {
      setCloseTicketConfirmId(id)
      return
    }
    closeTicket(id)
  }

  function afterSaleTicketReset(ticketId: string) {
    setPosMobPanel('shop')
    setDiscLineKey(null)
    setPayDebtOn(false)
    setPayDebtBuf('')
    setPayGivenBuf('')
    setCreditNoteOpen(false)
    setCreditNoteBuf('')
    setCreditPending(null)

    setTickets(prev => {
      // Один чек — очищаем и остаёмся на нём
      if (prev.length <= 1) {
        return prev.map(t => t.id !== ticketId ? t : {
          ...t,
          cart: [],
          client: null,
          discountPct: 0,
          bonusUsed: 0,
          pay: 'cash',
          selectedLineKey: null,
        })
      }

      // Несколько чеков: закрываем пробитый и открываем НОВЫЙ пустой
      // (не переключаемся на уже существующий чек 1/2/…)
      const remaining = prev.filter(t => t.id !== ticketId)
      if (remaining.length >= MAX_TICKETS) {
        const fallback = remaining[remaining.length - 1]
      if (fallback) setActiveTicketId(fallback.id)
        return remaining
      }
      const seq = nextTicketSeqRef.current
      const fresh = makeTicket(seq)
      nextTicketSeqRef.current = seq + 1
      setNextTicketSeq(seq + 1)
      setActiveTicketId(fresh.id)
      return [...remaining, fresh]
    })

    window.setTimeout(focusProductSearch, 0)
    window.setTimeout(focusProductSearch, 60)
  }

  function currentPayDebtAmt() {
    // Без явного «Погасить долг» сдача остаётся сдачей — долг не трогаем
    if (!payDebtOn || clientDebt <= 0) return 0
    const fromBuf = Math.min(clientDebt, Math.round(Math.max(0, Number(payDebtBuf) || 0) * 100) / 100)
    const given = Math.round(Math.max(0, Number(payGivenBuf || cashBuf) || 0) * 100) / 100
    const auto = given > 0.001 ? debtAmtFromGiven(given) : 0
    return Math.max(fromBuf, auto)
  }

  /** Из суммы «дал клиент»: сначала чек, остаток — в погашение долга (не больше долга). */
  function debtAmtFromGiven(givenRaw: number, saleTotal = total, debtCap = clientDebt) {
    const given = Math.round(Math.max(0, givenRaw) * 100) / 100
    const sale = Math.round(Math.max(0, saleTotal) * 100) / 100
    const cap = Math.round(Math.max(0, debtCap) * 100) / 100
    return Math.min(cap, Math.round(Math.max(0, given - sale) * 100) / 100)
  }

  function applyPayGiven(raw: string) {
    const next = sanitizeDecimalInput(raw)
    setPayGivenBuf(next)
    if (!payDebtOn || clientDebt <= 0) return
    const debtPart = debtAmtFromGiven(Number(next) || 0)
    setPayDebtBuf(debtPart > 0 ? String(debtPart) : '')
  }

  function applyPayDebtQuick(debtAmt: number) {
    const d = Math.min(clientDebt, Math.round(Math.max(0, debtAmt) * 100) / 100)
    setPayDebtOn(true)
    setPayDebtBuf(d > 0 ? String(d) : '')
    setPayGivenBuf(String(Math.round((total + d) * 100) / 100))
  }

  function discBaseAmount(mode: 'all' | 'line', lineKey?: string | null) {
    if (mode === 'line' && lineKey) {
      const line = cart.find(l => l.key === lineKey)
      return line ? lineGross(line) : 0
    }
    // На весь чек — после скидок на товары
    return cart.reduce((s, l) => s + lineNet(l), 0)
  }

  /** База для режима «Новая цена»: цена за ед. у позиции, сумма чека — на всё */
  function discSumBase(mode: 'all' | 'line', lineKey?: string | null) {
    if (mode === 'line' && lineKey) {
      const line = cart.find(l => l.key === lineKey)
      return line ? Math.round((Number(line.price) || 0) * 100) / 100 : 0
    }
    return discBaseAmount(mode, lineKey)
  }

  function discLineQtyFactor(lineKey?: string | null) {
    if (!lineKey) return 1
    const line = cart.find(l => l.key === lineKey)
    if (!line) return 1
    // Весовой: только если реально весим (кг), иначе штуки — даже если в названии «0,5»
    if (line.weightKg != null && line.weightKg > 0) {
      return Math.max(0.001, Number(line.weightKg) || 0.001)
    }
    return Math.max(0.001, Number(line.qty) || 1)
  }

  function typeDiscDigit(k: string) {
    const maxLen = discInputKind === 'sum' ? 8 : 5
    setDiscBuf(b => {
      const el = amountInputRef.current
      const len = String(el?.value ?? b).length
      const selectedAll = !!el
        && el.selectionStart === 0
        && el.selectionEnd === len
        && len > 0
      const wipe = discWipeNextRef.current || selectedAll
      discWipeNextRef.current = false
      return appendDigit(wipe ? '' : b, k, maxLen)
    })
  }

  function focusDiscField() {
    discWipeNextRef.current = true
    window.setTimeout(() => {
      amountInputRef.current?.focus()
      amountInputRef.current?.select()
    }, 0)
  }

  function openAllDiscount() {
    if (!cart.length) {
      showToast('Чек пуст', 'Сначала добавьте товары')
      return
    }
    setDiscMode('all')
    setDiscLineKey(null)
    setDiscInputKind('pct')
    setDiscEditTarget('unit')
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
      const unit = Math.round((Number(line.price) || 0) * 100) / 100
      const pct = Math.min(90, Math.max(0, Number(line.discPct) || 0))
      const currentUnit = Math.round(unit * (1 - pct / 100) * 100) / 100
      setDiscMode('line')
      setDiscLineKey(targetKey)
      setDiscInputKind('sum')
      setDiscEditTarget('unit')
      setDiscBuf(unit > 0 ? String(currentUnit) : '')
      discWipeNextRef.current = true
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

  function switchDiscInputKind(next: 'pct' | 'sum') {
    if (next === discInputKind) return
    const sumBase = discSumBase(discMode, discLineKey)
    const qty = discLineQtyFactor(discLineKey)
    const raw = Number(discBuf) || 0
    if (next === 'sum') {
      const pct = Math.min(90, Math.max(0, raw))
      const price = Math.round(sumBase * (1 - pct / 100) * 100) / 100
      setDiscEditTarget('unit')
      setDiscBuf(sumBase > 0 ? String(price > 0 ? price : Math.round(sumBase * 100) / 100) : '')
    } else {
      let unit = raw
      if (discMode === 'line' && discEditTarget === 'total' && qty > 0) {
        unit = Math.round((raw / qty) * 100) / 100
      }
      const pct = sumBase > 0.0001
        ? Math.round(Math.min(90, Math.max(0, (sumBase - unit) / sumBase * 100)) * 100) / 100
        : 0
      setDiscEditTarget('unit')
      setDiscBuf(pct > 0 ? String(pct) : '')
    }
    setDiscInputKind(next)
  }

  function switchDiscEditTarget(next: 'unit' | 'total') {
    if (discMode !== 'line') return
    const sumBase = discSumBase('line', discLineKey)
    const qty = discLineQtyFactor(discLineKey)
    const raw = Number(discBuf) || 0

    // Если были в %, сначала переводим в сумму/цену
    if (discInputKind !== 'sum') {
      const pct = Math.min(90, Math.max(0, raw))
      const unit = Math.round(sumBase * (1 - pct / 100) * 100) / 100
      setDiscInputKind('sum')
      if (next === 'total') {
        setDiscEditTarget('total')
        setDiscBuf(String(Math.round(unit * qty * 100) / 100))
      } else {
        setDiscEditTarget('unit')
        setDiscBuf(sumBase > 0 ? String(unit > 0 ? unit : Math.round(sumBase * 100) / 100) : '')
      }
      focusDiscField()
      return
    }

    if (next === discEditTarget) {
      focusDiscField()
      return
    }
    if (next === 'total') {
      const unit = discBuf === '' ? sumBase : Math.max(0, Math.min(sumBase, raw))
      const total = Math.round(unit * qty * 100) / 100
      setDiscBuf(String(total))
    } else {
      const lineGrossAmt = discBaseAmount('line', discLineKey)
      const total = discBuf === '' ? lineGrossAmt : Math.max(0, raw)
      const unit = qty > 0 ? Math.round((total / qty) * 100) / 100 : 0
      setDiscBuf(String(unit))
    }
    setDiscEditTarget(next)
    focusDiscField()
  }

  function applyDiscount() {
    const sumBase = discSumBase(discMode, discLineKey)
    const qty = discLineQtyFactor(discLineKey)
    const minUnit = Math.round(sumBase * 0.1 * 100) / 100
    let pct = 0
    if (discInputKind === 'sum') {
      let newUnit = Math.max(0, Number(discBuf) || 0)
      if (discMode === 'line' && discEditTarget === 'total' && qty > 0) {
        newUnit = Math.round((newUnit / qty) * 100) / 100
      }
      if (newUnit > sumBase + 0.001) {
        showToast('Выше цены', `Макс. ${sumBase.toFixed(2)} сом за ед. (без скидки)`)
        return
      }
      if (newUnit < minUnit - 0.001 && sumBase > 0) {
        showToast('Слишком много', `Мин. ${minUnit.toFixed(2)} сом за ед. (скидка до 90%)`)
        return
      }
      pct = sumBase > 0.0001
        ? Math.min(90, Math.round((sumBase - newUnit) / sumBase * 10000) / 100)
        : 0
    } else {
      pct = Math.min(90, Math.max(0, Number(discBuf) || 0))
    }
    if (discMode === 'line' && discLineKey) {
      setCart(prev => prev.map(l => l.key === discLineKey ? { ...l, discPct: pct || undefined } : l))
      setSelectedLineKey(discLineKey)
      // Сразу в ref — быстрый «Пробить» не потеряет скидку на товар
      ticketsRef.current = ticketsRef.current.map(t => {
        if (t.id !== activeTicketIdRef.current) return t
        return {
          ...t,
          cart: t.cart.map(l => (l.key === discLineKey ? { ...l, discPct: pct || undefined } : l)),
        }
      })
    } else {
      setDiscountPct(pct)
    }
    setDiscOpen(false)
    setDiscLineKey(null)
    setDiscInputKind('pct')
    setDiscEditTarget('unit')
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
    if (hideTradeHardwareUi()) {
      showToast('Чек', 'Печать только на кассе Windows')
      return
    }
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
        cashierName: resolveCashierName(sale),
        printerName: deskPrinterName || undefined,
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

  function askSaleConfirm(opts: {
    paidCash?: number
    method?: PayMethod
    bonusSpend?: number
    paidCard?: number
    debtAmt?: number
    saleNote?: string
    returnTo: 'payPick' | 'cash' | 'splitCard' | 'creditNote'
    previewTotal: number
  }) {
    setCashOpen(false)
    setSplitCardOpen(false)
    setPayPickOpen(false)
    setCreditNoteOpen(false)
    setAmountPad(false)
    printChoiceLockedRef.current = false
    setSaleConfirm({
      ticketId: activeTicketIdRef.current,
      paidCash: opts.paidCash ?? 0,
      method: opts.method,
      bonusSpend: opts.bonusSpend,
      paidCard: opts.paidCard,
      debtAmt: opts.debtAmt,
      debtRepayAmt: currentPayDebtAmt(),
      saleNote: opts.saleNote,
      returnTo: opts.returnTo,
      previewTotal: opts.previewTotal,
      clientName: client?.name,
    })
  }

  function cancelSaleConfirm() {
    const p = saleConfirm
    if (!p || busy) return
    setSaleConfirm(null)
    if (p.ticketId && p.ticketId !== activeTicketIdRef.current) {
      setActiveTicketId(p.ticketId)
    }
    if (p.returnTo === 'cash') {
      setCashOpen(true)
    } else if (p.returnTo === 'splitCard') {
      setCashOpen(true)
      setSplitCardOpen(true)
    } else if (p.returnTo === 'creditNote') {
      setCreditNoteOpen(true)
    } else {
      setPayPickOpen(true)
    }
  }

  async function finishSaleConfirm(shouldPrint: boolean) {
    const p = saleConfirm
    if (!p || printChoiceLockedRef.current || busy) return
    printChoiceLockedRef.current = true
    const ticketId = p.ticketId
    const debtRepayAmt = Math.max(0, Number(p.debtRepayAmt) || 0)
    setSaleConfirm(null)
    try {
      const ok = await submitSale(
        p.paidCash,
        p.method,
        p.bonusSpend,
        p.paidCard,
        p.debtAmt,
        p.saleNote,
        { shouldPrint, ticketId, debtRepayAmt },
      )
      if (!ok) {
        // Чек не прошёл — вернуть к оплате на том же чеке
        if (ticketId && ticketId !== activeTicketIdRef.current) {
          setActiveTicketId(ticketId)
        }
        if (p.returnTo === 'cash') setCashOpen(true)
        else if (p.returnTo === 'splitCard') { setCashOpen(true); setSplitCardOpen(true) }
        else if (p.returnTo === 'creditNote') setCreditNoteOpen(true)
        else setPayPickOpen(true)
      }
    } finally {
      printChoiceLockedRef.current = false
    }
  }

  async function confirmCreditNote() {
    if (!creditPending) return
    const note = creditNoteBuf.trim()
    const { paidCash, method, paidCard, debtAmt } = creditPending
    // Сумма чека — не чек + долг: долг уже часть этой суммы (нал + карта + долг = total)
    const preview = Math.max(0, afterDisc - Math.floor(usedBonus))
    askSaleConfirm({
      paidCash,
      method,
      bonusSpend: 0,
      paidCard,
      debtAmt,
      saleNote: note,
      returnTo: 'creditNote',
      previewTotal: Math.round(preview * 100) / 100,
    })
  }

  async function submitSale(
    paidCash = 0,
    payOverride?: PayMethod,
    bonusSpendOverride?: number,
    paidCardAmt?: number,
    debtAmt?: number,
    saleNote?: string,
    opts?: { shouldPrint?: boolean; ticketId?: string; debtRepayAmt?: number },
  ): Promise<boolean> {
    const ticketId = opts?.ticketId || activeTicketIdRef.current
    const ticketSnap = ticketsRef.current.find(t => t.id === ticketId)
    if (!activeShift || !ticketSnap?.cart.length) return false
    if (sellingTicketIdRef.current === ticketId) return false

    // Снимок чека — даже если кассир уже перешёл на другую вкладку
    const cart = ticketSnap.cart
    if (blockIfCartOverLiveStock(cart)) return false
    const client = ticketSnap.client
    const pay = ticketSnap.pay
    const discountPct = ticketSnap.discountPct
    const loyalty = client ? loyaltySummaryForClient(client, cards) : null
    const clientDebt = Number(loyalty?.debt) || 0
    const clientDebtBlocked = !!(client?.debtCreditBlocked || loyalty?.debtCreditBlocked)
    const subtotalGross = cart.reduce((s, l) => s + lineGross(l), 0)
    const itemDiscAmount = cart.reduce((s, l) => s + (lineGross(l) - lineNet(l)), 0)
    const subtotal = cart.reduce((s, l) => s + lineNet(l), 0)
    const levelDiscPct = (!loyalty || pay === 'credit')
      ? 0
      : ({ bronze: 0, silver: 3, gold: 5, platinum: 8, basic: 0 } as Record<string, number>)[loyalty.level] || 0
    const checkDiscPct = discountPct + levelDiscPct
    const discAmount = subtotal * (checkDiscPct / 100)
    const afterDisc = Math.max(0, subtotal - discAmount)
    const maxBonus = loyalty ? Math.min(Number(loyalty.bonus) || 0, afterDisc) : 0
    const usedBonus = Math.min(ticketSnap.bonusUsed, maxBonus)
    const total = Math.max(0, afterDisc - usedBonus)
    const payDebtForSale = Math.max(0, Number(opts?.debtRepayAmt) || 0)

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
      return false
    }
    if (methodPay === 'balance' && payable > 0.001) {
      showToast('Недостаточно бонусов', 'Спишите бонусы или выберите другой способ')
      return false
    }

    let apiMethod: 'cash' | 'card' | 'credit' | 'wallet' | 'mixed' = 'cash'
    let cashPaid = 0
    let cardPaid = 0
    let walletPaid = 0
    let debtAdded = 0
    let change = 0
    let cashReceivedVal = 0

    if (methodPay === 'credit') {
      if (clientDebtBlocked) {
        showDebtBlockedToast()
        return false
      }
      apiMethod = 'credit'
      debtAdded = payable
      // Лимит долга действует только в приложении клиента.
      // С кассы/админки можно оформить долг сразу, даже если лимит 0.
    } else if (methodPay === 'balance') {
      apiMethod = 'card'
    } else if (methodPay === 'wallet') {
      if (!client) {
        setClientOpen(true)
        showToast('Выберите клиента', 'Для оплаты с кошелька нужен клиент')
        return false
      }
      const walletBal = Math.round((Number(client.wallet) || 0) * 100) / 100
      if (payable > walletBal + 0.001) {
        showToast('Недостаточно на кошельке', `Доступно ${fmtMoney(walletBal)}`)
        return false
      }
      apiMethod = 'wallet'
      walletPaid = payable
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
          return false
        }
        if (clientDebtBlocked) {
          showDebtBlockedToast()
          return false
        }
        // Лимит не проверяем на кассе — только в приложении клиента
      }
      if (cashPaid < 0.01 && cardPaid < 0.01 && debtAdded < 0.01) {
        showToast('Ошибка', 'Укажите сумму оплаты')
        return false
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
      const debtRepayNow = payDebtForSale
      cashReceivedVal = Math.round(Math.max(0, paidCash) * 100) / 100
      if (cashReceivedVal < payable + debtRepayNow - 0.001) {
        cashReceivedVal = Math.round((payable + debtRepayNow) * 100) / 100
      }
      change = Math.max(0, Math.round((cashReceivedVal - payable - debtRepayNow) * 100) / 100)
    } else {
      apiMethod = 'card'
      cardPaid = payable
    }

    // Офлайн: кошелёк/бонусы без V2 — нельзя; карта как нал — local-first в очередь.
    const apiReachable = isOnline()
    const v2Full = isTradeLocalFirst()
    if (!apiReachable) {
      if (!v2Full && (walletPaid > 0.001 || apiMethod === 'wallet')) {
        showToast('Нет связи', 'Оплата с кошелька недоступна офлайн.')
        return false
      }
      if (!v2Full && spend > 0) {
        showToast('Нет связи', 'Списание бонусов недоступно офлайн.')
        return false
      }
    }

    sellingTicketIdRef.current = ticketId
    setBusy(true)
    setMsg('')
    try {
      const note = String(saleNote || '').trim()
      const discountTotal = Math.round((itemDiscAmount + discAmount) * 100) / 100
      const bonusBalanceBefore = loyalty ? Math.max(0, Math.floor(Number(loyalty.bonus) || 0)) : undefined
      let earnedBonusPreview = 0
      const statusEligiblePaid = Math.round(((Number(cashPaid) || 0) + (Number(cardPaid) || 0)) * 100) / 100
      if (statusEligiblePaid > 0.001 && client?.phone && client.card && apiMethod !== 'credit') {
        earnedBonusPreview = previewPosStatusCashBonus(
          client.phone,
          orders,
          statusEligiblePaid,
          buildPosLoyaltyMeta(client, cards),
          sales,
        )
      }
      const bonusBalanceAfter = bonusBalanceBefore != null
        ? Math.max(0, bonusBalanceBefore - spend + earnedBonusPreview)
        : undefined
      const salePosId = activeShift.posId || activePosPoint?.id
      await ensurePosOpSeqReady()
      const deviceId = getTradeDeviceIdSync()
      const salePayload = {
        clientRef: newClientRef(),
        createdAtIso: new Date().toISOString(),
        deviceId: deviceId || undefined,
        deviceName: getBoundDeviceNameSync() || undefined,
        opSeq: allocPosOpSeq(String(salePosId || ''), deviceId),
        cashierId: activeShift.cashierId,
        cashierName: resolveCashierName({
          cashierId: activeShift.cashierId,
          cashierName: activeShift.cashierName || settings.cashierName,
          shiftId: activeShift.id,
        }),
        shiftId: activeShift.id,
        posId: activeShift.posId || activePosPoint?.id,
        clientId: client?.id,
        clientName: client?.name,
        clientPhone: client?.phone,
        cardNum: client?.card,
        paymentMethod: apiMethod,
        paidCash: cashPaid,
        paidCard: cardPaid,
        paidWallet: walletPaid > 0.001 ? walletPaid : undefined,
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
        items: cart.map(l => {
          const p = products.find(x => x.id === l.productId)
          const qty = l.weightKg != null ? Math.round(l.weightKg * 1000) / 1000 : l.qty
          const gross = Math.round(lineGross(l) * 100) / 100
          const net = Math.round(lineNet(l) * 100) / 100
          const discPct = Math.min(90, Math.max(0, Number(l.discPct) || 0))
          const discAmount = Math.round(Math.max(0, gross - net) * 100) / 100
          const unit = cartLineUnit(l)
          const pack = cartLinePack(l, p?.unit)
          return {
            productId: l.productId,
            productName: l.name,
            qty,
            price: l.price,
            lineTotal: net,
            unit,
            pack: pack || undefined,
            discPct: discPct > 0.001 ? discPct : undefined,
            discAmount: discAmount > 0.001 ? discAmount : undefined,
            receiptId: l.receiptId || undefined,
            preferRetailPrice: l.preferRetailPrice != null ? l.preferRetailPrice : undefined,
            barcode: p ? (productBarcodes(p)[0] || undefined) : undefined,
          }
        }),
      }

      // Всё local-first (нал / карта / долг / кошелёк) — сервер из очереди в фоне.
      const needsLiveServer = false

      const saleRes = await createSaleSafe({
        salePayload,
        cart: cart.map(l => ({
          productId: l.productId,
          qty: l.qty,
          weightKg: l.weightKg,
        })),
        shiftId: activeShift.id,
        cashPaid,
        cardPaid,
        debtAdded,
        walletPaid,
        total,
        needsLiveServer,
        forceOffline: !apiReachable,
        client: client
          ? { id: client.id, card: client.card, debt: client.debt, wallet: client.wallet }
          : null,
        bonusSpend: spend,
        bonusEarn: earnedBonusPreview,
      })
      const created = {
        ...saleRes.data,
        _offline: saleRes.offline || !!(saleRes.data as { _offline?: boolean })._offline,
      } as PosSale & { orderId?: string; _offline?: boolean }

      // Сразу снимаем busy — дальше фон (sync/бонусы) не должен блокировать поиск
      sellingTicketIdRef.current = null
      setBusy(false)

      if (created._offline) {
        // Не пугаем «офлайн», если сеть есть — просто фоновая отправка
        if (!apiReachable) {
          showToast('Офлайн-чек сохранён', 'Отправится автоматически при появлении связи')
        }
        void useOfflineSync.getState().syncNow()
      }
      if (client?.id) {
        const itemsSummary = cart.slice(0, 5).map(l => `${l.name} ×${l.weightKg != null ? l.weightKg : l.qty}`).join(', ')
        const histKey = debtAccountKey(client)
        const purchaseCash = Math.round((Number(cashPaid) || 0) * 100) / 100
        const purchaseCard = Math.round((Number(cardPaid) || 0) * 100) / 100
        if (histKey && purchaseCash > 0.001) {
          recordStorePurchase(
            histKey,
            purchaseCash,
            'Покупка в магазине · нал',
            { orderId: created?.orderId || created?.id || undefined, itemsSummary },
          )
        }
        if (histKey && purchaseCard > 0.001) {
          recordStorePurchase(
            histKey,
            purchaseCard,
            'Покупка в магазине · карта',
            { orderId: created?.orderId || created?.id || undefined, itemsSummary },
          )
        }
        if (histKey && debtAdded > 0.001) {
          const baseDesc = debtAdded >= payable - 0.01 ? 'Чек в долг' : 'Часть чека в долг'
          recordStoreDebtCharge(histKey, debtAdded, note ? `${baseDesc} · ${note}` : baseDesc, {
            orderId: created?.orderId || created?.id || undefined,
            itemsSummary,
            source: 'pos',
          })
        }
        setHistTick(t => t + 1)
      }
      const earnedBonus = earnedBonusPreview
      const statusEligibleAfter = Math.round(((Number(cashPaid) || 0) + (Number(cardPaid) || 0)) * 100) / 100
      if (statusEligibleAfter > 0.001 && client?.phone && client.card) {
        const meta = buildPosLoyaltyMeta(client, cards)
        if (meta.levelAssignMode !== 'manual') {
          const statusFields = statusFieldsAfterPosCashPurchase(
            client.phone,
            orders,
            statusEligibleAfter,
            meta,
            sales,
          )
          useCardStore.getState().updateCardLoyalty(
            client.card,
            {
              level: statusFields.level,
              levelValidUntil: statusFields.levelValidUntil ?? undefined,
              levelAssignMode: statusFields.levelAssignMode,
            },
            { skipApi: true },
          )
          useClientStore.getState().updateClient(
            client.id,
            {
              level: statusFields.level,
              levelValidUntil: statusFields.levelValidUntil ?? undefined,
              levelAssignMode: statusFields.levelAssignMode,
            },
            { skipApi: true },
          )
        }
      }
      // Исходящая очередь + входящие чеки с сервера (браузер → ПК)
      void softSyncPosAfterSale({ force: true })
      useOfflineSync.getState().scheduleSyncDebounced()
      if (!created._offline) {
        void syncClientsFromApi()
        void syncCardsFromApi()
      }

      const debtRepay = payDebtForSale
      let debtRepayNote = ''
      if (debtRepay > 0.001 && client && apiMethod !== 'credit') {
        const method = cashPaid > 0.001 ? 'cash' : 'card'
        let cardClient = client
        try {
          if (!cardClient.card) cardClient = await ensureClientHasCard(cardClient)
        } catch { /* без карты погашение с чеком пропустим */ }
        if (!cardClient.card) {
          // не смогли выдать карту — долг останется, кассир погасит отдельно
        } else {
        const prevDebt = Number(loyalty?.debt) || clientDebt
        const payAmt = Math.min(prevDebt, Math.round(debtRepay * 100) / 100)
        debtRepayNote = ' · погашен долг ' + fmtMoney(payAmt)
        try {
          const repaid = await debtRepaySafe(cardClient.card, {
            amount: payAmt,
            method,
            cashierId: activeShift.cashierId,
            shiftId: activeShift.id,
            posId: activeShift.posId || activePosPoint?.id,
            clientId: cardClient.id,
            prevDebt,
          })
          if (!repaid.data.duplicate) {
            const histKey = debtAccountKey(client)
            const history = loadDebtHistoryForClient(client)
            const creditSales = sales
              .filter(s => {
                const matchId = client.id && s.clientId === client.id
                const matchPhone = client.phone && s.clientPhone && phonesMatch(client.phone, s.clientPhone)
                if (!matchId && !matchPhone) return false
                return saleOpenCreditAmount(s) > 0.001
              })
              .map(s => ({
                id: s.id,
                orderId: s.orderId || s.id,
                dateIso: s.createdAtIso,
                debtAdded: saleOpenCreditAmount(s),
                number: s.number,
              }))
              .filter(s => s.debtAdded > 0.001)
            const { saleStatus } = buildSaleDebtStatuses(creditSales, history, prevDebt)
            const targets = creditSales
              .filter(s => (saleStatus[s.id]?.remain || 0) > 0.001)
              .sort((a, b) => (Date.parse(a.dateIso) || 0) - (Date.parse(b.dateIso) || 0))
              .map(s => ({
                orderId: s.orderId || s.id,
                remain: saleStatus[s.id]?.remain || 0,
                label: s.number != null && Number(s.number) > 0
                  ? `Чек №${s.number}`
                  : `Чек ${String(s.id).slice(-6)}`,
              }))
            if (histKey) {
              const fifo = recordStoreDebtRepaymentFifo(histKey, payAmt, targets, {
                method,
                source: 'cashier',
                desc: 'Погашение долга с чеком',
                clientRef: repaid.data.clientRef,
              })
              if (fifo.appliedToChecks > 0.001) {
                debtRepayNote += ` · со старых чеков ${fmtMoney(fifo.appliedToChecks)}`
              }
            }
            setHistTick(t => t + 1)
          }
        } catch { /* ignore */ }
        }
      }

      const parts: string[] = []
      if (cashPaid > 0.001) parts.push(`нал ${fmtMoney(cashPaid)}`)
      if (cardPaid > 0.001) parts.push(`карта ${fmtMoney(cardPaid)}`)
      if (walletPaid > 0.001) parts.push(`кошелёк ${fmtMoney(walletPaid)}`)
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
      setSaleConfirm(null)

      const saleForPrint: PosSale = {
        ...created,
        orderGoodsTotal: created.orderGoodsTotal ?? Math.round(subtotalGross * 100) / 100,
        discountAmount: created.discountAmount ?? (discountTotal > 0.001 ? discountTotal : undefined),
        bonusSpent: created.bonusSpent ?? (spend > 0 ? spend : undefined),
        bonusEarned: created.bonusEarned ?? (earnedBonusPreview > 0 ? earnedBonusPreview : undefined),
        bonusBalanceBefore: created.bonusBalanceBefore ?? bonusBalanceBefore,
        bonusBalanceAfter: created.bonusBalanceAfter ?? bonusBalanceAfter,
        total: created.total ?? total,
      }
      afterSaleTicketReset(ticketId)
      if (opts?.shouldPrint) {
        void printSaleOnce(saleForPrint)
      }
      return true
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка продажи')
      showToast('Ошибка', e instanceof Error ? e.message : 'Ошибка продажи')
      return false
    } finally {
      sellingTicketIdRef.current = null
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
    if (blockIfCartOverLiveStock(cart)) return
    setPosMobPanel('cart')
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
    setPayDebtBuf('')
    setPayGivenBuf('')
    setPayPickOpen(true)
  }

  function choosePayMethod(method: PayMethod) {
    if ((method === 'credit' || method === 'balance' || method === 'wallet') && !client) {
      setPayPickOpen(false)
      setClientOpen(true)
      showToast('Выберите клиента', method === 'balance'
        ? 'Для списания бонусов нужен клиент'
        : method === 'wallet'
          ? 'Для оплаты с кошелька нужен клиент'
          : 'Для оплаты в долг нужен клиент')
      return
    }
    if (method === 'wallet') {
      const walletBal = Math.round((Number(client?.wallet) || 0) * 100) / 100
      const need = Math.max(0, Math.round((afterDisc - Math.floor(usedBonus)) * 100) / 100)
      if (need > walletBal + 0.001) {
        showToast('Недостаточно на кошельке', `Доступно ${fmtMoney(walletBal)} · к оплате ${need.toFixed(2)}`)
        return
      }
      setPayDebtOn(false)
      setPay(method)
      setPayPickOpen(false)
      askSaleConfirm({
        paidCash: 0,
        method: 'wallet',
        returnTo: 'payPick',
        previewTotal: Math.round(afterDisc * 100) / 100,
      })
      return
    }
    if (method === 'credit') {
      if (clientDebtBlocked) {
        setPayPickOpen(false)
        showDebtBlockedToast()
        return
      }
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
      askSaleConfirm({
        paidCash: 0,
        method: 'balance',
        bonusSpend: cover,
        returnTo: 'payPick',
        previewTotal: 0,
      })
      return
    }
    const debtExtra = currentPayDebtAmt()
    const due = Math.round((total + debtExtra) * 100) / 100
    const givenPrefill = Math.round(Math.max(0, Number(payGivenBuf) || 0) * 100) / 100
    setPay(method)
    if (method === 'cash') {
      setPayPickOpen(false)
      const cashPrefill = Math.max(due, givenPrefill)
      setCashBuf(cashPrefill > 0 ? cashPrefill.toFixed(2) : '')
      setAmountPad(false)
      setCashOpen(true)
      return
    }
    setPayPickOpen(false)
    askSaleConfirm({
      paidCash: 0,
      method,
      returnTo: 'payPick',
      previewTotal: Math.round((total + debtExtra) * 100) / 100,
    })
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
    if (clientDebtBlocked) {
      setCashOpen(false)
      showDebtBlockedToast()
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
    if (!activeShift) {
      showToast('Смена закрыта', 'Сначала откройте смену')
      return
    }
    const cash = Number(topupBuf) || 0
    if (cash <= 0) return
    // Единый баланс: и деньги, и % идут в Бонусы ⭐
    const principal = Math.max(0, Math.round(cash * 100) / 100)
    const percentBonus = calcCashDepositBonus(cash)
    const credit = Math.round((principal + percentBonus) * 100) / 100
    if (principal <= 0) return
    setBusy(true)
    try {
      const withCard = await ensureClientHasCard(client)
      const topup = await cardTopupSafe(withCard.card!, {
        cash,
        credit,
        note: `Пополнение бонусов · ${client.name}`,
        cashierId: settings.cashierId || activeShift.cashierId,
        cashierName: settings.cashierName || activeShift.cashierName,
        shiftId: activeShift.id,
        posId: activeShift.posId || activePosPoint?.id,
      })
      if (client.phone) recordBalanceTopup(client.phone, cash, percentBonus, 'Пополнение бонусов', {
        clientRef: topup.data?.clientRef,
      })
      if (!topup.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setTopupOpen(false)
      setTopupBuf('')
      const extra = percentBonus > 0 ? ` (деньги ${principal.toFixed(2)} + бонус ${fmtBonus(percentBonus)})` : ''
      const offlineNote = topup.offline ? ' · отправится в фоне' : ''
      showToast('Бонусы пополнены', `${client.name}: +${credit.toFixed(2)} ⭐${extra}${offlineNote}`)
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось пополнить')
    } finally {
      setBusy(false)
    }
  }

  async function submitDebtRepay() {
    if (!client || busy) return
    const amount = Number(repayBuf) || 0
    const prevDebt = clientDebt
    if (amount <= 0) return
    const maxForTarget = repayTarget
      ? Math.min(prevDebt, repayTarget.maxAmount)
      : prevDebt
    if (amount > maxForTarget + 0.001) {
      showToast('Слишком много', repayTarget
        ? `По этой позиции максимум ${fmtMoney(maxForTarget)}`
        : `Долг клиента ${fmtMoney(prevDebt)}`)
      return
    }
    if (!activeShift) {
      showToast('Смена закрыта', 'Откройте смену, чтобы принять погашение в кассу')
      return
    }
    setBusy(true)
    try {
      const withCard = await ensureClientHasCard(client)
      const payAmt = Math.round(Math.min(amount, maxForTarget) * 100) / 100
      let target = repayTarget
      const histKey = debtAccountKey(withCard)
      // Ручной остаток на карте без строки — сначала пишем в историю, потом гасим эту выдачу
      if (target?.kind === 'cash' && !target.orderId && histKey) {
        recordStoreDebtCharge(histKey, target.maxAmount, 'Ручное начисление (раньше на карте)', {
          source: 'manual',
        })
        const newest = loadDebtHistory(histKey).find(r => r.type === 'debt')
        if (newest) {
          const oid = cashDebtOrderId(newest)
          target = {
            ...target,
            orderId: oid,
            debtEntryId: newest.id,
            label: newest.desc || target.label,
          }
          setHistTick(t => t + 1)
        }
      }
      if (target?.debtEntryId && histKey && target.orderId) {
        ensureDebtHistoryOrderId(histKey, target.debtEntryId, target.orderId)
      }
      const repaid = await debtRepaySafe(withCard.card!, {
        amount: payAmt,
        method: repayMethod,
        note: target
          ? `Погашение · ${target.label} · ${client.name}`
          : `Погашение долга · ${client.name}`,
        cashierId: settings.cashierId || activeShift.cashierId,
        cashierName: settings.cashierName || activeShift.cashierName,
        shiftId: activeShift.id,
        posId: activeShift.posId || activePosPoint?.id,
        clientId: client.id,
        prevDebt,
      })
      const nextDebt = Number(repaid.data.nextDebt) || Math.max(0, prevDebt - payAmt)
      if (repaid.data.duplicate) {
        const freshDup = useClientStore.getState().clients.find(c => c.id === client.id)
        if (freshDup) setClient(freshDup)
        setRepayOpen(false)
        setRepayBuf('')
        setRepayMethod('cash')
        setRepayTarget(null)
        showToast('Уже принято', 'Это погашение уже записано')
        return
      }
      let fifoChecks = 0
      if (histKey) {
        if (target?.orderId) {
          recordStoreDebtRepayment(histKey, payAmt, {
            method: repayMethod,
            orderId: target.orderId,
            desc: `Погашение · ${target.label}`,
            batchId: repaid.data.clientRef || `payb-${Date.now()}`,
            clientRef: repaid.data.clientRef,
          })
        } else {
          const checkTargets = histActiveDebts
            .filter(r => r.saleId && (Number(r.debtRemain ?? r.amount) || 0) > 0.001)
            .slice()
            .sort((a, b) => a.ts - b.ts)
            .map(r => ({
              orderId: r.orderId || r.saleId,
              remain: Number(r.debtRemain ?? r.amount) || 0,
              label: (r.title || '').replace(/\s·\s(к оплате|частично)$/i, '').trim() || undefined,
            }))
          const cashTargets = cashierDebtPanel.cashView
            .filter(c => !c.isResidual && c.remain > 0.001)
            .slice()
            .sort((a, b) => a.ts - b.ts)
            .map(c => ({
              orderId: c.orderId || cashDebtOrderId(c),
              remain: c.remain,
              label: c.label,
            }))
          fifoChecks = recordStoreDebtRepaymentFifo(
            histKey,
            payAmt,
            [...checkTargets, ...cashTargets],
            {
              method: repayMethod,
              source: 'cashier',
              clientRef: repaid.data.clientRef,
            },
          ).checkCount
        }
      }
      if (!repaid.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setRepayOpen(false)
      setRepayBuf('')
      setRepayMethod('cash')
      setRepayTarget(null)
      const targetNote = target ? ` · ${target.label}` : ''
      const fifoNote = !target && fifoChecks > 0
        ? ` · с ${fifoChecks} чек${fifoChecks === 1 ? 'а' : 'ов'} (со старых)`
        : ''
      const tillNote = repayMethod === 'cash' ? ' · в кассу' : ''
      const offlineNote = repaid.offline ? ' · отправится в фоне' : ''
      showToast(
        'Долг погашен',
        `${client.name}: −${fmtMoney(payAmt)}${targetNote} · ${repayMethod === 'cash' ? 'нал' : 'карта'} · остаток ${fmtMoney(nextDebt)}${tillNote}${fifoNote}${offlineNote}`,
      )
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось погасить долг')
    } finally {
      setBusy(false)
    }
  }

  async function submitCashCharge() {
    if (!client || busy) return
    const amount = Math.round((Number(chargeBuf) || 0) * 100) / 100
    if (amount <= 0) return
    if (!activeShift) {
      showToast('Смена закрыта', 'Откройте смену, чтобы выдать наличные из кассы')
      return
    }
    if (amount > tillExpected + 0.009) {
      showToast('Мало наличных', `В кассе ${fmtMoney(tillExpected)}`)
      return
    }
    setBusy(true)
    try {
      const charged = await chargeCashDebtFromOpenShift(client, amount, {
        note: `Выдача наличных · ${client.name}`,
        posId: activeShift.posId || activePosPoint?.id,
      })
      if (!charged.offline) void refresh()
      else void useOfflineSync.getState().syncNow()
      const fresh = useClientStore.getState().clients.find(c => c.id === client.id)
      if (fresh) setClient(fresh)
      setChargeOpen(false)
      setChargeBuf('')
      const nextDebt = Number(charged.data.debt) || Math.round((clientDebt + amount) * 100) / 100
      showToast(
        'Выдано наличными',
        `${client.name}: +${fmtMoney(amount)} · из кассы · долг ${fmtMoney(nextDebt)}${charged.offline ? ' · отправится в фоне' : ''}`,
      )
    } catch (e) {
      showToast('Ошибка', e instanceof Error ? e.message : 'Не удалось выдать наличные')
    } finally {
      setBusy(false)
    }
  }

  function openCashCharge() {
    if (!activeShift) {
      showToast('Смена закрыта', 'Откройте смену, чтобы выдать наличные из кассы')
      return
    }
    setHistTab('cash')
    setChargeBuf('')
    setAmountPad(false)
    setChargeOpen(true)
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
                <p>{hideHardware ? 'Касса · название · телефон' : 'Касса · чек · принтер XP-58C · весы CAS'}</p>
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

                {!hideHardware && (
                <>
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
                                  rememberReceiptPrinterName(p.name)
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
                          onChange={e => {
                            const mode = e.target.value === 'none' ? 'none' : 'plu-label'
                            setDeskScaleMode(mode)
                            deskScaleModeRef.current = mode
                            if (mode === 'none') {
                              void ensureCasWeightMonitor(false)
                            } else if (deskScaleLiveWeight && deskScaleHost.trim()) {
                              void ensureCasWeightMonitor(true)
                            }
                          }}
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
                                if (!on || deskScaleMode === 'none') {
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
                              ? ((casWeight.grams || 0) > 0
                                ? `Связь OK · ${casWeight.grams} г (${(casWeight.weightKg || 0).toFixed(3)} кг)${casWeight.stable ? ' · вес стабилен' : ' · взвешивание…'}`
                                : (casWeight.error
                                  ? `Связь есть, вес не читается: ${casWeight.error}`
                                  : `Связь OK · 0 г · положите товар и нажмите «Тест»${casWeight.raw ? ` · ответ: ${String(casWeight.raw).replace(/\s+/g, ' ').slice(0, 40)}` : ''}`))
                              : (casWeight.error
                                ? `Нет связи: ${casWeight.error}`
                                : 'Нет связи с весами')}
                            <div className="pos-settings-net-hint">
                              ПК сейчас: <b>{deskLocalIps.length ? deskLocalIps.join(', ') : 'нет IPv4'}</b>
                              <br />
                              Весы: <b>{deskScaleHost.trim() || '192.168.1.10'}:{deskScalePort || 20304}</b>
                              <br />
                              {(() => {
                                const host = deskScaleHost.trim() || '192.168.1.10'
                                const sameLan = deskLocalIps.some(ip => {
                                  const a = ip.split('.')
                                  const b = host.split('.')
                                  return a.length === 4 && b.length === 4 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
                                })
                                if (!sameLan) {
                                  return (
                                    <span style={{ color: '#b45309' }}>
                                      ПК и весы в РАЗНЫХ сетях — касса их не увидит.
                                      Подключите Ethernet к весам и поставьте на ПК IP <b>192.168.1.2</b> / маска 255.255.255.0
                                    </span>
                                  )
                                }
                                return (
                                  <span>
                                    Сеть совпадает. Положите товар на весы и нажмите «Тест» — должны появиться граммы.
                                  </span>
                                )
                              })()}
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
                                  const host = deskScaleHost.trim()
                                  const port = Number(deskScalePort) || 20304
                                  if (!host) return
                                  setDeskCasTestBusy(true)
                                  setCasWeight(prev => ({
                                    ...prev,
                                    error: '',
                                    connected: prev.connected,
                                  }))
                                  try {
                                    const cur = await desk.getPrinterSettings()
                                    await desk.savePrinterSettings({
                                      ...cur,
                                      scaleMode: deskScaleMode,
                                      scaleHost: host,
                                      scalePort: port,
                                      scaleDept: Number(deskScaleDept) || 1,
                                      scaleLiveWeight: deskScaleLiveWeight,
                                    })

                                    // Сначала через монитор (не рвём TCP). Если нет — прямое чтение.
                                    let res: Awaited<ReturnType<NonNullable<typeof desk.readCasWeight>>>
                                    try {
                                      if (deskScaleLiveWeight) {
                                        await desk.startCasWeight?.({ host, port })
                                        await new Promise(r => setTimeout(r, 200))
                                      }
                                      res = await desk.readCasWeight({
                                        host,
                                        port,
                                        timeoutMs: 4000,
                                        forceDirect: false,
                                      })
                                    } catch {
                                      res = await desk.readCasWeight({
                                        host,
                                        port,
                                        timeoutMs: 5000,
                                        forceDirect: true,
                                      })
                                    }

                                    const hasWeight = (res.grams || 0) > 0
                                    setCasWeight({
                                      connected: true,
                                      running: !!deskScaleLiveWeight,
                                      host,
                                      port,
                                      weightKg: res.weightKg,
                                      grams: res.grams,
                                      price: res.price,
                                      stable: hasWeight,
                                      error: '',
                                      ts: res.ts,
                                    })
                                    const raw = String(res.raw || '').replace(/\s+/g, ' ').slice(0, 70)
                                    if (hasWeight) {
                                      showToast(`Вес ${res.grams} г`, raw || `${res.weightKg.toFixed(3)} кг`)
                                    } else {
                                      showToast(
                                        'Связь есть · вес 0 г',
                                        raw
                                          ? `Положите товар и нажмите тест снова · ${raw}`
                                          : 'Положите товар на весы и нажмите тест снова',
                                      )
                                    }
                                    if (deskScaleMode === 'plu-label' && deskScaleLiveWeight) {
                                      await desk.startCasWeight?.({ host, port })
                                    }
                                  } catch (e) {
                                    let msg = e instanceof Error ? e.message : 'Ошибка связи с весами'
                                    msg = msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
                                    setCasWeight(prev => ({
                                      ...prev,
                                      connected: false,
                                      host,
                                      port,
                                      error: msg,
                                    }))
                                    showToast('Нет связи с весами', msg.slice(0, 120))
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
                                    // Монитор веса занимает порт — освобождаем перед выгрузкой PLU
                                    await ensureCasWeightMonitor(false)
                                    await new Promise(r => setTimeout(r, 400))
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
                                    if (!items.length) {
                                      throw new Error('Нет весовых товаров с PLU для выгрузки')
                                    }
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
                                    if (deskScaleMode === 'plu-label' && deskScaleLiveWeight && deskScaleHost.trim()) {
                                      await ensureCasWeightMonitor(true)
                                    }
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
                </>
                )}

                <div className="pos-settings-card">
                  <h3>Офлайн Trade (V2)</h3>
                  <p className="hint">
                    На desktop по умолчанию «Полный»: товары, склад, клиенты, долги, поставщики и финансы без сети.
                    Карта терминала — только онлайн. В браузере по умолчанию выкл.
                  </p>
                  <div className="pos-settings-row-btns" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {([
                      { id: 'off' as const, label: 'Выкл' },
                      { id: 'shadow' as const, label: 'Тень' },
                      { id: 'on' as const, label: 'Полный' },
                    ]).map(opt => {
                      const cur = getOfflineV2Mode()
                      const on = cur === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className="btn-switch-till"
                          style={on ? { borderColor: 'var(--green, #2a7a3a)', fontWeight: 800 } : undefined}
                          onClick={() => {
                            setOfflineV2Mode(opt.id)
                            showToast(
                              'Офлайн V2',
                              opt.id === 'off'
                                ? 'Выключен — обычный режим'
                                : opt.id === 'shadow'
                                  ? 'Тень: зеркало SQLite, касса без изменений'
                                  : 'Полный офлайн Trade включён',
                            )
                            setVersion(v => v + 1)
                          }}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
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

        {receiptTemplateOpen && !hideHardware && (
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
  const cashSaleBonus = client?.card && client.phone && total > 0.001
    ? previewPosStatusCashBonus(client.phone, orders, total, buildPosLoyaltyMeta(client, cards), sales)
    : 0
  const topupCash = Number(topupBuf) || 0
  const topupPrincipal = Math.max(0, Math.round(topupCash * 100) / 100)
  const topupPercentBonus = calcCashDepositBonus(topupCash)
  const topupCredit = Math.round((topupPrincipal + topupPercentBonus) * 100) / 100
  const topupTier = cashDepositTierForAmount(topupCash)
  const repayAmount = Number(repayBuf) || 0
  const repayRemain = Math.max(0, clientDebt - repayAmount)
  const chargeAmount = Number(chargeBuf) || 0
  return (
    <div className="pos-root" data-theme={theme} data-embed={embedded ? '1' : undefined}>
      <style>{POS_MOCK_CSS}</style>
      {queueOpen && <OfflineQueuePanel onClose={() => setQueueOpen(false)} />}
      <div className="app" data-mob-panel={posMobPanel}>
        <div className="topbar">
          <div className="top-loc">
            <b>{activePosPoint?.name || 'Точка продаж'}</b>
            <div className="dot-row">
              <CashierNetChip
                onlineCode={activePosPoint?.code}
                onOpenQueue={() => setQueueOpen(true)}
              />
            </div>
          </div>

          <div className={`searchpill${q.trim() ? ' has-q' : ''}`}>
            <span className="ic" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              data-cashier-search="1"
              value={q}
              onChange={e => onProductSearchChange(e.target.value)}
              onFocus={() => noteCashierSearchActivity(5000)}
              placeholder="Товар, штрихкод…"
              autoFocus={!isTradeMobileUi()}
              onKeyDown={onProductSearchKeyDown}
            />
            {!!q.trim() && (
              <button
                type="button"
                className="search-clear"
                title="Очистить поиск"
                aria-label="Очистить поиск"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  if (scanCommitTimer.current) {
                    window.clearTimeout(scanCommitTimer.current)
                    scanCommitTimer.current = null
                  }
                  scanAccumRef.current = ''
                  scanTypeBufRef.current = ''
                  scanBurstRef.current = false
                  qRef.current = ''
                  setQ('')
                  window.setTimeout(focusProductSearch, 0)
                }}
              >
                ×
              </button>
            )}
            <button
              type="button"
              className="scan-tag"
              title="Камера · сканер штрихкода"
              aria-label="Открыть сканер камеры"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setCamScanOpen(true)}
            >
              📷
            </button>
          </div>

          <div className="order-tabs" aria-label="Открытые чеки">
            {tickets.map((t, idx) => {
              const active = t.id === activeTicketId
              const n = ticketLineCount(t)
              const label = t.client?.name?.split(/\s+/)[0] || `Чек ${idx + 1}`
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
                  {n === 0 && (tickets.length > 1 || !!t.client) && (
                    <span
                      className="order-tab-x"
                      role="button"
                      tabIndex={-1}
                      title="Закрыть чек"
                      onClick={e => { e.stopPropagation(); requestCloseTicket(t.id) }}
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

          <button type="button" className="bell-btn" title="Уведомления" onClick={() => showToast('Уведомления', 'Нет новых уведомлений')} style={{ marginLeft: 'auto' }}>
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
                  onClick={() => {
                    setCashierMenuOpen(false)
                    setPosSurface('dashboard')
                  }}
                >
                  <span className="ami-ic">🏪</span>
                  <span>
                    <b>Вход в торговую точку</b>
                    <i>Выбрать кассу или вернуться к точкам продаж</i>
                  </span>
                </button>
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
            {showFav && !gridSearch.trim() && visibleProducts.length === 0 ? (
            <div className="grid-wrap">
              <div className="cat-empty">
                <div className="cat-empty-ic">★</div>
                <b>Избранное пусто</b>
                <span>Добавьте товары звёздочкой на плитке</span>
              </div>
                      </div>
          ) : visibleProducts.length === 0 && gridSearch.trim() ? (
            <div className="grid-wrap">
              <div className="cat-empty">
                <div className="cat-empty-ic">🔍</div>
                <b>Ничего не найдено</b>
                <span>Попробуйте другое название или штрихкод</span>
              </div>
            </div>
          ) : (
            <VirtualProductGrid
              products={visibleProducts}
              resetKey={`${showFav}|${selectedCatSlugs.join(',')}|${gridSearch}`}
              renderTile={renderProductTile}
            />
          )}
        </div>

        <div className="cart">
          <div
            className={`client-card ${client ? 'set' : ''}`}
            onClick={() => {
              if (client) {
                setHistTab('pos')
                setHistOpen(true)
                return
              }
              setClientQ('')
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
                  ⭐ {fmtBonus(loyalty.bonus)} бон.
                  {clientDebt > 0 ? <> · <span className="debt">долг {fmtMoney(clientDebt)}</span></> : null}
                  {clientDebtBlocked ? <> · <span className="debt">новый долг закрыт</span></> : null}
                  {debtLimit > 0 ? <> · доступно {fmtMoney(availableDebt)}</> : null}
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
              <button type="button" className="client-x" onClick={e => { e.stopPropagation(); setClient(null); setBonusUsed(0); setPayDebtOn(false); setPayDebtBuf(''); setPayGivenBuf(''); if (pay === 'credit' || pay === 'balance') setPay('cash') }}>✕</button>
            )}
          </div>

          <div className="cart-items" ref={cartItemsRef}>
            {!cart.filter(l => l.key !== qtyEditDraftKey).length ? (
              <div className="cart-empty"><div className="ic">🛒</div>Чек пуст.<br />Отсканируйте или выберите товар.</div>
            ) : cart.filter(l => l.key !== qtyEditDraftKey).map(line => {
              const gross = lineGross(line)
              const net = lineNet(line)
              const lineDisc = Number(line.discPct) || 0
              const retailBase = line.retailBase ?? line.preferRetailPrice ?? line.price
              const bulkQty = line.weightKg != null ? Math.round(line.weightKg * 1000) : line.qty
              const activeBulk = activeBulkTierForQty(retailBase, line.bulkPricing, bulkQty)
              const bulkRetailGross = activeBulk
                ? Math.round((line.weightKg != null ? retailBase * line.weightKg : retailBase * line.qty) * 100) / 100
                : 0
              const lineNeed = line.weightKg != null ? (Number(line.weightKg) || 0) : (Number(line.qty) || 0)
              const lineProd = products.find(x => x.id === line.productId)
              const lineHave = lineProd ? liveStockForProduct(lineProd) : Number(line.stock) || 0
              const lineOverStock = lineNeed > lineHave + 0.001
              return (
                <div
                  key={line.key}
                  data-line-key={line.key}
                  className={`cart-row ${selectedLineKey === line.key ? 'sel' : ''} ${activeBulk ? 'bulk' : ''} ${lineOverStock ? 'over-stock' : ''}`}
                  onClick={() => setSelectedLineKey(line.key)}
                  ref={selectedLineKey === line.key ? (el) => {
                    if (!el) return
                    if (revealLineKeyRef.current !== line.key) return
                    scrollCartToPunched(line.key)
                  } : undefined}
                >
                  <div className="ic">{line.emoji}</div>
                  <div className="info">
                    <div className="name-row">
                    <div className="name">{line.name}</div>
                      <span className="unit-badge" title="Единица">{cartLineUnit(line)}</span>
                    </div>
                    <div className="meta">
                      {line.art ? <span>арт. {line.art}</span> : null}
                      {line.barcode ? <span>ш/к {line.barcode}</span> : null}
                      <span className={activeBulk ? 'line-bulk-unit' : undefined}>
                        {lineDisc > 0
                          ? `${(Math.round(line.price * (1 - lineDisc / 100) * 100) / 100).toFixed(2)} ЅМ/${cartLineUnit(line)}`
                          : `${line.price.toFixed(2)} ЅМ/${cartLineUnit(line)}`}
                      </span>
                      {line.preferRetailPrice != null ? (
                        <span className="line-batch">FIFO</span>
                      ) : line.receiptId && line.supplierName ? (
                        <span className="line-batch">{line.supplierName}</span>
                      ) : null}
                      {activeBulk ? (
                        <span className="line-bulk" title={`Оптовая цена от ${activeBulk.minQty}${line.weightKg != null ? ' г' : ' шт'}`}>
                          Опт от {activeBulk.minQty}{line.weightKg != null ? ' г' : ' шт'} · было {retailBase.toFixed(2)}
                        </span>
                      ) : null}
                      {lineDisc > 0 ? <span className="line-disc">было {line.price.toFixed(2)} · −{lineDisc}%</span> : null}
                    </div>
                  </div>
                    <button
                      type="button"
                      className="qty-btn"
                    title="Изменить количество"
                      onClick={e => { e.stopPropagation(); openQtyEdit(line) }}
                    >
                    {line.weightKg != null
                      ? line.weightKg.toFixed(3)
                      : `×${fmtQty(line.qty)}`}
                    </button>
                  <div className="price">
                    {lineDisc > 0 ? <span className="old">{gross.toFixed(2)}</span> : null}
                    {!lineDisc && activeBulk ? <span className="old">{bulkRetailGross.toFixed(2)}</span> : null}
                    {net.toFixed(2)}
                  </div>
                  <button type="button" className="rm" onClick={e => { e.stopPropagation(); removeLine(line.key); if (selectedLineKey === line.key) setSelectedLineKey(null) }}>✕</button>
                </div>
              )
            })}
            <div ref={cartEndRef} className="cart-end-anchor" aria-hidden />
          </div>

          <div className="check-actions">
            <button type="button" className="action-chip ac-clear" onClick={() => clearCart()} disabled={!cart.length && discountPct <= 0}>
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
            <div className="tot-grid">
              <div className="tot-cell">
                <span className="tot-lbl">Позиций</span>
                <span className="tot-val">{cart.reduce((s, l) => s + (l.weightKg != null ? 1 : l.qty), 0)}</span>
            </div>
              <div className="tot-cell">
                <span className="tot-lbl">Сумма</span>
                <span className="tot-val">{subtotalGross.toFixed(2)}</span>
              </div>
              <div className={`tot-cell disc ${itemDiscAmount + discAmount > 0 ? '' : 'muted'}`}>
                <span className="tot-lbl">Скидки</span>
                <span className="tot-val">−{(itemDiscAmount + discAmount).toFixed(2)}</span>
              </div>
            </div>
            {usedBonus > 0 && (
              <div className="tot-row disc">
                <span>Списано бонусами</span>
                <span>−{usedBonus.toFixed(2)}</span>
              </div>
            )}
            {payBlockedByStock && (
              <div className="cart-stock-block" role="alert">
                <b>Не хватает на складе</b>
                <span>
                  {cartStockBlocked.map(s => (
                    `${s.product.name}: ${fmtQty(s.need)} / ${fmtQty(s.have)} ${displaySellUnit(s.product)}`
                  )).join(' · ')}
                </span>
                <span className="cart-stock-block-hint">Пробить нельзя, пока не добавят остаток</span>
              </div>
            )}
            <div className="tot-final"><b>Итого</b><span className="sum">{total.toFixed(2)} ЅМ</span></div>
          </div>

          <button
            type="button"
            className="btn-checkout"
            disabled={!cart.length || busy || payBlockedByStock}
            onClick={startPay}
          >
            <span>🖨</span><span>{payBlockedByStock ? 'Нет остатка' : 'Оплатить'}</span>
          </button>
        </div>

        <nav className="pos-mob-switch" aria-label="Панели кассы">
          <button
            type="button"
            className={posMobPanel === 'shop' ? 'on' : ''}
            onClick={() => setPosMobPanel('shop')}
          >
            <span className="pms-ic">📦</span>
            <span>Товары</span>
          </button>
          <button
            type="button"
            className={posMobPanel === 'cart' ? 'on' : ''}
            onClick={() => setPosMobPanel('cart')}
          >
            <span className="pms-ic">🧾</span>
            <span>Чек</span>
            {cart.length > 0 && (
              <span className="pms-badge">{cart.length > 99 ? '99+' : cart.length}</span>
            )}
            {total > 0.001 && (
              <span className="pms-sum">{total.toFixed(0)}</span>
            )}
          </button>
          <button
            type="button"
            className="pms-pay"
            disabled={!cart.length || busy || payBlockedByStock}
            onClick={startPay}
          >
            {payBlockedByStock ? 'Нет ост.' : 'Оплата'}
          </button>
        </nav>
      </div>

      {catModalOpen && (
        <div className="overlay" {...backdropCloseProps(() => setCatModalOpen(false))}>
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
        const pLive = products.find(x => x.id === line.productId)
        const liveHave = pLive ? liveStockForProduct(pLive) : Number(line.stock) || 0
        const overStock = previewQty > liveHave + 0.001
        return (
          <div className="overlay" {...backdropCloseProps(() => closeQtyEdit())}>
            <PadShell
              openPad={qtyEditPad}
              onHidePad={() => setQtyEditPad(false)}
              pad={
                <Keypad
                  onDigit={k => setQtyEditBuf(b => appendDigit(b, k, 8))}
                  onBack={() => setQtyEditBuf(b => b.slice(0, -1))}
                />
              }
            >
            <div className="modal-card qty-edit-card">
              <div className="qty-edit-head">
                <div className="qty-edit-av">{line.emoji}</div>
                <div>
                  <div className="qty-edit-name">{line.name}</div>
                  <div className="qty-edit-stock">На складе: {fmtQty(liveHave)} {unit}</div>
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
                      ? (scaleMoving
                        ? `Движение · на весах ${casWeight.grams || 0} г · в чек ещё не пишем · ждём STOP…`
                        : scaleHolding
                          ? `Снято · в чеке ${(Number(qtyEditBuf) || 0).toFixed(3)} кг · положите другой товар`
                          : (casWeight.connected
                            ? ((casWeight.grams || 0) >= SCALE_STEP_G
                              ? (casWeight.stable
                                ? `STOP · в чеке ${casWeight.grams} г · можно сохранить или досыпать`
                                : `Сейчас: ${casWeight.grams} г · ждём STOP…`)
                              : (Number(qtyEditBuf) > 0
                                ? `В чеке ${(Number(qtyEditBuf) || 0).toFixed(3)} кг · положите товар`
                                : 'Весы подключены · положите товар на весы'))
                            : (casWeight.error
                              ? `Нет связи · ${casWeight.error}`
                              : 'Нет связи с весами… Проверьте IP и «Тест связи» в настройках')))
                      : (!deskScaleHost.trim()
                        ? 'Нет IP весов · Настройки → Весы CAS → IP → Сохранить → Тест связи'
                        : deskScaleMode === 'none' || !deskScaleLiveWeight
                          ? 'Живой вес выключен · включите в Настройки → Весы CAS'
                          : 'Введите вес с клавиатуры — сумма посчитается сама'))
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
                {overStock && (
                  <div className="qty-edit-warn">
                    Больше остатка ({fmtQty(liveHave)} {unit}). В чек можно, пробить — после прихода на склад.
                  </div>
                )}
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

              <div className="modal-card-actions">
                <button type="button" className="btn-cancel" onClick={() => closeQtyEdit()}>Отмена</button>
                <button type="button" className="btn-confirm" disabled={previewQty <= 0 || overStock || (isWeight && liveWeightEnabled() && scaleMoving)} onClick={applyQtyEdit}>
                  {isWeight ? (scaleMoving ? 'Ждём STOP…' : 'Сохранить') : 'Применить'}
                </button>
              </div>
            </div>
            </PadShell>
          </div>
        )
      })()}

      {payPickOpen && (
        <div className="overlay" {...backdropCloseProps(() => !busy && setPayPickOpen(false))}>
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>Оплата</h3>

            {client && loyalty ? (
              <div className="pay-client-strip">
                <div>
                  <b>{client.name}</b>
                  <span>{client.card || client.phone || 'без карты'}</span>
                </div>
                <div className="pay-client-bonus">⭐ {fmtBonus(loyalty.bonus)}</div>
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
                      if (!next) {
                        setPayDebtBuf('')
                        setPayGivenBuf('')
                      } else if (!(Number(payGivenBuf) > 0) && !(Number(payDebtBuf) > 0)) {
                        // Не подставляем весь долг — кассир вводит, сколько дал клиент
                        setPayDebtBuf('')
                        setPayGivenBuf('')
                      }
                      return next
                    })
                  }}
                >
                  <span className="sw" aria-hidden />
                  <span>
                    Погасить долг <b>{fmtMoney(clientDebt)}</b>
                    <em>сначала чек, остаток — с долга</em>
                  </span>
                </button>
                {payDebtOn && (
                  <>
                  <div className="pay-debt-row">
                    <button
                      type="button"
                      className={Math.abs(payDebtAmt - Math.round(clientDebt / 2 * 100) / 100) < 0.02 ? 'on' : ''}
                        onClick={() => applyPayDebtQuick(clientDebt / 2)}
                    >
                      ½
                    </button>
                    <button
                      type="button"
                      className={Math.abs(payDebtAmt - clientDebt) < 0.02 ? 'on' : ''}
                        onClick={() => applyPayDebtQuick(clientDebt)}
                    >
                      Весь
                    </button>
                    <input
                      className="pay-debt-amt"
                        value={payGivenBuf}
                      inputMode="decimal"
                        onChange={e => applyPayGiven(e.target.value)}
                      onFocus={e => e.currentTarget.select()}
                        placeholder="Сколько дал"
                        aria-label="Сколько дал клиент"
                    />
                  </div>
                    <div className="pay-debt-hint">
                      {payDebtAmt > 0.001 || (Number(payGivenBuf) || 0) > 0.001 ? (
                        <>
                          Чек <b>{total.toFixed(2)}</b>
                          {' → '}
                          долг <b>{payDebtAmt.toFixed(2)}</b>
                          {(Number(payGivenBuf) || 0) > collectTotal + 0.001 && (
                            <>
                              {' · '}сдача{' '}
                              <b>
                                {Math.max(0, Math.round(((Number(payGivenBuf) || 0) - collectTotal) * 100) / 100).toFixed(2)}
                              </b>
                            </>
                          )}
                        </>
                      ) : (
                        <>Введите сумму — например 77 при чеке {total.toFixed(2)}</>
                      )}
                    </div>
                  </>
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
              <button type="button" className="pay-btn pay-credit" onClick={() => choosePayMethod('credit')} disabled={busy || total <= 0.001 || clientDebtBlocked}>
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
                onClick={() => {
                  askSaleConfirm({
                    paidCash: 0,
                    method: 'balance',
                    returnTo: 'payPick',
                    previewTotal: 0,
                  })
                }}
              >
                Подтвердить · оплачено бонусами
              </button>
            )}

            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" disabled={busy} onClick={() => { setPayPickOpen(false); setBonusUsed(0); setPayDebtOn(false); setPayDebtBuf(''); setPayGivenBuf('') }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {creditNoteOpen && creditPending && (
        <div
          className="overlay"
          {...backdropCloseProps(() => {
            if (busy) return
            setCreditNoteOpen(false)
            setCreditPending(null)
            setCreditNoteBuf('')
          })}
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

      {clearCartConfirm && (
        <div className="overlay" {...backdropCloseProps(() => setClearCartConfirm(false))}>
          <div className="modal-card" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <h3>Очистить чек?</h3>
            <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 16 }}>
              Все товары{discountPct > 0 ? ', скидки' : ''} и клиент будут удалены из текущего чека. Это нельзя отменить.
            </div>
            <div className="modal-card-actions" style={{ gap: 8 }}>
              <button type="button" className="btn-cancel" onClick={() => setClearCartConfirm(false)}>
                Отмена
              </button>
              <button type="button" className="btn-confirm" onClick={() => confirmClearCart()}>
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}

      {returnConfirm && (
        <div className="overlay" {...backdropCloseProps(() => !busy && setReturnConfirm(null))}>
          <div className="modal-card" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            {returnConfirm.step === 'confirm' ? (
              <>
                <h3>{returnConfirm.title}</h3>
                <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 16 }}>
                  {returnConfirm.body}
                  {returnConfirm.needAdmin && (
                    <div style={{ marginTop: 8, color: 'var(--org)' }}>
                      Чек из другой или закрытой смены — потребуется код админа.
                    </div>
                  )}
                </div>
                <div className="modal-card-actions" style={{ gap: 8 }}>
                  <button type="button" className="btn-cancel" disabled={busy} onClick={() => setReturnConfirm(null)}>
                    Отмена
                  </button>
                  <button type="button" className="btn-confirm" disabled={busy} onClick={() => void executeReturnConfirm()}>
                    Вернуть
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Код администратора</h3>
                <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 12 }}>
                  Чек из другой или закрытой смены. Введите код: <b>АДМИН</b>
                </div>
                <input
                  className="cash-recv-field"
                  autoFocus
                  value={returnConfirm.adminCode}
                  onChange={e => setReturnConfirm(prev => prev ? { ...prev, adminCode: e.target.value } : prev)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void executeReturnConfirm()
                    }
                  }}
                  placeholder="АДМИН"
                  style={{ marginBottom: 16 }}
                />
                <div className="modal-card-actions" style={{ gap: 8 }}>
                  <button type="button" className="btn-cancel" disabled={busy} onClick={() => setReturnConfirm(null)}>
                    Отмена
                  </button>
                  <button type="button" className="btn-confirm" disabled={busy} onClick={() => void executeReturnConfirm()}>
                    {busy ? 'Возврат…' : 'Подтвердить'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {closeTicketConfirmId && (() => {
        const t = tickets.find(x => x.id === closeTicketConfirmId)
        const idx = tickets.findIndex(x => x.id === closeTicketConfirmId)
        const label = t?.client?.name?.split(/\s+/)[0] || (idx >= 0 ? `Чек ${idx + 1}` : 'Чек')
        const onlyOne = tickets.length <= 1
        return (
          <div className="overlay" {...backdropCloseProps(() => setCloseTicketConfirmId(null))}>
            <div className="modal-card" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
              <h3>{onlyOne ? 'Очистить чек?' : 'Закрыть чек?'}</h3>
              <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 16 }}>
                {t?.client ? `В «${label}» выбран клиент ${t.client.name}.` : `Закрыть «${label}»?`}
                {onlyOne ? ' Чек будет очищен.' : ' Чек закроется.'}
              </div>
              <div className="modal-card-actions" style={{ gap: 8 }}>
                <button type="button" className="btn-cancel" onClick={() => setCloseTicketConfirmId(null)}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn-confirm"
                  onClick={() => {
                    const id = closeTicketConfirmId
                    if (id) closeTicket(id)
                  }}
                >
                  {onlyOne ? 'Очистить' : 'Закрыть'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {scanBlockAlert && (
        <div className="overlay scan-block-overlay" onClick={e => e.stopPropagation()}>
          <div
            className="modal-card scan-block-card"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="scan-block-title"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <h3 id="scan-block-title" style={{ marginBottom: 0 }}>{scanBlockAlert.title}</h3>
              <button
                type="button"
                className="scan-block-x"
                aria-label="Закрыть"
                onClick={() => closeScanBlockAlert()}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 12 }}>
              {scanBlockAlert.sub}
            </div>
            {scanBlockAlert.code ? (
              <div className="scan-block-code">
                <span>Код</span>
                <b>{scanBlockAlert.code.length > 32 ? `${scanBlockAlert.code.slice(0, 32)}…` : scanBlockAlert.code}</b>
              </div>
            ) : null}
            <div style={{ fontSize: 12, color: 'var(--t3)', margin: '12px 0 16px', lineHeight: 1.4 }}>
              Касса заблокирована — следующий скан не примется, пока не закроете это окно.
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => closeScanBlockAlert()}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {barcodePick && (
        <div className="overlay scan-block-overlay" onClick={e => e.stopPropagation()}>
          <div
            className="modal-card barcode-pick-card"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="barcode-pick-title"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <h3 id="barcode-pick-title" style={{ marginBottom: 0 }}>Выберите товар</h3>
              <button
                type="button"
                className="scan-block-x"
                aria-label="Закрыть"
                onClick={() => closeBarcodePick()}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, marginBottom: 8 }}>
              Найдено {barcodePick.products.length} товара с этим штрихкодом — выберите нужный. Автоматически не пробиваем.
            </div>
            {barcodePick.code ? (
              <div className="scan-block-code" style={{ marginBottom: 12 }}>
                <span>Код</span>
                <b>{barcodePick.code.length > 32 ? `${barcodePick.code.slice(0, 32)}…` : barcodePick.code}</b>
              </div>
            ) : null}
            <div className="barcode-pick-list">
              {barcodePick.products.map(p => {
                const stock = liveStockForProduct(p)
                const out = stock <= 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`barcode-pick-row${out ? ' is-out' : ''}`}
                    disabled={out}
                    onClick={() => { if (!out) confirmBarcodePick(p) }}
                  >
                    <span className="barcode-pick-name">{p.name}</span>
                    <span className="barcode-pick-meta">
                      <b>{fmtMoney(Number(p.price) || 0)}</b>
                      <span>{out ? 'нет на складе' : `ост. ${stock}${isWeighted(p) ? ' кг' : ''}`}</span>
                      {p.art ? <span>арт. {p.art}</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="modal-card-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn-cancel" onClick={() => closeBarcodePick()}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {saleConfirm && (
        <div className="overlay" {...backdropCloseProps(() => cancelSaleConfirm())}>
          <div className="modal-card pay-checkout-card" onClick={e => e.stopPropagation()}>
            <h3>Пробить чек?</h3>
            <div className="pay-breakdown" style={{ marginBottom: 14 }}>
              <div className="due">
                <span>Сумма</span>
                <b className="bank-fig sum">{fmtMoney(Number(saleConfirm.previewTotal) || 0)}</b>
              </div>
              {saleConfirm.clientName && (
                <div><span>Клиент</span><b>{saleConfirm.clientName}</b></div>
              )}
              {client?.card && cashSaleBonus > 0 && saleConfirm.method !== 'credit' && saleConfirm.method !== 'wallet' && saleConfirm.method !== 'balance' && (Number(saleConfirm.debtAmt) || 0) < 0.001 && (
                <div><span>Кэшбэк статуса</span><b style={{ color: 'var(--gr)' }}>+{cashSaleBonus} ⭐</b></div>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 14, textAlign: 'center' }}>
              Чек пробьётся только после выбора. Печатать чек?
            </div>
            <div className="modal-card-actions" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => void finishSaleConfirm(false)}
              >
                Нет
              </button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy}
                onClick={() => void finishSaleConfirm(true)}
              >
                {busy ? 'Пробиваем…' : '🖨 Печатать'}
              </button>
            </div>
          </div>
        </div>
      )}

      <MobileBarcodeScanner
        open={camScanOpen}
        onClose={() => setCamScanOpen(false)}
        onDetect={code => {
          setCamScanOpen(false)
          commitPosSearchRef.current(code, { fromScanner: true })
        }}
        title="Сканер · касса"
        hint="Наведите на штрихкод — товар добавится в чек"
      />

      {clientScanOpen && (
        <div className="overlay" {...backdropCloseProps(() => setClientScanOpen(false))}>
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
        <div className="overlay" {...backdropCloseProps(() => setClientOpen(false))}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>👤 Выбор клиента</h3>
            <div className="pos-search">
              <span className="ic">🔍</span>
              <input
                ref={clientSearchRef}
                value={clientQ}
                onChange={e => setClientQ(e.target.value)}
                placeholder="Имя, телефон, карта…"
                autoFocus
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const raw = clientQ.trim()
                  if (!raw) return
                  if (applyClientScan(raw)) return
                  if (clientHits.length === 1) {
                    pickClientInPos(clientHits[0])
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
            {!clientQ.trim() && clientHits.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, fontWeight: 700 }}>
                Должники · нажмите на строку
              </div>
            )}
            <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 12 }}>
              {clientHits.map(c => {
                const sum = loyaltySummaryForClient(c, cards)
                const debt = effectiveDebt(c.card ? cards.find(x => cardNumsMatch(x.num, c.card)) : undefined, c)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="client-result"
                    onClick={() => pickClientInPos(c)}
                  >
                    <div className="av">{initialsOf(c.name)}</div>
                    <div className="ci">
                      <b>{c.name}</b>
                      <span>
                        {c.phone || '—'} · {c.card || 'без карты'} · ⭐ {fmtBonus(sum.bonus)}
                        {debt > 0.001 ? <> · <span className="debt">долг {fmtMoney(debt)}</span></> : null}
                      </span>
                    </div>
                  </button>
                )
              })}
              {clientQ.trim().length >= 1 && !clientHits.length && (
                <div style={{ fontSize: 11, color: 'var(--t3)', padding: 8 }}>Клиент не найден</div>
              )}
              {!clientQ.trim() && !clientHits.length && (
                <div style={{ fontSize: 11, color: 'var(--t3)', padding: 8 }}>Нет клиентов с долгом</div>
              )}
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setClientOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {discPickOpen && (
        <div className="overlay" {...backdropCloseProps(() => setDiscPickOpen(false))}>
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

      {discOpen && (() => {
        const lineTotal = discBaseAmount(discMode, discLineKey)
        const sumBase = discSumBase(discMode, discLineKey)
        // Кол-во надёжнее из суммы строки / цены (6×3=18), не только из line.qty
        const qtyFromLine = discLineQtyFactor(discLineKey)
        const qtyFromSum = sumBase > 0.0001
          ? Math.round((lineTotal / sumBase) * 1000) / 1000
          : 0
        const qty = qtyFromSum > 0.0001 ? qtyFromSum : qtyFromLine
        const raw = Number(discBuf) || 0
        const editingTotal = discMode === 'line' && discInputKind === 'sum' && discEditTarget === 'total'
        const minUnit = Math.round(sumBase * 0.1 * 100) / 100
        const minTotal = Math.round(minUnit * qty * 100) / 100

        let previewUnit = sumBase
        let previewPrice = lineTotal
        let previewPct = 0
        if (discInputKind === 'sum') {
          if (editingTotal) {
            previewPrice = discBuf === '' ? lineTotal : Math.round(Math.max(0, raw) * 100) / 100
            previewUnit = qty > 0 ? Math.round((previewPrice / qty) * 100) / 100 : 0
          } else {
            // Не режем Math.min при наборе — иначе 6 сразу «ломает» итого
            previewUnit = discBuf === ''
              ? sumBase
              : Math.round(Math.max(0, raw) * 100) / 100
            previewPrice = Math.round(previewUnit * qty * 100) / 100
          }
          previewPct = sumBase > 0.0001
            ? Math.min(90, Math.max(0, Math.round((sumBase - Math.min(sumBase, Math.max(0, previewUnit))) / sumBase * 10000) / 100))
            : 0
        } else {
          previewPct = Math.min(90, Math.max(0, raw))
          previewUnit = Math.round(sumBase * (1 - previewPct / 100) * 100) / 100
          previewPrice = Math.round(lineTotal * (1 - previewPct / 100) * 100) / 100
        }
        const previewOff = Math.round((lineTotal - previewPrice) * 100) / 100
        const over = discInputKind === 'sum' && sumBase > 0 && discBuf !== '' && (
          editingTotal
            ? (raw > lineTotal + 0.001 || raw < minTotal - 0.001)
            : (previewUnit > sumBase + 0.001 || previewUnit < minUnit - 0.001)
        )
        const pricePresets = editingTotal
          ? (lineTotal > 0
            ? [100, 95, 90, 85, 80].map(keep => Math.round(lineTotal * keep / 100 * 100) / 100)
            : [0])
          : (sumBase > 0
            ? [100, 95, 90, 85, 80].map(keep => Math.round(sumBase * keep / 100 * 100) / 100)
            : [0])
        const line = discMode === 'line' && discLineKey
          ? cart.find(l => l.key === discLineKey)
          : null
        const unitLabel = line ? cartLineUnit(line) : ''
        const qtyHint = line
          ? (line.weightKg != null
            ? `${line.weightKg.toFixed(3)} ${unitLabel}`
            : `×${fmtQty(line.qty)}`)
          : ''
        return (
          <div className="overlay" {...backdropCloseProps(() => { setDiscOpen(false); setDiscInputKind('pct'); setDiscEditTarget('unit') })}>
            <PadShell
              openPad={amountPad}
              onHidePad={() => setAmountPad(false)}
              pad={
                <Keypad
                  onDigit={k => typeDiscDigit(k)}
                  onBack={() => {
                    discWipeNextRef.current = false
                    setDiscBuf(b => b.slice(0, -1))
                  }}
                />
              }
            >
            <div className="modal-card disc-modal-card" onClick={e => e.stopPropagation()}>
            <h3>{discMode === 'line' ? '🏷 Скидка на товар' : '🏷 Скидка на всё'}</h3>
              {discMode === 'line' && line && (
                <div className="disc-product-line">
                  <b>{line.name}</b>
                  <span>
                    {sumBase.toFixed(2)} ЅМ/{unitLabel}
                    {qtyHint ? ` · ${qtyHint}` : ''}
                    {` · сумма ${lineTotal.toFixed(2)}`}
                  </span>
              </div>
            )}
            {discMode === 'all' && (
                <div className="disc-product-line">
                  <b>Весь чек</b>
                  <span>
                    сейчас {lineTotal.toFixed(2)} сом
                    {levelDiscPct > 0 ? ` · уже +${levelDiscPct}% статус` : ''}
                  </span>
              </div>
            )}

              <div className="disc-kind-toggle" role="group" aria-label="Тип скидки">
                <button
                  type="button"
                  className={discInputKind === 'pct' ? 'on' : ''}
                  onClick={() => switchDiscInputKind('pct')}
                >
                  Процент %
                </button>
                <button
                  type="button"
                  className={discInputKind === 'sum' ? 'on' : ''}
                  onClick={() => switchDiscInputKind('sum')}
                >
                  Новая цена
                </button>
              </div>

              <div className="disc-split">
                <div className={`disc-split-main on`}>
                  <div className="lbl">
                    {discInputKind === 'pct'
                      ? 'Скидка %'
                      : editingTotal
                        ? `Итого за ${qtyHint || `${qty} шт`}`
                        : (discMode === 'line' ? `Новая цена / ${unitLabel || 'ед.'}` : 'Новая сумма чека')}
                  </div>
              <input
                ref={amountInputRef}
                    className={`disc-split-field${editingTotal ? ' total' : ''}`}
                value={discBuf}
                inputMode="decimal"
                autoFocus
                    onChange={e => {
                      discWipeNextRef.current = false
                      setDiscBuf(sanitizeDecimalInput(e.target.value))
                    }}
                    onFocus={e => {
                      discWipeNextRef.current = true
                      e.currentTarget.select()
                    }}
                    placeholder={
                      discInputKind === 'pct'
                        ? '0'
                        : editingTotal
                          ? (lineTotal > 0 ? lineTotal.toFixed(2) : '0')
                          : (sumBase > 0 ? sumBase.toFixed(2) : '0')
                    }
                  />
                  <div className={`disc-split-sub ${over ? 'bad' : ''}`}>
                    {over
                      ? (editingTotal
                        ? `от ${minTotal.toFixed(2)} до ${lineTotal.toFixed(2)}`
                        : `от ${minUnit.toFixed(2)} до ${sumBase.toFixed(2)}`)
                      : discInputKind === 'pct'
                        ? `цена ${previewUnit.toFixed(2)} · итого ${previewPrice.toFixed(2)}`
                        : editingTotal
                          ? `цена за шт: ${previewUnit.toFixed(2)} · −${previewPct.toFixed(1)}%`
                          : `итого ${previewPrice.toFixed(2)} · −${previewPct.toFixed(1)}%`}
            </div>
                </div>
                {discMode === 'line' && discInputKind === 'sum' ? (
                  <button
                    type="button"
                    className={`disc-split-total ${editingTotal ? '' : 'on'}`}
                    aria-label={editingTotal ? 'Редактировать цену за штуку' : 'Редактировать итоговую сумму'}
                    onClick={() => switchDiscEditTarget(editingTotal ? 'unit' : 'total')}
                  >
                    <div className="lbl">{editingTotal ? `Цена / ${unitLabel || 'шт'}` : 'Итого'}</div>
                    <div className="val">
                      {editingTotal ? previewUnit.toFixed(2) : previewPrice.toFixed(2)}
                    </div>
                    <div className="sub">
                      {editingTotal
                        ? 'нажмите · цена за шт'
                        : 'нажмите · изменить сумму'}
                    </div>
                  </button>
                ) : (
                  <div className="disc-split-total">
                    <div className="lbl">Итого</div>
                    <div className="val">{previewPrice.toFixed(2)}</div>
                    <div className="sub">
                      {previewOff > 0.001 ? `−${previewOff.toFixed(2)} сом` : 'без скидки'}
                    </div>
                  </div>
                )}
              </div>

            <div className="qty-edit-toolbar">
              <div className="kp-quick" style={{ margin: 0, flex: 1 }}>
                  {discInputKind === 'pct'
                    ? [0, 5, 10, 15, 20].map(v => (
                      <button key={v} type="button" onClick={() => setDiscBuf(String(v))}>{v}%</button>
                    ))
                    : pricePresets.map((v, i) => (
                      <button key={`${v}-${i}`} type="button" onClick={() => setDiscBuf(String(v))}>
                        {i === 0 ? 'Полная' : v}
                      </button>
                    ))}
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
            <div className="modal-card-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => { setDiscOpen(false); setDiscInputKind('pct'); setDiscEditTarget('unit') }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn-confirm"
                  disabled={over}
                  onClick={applyDiscount}
                >
                  Применить
                </button>
            </div>
          </div>
            </PadShell>
        </div>
        )
      })()}

      {cashOpen && (
        <div className="overlay" {...backdropCloseProps(() => !busy && setCashOpen(false))}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            className="cash-checkout-shell"
            pad={
              <Keypad onDigit={k => setCashBuf(b => appendDigit(b, k))} onBack={() => setCashBuf(b => b.slice(0, -1))} />
            }
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
              {payDebtOn && clientDebt > 0.001 && (
                <div className="cash-debt-split">
                  {cashReceived > 0.001 ? (
                    <>
                      Из {cashReceived.toFixed(2)}: чек <span>{Math.min(total, cashReceived).toFixed(2)}</span>
                      {' · '}долг <span>{payDebtAmt.toFixed(2)}</span>
                      {cashChange > 0.001 && <> · сдача {cashChange.toFixed(2)}</>}
                    </>
                  ) : (
                    <>Чек {total.toFixed(2)} · остаток уйдёт в долг (макс. {clientDebt.toFixed(2)})</>
                  )}
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
                  <div className="cash-change-bonus">Кэшбэк статуса +{cashSaleBonus} ⭐</div>
                )}
              </div>

              <div className="cash-recv">
                <div className="lbl">{payDebtOn && clientDebt > 0.001 ? 'Дал клиент (чек → долг)' : 'Получено от клиента'}</div>
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
                <button
                  type="button"
                  className="cash-bill exact"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setCashBuf(String(Math.round(collectTotal * 100) / 100))
                    window.setTimeout(() => amountInputRef.current?.focus(), 0)
                  }}
                >
                  Без сдачи
                </button>
                {[10, 20, 50, 100, 200, 500].map(v => (
                  <button
                    key={v}
                    type="button"
                    className={cashReceived === v ? 'on' : ''}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setCashBuf(String(v))
                      window.setTimeout(() => amountInputRef.current?.focus(), 0)
                    }}
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
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  setAmountPad(v => !v)
                  window.setTimeout(() => amountInputRef.current?.focus(), 0)
                }}
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
                    askSaleConfirm({
                      paidCash: cashReceived,
                      method: 'cash',
                      returnTo: 'cash',
                      previewTotal: collectTotal,
                    })
                  }}
                >
                  Принять
                </button>
              </div>
            </div>
          </PadShell>
        </div>
      )}

      {splitCardOpen && (
        <div className="overlay" {...backdropCloseProps(() => !busy && setSplitCardOpen(false))}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            pad={
              <Keypad onDigit={k => setSplitCardBuf(b => appendDigit(b, k))} onBack={() => setSplitCardBuf(b => b.slice(0, -1))} />
            }
          >
          <div className="modal-card pay-checkout-card">
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
                  onClick={() => {
                    askSaleConfirm({
                      paidCash: cashReceived,
                      method: 'mixed',
                      paidCard: splitCardAmt,
                      debtAmt: 0,
                      returnTo: 'splitCard',
                      previewTotal: collectTotal,
                    })
                  }}
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
          </PadShell>
        </div>
      )}

      {layerPickOpen && layerPickProduct && (
        <div className="overlay" {...backdropCloseProps(() => !layerPickBusy && setLayerPickOpen(false))}>
          <div className="modal-card layer-pick-card" onClick={e => e.stopPropagation()}>
            <h3>Выберите цену</h3>
            <div className="layer-pick-hint">
              <b>{layerPickProduct.name}</b>
              <span>Одинаковые цены объединены. Списание — с самого старого прихода (FIFO)</span>
            </div>
            <div className="layer-pick-list">
              {layerPickGroups.map(group => {
                const when = group.oldest.createdAtIso
                  ? new Date(group.oldest.createdAtIso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  : '—'
                const batches = group.layers.length
                return (
                  <button
                    key={group.key}
                    type="button"
                    className={`layer-pick-item ${group.isFifo ? 'active' : ''}`}
                    disabled={layerPickBusy || group.remainingQty <= 0}
                    onClick={() => pickPriceGroup(group)}
                  >
                    <div className="lpi-top">
                      <span className="lpi-price">{group.retailPrice.toFixed(2)} ЅМ</span>
                      {group.isFifo ? <span className="lpi-badge">FIFO</span> : null}
                    </div>
                    <div className="lpi-row muted">
                      <span>Закуп</span>
                      <span>{group.costPrice.toFixed(2)} ЅМ</span>
                    </div>
                    <div className="lpi-row">
                      <span>Остаток</span>
                      <b>{group.remainingQty} {displaySellUnit(layerPickProduct)}</b>
                    </div>
                    <div className="lpi-row muted">
                      <span>
                        с {when}
                        {batches > 1 ? ` · ${batches} прихода` : ''}
                        {group.oldest.supplierName ? ` · ${group.oldest.supplierName}` : ''}
                      </span>
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
        <div className="overlay" {...backdropCloseProps(() => !busy && setTillMoveKind(null))}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            pad={
              <Keypad onDigit={k => setTillAmountBuf(b => appendDigit(b, k))} onBack={() => setTillAmountBuf(b => b.slice(0, -1))} />
            }
          >
          <div className="modal-card">
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
          </PadShell>
        </div>
      )}

      {topupOpen && client && (
        <div className="overlay stack-above-hist" {...backdropCloseProps(() => !busy && setTopupOpen(false))}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            pad={
              <Keypad onDigit={k => setTopupBuf(b => appendDigit(b, k))} onBack={() => setTopupBuf(b => b.slice(0, -1))} />
            }
          >
          <div className="modal-card">
            <h3>⭐ Пополнить бонусы</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
              Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>Внесённые деньги и % начисляются в Бонусы ⭐ (1 бонус = 1 сом)</div>
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
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Внесено наличными</span><b className="mono">{topupCash.toFixed(2)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)' }}><span>⭐ Деньги в бонусы</span><b className="mono">+{topupPrincipal.toFixed(2)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)' }}><span>⭐ Бонус %</span><b className="mono">+{fmtBonus(topupPercentBonus)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--gd)', fontWeight: 800 }}><span>⭐ Итого бонусов</span><b className="mono">+{fmtBonus(topupCredit)}</b></div>
              <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 8 }}>
                {topupTier ? cashDepositTierLabel(topupTier) : 'Ниже порога — без % бонуса, только сумма деньгами'}
              </div>
            </div>
            <div className="modal-card-actions">
              <button type="button" className="btn-cancel" onClick={() => setTopupOpen(false)}>Отмена</button>
              <button type="button" className="btn-confirm" disabled={busy || topupCredit <= 0} onClick={() => void submitTopup()}>Пополнить</button>
            </div>
          </div>
          </PadShell>
        </div>
      )}

      {repayOpen && client && (
        <div className="overlay stack-above-hist" {...backdropCloseProps(() => {
          if (busy) return
          setRepayOpen(false)
          setRepayTarget(null)
        })}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            pad={
              <Keypad onDigit={k => setRepayBuf(b => appendDigit(b, k))} onBack={() => setRepayBuf(b => b.slice(0, -1))} />
            }
          >
          <div className="modal-card">
            <h3>💳 {repayTarget
              ? (repayTarget.kind === 'cash' ? 'Погасить наличные' : 'Погасить чек')
              : 'Погасить долг'}</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
              Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b>
              {repayTarget ? (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>
                  Только {repayTarget.label} · макс. {fmtMoney(repayTarget.maxAmount)}
                </div>
              ) : (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>Старый долг · текущий чек не затрагивается</div>
              )}
            </div>
            <div className="kp-display">
              <div className="lbl">{repayTarget
                ? (repayTarget.kind === 'cash' ? 'ОСТАТОК ПО НАЛ.' : 'ОСТАТОК ПО ЧЕКУ')
                : 'ТЕКУЩИЙ ДОЛГ'}</div>
              <div className="val" style={{ color: 'var(--org)' }}>
                {(repayTarget ? Math.min(clientDebt, repayTarget.maxAmount) : clientDebt).toFixed(2)} сом
              </div>
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
                {(() => {
                  const maxPay = repayTarget
                    ? Math.min(clientDebt, repayTarget.maxAmount)
                    : clientDebt
                  return maxPay > 0 ? (
                    <button type="button" onClick={() => setRepayBuf(String(maxPay))}>
                      {repayTarget
                        ? (repayTarget.kind === 'cash' ? 'Вся выдача' : 'Весь чек')
                        : 'Весь долг'}
                    </button>
                  ) : null
                })()}
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
            <div className="modal-card-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setRepayOpen(false)
                  setRepayTarget(null)
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy || repayAmount <= 0 || repayAmount > (repayTarget ? Math.min(clientDebt, repayTarget.maxAmount) : clientDebt) + 0.001}
                onClick={() => void submitDebtRepay()}
              >
                Погасить
              </button>
            </div>
          </div>
          </PadShell>
        </div>
      )}

      {chargeOpen && client && (
        <div className="overlay stack-above-hist" {...backdropCloseProps(() => {
          if (busy) return
          setChargeOpen(false)
        })}>
          <PadShell
            openPad={amountPad}
            onHidePad={() => setAmountPad(false)}
            pad={
              <Keypad onDigit={k => setChargeBuf(b => appendDigit(b, k))} onBack={() => setChargeBuf(b => b.slice(0, -1))} />
            }
          >
          <div className="modal-card">
            <h3>💵 Выдать наличные</h3>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
              Клиент: <b style={{ color: 'var(--gd)' }}>{client.name}</b>
              <div style={{ marginTop: 4, fontSize: 11, color: activeShift ? 'var(--t3)' : 'var(--red)' }}>
                {activeShift
                  ? `Из кассы · в ящике ${fmtMoney(tillExpected)}`
                  : 'Смена закрыта — откройте смену'}
              </div>
            </div>
            <div className="kp-display">
              <div className="lbl">ТЕКУЩИЙ ДОЛГ</div>
              <div className="val" style={{ color: clientDebt > 0 ? 'var(--org)' : 'var(--t3)' }}>
                {clientDebt.toFixed(2)} сом
              </div>
            </div>
            <div className="kp-display" style={{ marginTop: -6 }}>
              <div className="lbl">СУММА ВЫДАЧИ</div>
              <input
                ref={amountInputRef}
                className="kp-field"
                value={chargeBuf}
                inputMode="decimal"
                autoFocus
                onChange={e => setChargeBuf(sanitizeDecimalInput(e.target.value))}
                onFocus={e => e.currentTarget.select()}
                placeholder="0.00"
              />
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Станет долг</span>
                <b className="mono" style={{ color: 'var(--org)' }}>{(clientDebt + chargeAmount).toFixed(2)}</b>
              </div>
            </div>
            <div className="qty-edit-toolbar">
              <div className="kp-quick" style={{ margin: 0, flex: 1 }} />
              <button
                type="button"
                className={`qty-pad-toggle ${amountPad ? 'on' : ''}`}
                onClick={() => setAmountPad(v => !v)}
                title={amountPad ? 'Скрыть клавиатуру' : 'Экранная клавиатура'}
              >
                ⌨ {amountPad ? 'Скрыть' : 'Клавиатура'}
              </button>
            </div>
            <div className="modal-card-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setChargeOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-confirm"
                disabled={busy || chargeAmount <= 0 || chargeAmount > tillExpected + 0.001}
                onClick={() => void submitCashCharge()}
              >
                Выдать
              </button>
            </div>
          </div>
          </PadShell>
        </div>
      )}

      {histOpen && client && loyalty && (
        <div className="overlay hist-fs-overlay" {...backdropCloseProps(() => { setHistOpen(false); setHistDetail(null); setPayGroupDetail(null) })}>
          <div className="modal-card hist-card hist-card-fs cashier-debts-panel" onClick={e => e.stopPropagation()}>
            <div className="cashier-debts-head">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1 }}>
                <div className="cashier-debts-av">{initialsOf(client.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 15 }}>{client.name}</b>
                    {clientDebt > 0 ? (
                      <span className="hist-badge open">В долгу</span>
                    ) : (
                      <span className="hist-badge paid">Без долга</span>
                    )}
                    <span className="hist-badge" style={{ background: `${CLIENT_LEVEL_COLORS[loyalty.level] || '#888'}22`, color: CLIENT_LEVEL_COLORS[loyalty.level] || '#888' }}>
                      {levelLabel(loyalty.level)}
                    </span>
                  </div>
                  <div className="client-profile-meta" style={{ marginTop: 3 }}>
                  <span>{client.phone || 'без телефона'}</span>
                    {client.card ? (() => {
                      const card = cards.find(x => cardNumsMatch(x.num, client.card))
                      const st = card ? CARD_STATUS_LABELS[card.status] : null
                      return (
                        <>
                          <span>·</span>
                          <span>
                            {client.card}
                            {st ? <> · <span style={{ color: st.c }}>{st.l}</span></> : null}
                          </span>
                        </>
                      )
                    })() : null}
                  </div>
                </div>
              </div>
              <button type="button" className="hist-fs-x" aria-label="Закрыть" onClick={() => { setHistOpen(false); setHistDetail(null); setPayGroupDetail(null) }}>✕</button>
                </div>

            <div className="cashier-debts-hero">
              <div className="cashier-debts-hero-main">
                <div className="kl">Сейчас должен</div>
                <div className="kv" style={{ color: clientDebt > 0 ? 'var(--red)' : 'var(--accent)' }}>
                  {clientDebt > 0 ? fmtMoney(clientDebt) : '0.00'}
                  <span className="cashier-debts-hero-cur"> сом</span>
                </div>
                <div className="kh">
                  {debtLimit > 0
                    ? `Можно ещё взять ${fmtMoney(availableDebt)} · лимит ${fmtMoney(debtLimit)}`
                    : 'Лимит не задан'}
                </div>
              </div>
              <div className="cashier-debts-hero-side">
                <div>
                  <span className="kl">Уже оплатил</span>
                  <b style={{ color: 'var(--accent)' }}>{fmtMoney(clientProfileStats.repaid)}</b>
                </div>
                <div>
                  <span className="kl">Бонусы</span>
                  <b style={{ color: 'var(--gd)' }}>{fmtBonus(clientProfileStats.bonus)}</b>
                </div>
                <div>
                  <span className="kl">Чеки к оплате</span>
                  <b style={{ color: 'var(--blue)' }}>{cashierDebtPanel.openChecks}</b>
                </div>
              </div>
            </div>
            {(cashierDebtPanel.posRemain > 0.005 || cashierDebtPanel.cashOnCard > 0.005) && (
              <div className="cashier-debts-split">
                <span>Из них по чекам <b style={{ color: 'var(--blue)' }}>{fmtMoney(cashierDebtPanel.posRemain)}</b></span>
                {cashierDebtPanel.cashOnCard > 0.005 && (
                  <span>наличными <b style={{ color: 'var(--org)' }}>{fmtMoney(cashierDebtPanel.cashOnCard)}</b></span>
                )}
              </div>
            )}

            <div className="cashier-debts-subtabs" role="tablist">
              {([
                ['pos', `Чеки (${cashierDebtPanel.openChecks})`],
                ['pay', `Оплаты (${cashierDebtPanel.payGroups.length})`],
                ['cash', `Нал. (${cashierDebtPanel.openCash})`],
                ['history', 'Лента'],
              ] as const).map(([id, label]) => (
                  <button
                  key={id}
                    type="button"
                  role="tab"
                  aria-selected={histTab === id}
                  className={`cashier-debts-subtab ${histTab === id ? 'on' : ''}`}
                  onClick={() => setHistTab(id)}
                >
                  {label}
                  </button>
              ))}
            </div>

            <div className="hist-scroll hist-scroll-fs cashier-debts-body">
              {histTab === 'pos' && (
                <>
                  {(() => {
                    // Только чеки с остатком долга (открытые + частичные). Погашенные скрыты.
                    const openRows = cashierDebtPanel.creditSales.filter(s => s.remain > 0.001)
                    if (!openRows.length) {
                      return <div className="hist-empty">Нет чеков к оплате</div>
                    }
                    const renderSale = (s: typeof cashierDebtPanel.creditSales[number]) => {
                      const statusLabel = s.status === 'paid' ? 'Погашен' : s.status === 'partial' ? 'Частично' : 'Должен'
                      const statusColor = s.status === 'paid' ? 'var(--accent)' : s.status === 'partial' ? 'var(--org)' : 'var(--red)'
                      const whenShort = s.when.replace(/,\s*/, ' · ').replace(/\.(\d{2}),/, '.$1')
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className="cashier-debt-check"
                          onClick={() => {
                            const match = histActiveDebts.find(r => r.saleId === s.id)
                              || histPaidDebts.find(r => r.saleId === s.id)
                            if (match) { setHistDetail(match); return }
                            const sale = sales.find(x => x.id === s.id)
                            const lines = sale ? mapSaleLines(sale.items, products) : []
                            setHistDetail({
                              id: `active-sale-${s.id}`,
                              ts: s.ts,
                              when: s.when,
                              title: `${s.label} · ${statusLabel.toLowerCase()}`,
                              sub: s.paid > 0.001
                                ? `Было ${fmtMoney(s.debtAdded)} · оплатил ${fmtMoney(s.paid)} · осталось ${fmtMoney(s.remain)}`
                                : `К оплате ${fmtMoney(s.remain)}`,
                              items: s.items || undefined,
                              lines: lines.length ? lines : undefined,
                              amount: s.debtAdded,
                              tone: s.status === 'paid' ? 'credit' : 'debt',
                              debtStatus: s.status,
                              debtPaid: s.paid,
                              debtRemain: s.remain,
                              saleId: s.id,
                              orderId: sale?.orderId || s.id,
                            })
                          }}
                        >
                          <span className="cashier-debt-check-id">
                            <b>{s.label}</b>
                            <em>{whenShort}</em>
                          </span>
                          <span className="cashier-debt-check-nums">
                            <span title="Было"><i>было</i><b>{fmtMoney(s.debtAdded)}</b></span>
                            <span title="Оплатил"><i>опл.</i><b style={{ color: 'var(--accent)' }}>{fmtMoney(s.paid)}</b></span>
                            <span title="Осталось"><i>ост.</i><b style={{ color: statusColor }}>{s.status === 'paid' ? '—' : fmtMoney(s.remain)}</b></span>
                          </span>
                          <span className="cashier-debt-check-st" style={{ color: statusColor }}>{statusLabel} ›</span>
                        </button>
                      )
                    }
                    return (
                      <>
                        <div className="cashier-debt-sec">Ещё должен · {fmtMoney(cashierDebtPanel.posRemain)}</div>
                        {openRows.map(renderSale)}
                      </>
                    )
                  })()}
                </>
              )}

              {histTab === 'pay' && (
                <>
                  <div className="cashier-debt-hint">
                    Одна оплата — одна строка. Нажмите: какие чеки и нал. выдачи закрыты.
                  </div>
                  {!cashierDebtPanel.payGroups.length ? (
                    <div className="hist-empty">Пока нет оплат</div>
                  ) : (
                    <div className="cashier-debt-pays">
                      {cashierDebtPanel.payGroups.map(g => (
                        <button
                          key={g.id}
                          type="button"
                          className="cashier-debt-pay"
                          onClick={() => setPayGroupDetail(g)}
                        >
                          <span className="cashier-debt-pay-main">
                            <b>{g.isReturn ? 'Возврат' : 'Оплата'} {fmtMoney(g.amount)}</b>
                            <em>
                              {g.isReturn ? `по ${g.coverHint}` : g.coverHint}
                              {g.methodHint ? ` · ${g.methodHint}` : ''}
                              {!g.isReturn && (g.cashCount || 0) > 0 ? ' · внутри нал.' : ''}
                            </em>
                            <i>{g.when}</i>
                          </span>
                          <span className="cashier-debt-pay-amt">−{fmtMoney(g.amount)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {histTab === 'cash' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div className="cashier-debt-hint" style={{ margin: 0 }}>
                      Только незакрытые выдачи. Погашенные — во вкладке «Оплаты».
                    </div>
                    <button
                      type="button"
                      className="cashier-debts-subtab"
                      onClick={() => openCashCharge()}
                    >
                      + Выдать
                    </button>
                  </div>
                  {(() => {
                    const openRows = cashierDebtPanel.cashView.filter(c => c.remain > 0.001)
                    if (!openRows.length) {
                      return <div className="hist-empty">Нет наличных к оплате</div>
                    }
                    const openCashSum = openRows.reduce((s, c) => s + c.remain, 0)
                    const openCashRepay = (c: typeof cashierDebtPanel.cashView[number]) => {
                      const remain = Math.min(c.remain, clientDebt)
                      if (remain <= 0.001 || clientDebt <= 0) {
                        showToast('Нет долга', 'У клиента нет задолженности')
                        return
                      }
                      setRepayTarget({
                        orderId: c.orderId || '',
                        label: c.label,
                        maxAmount: remain,
                        debtEntryId: c.debtEntryId,
                        kind: 'cash',
                      })
                      setRepayBuf(String(remain))
                      setRepayMethod('cash')
                      setAmountPad(false)
                      setRepayOpen(true)
                    }
                    return (
                      <>
                        <div className="cashier-debt-sec">Ещё должен · {fmtMoney(openCashSum)}</div>
                        {openRows.map(c => {
                          const statusLabel = c.status === 'partial' ? 'Частично' : 'Должен'
                          const statusColor = c.status === 'partial' ? 'var(--org)' : 'var(--red)'
                          const whenShort = c.when.replace(/,\s*/, ' · ')
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className="cashier-debt-check"
                              onClick={() => openCashRepay(c)}
                            >
                              <span className="cashier-debt-check-id">
                                <b>{c.isResidual ? 'На карте' : c.label}</b>
                                <em>{whenShort}</em>
                              </span>
                              <span className="cashier-debt-check-nums">
                                <span title="Было"><i>было</i><b>{fmtMoney(c.debtAdded)}</b></span>
                                <span title="Оплатил"><i>опл.</i><b style={{ color: 'var(--accent)' }}>{fmtMoney(c.paid)}</b></span>
                                <span title="Осталось"><i>ост.</i><b style={{ color: statusColor }}>{fmtMoney(c.remain)}</b></span>
                              </span>
                              <span className="cashier-debt-check-st" style={{ color: statusColor }}>{statusLabel} ›</span>
                            </button>
                          )
                        })}
                      </>
                    )
                  })()}
                </>
              )}

              {histTab === 'history' && (
                !cashierDebtPanel.feed.length ? (
                  <div className="hist-empty">Пока нет движений</div>
                ) : (
                  <div className="cashier-debts-table-wrap">
                    <div className="cashier-debt-hint">Подробная лента. Главная цифра долга — сверху «Сейчас должен».</div>
                    <table className="cashier-debts-table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>Что</th>
                          <th style={{ textAlign: 'right' }}>Сумма</th>
                          <th style={{ textAlign: 'right' }}>Долг после</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashierDebtPanel.feed.map(row => {
                          const isReturn = row.kind === 'pay' && /возврат/i.test(row.desc || '')
                          const kindLabel = row.kind === 'pos' ? 'Чек' : row.kind === 'cash' ? 'Нал.' : isReturn ? 'Возврат' : 'Оплата'
                          const kindColor = row.kind === 'pos' ? 'var(--blue)' : row.kind === 'cash' ? 'var(--org)' : isReturn ? 'var(--blue)' : 'var(--accent)'
                          return (
                            <tr
                              key={row.key}
                              onClick={() => {
                                if (!row.saleId) return
                                const match = histActiveDebts.find(r => r.saleId === row.saleId)
                                  || histPaidDebts.find(r => r.saleId === row.saleId)
                                if (match) setHistDetail(match)
                              }}
                              style={{ cursor: row.saleId ? 'pointer' : undefined }}
                            >
                              <td style={{ whiteSpace: 'nowrap', color: 'var(--t3)', fontSize: 12 }}>{row.when}</td>
                              <td style={{ fontSize: 13 }}>
                                <span style={{ fontWeight: 800, color: kindColor, marginRight: 6 }}>{kindLabel}</span>
                                {row.desc}
                              </td>
                              <td style={{
                                textAlign: 'right', fontWeight: 900, whiteSpace: 'nowrap',
                                color: row.amount < 0 ? 'var(--accent)' : 'var(--org)',
                              }}>
                                {row.amount < 0 ? '−' : '+'}{fmtMoney(Math.abs(row.amount))}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>
                                {fmtMoney(row.balance)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
                </div>

            <div className="cashier-debts-actions">
              <button
                type="button"
                className="btn-confirm"
                disabled={!(clientDebt > 0)}
                onClick={() => {
                  if (clientDebt <= 0) { showToast('Нет долга', 'У клиента нет задолженности'); return }
                  setRepayTarget(null)
                  setRepayBuf('')
                  setRepayMethod('cash')
                  setAmountPad(false)
                  setRepayOpen(true)
                }}
              >
                ✓ Погасить {clientDebt > 0 ? fmtMoney(clientDebt) : 'долг'}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => openCashCharge()}
              >
                Выдать наличные
              </button>
            </div>
          </div>
        </div>
      )}

      {payGroupDetail && (
        <div className="overlay hist-detail-overlay" {...backdropCloseProps(() => setPayGroupDetail(null))}>
          <div className="modal-card hist-detail-card" onClick={e => e.stopPropagation()}>
            <div className="hist-detail-head">
              <button type="button" className="hist-back" onClick={() => setPayGroupDetail(null)}>← Назад</button>
              <h3>Оплата</h3>
            </div>
            <div className="hist-detail-body">
              <div className="hist-title-row" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>
                  {payGroupDetail.isReturn ? 'Возврат' : 'Оплата'} {fmtMoney(payGroupDetail.amount)}
                </b>
              </div>
              <div className="hist-when" style={{ marginBottom: 6 }}>{payGroupDetail.when}</div>
              <div className="hist-sub" style={{ marginBottom: 12 }}>
                {payGroupDetail.methodHint ? `${payGroupDetail.methodHint} · ` : ''}
                {payGroupDetail.coverHint
                  || (payGroupDetail.checkCount > 1
                    ? `Распределено по ${payGroupDetail.checkCount} чекам`
                    : 'По одному чеку / позиции')}
                {(payGroupDetail.cashCount || 0) > 0 ? ' · есть нал. выдачи' : ''}
              </div>
              <div className="hist-detail-sum" style={{ color: 'var(--accent)', marginBottom: 14 }}>
                −{fmtMoney(payGroupDetail.amount)}
              </div>
              <div className="hist-detail-items">
                <div className="hist-section-h">
                  {payGroupDetail.isReturn ? 'По позиции' : 'Что закрыто этой оплатой'} · {payGroupDetail.parts.length}
                </div>
                <div className="hist-lines">
                  {payGroupDetail.parts.map((p, i) => {
                    const kind = p.partKind === 'cash' ? 'Нал.' : p.partKind === 'check' ? 'Чек' : ''
                    return (
                      <div key={p.id || `${p.checkLabel}-${i}`} className="hist-line">
                        <div className="hist-line-main">
                          <b>
                            {kind ? `${kind} · ` : ''}
                            {p.checkLabel}
                          </b>
                          {p.items ? <span className="hist-line-qty" style={{ display: 'block', marginTop: 2 }}>{p.items}</span> : null}
                        </div>
                        <div className="hist-line-sum" style={{ color: 'var(--accent)' }}>
                          −{fmtMoney(p.amount)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="hist-detail-foot">
              <button type="button" className="btn-cancel" style={{ width: '100%' }} onClick={() => setPayGroupDetail(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {histDetail && (
        <div className="overlay hist-detail-overlay" {...backdropCloseProps(() => setHistDetail(null))}>
          <div className="modal-card hist-detail-card" onClick={e => e.stopPropagation()}>
            <div className="hist-detail-head">
              <button type="button" className="hist-back" onClick={() => setHistDetail(null)}>← Назад</button>
              <h3>Детали</h3>
            </div>
            <div className="hist-detail-body">
              <div className="hist-title-row" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>{histDetail.title}</b>
                {histDetail.debtStatus === 'paid' && <span className="hist-badge paid">Погашен</span>}
                {histDetail.debtStatus === 'partial' && <span className="hist-badge partial">Частично</span>}
                {histDetail.debtStatus === 'open' && <span className="hist-badge open">К оплате</span>}
              </div>
              <div className="hist-when" style={{ marginBottom: 6 }}>{histDetail.when}</div>
              <div className="hist-sub" style={{ marginBottom: 12 }}>{histDetail.sub}</div>
              {(histDetail.debtPaid != null || histDetail.debtRemain != null) ? (
                <div className="cashier-debt-check-nums hist-detail-nums" style={{ marginBottom: 12 }}>
                  <div><span>Сумма</span><b>{fmtMoney(histDetail.amount)}</b></div>
                  <div><span>Оплатил</span><b style={{ color: 'var(--accent)' }}>{fmtMoney(histDetail.debtPaid || 0)}</b></div>
                  <div><span>Осталось</span><b style={{ color: 'var(--red)' }}>{fmtMoney(histDetail.debtRemain || 0)}</b></div>
                </div>
              ) : (
                <div className="hist-detail-sum">{fmtMoney(histDetail.amount)}</div>
              )}
              {(() => {
                const detailLines = (histDetail.lines && histDetail.lines.length)
                  ? histDetail.lines
                  : parseItemsSummary(histDetail.items)
                if (!detailLines.length) return null
                return (
                  <div className="hist-detail-items">
                    <div className="hist-section-h">Состав · {detailLines.length}</div>
                    <div className="hist-lines">
                      {detailLines.map((line, i) => {
                        const q = Number.isInteger(line.qty)
                          ? String(line.qty)
                          : String(Math.round(line.qty * 1000) / 1000)
                        const u = String(line.unit || '').trim()
                        return (
                          <div key={`${line.name}-${i}`} className="hist-line">
                            <div className="hist-line-main">
                              <b>{line.name}</b>
                              <span className="hist-line-qty">{u ? `${q} ${u}` : `× ${q}`}</span>
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
            </div>
            <div className="hist-detail-foot">
              {(histDetail.tone === 'credit' || histDetail.tone === 'debt') && histDetail.debtStatus !== 'paid' && (
                <button
                  type="button"
                  className="action-chip ac-repay"
                  style={{ width: '100%' }}
                  onClick={() => {
                    const remain = Math.min(
                      histDetail.debtRemain ?? histDetail.amount,
                      clientDebt,
                    )
                    if (remain <= 0.001 || clientDebt <= 0) {
                      showToast('Нет долга', 'У клиента нет задолженности')
                      return
                    }
                    const label = histDetail.title.replace(/\s·\s(к оплате|частично)$/i, '').trim()
                      || 'Чек'
                    setHistDetail(null)
                    setRepayTarget(histDetail.orderId || histDetail.saleId
                      ? {
                          orderId: histDetail.orderId || histDetail.saleId!,
                          label,
                          maxAmount: remain,
                          debtEntryId: histDetail.debtEntryId,
                          kind: histDetail.saleId ? 'sale' : (histDetail.orderId?.startsWith('cash-') || histDetail.id.startsWith('active-cash-') || histDetail.id.startsWith('cash-') ? 'cash' : 'sale'),
                        }
                      : histDetail.id.startsWith('active-cash-') || histDetail.id === 'residual-cash' || histDetail.id.startsWith('cash-')
                        ? {
                            orderId: histDetail.orderId || '',
                            label,
                            maxAmount: remain,
                            debtEntryId: histDetail.debtEntryId,
                            kind: 'cash',
                          }
                        : null)
                    setRepayBuf(String(remain))
                    setRepayMethod('cash')
                    setAmountPad(false)
                    setRepayOpen(true)
                  }}
                >
                  <span className="ic-wrap">💳</span>
                  <span>{histDetail.saleId
                    ? 'Погасить этот чек'
                    : (histDetail.orderId?.startsWith('cash-') || histDetail.id.includes('cash')
                      ? 'Погасить эту выдачу'
                      : 'Погасить этот долг')}</span>
                </button>
              )}
              <button type="button" className="btn-confirm" onClick={() => setHistDetail(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {cashierScreen === 'receipts' && activeShift && (
        <div className="cashier-screen receipts-screen">
          <div className="cashier-screen-inner wide receipts-fs">
            <div className="cashier-screen-top receipts-top">
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
              <div className="receipts-top-title">
                <h2>{receiptDetail ? 'Чек' : 'История чеков'}</h2>
                {receiptDetail && <p>{saleNumberLabel(receiptDetail)}</p>}
              </div>
              {!receiptDetail && (
                <div className="receipt-shift-card receipts-top-shift">
                  {receiptScope === 'shift' && receiptShiftHeader ? (
                    <>
                      <div className="receipt-shift-card-main">
                        <b>{receiptShiftHeader.title}</b>
                        <span>{receiptShiftHeader.openedLabel}</span>
                      </div>
                      <div className="receipt-shift-card-stats">
                        <span>Чеков: <b>{receiptListTotalCount}</b></span>
                        <span>Выручка: <b>{fmtMoney(receiptPeriodSum)}</b></span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="receipt-shift-card-main">
                        <b>Другие смены</b>
                        <span>
                          {receiptFrom && receiptTo
                            ? `${receiptFrom.split('-').reverse().join('.')} — ${receiptTo.split('-').reverse().join('.')}`
                            : 'выберите период ниже'}
                        </span>
                      </div>
                      <div className="receipt-shift-card-stats">
                        <span>Чеков: <b>{receiptListTotalCount}</b></span>
                        <span>Выручка: <b>{fmtMoney(receiptPeriodSum)}</b></span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {!receiptDetail ? (
              <>
                <div className="receipt-scope-bar" role="group" aria-label="Режим истории">
                  <button
                    type="button"
                    className={`receipt-scope-btn ${receiptScope === 'shift' ? 'on' : ''}`}
                    onClick={() => { setReceiptScope('shift'); setReceiptLimit(50); setReceiptQ('') }}
                  >
                    Эта смена
                  </button>
                  <button
                    type="button"
                    className={`receipt-scope-btn ${receiptScope === 'other' ? 'on' : ''}`}
                    onClick={() => { setReceiptScope('other'); setReceiptLimit(50); setReceiptQ('') }}
                  >
                    Другие смены
                  </button>
                </div>

                <div className="receipt-topbar receipt-topbar-shift">
                  <div className="pos-search receipt-search">
                  <span className="ic">🔍</span>
                  <input
                    ref={receiptSearchRef}
                    value={receiptQ}
                      onChange={e => onReceiptSearchChange(e.target.value)}
                      placeholder={
                        receiptScope === 'shift'
                          ? 'Поиск в этой смене…'
                          : 'Поиск в выбранном периоде…'
                      }
                    autoFocus
                      onKeyDown={onReceiptSearchKeyDown}
                    />
                    {!!receiptQ.trim() && (
                      <button
                        type="button"
                        className="search-clear"
                        title="Очистить"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setReceiptQ('')}
                      >×</button>
                    )}
                  </div>

                  <div className="receipt-toolbar">
                    <div className="receipt-filters-row">
                      <div className="receipt-filters receipt-filters-sm" role="group" aria-label="Оплата">
                  {([
                    ['all', 'Все'],
                    ['cash', 'Нал'],
                    ['card', 'Карта'],
                    ['credit', 'Долг'],
                          ['returned', 'Возвр.'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`receipt-filter ${receiptFilter === id ? 'on' : ''}`}
                            onClick={() => { setReceiptFilter(id); setReceiptLimit(50) }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                      {receiptScope === 'other' && (
                        <div className="receipt-period-inline" title="Период других смен">
                          <input
                            type="date"
                            value={receiptFrom}
                            onChange={e => { setReceiptFrom(e.target.value); setReceiptLimit(50); setReceiptQ('') }}
                            aria-label="Дата с"
                          />
                          <span>—</span>
                          <input
                            type="date"
                            value={receiptTo}
                            onChange={e => { setReceiptTo(e.target.value); setReceiptLimit(50); setReceiptQ('') }}
                            aria-label="Дата по"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {receiptProductHint && (
                  <div className="receipt-product-hint">
                    <div className="receipt-product-hint-name">
                      Товар: <b>{receiptProductHint.name}</b>
                      <span> · {receiptProductHint.count} чек.</span>
                    </div>
                    <div className="receipt-codes">
                      {receiptProductHint.art ? <span>арт. {receiptProductHint.art}</span> : null}
                      {receiptProductHint.plu ? <span>PLU {receiptProductHint.plu}</span> : null}
                      {receiptProductHint.barcode ? <span>ш/к {receiptProductHint.barcode}</span> : null}
                    </div>
                  </div>
                )}

                <div className="receipt-list">
                  {!receiptList.length && (
                    <div className="hist-empty">
                      {receiptQ.trim()
                        ? (receiptScope === 'shift'
                          ? 'В этой смене ничего не найдено'
                          : 'В выбранном периоде ничего не найдено')
                        : 'Чеков не найдено'}
                    </div>
                  )}
                  {receiptList.map(s => {
                    const fully = isSaleFullyReturned(s)
                    const partial = isSalePartiallyReturned(s)
                    const when = new Date(s.createdAtIso)
                    const payLabel = fully
                      ? 'Возврат'
                      : partial
                        ? 'Частичный возврат'
                        : s.paymentMethod === 'cash'
                          ? 'Нал'
                          : s.paymentMethod === 'card'
                            ? 'Карта'
                            : s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0
                              ? 'Долг'
                              : 'Смеш.'
                    const cashierLabel = cashierDisplayName(s)
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
                            <b className="receipt-pay-label">{payLabel}</b>
                            {fully && <span className="hist-badge open">Возвращён</span>}
                            {partial && <span className="hist-badge">Часть</span>}
                          </div>
                          <span className="hist-when">
                            {Number.isNaN(when.getTime())
                              ? s.createdAtIso
                              : `${when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${receiptScope === 'other' ? ` · ${when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}`}
                            {` · ${cashierLabel}`}
                            {s.clientName ? ` · ${s.clientName}` : ''}
                          </span>
                        </div>
                        <div className="hist-amt-col">
                          <div className="hist-amt">{fmtMoney(s.total)}</div>
                        </div>
                      </button>
                    )
                  })}
                  {receiptList.length < receiptListTotalCount && (
                    <button
                      type="button"
                      className="receipt-load-more"
                      onClick={() => setReceiptLimit(n => n + 50)}
                    >
                      Показать ещё {Math.min(50, receiptListTotalCount - receiptList.length)}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="receipt-detail">
                <div className="receipt-detail-scroll">
                <div className="receipt-detail-meta">
                  <div><span>Дата и время</span><b>{(() => {
                    const when = new Date(receiptDetail.createdAtIso)
                    return Number.isNaN(when.getTime())
                      ? receiptDetail.createdAtIso
                      : `${when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} · ${when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                  })()}</b></div>
                  <div><span>Смена</span><b>{shiftLabelForSale(receiptDetail)}</b></div>
                  <div><span>Кассир</span><b>{cashierDisplayName(receiptDetail)}</b></div>
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
                  {(Number(receiptDetail.paidCash) || 0) > 0.001 && (
                    <div><span>Наличные</span><b>{fmtMoney(Number(receiptDetail.paidCash))}</b></div>
                  )}
                  {(Number(receiptDetail.paidCard) || 0) > 0.001 && (
                    <div><span>Карта</span><b>{fmtMoney(Number(receiptDetail.paidCard))}</b></div>
                  )}
                  {(Number(receiptDetail.paidWallet) || 0) > 0.001 && (
                    <div><span>Кошелёк</span><b>{fmtMoney(Number(receiptDetail.paidWallet))}</b></div>
                  )}
                  {(Number(receiptDetail.debtAdded) || 0) > 0.001 && (
                    <div><span>В долг</span><b>{fmtMoney(Number(receiptDetail.debtAdded))}</b></div>
                  )}
                  {(Number(receiptDetail.discountAmount) || 0) > 0.001 && (
                    <div><span>Скидка</span><b>{fmtMoney(Number(receiptDetail.discountAmount))}</b></div>
                  )}
                  {(Number(receiptDetail.bonusSpent) || 0) > 0.001 && (
                    <div><span>Списано бонусов</span><b>{fmtMoney(Number(receiptDetail.bonusSpent))}</b></div>
                  )}
                  {(Number(receiptDetail.bonusEarned) || 0) > 0.001 && (
                    <div><span>Начислено бонусов</span><b>{fmtMoney(Number(receiptDetail.bonusEarned))}</b></div>
                  )}
                  {(Number(receiptDetail.cashReceived) || 0) > 0.001 && (
                    <div><span>Дал клиент</span><b className="bank-fig">{fmtMoney(Number(receiptDetail.cashReceived))}</b></div>
                  )}
                  {(Number(receiptDetail.changeGiven) || 0) > 0.001 && (
                    <div><span>Сдача</span><b className="sum">{fmtMoney(Number(receiptDetail.changeGiven))}</b></div>
                  )}
                  <div>
                    <span>Клиент</span>
                    <b>
                      {receiptDetail.clientName || 'Без клиента'}
                      {receiptDetail.clientPhone ? ` · ${receiptDetail.clientPhone}` : ''}
                    </b>
                </div>
                  {needsAdminReturnConfirm(receiptDetail) && !isSaleFullyReturned(receiptDetail) && (
                    <div><span>Возврат</span><b style={{ color: 'var(--org, #e8a23a)' }}>Нужен код админа (чужая/закрытая смена)</b></div>
                  )}
                </div>
                {(receiptDetail.returns || []).length > 0 && (
                  <div className="receipt-returns-block">
                    <div className="hist-section-h">История возвратов</div>
                    <div className="receipt-returns-list">
                      {(receiptDetail.returns || []).map((r, idx) => {
                        const at = new Date(r.atIso)
                        const who = r.cashierId
                          ? (shifts.find(x => x.cashierId === r.cashierId)?.cashierName
                            || (r.cashierId === settings.cashierId ? settings.cashierName : r.cashierId))
                          : '—'
                        return (
                          <div key={`${r.atIso}-${idx}`} className="receipt-return-row">
                            <b>{fmtMoney(
                              (r.cutCash != null || r.cutCard != null || r.cutDebt != null)
                                ? (Number(r.cutCash) || 0) + (Number(r.cutCard) || 0)
                                : (Number(r.total) || 0),
                            )}</b>
                            <span>
                              {Number.isNaN(at.getTime())
                                ? r.atIso
                                : `${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
                              {` · ${who}`}
                              {(Number(r.cutDebt) || 0) > 0.001 ? ` · долг −${fmtMoney(Number(r.cutDebt))}` : ''}
                              {r.note ? ` · ${r.note}` : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
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
                  <div className="receipt-return-hint">Отметьте позиции — можно вернуть часть штук или веса (напр. 250 г из 500 г)</div>
                )}
                <div className="hist-lines receipt-lines-compact">
                  {(receiptDetail.items || []).map((line, i) => {
                    const left = saleLineLeft(line)
                    const returnedQty = Number(line.returnedQty) || 0
                    const selectedQty = Number(returnQtyByIdx[i]) || 0
                    const on = selectedQty > 0
                    const unitPrice = Number(line.qty) > 0
                      ? (Number(line.lineTotal) || 0) / Number(line.qty)
                      : Number(line.price) || 0
                    const showSum = left > 0 ? unitPrice * left : Number(line.lineTotal) || 0
                    const canReturn = left > 0 && !isSaleFullyReturned(receiptDetail)
                    const p = products.find(x => x.id === line.productId)
                    const weightedLine = isSaleLineWeighted(line, p)
                    const returnStep = returnQtyStep(weightedLine)
                    const unitLabel = String(line.unit || '').trim()
                      || (p ? (isWeighted(p) ? 'кг' : displaySellUnit(p)) : '')
                      || (Number.isInteger(Number(line.qty)) ? 'шт' : 'кг')
                    const qtyLabel = (n: number) => formatReturnQty(n, unitLabel, weightedLine)
                    const codes = productCodesForId(line.productId)
                    const metaParts = [
                      left > 0 ? qtyLabel(left) : `возвращено ${qtyLabel(Number(line.qty) || 0)}`,
                      returnedQty > 0 && left > 0 ? `возврат ${qtyLabel(returnedQty)}` : '',
                      codes.art ? `арт. ${codes.art}` : '',
                      codes.plu ? `PLU ${codes.plu}` : '',
                      codes.barcode ? `ш/к ${codes.barcode}` : '',
                    ].filter(Boolean)
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
                        {canReturn ? (
                          <span className={`receipt-check ${on ? 'on' : ''}`} aria-hidden>{on ? '✓' : ''}</span>
                        ) : (
                          <span className="receipt-check ghost" aria-hidden />
                        )}
                        <div className="hist-line-main">
                          <div className="hist-line-top">
                          <b>{line.productName || `#${line.productId}`}</b>
                            <span className="hist-line-sum">{fmtMoney(showSum)}</span>
                          </div>
                          <span className="hist-line-meta">{metaParts.join(' · ')}</span>
                          {on && (left > 1 || weightedLine) && (
                            <div
                              className="receipt-qty-ctrl"
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={busy || selectedQty <= returnStep - 1e-9}
                                onClick={() => setReturnLineQty(i, selectedQty - returnStep, left, weightedLine)}
                              >−</button>
                              {weightedLine ? (
                                <input
                                  type="number"
                                  className="receipt-qty-inp"
                                  inputMode="decimal"
                                  step={returnStep}
                                  min={returnStep}
                                  max={left}
                                  value={selectedQty}
                                  disabled={busy}
                                  aria-label="Вес возврата, кг"
                                  onChange={e => setReturnLineQty(i, Number(e.target.value), left, true)}
                                />
                              ) : (
                                <span>{formatReturnQty(selectedQty, unitLabel, false)}</span>
                              )}
                              <button
                                type="button"
                                disabled={busy || selectedQty >= left - 1e-9}
                                onClick={() => setReturnLineQty(i, selectedQty + returnStep, left, weightedLine)}
                              >+</button>
                              {weightedLine ? (
                                <span className="receipt-qty-hint">{formatReturnQty(selectedQty, unitLabel, true)}</span>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!(receiptDetail.items || []).length && <div className="hist-empty">Нет позиций</div>}
                </div>
                {msg && <div className="pos-err" style={{ marginTop: 12 }}>{msg}</div>}
                </div>
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
                            ? `Вернуть выбранное · ${fmtMoney(receiptReturnPreview.giveMoney)}`
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

            <label className="gate-label">Сверка наличных и карты</label>
            <p className="shift-reconcile-hint">
              Сначала нажмите «Сверка», введите сколько реально нал и карта, потом смотрите итог.
            </p>
            <button
              type="button"
              className="btn-confirm shift-reconcile-open"
              disabled={busy}
              onClick={() => { setMsg(''); setShiftReconcileOpen(true) }}
            >
              {shiftReconciled ? 'Изменить сверку' : 'Сверка'}
            </button>
            {shiftReconciled && (
              <ShiftReconcileReport
                a={analyzeShiftReconcile(
                  closingCash,
                  closingCard,
                  expectedTillCash(activeShift),
                  Number(activeShift.salesCard) || 0,
                )}
              />
            )}
            {msg && <div className="pos-err" style={{ marginTop: 12 }}>{msg}</div>}
            <div className="cashier-screen-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => { setCashierScreen(null); setMsg(''); setShiftReconcileOpen(false); setShiftReconciled(false) }}
              >
                Отмена
              </button>
              {cashierScreen === 'close' ? (
                <button type="button" className="btn-confirm" disabled={busy || !shiftReconciled} onClick={() => void closeShift()}>
                  {busy ? 'Закрываем…' : 'Закрыть смену'}
                </button>
              ) : (
                <button type="button" className="btn-confirm" disabled={busy || !shiftReconciled} onClick={() => void switchCashier()}>
                  {busy ? 'Меняем…' : 'Сменить и открыть'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {shiftReconcileOpen && cashierScreen && cashierScreen !== 'receipts' && activeShift && (
        <div className="overlay shift-reconcile-overlay" {...backdropCloseProps(() => { if (!busy) { setShiftReconcileOpen(false); setMsg('') } })}>
          <div className="modal-card shift-reconcile-card" onClick={e => e.stopPropagation()}>
            <div className="shift-reconcile-head">
              <h3>Сверка</h3>
              <p className="shift-reconcile-sub">
                Введите факт. Смена не закроется — только сверка.
              </p>
            </div>

            <div className="shift-reconcile-inputs">
              <div className="shift-reconcile-block">
                <label className="gate-label">Нал (факт)</label>
                <div className="shift-reconcile-expected">Должно: {fmtMoney(expectedTillCash(activeShift))}</div>
                <input
                  className="gate-input"
                  value={closingCash}
                  onChange={e => setClosingCash(sanitizeDecimalInput(e.target.value))}
                  inputMode="decimal"
                  placeholder="0.00"
                  autoFocus
                />
                <div className="shift-reconcile-quick">
                  <button type="button" onClick={() => setClosingCash('0.00')}>0</button>
                  <button
                    type="button"
                    onClick={() => setClosingCash(Number(expectedTillCash(activeShift)).toFixed(2))}
                  >
                    Должно
                  </button>
                </div>
              </div>

              <div className="shift-reconcile-block">
                <label className="gate-label">Карта (факт)</label>
                <div className="shift-reconcile-expected">Должно: {fmtMoney(activeShift.salesCard)}</div>
                <input
                  className="gate-input"
                  value={closingCard}
                  onChange={e => setClosingCard(sanitizeDecimalInput(e.target.value))}
                  inputMode="decimal"
                  placeholder="0.00"
                />
                <div className="shift-reconcile-quick">
                  <button type="button" onClick={() => setClosingCard('0.00')}>0</button>
                  <button
                    type="button"
                    onClick={() => setClosingCard(Number(activeShift.salesCard || 0).toFixed(2))}
                  >
                    Должно
                  </button>
                </div>
              </div>
            </div>

            {(() => {
              const a = analyzeShiftReconcile(
                closingCash,
                closingCard,
                expectedTillCash(activeShift),
                Number(activeShift.salesCard) || 0,
              )
              return a.ready ? <ShiftReconcileReport a={a} /> : (
                <div className="shift-reconcile-hint" style={{ margin: '8px 0' }}>
                  Введите обе суммы — сразу покажем итог
                </div>
              )
            })()}

            {msg && <div className="pos-err">{msg}</div>}

            <div className="modal-card-actions shift-reconcile-actions">
              <button
                type="button"
                className="btn-cancel"
                disabled={busy}
                onClick={() => { setShiftReconcileOpen(false); setMsg('') }}
              >
                Назад
              </button>
              <button type="button" className="btn-confirm" disabled={busy} onClick={applyShiftReconcile}>
                ОК
              </button>
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
