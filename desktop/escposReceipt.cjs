'use strict'

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c

/**
 * Минимальный CP866 без iconv-lite (portable касса часто без node_modules).
 * Кириллица + базовые символы для чека.
 */
const CP866_MAP = (() => {
  const m = Object.create(null)
  const pairs = [
    // А-Я
    ['А', 0x80], ['Б', 0x81], ['В', 0x82], ['Г', 0x83], ['Д', 0x84], ['Е', 0x85], ['Ж', 0x86], ['З', 0x87],
    ['И', 0x88], ['Й', 0x89], ['К', 0x8A], ['Л', 0x8B], ['М', 0x8C], ['Н', 0x8D], ['О', 0x8E], ['П', 0x8F],
    ['Р', 0x90], ['С', 0x91], ['Т', 0x92], ['У', 0x93], ['Ф', 0x94], ['Х', 0x95], ['Ц', 0x96], ['Ч', 0x97],
    ['Ш', 0x98], ['Щ', 0x99], ['Ъ', 0x9A], ['Ы', 0x9B], ['Ь', 0x9C], ['Э', 0x9D], ['Ю', 0x9E], ['Я', 0x9F],
    // а-п
    ['а', 0xA0], ['б', 0xA1], ['в', 0xA2], ['г', 0xA3], ['д', 0xA4], ['е', 0xA5], ['ж', 0xA6], ['з', 0xA7],
    ['и', 0xA8], ['й', 0xA9], ['к', 0xAA], ['л', 0xAB], ['м', 0xAC], ['н', 0xAD], ['о', 0xAE], ['п', 0xAF],
    // р-я
    ['р', 0xE0], ['с', 0xE1], ['т', 0xE2], ['у', 0xE3], ['ф', 0xE4], ['х', 0xE5], ['ц', 0xE6], ['ч', 0xE7],
    ['ш', 0xE8], ['щ', 0xE9], ['ъ', 0xEA], ['ы', 0xEB], ['ь', 0xEC], ['э', 0xED], ['ю', 0xEE], ['я', 0xEF],
    ['Ё', 0xF0], ['ё', 0xF1],
    ['№', 0xFC], ['·', 0xFA], ['×', 0x78], ['⭐', 0x2A],
  ]
  for (const [ch, code] of pairs) m[ch] = code
  return m
})()

/** Таджикские буквы → ближайшие в CP866 (XP-58C RAW не умеет ғқҳҷӯӣ) */
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
    if (code < 128) {
      out[i] = code
    } else if (CP866_MAP[ch] != null) {
      out[i] = CP866_MAP[ch]
    } else {
      out[i] = 0x3F // ?
    }
  }
  return out
}

const DEFAULT_LABELS = {
  shopTag: 'магазин · касса',
  titleSale: 'ТОВАРНЫЙ ЧЕК',
  titleReturn: 'ВОЗВРАТНЫЙ ЧЕК',
  titlePartial: 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ',
  orderNo: 'Заказ',
  receiptNo: 'Чек',
  date: 'Дата',
  pos: 'Касса',
  cashier: 'Кассир',
  shift: 'Смена',
  client: 'Клиент',
  cardSuffix: 'карта',
  noItems: 'Нет позиций',
  goods: 'Товары',
  discount: 'Скидка',
  bonus: 'Бонусами',
  total: 'ИТОГО',
  payment: 'Оплата',
  cash: 'Наличные',
  cardPay: 'Карта',
  credit: 'В долг',
  cashReceived: 'Дал клиент',
  change: 'Сдача',
  bonusEarned: 'Начислено бонусов',
  note: 'Примечание',
  thanks: 'Спасибо за покупку!',
  keepReceipt: 'Сохраняйте чек',
  payCash: 'Наличные',
  payCard: 'Карта',
  payCredit: 'В долг',
  payMixed: 'Смешанная',
  returnedQty: 'возврат',
  currency: 'сом',
}

function money(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
}

