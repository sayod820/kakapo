'use strict'

const iconv = require('iconv-lite')

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

function money(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
}

function qtyText(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function payLabel(sale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Карта'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return sale.paymentMethod || '—'
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

/**
 * XP-58C / ESC-POS: текст в CP866, ширина ~32 символа на 58 мм.
 */
function buildEscPosReceipt(sale, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const store = String(opts.storeName || 'KAKAPO').trim() || 'KAKAPO'
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

  const lines = []
  const push = (s = '') => lines.push(String(s))
  const sep = () => push('-'.repeat(width))

  push(store)
  push('магазин · касса')
  if (opts.storeAddress) push(String(opts.storeAddress))
  if (opts.storePhone) push(String(opts.storePhone))
  sep()
  push(returned ? 'ВОЗВРАТНЫЙ ЧЕК' : partialReturn ? 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ' : 'ТОВАРНЫЙ ЧЕК')
  push(padLine('Заказ', receiptNo(sale), width))
  if (sale.number) push(padLine('Чек', `№${sale.number}`, width))
  push(padLine('Дата', when, width))
  if (pos) push(padLine('Касса', pos, width))
  if (cashier) push(padLine('Кассир', cashier, width))
  if (sale.clientName) {
    sep()
    push('Клиент')
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
    push(padLine(`${qtyText(qty)} x ${money(price)}`, `${money(sum)} сом`, width))
  })

  if (!items.length) push('Нет позиций')
  sep()
  if (subtotal > total + 0.001) push(padLine('Товары', `${money(subtotal)} сом`, width))
  if (discount > 0.001) push(padLine('Скидка', `-${money(discount)} сом`, width))
  if (bonusSpent > 0.001) push(padLine('Бонусами', `-${money(bonusSpent)} сом`, width))
  push(padLine('ИТОГО', `${money(total)} сом`, width))
  push(padLine('Оплата', payLabel(sale), width))
  if ((Number(sale.paidCash) || 0) > 0.001) push(padLine('Наличные', `${money(sale.paidCash)} сом`, width))
  if ((Number(sale.paidCard) || 0) > 0.001) push(padLine('Карта', `${money(sale.paidCard)} сом`, width))
  if ((Number(sale.debtAdded) || 0) > 0.001) push(padLine('В долг', `${money(sale.debtAdded)} сом`, width))
  if ((Number(sale.cashReceived) || 0) > 0.001) push(padLine('Дал клиент', `${money(sale.cashReceived)} сом`, width))
  if ((Number(sale.changeGiven) || 0) > 0.001) push(padLine('Сдача', `${money(sale.changeGiven)} сом`, width))
  if (sale.note) {
    sep()
    push(`Примечание: ${sale.note}`)
  }
  sep()
  push('Спасибо за покупку!')
  push('Сохраняйте чек')
  push('')
  push('')
  push('')

  const chunks = []
  // Init + codepage CP866 (ESC t 17 часто CP866 на Xprinter)
  chunks.push(Buffer.from([ESC, 0x40]))
  chunks.push(Buffer.from([ESC, 0x74, 17]))
  // Center for header lines 0..1
  chunks.push(Buffer.from([ESC, 0x61, 1]))
  chunks.push(iconv.encode(`${lines[0]}\n`, 'cp866'))
  chunks.push(iconv.encode(`${lines[1]}\n`, 'cp866'))
  chunks.push(Buffer.from([ESC, 0x61, 0]))
  for (let i = 2; i < lines.length; i++) {
    chunks.push(iconv.encode(`${lines[i]}\n`, 'cp866'))
  }
  // Partial cut
  chunks.push(Buffer.from([GS, 0x56, 0x01]))
  return Buffer.concat(chunks)
}

function buildEscPosFromPlainLines(plainLines, opts = {}) {
  const width = opts.paperWidthMm === 80 ? 48 : 32
  const lines = (plainLines || [])
    .map(l => String(l || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(l => (l.length > width ? l.slice(0, width) : l))

  if (!lines.length) lines.push('Чек KAKAPO', 'Пустой документ')

  const chunks = []
  chunks.push(Buffer.from([ESC, 0x40]))
  chunks.push(Buffer.from([ESC, 0x74, 17]))
  chunks.push(Buffer.from([ESC, 0x61, 1]))
  chunks.push(iconv.encode(`${lines[0]}\n`, 'cp866'))
  if (lines[1]) chunks.push(iconv.encode(`${lines[1]}\n`, 'cp866'))
  chunks.push(Buffer.from([ESC, 0x61, 0]))
  for (let i = 2; i < lines.length; i++) {
    chunks.push(iconv.encode(`${lines[i]}\n`, 'cp866'))
  }
  chunks.push(iconv.encode('\n\n\n', 'cp866'))
  chunks.push(Buffer.from([GS, 0x56, 0x01]))
  return Buffer.concat(chunks)
}

/** Грубый разбор HTML-чека → ESC/POS (для старого UI без sale) */
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
  return buildEscPosFromPlainLines(text, opts)
}

module.exports = {
  buildEscPosReceipt,
  buildEscPosFromReceiptHtml,
}
