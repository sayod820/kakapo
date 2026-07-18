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

function payLabel(sale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Картой'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return '-'
}

function orderNo(sale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `N${sale.number}`
  return sale.id || 'Chek'
}

function docTitle(sale) {
  if (sale.status === 'returned') return 'ВОЗВРАТНЫЙ ЧЕК'
  if (sale.status === 'partial') return 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ'
  return 'ТОВАРНЫЙ ЧЕК'
}

/**
 * Способ B: чистый ESC/POS текст для XP-58C.
 * Ширина 32 символа (Font A), кодовая страница CP866.
 * Порядок полей = receipt-example.html.
 */
function buildEscPosReceipt(sale, opts = {}) {
  const width = 32
  const store = clip(String(opts.storeName || 'КАКАПО').trim() || 'КАКАПО', width)
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
  const sep = () => txt('-'.repeat(width))

  // Init + CP866 (page 17)
  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  cmd(ESC, 0x52, 0x00) // international character set USA
  cmd(ESC, 0x74, 17) // code page CP866
  cmd(ESC, 0x4D, 0x00) // Font A 12x24
  cmd(GS, 0x42, 0x00) // reverse off
  cmd(ESC, 0x45, 0) // bold off
  cmd(ESC, 0x61, 1) // center

  // Header
  cmd(ESC, 0x45, 1)
  txt(store)
  cmd(ESC, 0x45, 0)
  txt('магазин · касса')
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
    const nameLines = wrapName(it.productName || `#${it.productId}`, width)
    nameLines.forEach((line, i) => {
      if (i === nameLines.length - 1) {
        // last name line + amount on next layout: name then amount row
        txt(line)
      } else {
        txt(line)
      }
    })
    txt(padLine(`${qtyText(qty)} x ${money(price)}`, moneySom(sum), width))
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

  cmd(ESC, 0x45, 1)
  txt(padLine('ИТОГ', moneySom(total), width))
  cmd(ESC, 0x45, 0)

  sep()

  txt(padLine('Оплата', payLabel(sale), width))
  if ((Number(sale.paidCash) || 0) > 0.001) txt(padLine('Наличные', moneySom(sale.paidCash), width))
  if ((Number(sale.paidCard) || 0) > 0.001) txt(padLine('Картой', moneySom(sale.paidCard), width))
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
    txt(padLine('Баланс бонусов', `${Math.floor(Number(balBefore) || 0)} -> ${Math.floor(Number(balAfter) || 0)}`, width))
  }

  sep()
  cmd(ESC, 0x61, 1)
  cmd(ESC, 0x45, 1)
  txt('Спасибо за покупку!')
  cmd(ESC, 0x45, 0)
  txt('Сохраняйте чек до проверки')
  txt('товара')
  txt('www.kakapo.tj')

  chunks.push(encodeCp866('\n\n\n'))
  cmd(GS, 0x56, 0x01) // partial cut
  return Buffer.concat(chunks)
}

/** Оставлен для этикеток/legacy; чеки печатаются через buildEscPosReceipt */
function buildEscPosRaster(mono, opts = {}) {
  const height = Math.max(1, Number(mono?.height) || 0)
  const widthBytes = Math.max(1, Number(mono?.widthBytes) || Math.ceil((Number(mono?.width) || 8) / 8))
  const src = Buffer.isBuffer(mono?.data) ? mono.data : Buffer.alloc(widthBytes * height)
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = height & 0xff
  const yH = (height >> 8) & 0xff
  const chunks = []
  const cmd = (...b) => chunks.push(Buffer.from(b))
  cmd(ESC, 0x40)
  cmd(FS, 0x2E)
  cmd(GS, 0x28, 0x4B, 0x02, 0x00, 0x31, 3)
  cmd(ESC, 0x61, 1)
  cmd(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH)
  chunks.push(src.subarray(0, widthBytes * height))
  cmd(ESC, 0x61, 0)
  chunks.push(Buffer.from('\n', 'ascii'))
  if (opts.cut !== false) cmd(GS, 0x56, 0x01)
  return Buffer.concat(chunks)
}

module.exports = {
  buildEscPosReceipt,
  buildEscPosRaster,
  encodeCp866,
}
