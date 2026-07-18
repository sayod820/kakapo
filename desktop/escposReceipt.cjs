'use strict'

const { normalizeReceiptTemplate } = require('./receiptTemplate.cjs')

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c

/**
 * CP866 без iconv-lite (portable касса часто без node_modules).
 * XP-58C: ESC t 17 = Page 17 CP866.
 */
const CP866_MAP = (() => {
  const m = Object.create(null)
  const pairs = [
    ['А', 0x80], ['Б', 0x81], ['В', 0x82], ['Г', 0x83], ['Д', 0x84], ['Е', 0x85], ['Ж', 0x86], ['З', 0x87],
    ['И', 0x88], ['Й', 0x89], ['К', 0x8A], ['Л', 0x8B], ['М', 0x8C], ['Н', 0x8D], ['О', 0x8E], ['П', 0x8F],
    ['Р', 0x90], ['С', 0x91], ['Т', 0x92], ['У', 0x93], ['Ф', 0x94], ['Х', 0x95], ['Ц', 0x96], ['Ч', 0x97],
    ['Ш', 0x98], ['Щ', 0x99], ['Ъ', 0x9A], ['Ы', 0x9B], ['Ь', 0x9C], ['Э', 0x9D], ['Ю', 0x9E], ['Я', 0x9F],
    ['а', 0xA0], ['б', 0xA1], ['в', 0xA2], ['г', 0xA3], ['д', 0xA4], ['е', 0xA5], ['ж', 0xA6], ['з', 0xA7],
    ['и', 0xA8], ['й', 0xA9], ['к', 0xAA], ['л', 0xAB], ['м', 0xAC], ['н', 0xAD], ['о', 0xAE], ['п', 0xAF],
    ['р', 0xE0], ['с', 0xE1], ['т', 0xE2], ['у', 0xE3], ['ф', 0xE4], ['х', 0xE5], ['ц', 0xE6], ['ч', 0xE7],
    ['ш', 0xE8], ['щ', 0xE9], ['ъ', 0xEA], ['ы', 0xEB], ['ь', 0xEC], ['э', 0xED], ['ю', 0xEE], ['я', 0xEF],
    ['Ё', 0xF0], ['ё', 0xF1],
    ['№', 0xFC], ['·', 0xFA], ['×', 0x78],
  ]
  for (const [ch, code] of pairs) m[ch] = code
  return m
})()

const TAJIK_FOLD = {
  ғ: 'г', Ғ: 'Г',
  қ: 'к', Қ: 'К',
  ҳ: 'х', Ҳ: 'Х',
  ҷ: 'ч', Ҷ: 'Ч',
  ӯ: 'у', Ӯ: 'У',
  ӣ: 'и', Ӣ: 'И',
}

function foldForCp866(ch) {
  return TAJIK_FOLD[ch] || ch
}

function encodeCp866(text) {
  const s = String(text || '')
  const out = Buffer.alloc(s.length)
  for (let i = 0; i < s.length; i++) {
    const ch = foldForCp866(s[i])
    const code = ch.charCodeAt(0)
    if (code < 128) out[i] = code
    else if (CP866_MAP[ch] != null) out[i] = CP866_MAP[ch]
    else out[i] = 0x3F // ?
  }
  return out
}

function money(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
}

function moneySom(n) {
  return `${money(n)} сом`
}

function moneyWithCurrency(n, currency) {
  const cur = String(currency || 'сом').trim() || 'сом'
  return `${money(n)} ${cur}`
}

