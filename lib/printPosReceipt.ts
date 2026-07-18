import type { PosSale } from '@/lib/types'
import { getKakapoDesktop, isKakapoDesktop } from '@/lib/desktopBridge'
import { pickReceiptPrinter, XP58C_RECEIPT_MM } from '@/lib/printerPresets'

const STORE_KEY = 'kakapo_trade_receipt_store'

export type ReceiptStoreConfig = {
  storeName: string
  storePhone: string
  subtitle: string
  docTitle: string
  docTitleReturn: string
  docTitlePartial: string
  currency: string

  labelOrderNo: string
  labelReceiptNo: string
  labelDate: string
  labelPos: string
  labelCashier: string
  labelClient: string
  labelClientPhone: string
  labelSum: string
  labelDiscount: string
  labelBonusEarned: string
  labelBonusSpent: string
  labelTotal: string
  labelPay: string
  labelCash: string
  labelCard: string
  labelDebt: string
  labelCashGiven: string
  labelChange: string
  labelBonusBalance: string

  footerThanks: string
  footerNote: string

  showOrderNo: boolean
  showReceiptNo: boolean
  showDate: boolean
  showPos: boolean
  showCashier: boolean
  showClient: boolean
  showClientPhone: boolean
  showDiscount: boolean
  showBonusEarned: boolean
  showBonusSpent: boolean
  showBonusBalance: boolean
  showPay: boolean
  showCash: boolean
  showCard: boolean
  showDebt: boolean
  showCashGiven: boolean
  showChange: boolean
}

export const DEFAULT_RECEIPT_STORE: ReceiptStoreConfig = {
  storeName: 'КАКАПО',
  storePhone: '+992 112 373 333',
  subtitle: 'магазин - касса',
  docTitle: 'ТОВАРНЫЙ ЧЕК',
  docTitleReturn: 'ВОЗВРАТНЫЙ ЧЕК',
  docTitlePartial: 'ЧЕК - ЧАСТИЧНЫЙ ВОЗВРАТ',
  currency: 'сом',

  labelOrderNo: 'Номер заказа',
  labelReceiptNo: 'Номер чека',
  labelDate: 'Дата',
  labelPos: 'Касса',
  labelCashier: 'Кассир',
  labelClient: 'Клиент',
  labelClientPhone: 'Тел. клиента',
  labelSum: 'Сумма',
  labelDiscount: 'Скидка',
  labelBonusEarned: 'Начислено бонусов',
  labelBonusSpent: 'Списано бонусов',
  labelTotal: 'ИТОГ',
  labelPay: 'Оплата',
  labelCash: 'Наличные',
  labelCard: 'Картой',
  labelDebt: 'В долг',
  labelCashGiven: 'Дал клиент',
  labelChange: 'Сдача',
  labelBonusBalance: 'Баланс бонусов',

  footerThanks: 'Спасибо за покупку!',
  footerNote: 'Сохраняйте чек до проверки товара',

  showOrderNo: true,
  showReceiptNo: true,
  showDate: true,
  showPos: true,
  showCashier: true,
  showClient: true,
  showClientPhone: true,
  showDiscount: true,
  showBonusEarned: true,
  showBonusSpent: true,
  showBonusBalance: true,
  showPay: true,
  showCash: true,
  showCard: true,
  showDebt: true,
  showCashGiven: true,
  showChange: true,
}