function qtyText(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function mergeLabels(labels) {
  return { ...DEFAULT_LABELS, ...(labels && typeof labels === 'object' ? labels : {}) }
}

function payLabel(sale, L) {
  if (sale.paymentMethod === 'credit') return L.payCredit
  if (sale.paymentMethod === 'mixed') return L.payMixed
  if (sale.paymentMethod === 'cash') return L.payCash
  if (sale.paymentMethod === 'card') return L.payCard
  if ((Number(sale.debtAdded) || 0) > 0.001) return L.payCredit
  return sale.paymentMethod || '-'
}

function receiptNo(sale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `№${sale.number}`
  return sale.id || 'Чек'
}

function padLine(left, right, width) {
  const l = String(left || '')
  const r = String(right || '')
  const space = Math.max(1, width - l.length - r.length)
  return l + ' '.repeat(space) + r
}

function wrapName(name, width) {
  const s = String(name || '').trim() || 'Товар'
  if (s.length <= width) return [s]
  const out = []
  let rest = s
  while (rest.length > width) {
    out.push(rest.slice(0, width))
    rest = rest.slice(width)
  }
  if (rest) out.push(rest)
  return out
}

function packEscPosLines(lines, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const list = (lines || [])
    .map(l => String(l || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(l => (l.length > width ? l.slice(0, width) : l))

  if (!list.length) list.push('KAKAPO', 'Пустой чек')

  const chunks = []
  chunks.push(Buffer.from([ESC, 0x40])) // init
  // Китайская прошивка XP-58C: Kanji/GBK включён → кириллица печатается иероглифами.
  // FS . отключает китайский режим, затем PC866 для русского.
  chunks.push(Buffer.from([FS, 0x2E])) // FS . cancel Kanji / Chinese mode
  chunks.push(Buffer.from([ESC, 0x52, 0x00])) // ESC R 0 international charset
  chunks.push(Buffer.from([ESC, 0x74, 17])) // ESC t 17 = PC866 Cyrillic
  chunks.push(Buffer.from([ESC, 0x4D, 0x00])) // Font A
  chunks.push(Buffer.from([ESC, 0x61, 1])) // center
  chunks.push(encodeCp866(`${list[0]}\n`))
  if (list[1]) chunks.push(encodeCp866(`${list[1]}\n`))
  chunks.push(Buffer.from([ESC, 0x61, 0])) // left
  for (let i = 2; i < list.length; i++) {
    chunks.push(encodeCp866(`${list[i]}\n`))
  }
  chunks.push(encodeCp866('\n\n\n'))
  chunks.push(Buffer.from([GS, 0x56, 0x01])) // partial cut
  return Buffer.concat(chunks)
}

/**
 * XP-58C / ESC-POS: текст в CP866, ширина ~32 символа на 58 мм.
 * Только русский (или латиница). Таджикские буквы — через GDI HTML.
 */
function buildEscPosReceipt(sale, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const L = mergeLabels(opts.labels)
  const store = String(opts.storeName || 'KAKAPO').trim() || 'KAKAPO'
  const header = String(opts.headerText || L.shopTag).trim() || L.shopTag
  const thanks = String(opts.footerThanks || L.thanks).trim() || L.thanks
  const footNote = String(opts.footerNote || L.keepReceipt).trim() || L.keepReceipt
  const pos = String(opts.posLabel || '').trim()
  const cashier = String(opts.cashierName || sale.cashierName || '').trim()
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString('ru-RU')
    : new Date().toLocaleString('ru-RU')

  const items = sale.items || []
  const goodsTotal = Number(sale.orderGoodsTotal)
  const subtotal = Number.isFinite(goodsTotal) && goodsTotal > 0
    ? goodsTotal
    : Math.round(items.reduce((s, it) => {
      const qty = Number(it.qty) || 0
      const price = Number(it.price) || 0
      const sum = Number(it.lineTotal)
      return s + (Number.isFinite(sum) && sum > 0 ? sum : price * qty)
    }, 0) * 100) / 100
  const total = Number(sale.total) || 0
  const bonusSpent = Math.max(0, Number(sale.bonusSpent) || 0)
  const discount = Math.max(0, Math.round((subtotal - total - bonusSpent) * 100) / 100)
  const returned = sale.status === 'returned'
  const partialReturn = sale.status === 'partial'
  const titleBanner = returned
    ? L.titleReturn
    : partialReturn
      ? L.titlePartial
      : L.titleSale

  const lines = []
  const push = (s = '') => lines.push(String(s))
  const sep = () => push('-'.repeat(width))
  const cur = L.currency || 'сом'

  push(store)
  push(header)
  if (opts.storeAddress) push(String(opts.storeAddress))
  if (opts.storePhone) push(String(opts.storePhone))
  sep()
  push(titleBanner)
  push(padLine(L.orderNo, receiptNo(sale), width))
  if (sale.number) push(padLine(L.receiptNo, `№${sale.number}`, width))
  push(padLine(L.date, when, width))
  if (pos) push(padLine(L.pos, pos, width))
  if (cashier) push(padLine(L.cashier, cashier, width))
  if (sale.clientName) {
    sep()
    push(L.client)
    push(String(sale.clientName))
    if (sale.clientPhone) push(String(sale.clientPhone))
  }
  sep()

  items.forEach((it, idx) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    const nameLines = wrapName(`${idx + 1}. ${it.productName || `#${it.productId}`}`, width)
    nameLines.forEach(n => push(n))
    push(padLine(`${qtyText(qty)} x ${money(price)}`, `${money(sum)} ${cur}`, width))
  })

  if (!items.length) push(L.noItems)
  sep()
  if (subtotal > total + 0.001) push(padLine(L.goods, `${money(subtotal)} ${cur}`, width))
  if (discount > 0.001) push(padLine(L.discount, `-${money(discount)} ${cur}`, width))
  if (bonusSpent > 0.001) push(padLine(L.bonus, `-${money(bonusSpent)} ${cur}`, width))
  push(padLine(L.total, `${money(total)} ${cur}`, width))
  push(padLine(L.payment, payLabel(sale, L), width))
  if ((Number(sale.paidCash) || 0) > 0.001) push(padLine(L.cash, `${money(sale.paidCash)} ${cur}`, width))
  if ((Number(sale.paidCard) || 0) > 0.001) push(padLine(L.cardPay, `${money(sale.paidCard)} ${cur}`, width))
  if ((Number(sale.debtAdded) || 0) > 0.001) push(padLine(L.credit, `${money(sale.debtAdded)} ${cur}`, width))
  if ((Number(sale.cashReceived) || 0) > 0.001) push(padLine(L.cashReceived, `${money(sale.cashReceived)} ${cur}`, width))
  if ((Number(sale.changeGiven) || 0) > 0.001) push(padLine(L.change, `${money(sale.changeGiven)} ${cur}`, width))
  if (sale.note) {
    sep()
    push(`${L.note}: ${sale.note}`)
  }
  sep()
  push(thanks)
  push(footNote)

  return packEscPosLines(lines, opts)
}

function buildEscPosFromReceiptHtml(html, opts = {}) {
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

module.exports = {
  buildEscPosReceipt,
  buildEscPosFromReceiptHtml,
  encodeCp866,
}
