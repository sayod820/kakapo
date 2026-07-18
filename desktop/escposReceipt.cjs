'use strict'

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

function wrapName(name, width) {
  const s = String(name || '').trim() || 'Товар'
  if (s.length <= width) return [s]
  const lines = []
  let rest = s
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut < 8) cut = width
    lines.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) lines.push(rest)
  return lines
}

/** Имя + сумма справа (как на макете); перенос имени без суммы. */
function nameAmountLines(name, amount, width) {
  const right = moneySom(amount)
  const maxLeft = Math.max(8, width - right.length - 1)
  const lines = wrapName(name, maxLeft)
  const out = []
  lines.forEach((line, i) => {
    if (i === lines.length - 1) out.push(padLine(clip(line, maxLeft), right, width))
    else out.push(clip(line, width))
  })
  return out
}

function payLabel(sale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Картой'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return '-'
}

function cardLineLabel(sale) {
  const digits = String(sale.cardNum || '').replace(/\D/g, '')
  if (digits.length >= 4) return `Картой (Visa ****${digits.slice(-4)})`
  return 'Картой'
}

function orderNo(sale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `N${sale.number}`
  return sale.id || 'Chek'
}

function docTitle(sale) {
  if (sale.status === 'returned') return 'ВОЗВРАТНЫЙ ЧЕК'
  if (sale.status === 'partial') return 'ЧЕК - ЧАСТИЧНЫЙ ВОЗВРАТ'
  return 'ТОВАРНЫЙ ЧЕК'
}

/**
 * Макет 1:1 с дизайн-макетом 58 мм.
 * Ширина 32 символа (Font A), кодовая страница CP866.
 */
function buildEscPosReceipt(sale, opts = {}) {
  const width = 32
  const store = String(opts.storeName || 'КАКАПО').trim() || 'КАКАПО'
  const phone = clip(String(opts.storePhone || '').trim(), width)
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
  const txt = (s) => chunks.push(encodeCp866(`${clip(s, width)}\n`))
  const txtRaw = (s) => chunks.push(encodeCp866(`${s}\n`))
  const sep = () => txt('-'.repeat(width))

  // Init + CP866 (page 17)
  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  cmd(ESC, 0x52, 0x00)
  cmd(ESC, 0x74, 17)
  cmd(ESC, 0x4D, 0x00) // Font A 12x24
  cmd(GS, 0x42, 0x00)
  cmd(ESC, 0x45, 0)
  cmd(ESC, 0x61, 1) // center

  // Header: крупное имя магазина
  cmd(ESC, 0x45, 1)
  cmd(GS, 0x21, 0x11) // double width + height (16 cols)
  txtRaw(clip(store, 16))
  cmd(GS, 0x21, 0x00)
  cmd(ESC, 0x45, 0)
  txt('магазин - касса')
  if (phone) txt(phone)

  sep()
  cmd(ESC, 0x45, 1)
  txt(docTitle(sale))
  cmd(ESC, 0x45, 0)
  sep()

  cmd(ESC, 0x61, 0) // left
  txt(padLine('Номер заказа', clip(orderNo(sale), 16), width))
  if (sale.number != null) txt(padLine('Номер чека', clip(`№${sale.number}`, 16), width))
  txt(padLine('Дата', clip(when, 18), width))
  if (pos) txt(padLine('Касса', clip(pos, 20), width))
  if (cashier) txt(padLine('Кассир', clip(cashier, 20), width))
  if (sale.clientName) txt(padLine('Клиент', clip(sale.clientName, 18), width))
  if (sale.clientPhone) txt(padLine('Тел. клиента', clip(sale.clientPhone, 14), width))

  sep()

  items.forEach((it) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    nameAmountLines(it.productName || `#${it.productId}`, sum, width).forEach(line => txtRaw(line))
    txt(`${qtyText(qty)} x ${money(price)}`)
  })

  if (!items.length) txt('Нет позиций')

  sep()

  txt(padLine('Сумма', moneySom(subtotal), width))
  if (discount > 0.001) {
    txt(padLine(`Скидка${discountPct > 0 ? ` ${discountPct}%` : ''}`, `-${moneySom(discount)}`, width))
  }
  if (bonusEarned > 0.001) {
    txt(padLine('Начислено бонусов', `+${Math.floor(bonusEarned)}`, width))
  }
  if (bonusSpent > 0.001) {
    txt(padLine('Списано бонусов', `-${moneySom(bonusSpent)}`, width))
  }

  // ИТОГ — жирный + двойная высота
  cmd(ESC, 0x45, 1)
  cmd(GS, 0x21, 0x10)
  txt(padLine('ИТОГ', moneySom(total), width))
  cmd(GS, 0x21, 0x00)
  cmd(ESC, 0x45, 0)

  sep()

  txt(padLine('Оплата', payLabel(sale), width))
  if ((Number(sale.paidCash) || 0) > 0.001) txt(padLine('Наличные', moneySom(sale.paidCash), width))
  if ((Number(sale.paidCard) || 0) > 0.001) {
    txt(padLine(clip(cardLineLabel(sale), 20), moneySom(sale.paidCard), width))
  }
  if ((Number(sale.debtAdded) || 0) > 0.001) txt(padLine('В долг', moneySom(sale.debtAdded), width))
  if ((Number(sale.cashReceived) || 0) > 0.001) txt(padLine('Дал клиент', moneySom(sale.cashReceived), width))
  if ((Number(sale.changeGiven) || 0) > 0.001) {
    cmd(ESC, 0x45, 1)
    txt(padLine('Сдача', moneySom(sale.changeGiven), width))
    cmd(ESC, 0x45, 0)
  }

  const balBefore = sale.bonusBalanceBefore
  const balAfter = sale.bonusBalanceAfter
  if (balBefore != null && balAfter != null) {
    sep()
    txt(padLine(
      'Баланс бонусов',
      `${Math.floor(Number(balBefore) || 0)} -> ${Math.floor(Number(balAfter) || 0)}`,
      width,
    ))
  }

  sep()
  cmd(ESC, 0x61, 1)
  cmd(ESC, 0x45, 1)
  txt('Спасибо за покупку!')
  cmd(ESC, 0x45, 0)
  txt('Сохраняйте чек до проверки')
  txt('товара')

  chunks.push(encodeCp866('\n\n\n'))
  cmd(GS, 0x56, 0x01) // partial cut
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