/** Поля-подписи и заголовки, которые редактируются как текст. */
export const RECEIPT_TEXT_FIELDS: Array<{ key: keyof ReceiptStoreConfig; label: string; group: string }> = [
  { key: 'storeName', label: 'Название магазина', group: 'Шапка' },
  { key: 'subtitle', label: 'Подзаголовок', group: 'Шапка' },
  { key: 'storePhone', label: 'Телефон', group: 'Шапка' },
  { key: 'docTitle', label: 'Заголовок чека', group: 'Шапка' },
  { key: 'docTitleReturn', label: 'Заголовок возврата', group: 'Шапка' },
  { key: 'docTitlePartial', label: 'Заголовок частичного возврата', group: 'Шапка' },
  { key: 'currency', label: 'Валюта', group: 'Шапка' },
  { key: 'labelOrderNo', label: 'Номер заказа', group: 'Подписи полей' },
  { key: 'labelReceiptNo', label: 'Номер чека', group: 'Подписи полей' },
  { key: 'labelDate', label: 'Дата', group: 'Подписи полей' },
  { key: 'labelPos', label: 'Касса', group: 'Подписи полей' },
  { key: 'labelCashier', label: 'Кассир', group: 'Подписи полей' },
  { key: 'labelClient', label: 'Клиент', group: 'Подписи полей' },
  { key: 'labelClientPhone', label: 'Тел. клиента', group: 'Подписи полей' },
  { key: 'labelSum', label: 'Сумма', group: 'Подписи полей' },
  { key: 'labelDiscount', label: 'Скидка', group: 'Подписи полей' },
  { key: 'labelBonusEarned', label: 'Начислено бонусов', group: 'Подписи полей' },
  { key: 'labelBonusSpent', label: 'Списано бонусов', group: 'Подписи полей' },
  { key: 'labelTotal', label: 'Итог', group: 'Подписи полей' },
  { key: 'labelPay', label: 'Оплата', group: 'Подписи полей' },
  { key: 'labelCash', label: 'Наличные', group: 'Подписи полей' },
  { key: 'labelCard', label: 'Картой', group: 'Подписи полей' },
  { key: 'labelDebt', label: 'В долг', group: 'Подписи полей' },
  { key: 'labelCashGiven', label: 'Дал клиент', group: 'Подписи полей' },
  { key: 'labelChange', label: 'Сдача', group: 'Подписи полей' },
  { key: 'labelBonusBalance', label: 'Баланс бонусов', group: 'Подписи полей' },
  { key: 'footerThanks', label: 'Строка «спасибо»', group: 'Футер' },
  { key: 'footerNote', label: 'Строка под «спасибо»', group: 'Футер' },
]

/** Флаги показа блоков. */
export const RECEIPT_TOGGLE_FIELDS: Array<{ key: keyof ReceiptStoreConfig; label: string }> = [
  { key: 'showOrderNo', label: 'Номер заказа' },
  { key: 'showReceiptNo', label: 'Номер чека' },
  { key: 'showDate', label: 'Дата' },
  { key: 'showPos', label: 'Касса' },
  { key: 'showCashier', label: 'Кассир' },
  { key: 'showClient', label: 'Клиент' },
  { key: 'showClientPhone', label: 'Тел. клиента' },
  { key: 'showDiscount', label: 'Скидка' },
  { key: 'showBonusEarned', label: 'Начислено бонусов' },
  { key: 'showBonusSpent', label: 'Списано бонусов' },
  { key: 'showBonusBalance', label: 'Баланс бонусов' },
  { key: 'showPay', label: 'Оплата' },
  { key: 'showCash', label: 'Наличные' },
  { key: 'showCard', label: 'Картой' },
  { key: 'showDebt', label: 'В долг' },
  { key: 'showCashGiven', label: 'Дал клиент' },
  { key: 'showChange', label: 'Сдача' },
]

function str(v: unknown, fallback: string): string {
  const s = String(v == null ? '' : v).trim()
  return s || fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 0 || v === '0' || v === 'false') return false
  if (v === 1 || v === '1' || v === 'true') return true
  return fallback
}

export function normalizeReceiptStore(p?: Partial<ReceiptStoreConfig> | null): ReceiptStoreConfig {
  const d = DEFAULT_RECEIPT_STORE
  const o = p || {}
  const out = {} as ReceiptStoreConfig
  for (const f of RECEIPT_TEXT_FIELDS) {
    // телефон может быть пустым — не форсим дефолт
    if (f.key === 'storePhone') {
      out.storePhone = String((o as Record<string, unknown>).storePhone ?? d.storePhone).trim()
    } else {
      ;(out as Record<string, unknown>)[f.key] = str((o as Record<string, unknown>)[f.key], String(d[f.key]))
    }
  }
  for (const f of RECEIPT_TOGGLE_FIELDS) {
    ;(out as Record<string, unknown>)[f.key] = bool((o as Record<string, unknown>)[f.key], Boolean(d[f.key]))
  }
  return out
}

export function loadReceiptStore(): ReceiptStoreConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_RECEIPT_STORE }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_RECEIPT_STORE }
    return normalizeReceiptStore(JSON.parse(raw) as Partial<ReceiptStoreConfig>)
  } catch {
    return { ...DEFAULT_RECEIPT_STORE }
  }
}

export function saveReceiptStore(cfg: ReceiptStoreConfig) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORE_KEY, JSON.stringify(normalizeReceiptStore(cfg)))
}