function qtyText(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function clip(s, width) {
  const t = String(s || '')
  if (t.length <= width) return t
  return t.slice(0, Math.max(0, width - 1)) + '.'
}

function padLine(left, right, width) {
  const l = String(left || '')
  const r = String(right || '')
  const space = Math.max(1, width - l.length - r.length)
  return l + ' '.repeat(space) + r
}

/** Перенос только по пробелам / дефису / & — никогда посередине слова. */
function wrapName(name, width) {
  const s = String(name || '').trim() || 'Товар'
  if (s.length <= width) return [s]
  const lines = []
  let rest = s
  while (rest.length > width) {
    let cut = -1
    for (let i = Math.min(width, rest.length - 1); i >= Math.min(8, width); i--) {
      const ch = rest[i]
      if (ch === ' ' || ch === '-' || ch === '&') {
        cut = ch === ' ' ? i : i + 1
        break
      }
    }
    if (cut < 1) cut = width
    lines.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) lines.push(rest)
  return lines
}

/** Имя + сумма справа; если не влезает — имя целиком, сумма отдельной строкой справа. */
function nameAmountLines(name, amount, width, currency) {
  const right = moneyWithCurrency(amount, currency)
  const maxLeft = Math.max(8, width - right.length - 1)
  const nameLines = wrapName(name, width)
  const out = []
  if (nameLines.length === 1 && nameLines[0].length <= maxLeft) {
    out.push(padLine(nameLines[0], right, width))
    return out
  }
  for (const line of nameLines) out.push(line)
  out.push(padLine('', right, width))
  return out
}

/** «Шампунь Head&Shoulders 400мл» → имя + отдельная строка объёма (как на макете). */
function splitNameDetail(name) {
  const s = String(name || '').trim()
  const m = s.match(/^(.*?)\s+(\d+(?:[.,]\d+)?\s*(?:мл|мл\.|г|гр|кг|л|шт\.?))$/i)
  if (m && m[1].trim().length >= 8) {
    return { name: m[1].trim(), detail: m[2].trim() }
  }
  return { name: s, detail: '' }
}

/** Подпись слева / значение справа; без обрезки точками. */
function kvLines(label, value, width) {
  const l = String(label || '')
  const r = String(value ?? '')
  if (!r) return []
  if (l.length + 1 + r.length <= width) return [padLine(l, r, width)]
  if (r.length <= width) return [l, padLine('', r, width)]
  return [l, ...wrapName(r, width)]
}

function payLabel(sale, tpl) {
  if (sale.paymentMethod === 'credit') return tpl.labelDebt
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return tpl.labelCash
  if (sale.paymentMethod === 'card') return tpl.labelCard
  if ((Number(sale.debtAdded) || 0) > 0.001) return tpl.labelDebt
  return '-'
}

function cardLineLabel(sale, labelCard) {
  const digits = String(sale.cardNum || '').replace(/\D/g, '')
  const base = String(labelCard || 'Картой').trim() || 'Картой'
  if (digits.length >= 4) return `${base} (Visa ****${digits.slice(-4)})`
  return base
}

function orderNo(sale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `N${sale.number}`
  return sale.id || 'Chek'
}

function docTitle(sale, tpl) {
  if (sale.status === 'returned') return tpl.docTitleReturn
  if (sale.status === 'partial') return tpl.docTitlePartial
  return tpl.docTitle
}

/**
 * Макет 1:1 с редактором шаблона.
 * Стили через ESC ! (Font B/A + bold + double-height).
 * Double-width никогда не включаем — иначе 16 символов и обрезка слов.
 */
function buildEscPosReceipt(sale, opts = {}) {
  const tpl = normalizeReceiptTemplate(opts)
  const currency = tpl.currency
  const width = tpl.charsPerLine
  const store = tpl.storeName
  const phone = tpl.storePhone
  const subtitle = tpl.subtitle
  const footerThanks = tpl.footerThanks
  const footerNote = tpl.footerNote
  const pos = String(opts.posLabel || '').trim()
  const cashier = String(opts.cashierName || sale.cashierName || '').trim()
  const fmt = (n) => moneyWithCurrency(n, currency)
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).replace(',', '')
    : new Date().toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
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

  const chunks = []
  const cmd = (...b) => chunks.push(Buffer.from(b))
  const txt = (s) => {
    const raw = String(s == null ? '' : s)
    if (raw.length <= width) {
      chunks.push(encodeCp866(`${raw}\n`))
      return
    }
    for (const part of wrapName(raw, width)) {
      chunks.push(encodeCp866(`${part}\n`))
    }
  }
  const sep = () => {
    setStyle({ size: tpl.sizeBody, bold: false })
    txt('-'.repeat(width))
  }
  const lines = (arr) => { for (const line of arr) txt(line) }

  /**
   * ESC ! n:
   * 0x01 Font B, 0x08 bold, 0x10 double-height.
   * Никогда 0x20 (double-width).
   */
  const setStyle = ({ size, bold }) => {
    const base = tpl.printFont === 'small' ? 'small' : 'normal'
    let font = size === 'small' || size === 'normal' ? size : base
    if (size === 'tall') font = base
    let n = 0
    if (font === 'small') n |= 0x01
    if (bold) n |= 0x08
    if (size === 'tall') n |= 0x10
    cmd(GS, 0x21, 0x00) // сброс GS-увеличения (иначе залипает 16 символов)
    cmd(ESC, 0x21, n)
    cmd(ESC, 0x4D, font === 'small' ? 0x01 : 0x00)
    cmd(ESC, 0x45, bold ? 1 : 0)
  }

  const boot = (align = 0) => {
    cmd(ESC, 0x40)
    cmd(FS, 0x2E)
    cmd(ESC, 0x52, 0x00)
    cmd(ESC, 0x74, 17) // CP866
    cmd(ESC, 0x33, tpl.lineSpacing)
    cmd(GS, 0x21, 0x00)
    cmd(ESC, 0x21, 0x00)
    setStyle({ size: tpl.sizeBody, bold: false })
    cmd(GS, 0x42, 0x00)
    cmd(ESC, 0x61, align)
  }

  boot(1)

  if (tpl.showStoreName) {
    setStyle({ size: tpl.sizeStoreName, bold: tpl.boldStoreName })
    txt(store)
  }
  if (tpl.showSubtitle) {
    setStyle({ size: tpl.sizeSubtitle, bold: tpl.boldSubtitle })
    txt(subtitle)
  }
  if (tpl.showStorePhone && phone) {
    setStyle({ size: tpl.sizePhone, bold: tpl.boldPhone })
    txt(phone)
  }

  sep()
  if (tpl.showDocTitle) {
    setStyle({ size: tpl.sizeDocTitle, bold: tpl.boldDocTitle })
    txt(docTitle(sale, tpl))
  }
  sep()

  cmd(ESC, 0x61, 0)
  setStyle({ size: tpl.sizeBody, bold: tpl.boldBody })
  if (tpl.showOrderNo) lines(kvLines(tpl.labelOrderNo, orderNo(sale), width))
  if (tpl.showReceiptNo && sale.number != null) {
    lines(kvLines(tpl.labelReceiptNo, `№${sale.number}`, width))
  }
  if (tpl.showDate) lines(kvLines(tpl.labelDate, when, width))
  if (tpl.showPos && pos) lines(kvLines(tpl.labelPos, pos, width))
  if (tpl.showCashier && cashier) lines(kvLines(tpl.labelCashier, cashier, width))
  if (tpl.showClient && sale.clientName) lines(kvLines(tpl.labelClient, sale.clientName, width))
  if (tpl.showClientPhone && sale.clientPhone) {
    lines(kvLines(tpl.labelClientPhone, sale.clientPhone, width))
  }

  sep()

  if (tpl.showItems) {
    setStyle({ size: tpl.sizeItems, bold: tpl.boldItems })
    items.forEach((it) => {
      const qty = Number(it.qty) || 0
      const price = Number(it.price) || 0
      const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
      const fullName = String(it.productName || `#${it.productId}`).trim()
      const parts = splitNameDetail(fullName)
      const right = fmt(sum)
      const maxLeft = Math.max(8, width - right.length - 1)
      const useDetail = parts.detail && parts.name.length <= maxLeft && fullName.length > maxLeft
      lines(nameAmountLines(useDetail ? parts.name : fullName, sum, width, currency))
      if (useDetail) txt(parts.detail)
      txt(`${qtyText(qty)} x ${money(price)}`)
    })
  }

  if (tpl.showItems && !items.length) {
    setStyle({ size: tpl.sizeItems, bold: tpl.boldItems })
    txt('Нет позиций')
  }

  sep()

  setStyle({ size: tpl.sizeBody, bold: tpl.boldBody })
  if (tpl.showSubtotal) lines(kvLines(tpl.labelSum, fmt(subtotal), width))
  if (tpl.showDiscount && discount > 0.001) {
    const discLabel = `${tpl.labelDiscount}${discountPct > 0 ? ` ${discountPct}%` : ''}`
    lines(kvLines(discLabel, `-${fmt(discount)}`, width))
  }
  if (tpl.showBonusEarned && bonusEarned > 0.001) {
    lines(kvLines(tpl.labelBonusEarned, `+${Math.floor(bonusEarned)}`, width))
  }
  if (tpl.showBonusSpent && bonusSpent > 0.001) {
    lines(kvLines(tpl.labelBonusSpent, `-${fmt(bonusSpent)}`, width))
  }

  setStyle({ size: tpl.sizeTotal, bold: tpl.boldTotal })
  txt(padLine(tpl.labelTotal, fmt(total), width))

  sep()

  setStyle({ size: tpl.sizeBody, bold: tpl.boldBody })
  if (tpl.showPay) lines(kvLines(tpl.labelPay, payLabel(sale, tpl), width))
  if (tpl.showCash && (Number(sale.paidCash) || 0) > 0.001) {
    lines(kvLines(tpl.labelCash, fmt(sale.paidCash), width))
  }
  if (tpl.showCard && (Number(sale.paidCard) || 0) > 0.001) {
    lines(kvLines(cardLineLabel(sale, tpl.labelCard), fmt(sale.paidCard), width))
  }
  if (tpl.showDebt && (Number(sale.debtAdded) || 0) > 0.001) {
    lines(kvLines(tpl.labelDebt, fmt(sale.debtAdded), width))
  }
  if (tpl.showCashGiven && (Number(sale.cashReceived) || 0) > 0.001) {
    lines(kvLines(tpl.labelCashGiven, fmt(sale.cashReceived), width))
  }
  if (tpl.showChange && (Number(sale.changeGiven) || 0) > 0.001) {
    setStyle({ size: tpl.sizeBody, bold: tpl.boldChange })
    txt(padLine(tpl.labelChange, fmt(sale.changeGiven), width))
  }

  const balBefore = sale.bonusBalanceBefore
  const balAfter = sale.bonusBalanceAfter
  if (tpl.showBonusBalance && balBefore != null && balAfter != null) {
    sep()
    setStyle({ size: tpl.sizeBody, bold: tpl.boldBody })
    lines(kvLines(
      tpl.labelBonusBalance,
      `${Math.floor(Number(balBefore) || 0)} -> ${Math.floor(Number(balAfter) || 0)}`,
      width,
    ))
  }

  sep()
  cmd(ESC, 0x61, 1)
  if (tpl.showFooterThanks) {
    setStyle({ size: tpl.sizeFooter, bold: tpl.boldFooterThanks })
    for (const line of wrapName(footerThanks, width)) txt(line)
  }
  if (tpl.showFooterNote) {
    setStyle({ size: tpl.sizeFooter, bold: tpl.boldFooterNote })
    for (const line of wrapName(footerNote, width)) txt(line)
  }

  chunks.push(encodeCp866('\n\n\n\n'))
  cmd(GS, 0x56, 0x01)
  return Buffer.concat(chunks)
}

