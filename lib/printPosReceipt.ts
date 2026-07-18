import type { PosSale } from '@/lib/types'
import { getKakapoDesktop, isKakapoDesktop } from '@/lib/desktopBridge'
import { pickReceiptPrinter, XP58C_RECEIPT_MM } from '@/lib/printerPresets'
import {
  loadReceiptTemplate,
  normalizeReceiptTemplate,
  resolveReceiptTexts,
  type ReceiptLabels,
  type ReceiptTemplate,
} from '@/lib/receiptTemplate'

type PosReceiptSale = PosSale & {
  bonusSpent?: number
  bonusEarned?: number
  orderGoodsTotal?: number
}

export type PosReceiptPrintOpts = {
  storeName?: string
  storeAddress?: string
  storePhone?: string
  posLabel?: string
  cashierName?: string
  paperWidthMm?: 58 | 80
  template?: Partial<ReceiptTemplate>
}

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n: number, currency: string) {
  return `${(Math.round(n * 100) / 100).toFixed(2)} ${currency}`
}

function shortMoney(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function qtyText(n: number) {
  const rounded = Math.round(n * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function payLabel(sale: PosReceiptSale, L: ReceiptLabels) {
  if (sale.paymentMethod === 'credit') return L.payCredit
  if (sale.paymentMethod === 'mixed') return L.payMixed
  if (sale.paymentMethod === 'cash') return L.payCash
  if (sale.paymentMethod === 'card') return L.payCard
  if ((Number(sale.debtAdded) || 0) > 0.001) return L.payCredit
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

function moneyRow(label: string, value: number, currency: string, cls = '') {
  if (!(Math.abs(Number(value) || 0) > 0.001)) return ''
  return `<div class="sum-row ${cls}"><span>${esc(label)}</span><b>${money(Number(value) || 0, currency)}</b></div>`
}

function receiptFontCss(font: ReceiptTemplate['fontFamily']) {
  if (font === 'arial-narrow') return "'Arial Narrow','Roboto Condensed',Arial,sans-serif"
  if (font === 'tahoma') return "Tahoma,Arial,sans-serif"
  if (font === 'verdana') return "Verdana,Arial,sans-serif"
  if (font === 'times') return "'Times New Roman',Times,serif"
  if (font === 'courier') return "'Courier New',Courier,monospace"
  return "Arial,'Helvetica Neue',sans-serif"
}

function mergePrintOpts(opts?: PosReceiptPrintOpts) {
  const base = normalizeReceiptTemplate(opts?.template || loadReceiptTemplate())
  const template = normalizeReceiptTemplate({
    ...base,
    storeName: opts?.storeName ?? base.storeName,
    storeAddress: opts?.storeAddress ?? base.storeAddress,
    storePhone: opts?.storePhone ?? base.storePhone,
  })
  const texts = resolveReceiptTexts(template)
  return { template, texts }
}

export function buildPosReceiptHtml(
  sale: PosReceiptSale,
  opts?: PosReceiptPrintOpts,
): string {
  const paperWidthMm = opts?.paperWidthMm === 80 ? 80 : 58
  const { template, texts } = mergePrintOpts(opts)
  const L = texts.labels
  const store = esc(texts.storeName)
  const storeAddress = esc(texts.storeAddress)
  const storePhone = esc(texts.storePhone)
  const headerText = esc(texts.headerText)
  const footerThanks = esc(texts.footerThanks)
  const footerNote = esc(texts.footerNote)
  const pos = esc(opts?.posLabel || '')
  const cashier = esc(opts?.cashierName || sale.cashierName || '')
  const locale = template.lang === 'tg' ? 'tg-TJ' : 'ru-RU'
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString(locale)
    : new Date().toLocaleString(locale)

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
  const titleBanner = returned
    ? L.titleReturn
    : partialReturn
      ? L.titlePartial
      : L.titleSale

  const lines = items.map((it, idx) => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    const returnedQty = Math.max(0, Number(it.returnedQty) || 0)
    return `<div class="item">
      <div class="item-name"><span>${idx + 1}. ${esc(it.productName || `#${it.productId}`)}</span>${returnedQty > 0 ? `<em>${esc(L.returnedQty)} ${qtyText(returnedQty)}</em>` : ''}</div>
      <div class="item-calc">
        <span>${qtyText(qty)} × ${shortMoney(price)}</span>
        <b>${money(sum, L.currency)}</b>
      </div>
    </div>`
  }).join('')

  const extras: string[] = []
  extras.push(moneyRow(L.cash, Number(sale.paidCash) || 0, L.currency))
  extras.push(moneyRow(L.cardPay, Number(sale.paidCard) || 0, L.currency))
  extras.push(moneyRow(L.credit, Number(sale.debtAdded) || 0, L.currency, 'debt'))
  extras.push(moneyRow(L.cashReceived, Number(sale.cashReceived) || 0, L.currency))
  extras.push(moneyRow(L.change, Number(sale.changeGiven) || 0, L.currency, 'change'))

  const customer: string[] = []
  if (sale.clientName) customer.push(`<div class="customer-name">${esc(sale.clientName)}</div>`)
  const clientBits = [sale.clientPhone, sale.cardNum ? `${L.cardSuffix} ${String(sale.cardNum).slice(-4)}` : ''].filter(Boolean)
  if (clientBits.length) customer.push(`<div class="muted">${esc(clientBits.join(' · '))}</div>`)

  const scale = template.fontScale / 100
  const px = (n: number) => Math.max(8, Math.round(n * scale))
  const fontSize = px(paperWidthMm === 58 ? 16 : 15)
  const smallSize = px(paperWidthMm === 58 ? 13 : 12)
  const titleSize = px(paperWidthMm === 58 ? 28 : 24)
  const totalSize = px(paperWidthMm === 58 ? 22 : 20)
  const bannerSize = px(paperWidthMm === 58 ? 15 : 14)
  const blockPad = template.compact ? 4 : 7
  const blockGap = template.compact ? 5 : 9
  const separator = template.separatorStyle === 'solid' ? 'solid' : 'dotted'
  const fontFamily = receiptFontCss(template.fontFamily)
  const htmlLang = template.lang === 'tg' ? 'tg' : 'ru'

  return `<!DOCTYPE html><html lang="${htmlLang}"><head><meta charset="utf-8"><title>${esc(titleBanner)} ${esc(receiptTitle(sale))}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{color-scheme:light only}
  body{font-family:${fontFamily};background:#fff;color:#000;padding:8px;width:${paperWidthMm}mm;max-width:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .receipt{font-size:${fontSize}px;line-height:1.35;font-weight:700}
  .shop{text-align:${template.storeAlign};font-weight:900;font-size:${titleSize}px;letter-spacing:.6px;line-height:1.08;text-transform:uppercase}
  .tag{text-align:${template.storeAlign};font-weight:800;font-size:${smallSize}px;margin-top:3px}
  .muted{color:#111;font-size:${smallSize}px;line-height:1.3;font-weight:700}
  .center{text-align:${template.storeAlign}}
  .sep{height:0;border:0;border-top:2px ${separator} #000;margin:${blockGap}px 0}
  .doc-title{
    background:#fff;color:#000;text-align:center;
    font-size:${bannerSize + 2}px;font-weight:900;padding:8px 4px;margin:8px 0 7px;
    letter-spacing:.04em;text-transform:uppercase;
    border-top:2px solid #000;border-bottom:2px solid #000;
  }
  .meta-row,.sum-row,.item-calc{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .meta-row{font-size:${smallSize}px;margin:3px 0;font-weight:700}
  .meta-row span{color:#111;font-weight:700}
  .meta-row b{font-weight:900;text-align:right;word-break:break-word}
  .customer{border:2px solid #000;border-radius:5px;padding:${blockPad}px;margin:${blockGap}px 0}
  .customer-title{font-size:${smallSize}px;font-weight:900;text-transform:uppercase;margin-bottom:3px}
  .customer-name{font-weight:900;font-size:${fontSize}px}
  .item{padding:${blockPad}px 0;border-bottom:2px ${separator} #000}
  .item-name{font-weight:900;word-break:break-word;font-size:${fontSize}px}
  .item-name em{display:block;font-style:normal;font-size:${smallSize}px;font-weight:800;color:#000;margin-top:2px}
  .item-calc{font-family:${fontFamily};margin-top:4px;font-size:${fontSize}px;font-weight:800}
  .item-calc b{font-size:${fontSize + 1}px;white-space:nowrap;font-weight:900}
  .sum-row{font-size:${fontSize}px;margin:4px 0;font-weight:800}
  .sum-row b{font-weight:900;white-space:nowrap}
  .sum-row.debt b{border-bottom:2px solid #000}
  .sum-row.change b{font-size:${fontSize + 2}px}
  .total{display:flex;justify-content:space-between;gap:8px;align-items:flex-end;font-size:${totalSize}px;font-weight:900;margin:8px 0 6px;text-transform:uppercase;letter-spacing:.02em}
  .total span:last-child{white-space:nowrap}
  .note{font-size:${smallSize}px;margin-top:8px;color:#000;white-space:pre-wrap;border-top:2px dotted #000;padding-top:6px;font-weight:700}
  .foot{text-align:center;font-size:${smallSize}px;margin-top:12px;color:#000;font-weight:700}
  .thanks{font-weight:900;font-size:${fontSize + 2}px;margin-bottom:4px}
  @media print{body{padding:4px;width:${paperWidthMm}mm}.receipt{page-break-inside:avoid}}
</style></head><body>
  <div class="receipt">
    <div class="shop">${store}</div>
    <div class="tag">${headerText}</div>
    ${(storeAddress || storePhone) ? `<div class="center muted">${storeAddress}${storeAddress && storePhone ? '<br>' : ''}${storePhone}</div>` : ''}
    <hr class="sep"/>
    <div class="doc-title">${esc(titleBanner)}</div>
    ${metaRow(L.orderNo, orderNo)}
    ${sale.number ? metaRow(L.receiptNo, `№${sale.number}`) : ''}
    ${metaRow(L.date, when)}
    ${pos ? metaRow(L.pos, pos) : ''}
    ${template.showCashier && cashier ? metaRow(L.cashier, cashier) : ''}
    ${sale.shiftId ? metaRow(L.shift, sale.shiftId.slice(-6)) : ''}
    ${template.showCustomer && customer.length ? `<div class="customer"><div class="customer-title">${esc(L.client)}</div>${customer.join('')}</div>` : ''}
    <hr class="sep"/>
    ${lines || `<div class="item">${esc(L.noItems)}</div>`}
    <hr class="sep"/>
    ${subtotal > total + 0.001 ? moneyRow(L.goods, subtotal, L.currency) : ''}
    ${discount > 0.001 ? moneyRow(L.discount, -discount, L.currency) : ''}
    ${bonusSpent > 0.001 ? moneyRow(L.bonus, -bonusSpent, L.currency) : ''}
    <div class="total"><span>${esc(L.total)}</span><span>${money(total, L.currency)}</span></div>
    <div class="sum-row"><span>${esc(L.payment)}</span><b>${esc(payLabel(sale, L))}</b></div>
    ${extras.filter(Boolean).join('')}
    ${Number(sale.bonusEarned) > 0.001 ? `<div class="sum-row"><span>${esc(L.bonusEarned)}</span><b>${Math.floor(Number(sale.bonusEarned))}</b></div>` : ''}
    ${sale.note ? `<div class="note">${esc(L.note)}: ${esc(sale.note)}</div>` : ''}
    ${template.showFooter ? `<hr class="sep"/>
    <div class="foot">
      <div class="thanks">${footerThanks}</div>
      <div>${footerNote}</div>
    </div>` : ''}
  </div>
</body></html>`
}

export async function printPosReceipt(
  sale: PosReceiptSale,
  opts?: PosReceiptPrintOpts,
): Promise<void> {
  if (typeof window === 'undefined') return

  const { template, texts } = mergePrintOpts(opts)
  const printOpts: PosReceiptPrintOpts = {
    ...opts,
    storeName: texts.storeName,
    storeAddress: texts.storeAddress || undefined,
    storePhone: texts.storePhone || undefined,
    template,
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

    const html = buildPosReceiptHtml(sale, { ...printOpts, paperWidthMm })
    const pageHeightMm = Math.max(300, Math.min(1200, 130 + (sale.items || []).length * 16))
    await desktop.printHtml(html, {
      role: 'receipt',
      printerName,
      paperWidthMm,
      pageWidthMm: paperWidthMm,
      pageHeightMm,
      receiptLang: template.lang,
      receiptDensity: template.printDensity,
      // Всегда ESC/POS RAW (GDI на XP-58C часто крутит пустую ленту).
      // Таджикские ғқҳҷӯӣ desktop сворачивает в ближайшие CP866.
      sale,
      storeName: texts.storeName,
      storeAddress: texts.storeAddress || undefined,
      storePhone: texts.storePhone || undefined,
      posLabel: opts?.posLabel,
      cashierName: opts?.cashierName || sale.cashierName,
      headerText: texts.headerText,
      footerThanks: texts.footerThanks,
      footerNote: texts.footerNote,
      labels: texts.labels,
    })
    return
  }

  const html = buildPosReceiptHtml(sale, { ...printOpts, paperWidthMm: 58 })
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
