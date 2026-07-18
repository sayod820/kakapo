import type { PosSale } from '@/lib/types'
import { getKakapoDesktop, isKakapoDesktop } from '@/lib/desktopBridge'
import { pickReceiptPrinter, XP58C_RECEIPT_MM } from '@/lib/printerPresets'

type PosReceiptSale = PosSale & {
  bonusSpent?: number
  bonusEarned?: number
  orderGoodsTotal?: number
}

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n: number) {
  return `${(Math.round(n * 100) / 100).toFixed(2)} сом`
}

function shortMoney(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function qtyText(n: number) {
  const rounded = Math.round(n * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function payLabel(sale: PosReceiptSale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Карта'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return sale.paymentMethod || '—'
}

function receiptTitle(sale: PosReceiptSale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `№${sale.number}`
  return sale.id || 'Чек'
}

function metaRow(label: string, value?: string | number | null) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return `<div class="meta-row"><span>${esc(label)}</span><b>${esc(v)}</b></div>`
}

function moneyRow(label: string, value: number, cls = '') {
  if (!(Math.abs(Number(value) || 0) > 0.001)) return ''
  return `<div class="sum-row ${cls}"><span>${esc(label)}</span><b>${money(Number(value) || 0)}</b></div>`
}

export function buildPosReceiptHtml(
  sale: PosReceiptSale,
  opts?: {
    storeName?: string
    storeAddress?: string
    storePhone?: string
    posLabel?: string
    cashierName?: string
    paperWidthMm?: 58 | 80
  },
): string {
  const paperWidthMm = opts?.paperWidthMm === 80 ? 80 : 58
  const store = esc(opts?.storeName || 'KAKAPO')
  const storeAddress = esc(opts?.storeAddress || '')
  const storePhone = esc(opts?.storePhone || '')
  const pos = esc(opts?.posLabel || '')
  const cashier = esc(opts?.cashierName || sale.cashierName || '')
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString('ru-RU')
    : new Date().toLocaleString('ru-RU')

  const orderNo = receiptTitle(sale)
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

  const lines = items.map((it, idx) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    const returnedQty = Math.max(0, Number(it.returnedQty) || 0)
    return `<div class="item">
      <div class="item-name"><span>${idx + 1}. ${esc(it.productName || `#${it.productId}`)}</span>${returnedQty > 0 ? `<em>возврат ${qtyText(returnedQty)}</em>` : ''}</div>
      <div class="item-calc">
        <span>${qtyText(qty)} × ${shortMoney(price)}</span>
        <b>${money(sum)}</b>
      </div>
    </div>`
  }).join('')

  const extras: string[] = []
  extras.push(moneyRow('Наличные', Number(sale.paidCash) || 0))
  extras.push(moneyRow('Карта', Number(sale.paidCard) || 0))
  extras.push(moneyRow('В долг', Number(sale.debtAdded) || 0, 'debt'))
  extras.push(moneyRow('Дал клиент', Number(sale.cashReceived) || 0))
  extras.push(moneyRow('Сдача', Number(sale.changeGiven) || 0, 'change'))

  const customer: string[] = []
  if (sale.clientName) customer.push(`<div class="customer-name">${esc(sale.clientName)}</div>`)
  const clientBits = [sale.clientPhone, sale.cardNum ? `карта ${String(sale.cardNum).slice(-4)}` : ''].filter(Boolean)
  if (clientBits.length) customer.push(`<div class="muted">${esc(clientBits.join(' · '))}</div>`)

  const fontSize = paperWidthMm === 58 ? 11 : 12
  const smallSize = paperWidthMm === 58 ? 9 : 10
  const titleSize = paperWidthMm === 58 ? 18 : 21
  const totalSize = paperWidthMm === 58 ? 15 : 18

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Чек ${esc(receiptTitle(sale))}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{color-scheme:light only}
  body{font-family:Arial,'Helvetica Neue',sans-serif;background:#fff;color:#000;padding:7px;width:${paperWidthMm}mm;max-width:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .receipt{font-size:${fontSize}px;line-height:1.22}
  .shop{text-align:center;font-weight:900;font-size:${titleSize}px;letter-spacing:.7px;line-height:1.05;text-transform:uppercase}
  .tag{text-align:center;font-weight:800;font-size:${smallSize}px;margin-top:2px}
  .muted{color:#333;font-size:${smallSize}px;line-height:1.25}
  .center{text-align:center}
  .sep{height:1px;border:0;border-top:1px dashed #000;margin:7px 0}
  .black{background:#000;color:#fff;text-align:center;font-size:${smallSize}px;font-weight:900;padding:3px 5px;margin:7px 0 5px;border-radius:2px}
  .meta-row,.sum-row,.item-calc{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .meta-row{font-size:${smallSize}px;margin:1px 0}
  .meta-row span{color:#333}
  .meta-row b{font-weight:800;text-align:right;word-break:break-word}
  .customer{border:1px solid #000;border-radius:4px;padding:5px;margin:6px 0}
  .customer-title{font-size:${smallSize}px;font-weight:900;text-transform:uppercase;margin-bottom:2px}
  .customer-name{font-weight:900}
  .item{padding:5px 0;border-bottom:1px dotted #999}
  .item-name{font-weight:800;word-break:break-word}
  .item-name em{display:block;font-style:normal;font-size:${smallSize}px;font-weight:800;color:#000;margin-top:1px}
  .item-calc{font-family:'Courier New',Courier,monospace;margin-top:3px;font-size:${fontSize}px}
  .item-calc b{font-size:${fontSize + 1}px;white-space:nowrap}
  .sum-row{font-size:${fontSize}px;margin:3px 0}
  .sum-row b{font-weight:900;white-space:nowrap}
  .sum-row.debt b{border-bottom:2px solid #000}
  .sum-row.change b{font-size:${fontSize + 1}px}
  .total{display:flex;justify-content:space-between;gap:8px;align-items:flex-end;font-size:${totalSize}px;font-weight:900;margin:6px 0 4px;text-transform:uppercase}
  .total span:last-child{white-space:nowrap}
  .note{font-size:${smallSize}px;margin-top:6px;color:#000;white-space:pre-wrap;border-top:1px dotted #777;padding-top:5px}
  .foot{text-align:center;font-size:${smallSize}px;margin-top:10px;color:#000}
  .thanks{font-weight:900;font-size:${fontSize + 1}px;margin-bottom:3px}
  @media print{body{padding:0;width:${paperWidthMm}mm}.receipt{page-break-inside:avoid}}
</style></head><body>
  <div class="receipt">
    <div class="shop">${store}</div>
    <div class="tag">магазин · касса</div>
    ${(storeAddress || storePhone) ? `<div class="center muted">${storeAddress}${storeAddress && storePhone ? '<br>' : ''}${storePhone}</div>` : ''}
    <hr class="sep"/>
    <div class="black">${returned ? 'ВОЗВРАТНЫЙ ЧЕК' : partialReturn ? 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ' : 'ТОВАРНЫЙ ЧЕК'}</div>
    ${metaRow('Номер заказа', orderNo)}
    ${sale.number ? metaRow('Номер чека', `№${sale.number}`) : ''}
    ${metaRow('Дата', when)}
    ${pos ? metaRow('Касса', pos) : ''}
    ${cashier ? metaRow('Кассир', cashier) : ''}
    ${sale.shiftId ? metaRow('Смена', sale.shiftId.slice(-6)) : ''}
    ${customer.length ? `<div class="customer"><div class="customer-title">Клиент</div>${customer.join('')}</div>` : ''}
    <hr class="sep"/>
    ${lines || '<div class="item">Нет позиций</div>'}
    <hr class="sep"/>
    ${subtotal > total + 0.001 ? moneyRow('Товары', subtotal) : ''}
    ${discount > 0.001 ? moneyRow('Скидка', -discount) : ''}
    ${bonusSpent > 0.001 ? moneyRow('Бонусами', -bonusSpent) : ''}
    <div class="total"><span>Итого</span><span>${money(total)}</span></div>
    <div class="sum-row"><span>Оплата</span><b>${esc(payLabel(sale))}</b></div>
    ${extras.filter(Boolean).join('')}
    ${Number(sale.bonusEarned) > 0.001 ? `<div class="sum-row"><span>Начислено бонусов</span><b>${Math.floor(Number(sale.bonusEarned))}</b></div>` : ''}
    ${sale.note ? `<div class="note">Примечание: ${esc(sale.note)}</div>` : ''}
    <hr class="sep"/>
    <div class="foot">
      <div class="thanks">Спасибо за покупку!</div>
      <div>Сохраняйте чек до проверки товара</div>
    </div>
  </div>
</body></html>`
}

export async function printPosReceipt(
  sale: PosReceiptSale,
  opts?: { storeName?: string; storeAddress?: string; storePhone?: string; posLabel?: string; cashierName?: string },
): Promise<void> {
  if (typeof window === 'undefined') return

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

    const html = buildPosReceiptHtml(sale, { ...opts, paperWidthMm })
    const pageHeightMm = Math.max(300, Math.min(1200, 130 + (sale.items || []).length * 16))
    await desktop.printHtml(html, {
      role: 'receipt',
      printerName,
      paperWidthMm,
      pageWidthMm: paperWidthMm,
      pageHeightMm,
      // ESC/POS RAW на desktop (если поддерживается)
      sale,
      storeName: opts?.storeName || 'KAKAPO',
      storeAddress: opts?.storeAddress,
      storePhone: opts?.storePhone,
      posLabel: opts?.posLabel,
      cashierName: opts?.cashierName || sale.cashierName,
    })
    return
  }

  const html = buildPosReceiptHtml(sale, { ...opts, paperWidthMm: 58 })
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