function packEscPosLines(lines, opts = {}) {
  const width = 32
  const chunks = []
  const cmd = (...b) => chunks.push(Buffer.from(b))
  const txt = (s) => chunks.push(encodeCp866(`${clip(s, width)}\n`))
  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  cmd(ESC, 0x52, 0x00)
  cmd(ESC, 0x74, 17)
  cmd(ESC, 0x4D, 0x00)
  cmd(GS, 0x42, 0x00)
  cmd(ESC, 0x61, 0)
  for (const line of lines || []) {
    const t = String(line || '').trim()
    if (!t) continue
    txt(t)
  }
  chunks.push(encodeCp866('\n\n\n'))
  if (opts.cut !== false) cmd(GS, 0x56, 0x01)
  return Buffer.concat(chunks)
}

function extractSaleFromHtml(html) {
  const s = String(html || '')
  const m = s.match(/id=["']kakapo-sale["'][^>]*>([\s\S]*?)<\/script>/i)
    || s.match(/<!--KAKAPO_SALE_JSON:([\s\S]*?)-->/)
  if (!m) return null
  try {
    return JSON.parse(m[1].trim())
  } catch {
    return null
  }
}

/** Fallback: HTML → sale JSON (если есть) или строки → ESC/POS */
function buildEscPosFromReceiptHtml(html, opts = {}) {
  const embedded = extractSaleFromHtml(html)
  if (embedded && typeof embedded === 'object') {
    return buildEscPosReceipt(embedded, opts)
  }
  const text = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return packEscPosLines(text, opts)
}

/** Демо-продажа 1:1 с дизайн-макетом (для «Тест чека»). */
function buildDemoReceiptSale() {
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

module.exports = {
  buildEscPosReceipt,
  buildEscPosFromReceiptHtml,
  buildDemoReceiptSale,
  encodeCp866,
}
