'use strict'

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c

/**
 * Минимальный CP866 без iconv-lite (portable касса часто без node_modules).
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
    ['№', 0xFC], ['·', 0xFA], ['×', 0x78], ['⭐', 0x2A],
  ]
  for (const [ch, code] of pairs) m[ch] = code
  return m
})()

/** Таджикские буквы → ближайшие в CP866 */
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
    else out[i] = 0x3F
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
  total: 'ИТОГ',
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
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')
}

function qtyText(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000
  if (Number.isInteger(rounded)) return `${rounded},0`
  return String(rounded).replace('.', ',')
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

function rightAlign(text, width) {
  const t = String(text || '')
  if (t.length >= width) return t.slice(-width)
  return ' '.repeat(width - t.length) + t
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

function clip(s, width) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > width ? t.slice(0, width) : t
}

function packEscPosLines(lines, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const list = (lines || [])
    .map(l => String(l || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(l => (l.length > width ? l.slice(0, width) : l))

  if (!list.length) list.push('KAKAPO', 'Пустой чек')

  const chunks = []
  chunks.push(Buffer.from([ESC, 0x40]))
  chunks.push(Buffer.from([FS, 0x2E]))
  chunks.push(Buffer.from([ESC, 0x52, 0x00]))
  chunks.push(Buffer.from([ESC, 0x74, 17]))
  chunks.push(Buffer.from([ESC, 0x4D, 0x00]))
  chunks.push(Buffer.from([GS, 0x42, 0x00]))
  chunks.push(Buffer.from([ESC, 0x61, 1]))
  chunks.push(encodeCp866(`${list[0]}\n`))
  if (list[1]) chunks.push(encodeCp866(`${list[1]}\n`))
  chunks.push(Buffer.from([ESC, 0x61, 0]))
  for (let i = 2; i < list.length; i++) {
    chunks.push(encodeCp866(`${list[i]}\n`))
  }
  chunks.push(encodeCp866('\n\n\n'))
  chunks.push(Buffer.from([GS, 0x56, 0x01]))
  return Buffer.concat(chunks)
}

/**
 * Нативный шрифт XP-58C (как старая касса) — чётко.
 * «ТОВАРНЫЙ ЧЕК» — чёрный на белом (без инверсии).
 */
function buildEscPosReceipt(sale, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const L = mergeLabels(opts.labels)
  const store = clip(String(opts.storeName || 'KAKAPO').trim() || 'KAKAPO', width)
  const header = clip(String(opts.headerText || L.shopTag).trim() || L.shopTag, width)
  const thanks = clip(String(opts.footerThanks || L.thanks).trim() || L.thanks, width)
  const footNote = clip(String(opts.footerNote || L.keepReceipt).trim() || L.keepReceipt, width)
  const pos = String(opts.posLabel || '').trim()
  const cashier = String(opts.cashierName || sale.cashierName || '').trim()
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

  const chunks = []
  const cmd = (...b) => chunks.push(Buffer.from(b))
  const txt = (s) => chunks.push(encodeCp866(`${clip(s, width)}\n`))
  const sep = () => txt('.'.repeat(width))

  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  cmd(ESC, 0x52, 0x00)
  cmd(ESC, 0x74, 17)
  cmd(ESC, 0x4D, 0x00)
  cmd(GS, 0x42, 0x00) // white-on-black OFF

  // магазин
  cmd(ESC, 0x61, 1)
  cmd(ESC, 0x45, 1)
  cmd(ESC, 0x21, 0x10) // double height
  txt(store)
  cmd(ESC, 0x21, 0x00)
  cmd(ESC, 0x45, 0)
  txt(header)
  if (opts.storeAddress) txt(opts.storeAddress)
  if (opts.storePhone) txt(opts.storePhone)

  // ТОВАРНЫЙ ЧЕК — чёрный на белом
  cmd(ESC, 0x45, 1)
  txt(titleBanner)
  cmd(ESC, 0x45, 0)

  cmd(ESC, 0x61, 0)
  txt(padLine(clip(L.orderNo, 14), clip(receiptNo(sale), 16), width))
  if (sale.number) txt(padLine(clip(L.receiptNo, 14), clip(`№${sale.number}`, 16), width))
  txt(padLine(clip(L.date, 8), clip(when, 22), width))
  if (pos) txt(padLine(clip(L.pos, 10), clip(pos, 20), width))
  if (cashier) txt(padLine(clip(L.cashier, 10), clip(cashier, 20), width))
  if (sale.clientName) {
    sep()
    txt(L.client)
    txt(sale.clientName)
    if (sale.clientPhone) txt(sale.clientPhone)
  }
  sep()

  items.forEach((it, idx) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    wrapName(`${idx + 1}. ${it.productName || `#${it.productId}`}`, width).forEach(n => txt(n))
    txt(rightAlign(`${money(price)} x ${qtyText(qty)} = ${money(sum)}`, width))
    sep()
  })

  if (!items.length) {
    txt(L.noItems)
    sep()
  }

  if (subtotal > total + 0.001) txt(padLine(L.goods, money(subtotal), width))
  if (discount > 0.001) txt(padLine(L.discount, `-${money(discount)}`, width))
  if (bonusSpent > 0.001) txt(padLine(L.bonus, `-${money(bonusSpent)}`, width))

  const payAmt = (Number(sale.paidCash) || 0) > 0.001
    ? Number(sale.paidCash)
    : ((Number(sale.paidCard) || 0) > 0.001 ? Number(sale.paidCard) : total)
  txt(padLine(payLabel(sale, L), money(payAmt), width))
  if ((Number(sale.paidCard) || 0) > 0.001 && (Number(sale.paidCash) || 0) > 0.001) {
    txt(padLine(L.cardPay, money(sale.paidCard), width))
  }
  if ((Number(sale.debtAdded) || 0) > 0.001) txt(padLine(L.credit, money(sale.debtAdded), width))
  if ((Number(sale.cashReceived) || 0) > 0.001) txt(padLine(L.cashReceived, money(sale.cashReceived), width))
  if ((Number(sale.changeGiven) || 0) > 0.001) txt(padLine(L.change, money(sale.changeGiven), width))

  // ИТОГ — жирный, двойная высота
  cmd(ESC, 0x45, 1)
  cmd(ESC, 0x21, 0x10)
  txt(padLine(clip(L.total, 10), money(total), width))
  cmd(ESC, 0x21, 0x00)
  cmd(ESC, 0x45, 0)

  if (sale.note) {
    sep()
    txt(`${L.note}: ${sale.note}`)
  }
  if (cashier) txt(clip(`Продавец: _______(${cashier})`, width))

  cmd(ESC, 0x61, 1)
  cmd(ESC, 0x45, 1)
  txt(thanks)
  cmd(ESC, 0x45, 0)
  txt(footNote)
  txt(store)

  chunks.push(encodeCp866('\n\n\n'))
  cmd(GS, 0x56, 0x01)
  return Buffer.concat(chunks)
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

function buildEscPosRaster(mono, opts = {}) {
  const height = Math.max(1, Number(mono?.height) || 0)
  const widthBytes = Math.max(1, Number(mono?.widthBytes) || Math.ceil((Number(mono?.width) || 8) / 8))
  const src = Buffer.isBuffer(mono?.data) ? mono.data : Buffer.alloc(widthBytes * height)
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = height & 0xff
  const yH = (height >> 8) & 0xff
  const chunks = []
  chunks.push(Buffer.from([ESC, 0x40]))
  chunks.push(Buffer.from([FS, 0x2E]))
  chunks.push(Buffer.from([ESC, 0x61, 1]))
  chunks.push(Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]))
  chunks.push(src.subarray(0, widthBytes * height))
  chunks.push(Buffer.from([ESC, 0x61, 0]))
  chunks.push(Buffer.from('\n\n\n', 'ascii'))
  if (opts.cut !== false) chunks.push(Buffer.from([GS, 0x56, 0x01]))
  return Buffer.concat(chunks)
}

module.exports = {
  buildEscPosReceipt,
  buildEscPosFromReceiptHtml,
  buildEscPosRaster,
  encodeCp866,
}