export type PosReceiptPrintOpts = Partial<ReceiptStoreConfig> & {
  posLabel?: string
  cashierName?: string
}

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n: number, currency = 'сом') {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)} ${currency}`.trimEnd()
}

function shortMoney(n: number) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
}

function qtyText(n: number) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function payLabel(sale: PosSale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Картой'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return '—'
}

function orderNo(sale: PosSale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `№${sale.number}`
  return sale.id || 'Чек'
}

function row(label: string, value?: string | number | null) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return `<div class="row"><span>${esc(label)}</span><span>${esc(v)}</span></div>`
}

function moneyRow(label: string, value: number, opts?: { bold?: boolean; prefix?: string; currency?: string }) {
  if (!(Math.abs(Number(value) || 0) > 0.001)) return ''
  const cls = opts?.bold ? 'row bold' : 'row'
  const prefix = opts?.prefix || ''
  return `<div class="${cls}"><span>${esc(label)}</span><span>${prefix}${money(value, opts?.currency)}</span></div>`
}

function cardLineLabel(sale: PosSale, base: string) {
  const digits = String(sale.cardNum || '').replace(/\D/g, '')
  if (digits.length >= 4) return `${base} (Visa ****${digits.slice(-4)})`
  return base
}

function docTitleOf(sale: PosSale, tpl: ReceiptStoreConfig) {
  if (sale.status === 'returned') return tpl.docTitleReturn
  if (sale.status === 'partial') return tpl.docTitlePartial
  return tpl.docTitle
}

function resolveTemplateOpts(opts?: PosReceiptPrintOpts): ReceiptStoreConfig {
  const storeCfg = typeof window !== 'undefined' ? loadReceiptStore() : { ...DEFAULT_RECEIPT_STORE }
  // opts переопределяют сохранённый шаблон только там, где значение задано
  const merged: Record<string, unknown> = { ...storeCfg }
  if (opts) {
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) merged[k] = v
    }
  }
  return normalizeReceiptStore(merged as Partial<ReceiptStoreConfig>)
}

/** Демо 1:1 с дизайн-макетом — для «Тест чека» и превью. */
export function buildDemoReceiptSale(): PosSale {
  return {
    id: 'DEMO',
    number: 128,
    orderId: 'ORD-1047',
    createdAtIso: '2026-07-18T14:32:00',
    cashierName: 'Азиза М.',
    clientName: 'Рустам А.',
    clientPhone: '+992 900 12 34 56',
    cardNum: '4821',
    paymentMethod: 'mixed',
    total: 147.5,
    paidCash: 50,
    paidCard: 97.5,
    debtAdded: 0,
    cashReceived: 100,
    changeGiven: 50,
    orderGoodsTotal: 175,
    discountAmount: 17.5,
    bonusSpent: 10,
    bonusEarned: 15,
    bonusBalanceBefore: 245,
    bonusBalanceAfter: 250,
    items: [
      { productId: 1, productName: 'Шампунь Head&Shoulders 400мл', qty: 1, price: 85, lineTotal: 85 },
      { productId: 2, productName: 'Мыло Dove 100г', qty: 2, price: 18, lineTotal: 36 },
      { productId: 3, productName: 'Зубная паста Colgate', qty: 1, price: 42, lineTotal: 42 },
      { productId: 4, productName: 'Хлеб белый', qty: 2, price: 6, lineTotal: 12 },
    ],
  }
}

/** Единственный шаблон чека — структура как на макете. */
export function buildPosReceiptHtml(sale: PosSale, opts?: PosReceiptPrintOpts): string {
  const tpl = resolveTemplateOpts(opts)
  const cur = tpl.currency
  const m = (n: number) => money(n, cur)
  const storeName = esc(tpl.storeName)
  const storePhone = esc(tpl.storePhone)
  const subtitle = esc(tpl.subtitle)
  const footerThanks = esc(tpl.footerThanks)
  const footerNote = esc(tpl.footerNote)
  const pos = esc(opts?.posLabel || '')
  const cashier = esc(opts?.cashierName || sale.cashierName || '')
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(',', '')
    : new Date().toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(',', '')

  const items = sale.items || []
  const goodsFromField = Number(sale.orderGoodsTotal)
  const itemsSum = Math.round(items.reduce((s, it) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal)
    return s + (Number.isFinite(sum) && sum > 0 ? sum : price * qty)
  }, 0) * 100) / 100
  const subtotal = Number.isFinite(goodsFromField) && goodsFromField > 0 ? goodsFromField : itemsSum
  const total = Number(sale.total) || 0
  const bonusSpent = Math.max(0, Number(sale.bonusSpent) || 0)
  const bonusEarned = Math.max(0, Number(sale.bonusEarned) || 0)
  const discount = Math.max(0, Number(sale.discountAmount) || 0)
    || Math.max(0, Math.round((subtotal - total - bonusSpent) * 100) / 100)
  const discountPct = subtotal > 0.001 && discount > 0.001
    ? Math.round((discount / subtotal) * 100)
    : 0

  const itemHtml = items.map(it => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    const rawName = String(it.productName || `#${it.productId}`).trim()
    const rightLen = m(sum).length
    const maxLeft = Math.max(8, 32 - rightLen - 1)
    const vol = rawName.match(/^(.*?)\s+(\d+(?:[.,]\d+)?\s*(?:мл|мл\.|г|гр|кг|л|шт\.?))$/i)
    let name = rawName
    let detail = ''
    if (rawName.length > maxLeft && vol && vol[1].trim().length >= 8 && vol[1].trim().length <= maxLeft) {
      name = vol[1].trim()
      detail = vol[2].trim()
    }
    return `<div class="item">
    <div class="item-row">
      <span class="item-name">${esc(name)}</span>
      <span>${m(sum)}</span>
    </div>
    ${detail ? `<div class="item-qty">${esc(detail)}</div>` : ''}
    <div class="item-qty">${qtyText(qty)} x ${shortMoney(price)}</div>
  </div>`
  }).join('\n')

  const balBefore = sale.bonusBalanceBefore
  const balAfter = sale.bonusBalanceAfter
  const showBalance = tpl.showBonusBalance && balBefore != null && balAfter != null
    && (Number.isFinite(Number(balBefore)) || Number.isFinite(Number(balAfter)))

  const meta = [
    tpl.showOrderNo ? row(tpl.labelOrderNo, orderNo(sale)) : '',
    tpl.showReceiptNo && sale.number != null ? row(tpl.labelReceiptNo, `№${sale.number}`) : '',
    tpl.showDate ? row(tpl.labelDate, when) : '',
    tpl.showPos && pos ? row(tpl.labelPos, pos) : '',
    tpl.showCashier && cashier ? row(tpl.labelCashier, cashier) : '',
    tpl.showClient && sale.clientName ? row(tpl.labelClient, sale.clientName) : '',
    tpl.showClientPhone && sale.clientPhone ? row(tpl.labelClientPhone, sale.clientPhone) : '',
  ].filter(Boolean).join('\n  ')

  const totals = [
    row(tpl.labelSum, m(subtotal)),
    tpl.showDiscount && discount > 0.001
      ? `<div class="row"><span>${esc(tpl.labelDiscount)}${discountPct > 0 ? ` ${discountPct}%` : ''}</span><span>-${m(discount)}</span></div>`
      : '',
    tpl.showBonusEarned && bonusEarned > 0.001
      ? `<div class="row"><span>${esc(tpl.labelBonusEarned)}</span><span>+${Math.floor(bonusEarned)}</span></div>`
      : '',
    tpl.showBonusSpent && bonusSpent > 0.001
      ? `<div class="row"><span>${esc(tpl.labelBonusSpent)}</span><span>-${m(bonusSpent)}</span></div>`
      : '',
    `<div class="grand-total row"><span>${esc(tpl.labelTotal)}</span><span>${m(total)}</span></div>`,
  ].filter(Boolean).join('\n    ')

  const payments = [
    tpl.showPay ? row(tpl.labelPay, payLabel(sale)) : '',
    tpl.showCash ? moneyRow(tpl.labelCash, Number(sale.paidCash) || 0, { currency: cur }) : '',
    tpl.showCard ? moneyRow(cardLineLabel(sale, tpl.labelCard), Number(sale.paidCard) || 0, { currency: cur }) : '',
    tpl.showDebt ? moneyRow(tpl.labelDebt, Number(sale.debtAdded) || 0, { currency: cur }) : '',
    tpl.showCashGiven ? moneyRow(tpl.labelCashGiven, Number(sale.cashReceived) || 0, { currency: cur }) : '',
    tpl.showChange ? moneyRow(tpl.labelChange, Number(sale.changeGiven) || 0, { bold: true, currency: cur }) : '',
  ].filter(Boolean).join('\n    ')

  const saleJson = JSON.stringify(sale).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Чек ${esc(orderNo(sale))}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{color-scheme:light only}
  body{
    background:#fff;
    margin:0;
    padding:0;
    width:384px;
    max-width:384px;
    color:#000;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
    -webkit-font-smoothing:none;font-smooth:never;
  }
  .receipt{
    width:100%;
    max-width:384px;
    background:#fff;
    padding:10px 12px 14px;
    font-family:'Courier New',Courier,monospace;
    font-weight:500;
    font-size:13px;
    line-height:1.35;
    color:#000;
  }
  .center{text-align:center}
  .bold{font-weight:700}
  .title{font-size:22px;font-weight:800;letter-spacing:1px}
  .sub{font-size:12px}
  .line{border-top:1px dashed #000;margin:8px 0}
  .row{display:flex;justify-content:space-between;gap:8px}
  .row span:last-child{text-align:right;word-break:break-word}
  .item-row{display:flex;justify-content:space-between;margin-top:4px;gap:8px}
  .item-name{flex:1;word-break:break-word}
  .item-qty{color:#000;font-size:12px}
  .totals .row{margin:3px 0}
  .grand-total{font-size:17px;font-weight:800;margin:6px 0}
  .footer{margin-top:10px}
</style>
</head>
<body>
<script type="application/json" id="kakapo-sale">${saleJson}</script>
<div class="receipt">
  <div class="center title">${storeName}</div>
  <div class="center sub">${subtitle}</div>
  ${storePhone ? `<div class="center sub">${storePhone}</div>` : ''}

  <div class="line"></div>
  <div class="center bold">${esc(docTitleOf(sale, tpl))}</div>
  <div class="line"></div>

  ${meta}

  <div class="line"></div>

  ${itemHtml || '<div class="item"><div class="item-row"><span class="item-name">Нет позиций</span><span></span></div></div>'}

  <div class="line"></div>

  <div class="totals">
    ${totals}
  </div>

  <div class="line"></div>

  <div class="totals">
    ${payments}
  </div>

  ${showBalance ? `<div class="line"></div>
  <div class="totals">
    <div class="row"><span>${esc(tpl.labelBonusBalance)}</span><span>${Math.floor(Number(balBefore) || 0)} -> ${Math.floor(Number(balAfter) || 0)}</span></div>
  </div>` : ''}

  <div class="line"></div>

  <div class="center footer">
    <div class="bold">${footerThanks}</div>
    <div class="sub">${footerNote}</div>
  </div>
</div>
</body>
</html>`
}

export async function printPosReceipt(
  sale: PosSale,
  opts?: PosReceiptPrintOpts,
): Promise<void> {
  if (typeof window === 'undefined') return

  const tpl = resolveTemplateOpts(opts)
  const printOpts: PosReceiptPrintOpts = {
    ...tpl,
    posLabel: opts?.posLabel,
    cashierName: opts?.cashierName,
  }

  const desktop = getKakapoDesktop()
  if (isKakapoDesktop() && desktop) {
    const [settings, printers] = await Promise.all([
      desktop.getPrinterSettings().catch(() => ({
        printerName: '',
        paperWidthMm: XP58C_RECEIPT_MM,
        labelPrinterName: '',
        scaleMode: 'plu-label' as const,
      })),
      desktop.getPrinters().catch(() => []),
    ])

    let printerName = String(settings.printerName || '').trim()
    const stillThere = printerName && printers.some(p => p.name === printerName)
    if (!stillThere) {
      printerName = pickReceiptPrinter(printers)
    }
    if (!printerName) {
      const names = printers.map(p => p.displayName || p.name).filter(Boolean)
      throw new Error(
        names.length
          ? `Принтер XP-58C не найден в Windows. Сейчас: ${names.slice(0, 4).join(', ')}. Подключите XP-58C и установите драйвер.`
          : 'Принтер XP-58C не найден в Windows. Подключите USB, включите принтер и установите драйвер Xprinter.',
      )
    }

    const paperWidthMm = XP58C_RECEIPT_MM
    if (settings.printerName !== printerName || settings.paperWidthMm !== paperWidthMm) {
      await desktop.savePrinterSettings({
        ...settings,
        printerName,
        paperWidthMm,
      }).catch(() => undefined)
    }

    const salePayload = JSON.parse(JSON.stringify(sale)) as PosSale
    const payload = {
      printerName,
      sale: salePayload,
      ...tpl,
      posLabel: opts?.posLabel,
      cashierName: opts?.cashierName || sale.cashierName,
    }

    if (typeof desktop.printReceipt === 'function') {
      await desktop.printReceipt(payload)
    } else {
      await desktop.printHtml(buildPosReceiptHtml(salePayload, printOpts), {
        role: 'receipt',
        paperWidthMm,
        pageWidthMm: paperWidthMm,
        ...payload,
      })
    }
    return
  }

  const html = buildPosReceiptHtml(sale, printOpts)
  const w = window.open('', '_blank', 'width=420,height=720')
  if (!w) {
    window.alert('Разрешите всплывающие окна для печати чека')
    return
  }
  w.document.write(html.replace(
    '</body></html>',
    '<script>window.onload=function(){window.print()}</script></body></html>',
  ))
  w.document.close()
}
