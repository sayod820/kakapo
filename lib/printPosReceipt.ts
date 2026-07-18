import type { PosSale } from '@/lib/types'
import { getKakapoDesktop, isKakapoDesktop } from '@/lib/desktopBridge'
import { pickReceiptPrinter, XP58C_RECEIPT_MM } from '@/lib/printerPresets'

const STORE_KEY = 'kakapo_trade_receipt_store'

export type ReceiptStoreConfig = {
  storeName: string
  storePhone: string
}

export const DEFAULT_RECEIPT_STORE: ReceiptStoreConfig = {
  storeName: 'КАКАПО',
  storePhone: '',
}

export function loadReceiptStore(): ReceiptStoreConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_RECEIPT_STORE }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_RECEIPT_STORE }
    const p = JSON.parse(raw) as Partial<ReceiptStoreConfig>
    return {
      storeName: String(p.storeName || DEFAULT_RECEIPT_STORE.storeName).trim() || 'КАКАПО',
      storePhone: String(p.storePhone || '').trim(),
    }
  } catch {
    return { ...DEFAULT_RECEIPT_STORE }
  }
}

export function saveReceiptStore(cfg: ReceiptStoreConfig) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORE_KEY, JSON.stringify({
    storeName: String(cfg.storeName || '').trim() || 'КАКАПО',
    storePhone: String(cfg.storePhone || '').trim(),
  }))
}

export type PosReceiptPrintOpts = {
  storeName?: string
  storePhone?: string
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

function money(n: number) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)} сом`
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

function moneyRow(label: string, value: number, opts?: { bold?: boolean; prefix?: string }) {
  if (!(Math.abs(Number(value) || 0) > 0.001)) return ''
  const cls = opts?.bold ? 'row bold' : 'row'
  const prefix = opts?.prefix || ''
  return `<div class="${cls}"><span>${esc(label)}</span><span>${prefix}${money(value)}</span></div>`
}

function docTitle(sale: PosSale) {
  if (sale.status === 'returned') return 'ВОЗВРАТНЫЙ ЧЕК'
  if (sale.status === 'partial') return 'ЧЕК · ЧАСТИЧНЫЙ ВОЗВРАТ'
  return 'ТОВАРНЫЙ ЧЕК'
}

/** Единственный шаблон чека — структура receipt-example.html */
export function buildPosReceiptHtml(sale: PosSale, opts?: PosReceiptPrintOpts): string {
  const storeCfg = loadReceiptStore()
  const storeName = esc((opts?.storeName || storeCfg.storeName || 'КАКАПО').trim() || 'КАКАПО')
  const storePhone = esc((opts?.storePhone ?? storeCfg.storePhone) || '')
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
    return `<div class="item">
    <div class="item-row">
      <span class="item-name">${esc(it.productName || `#${it.productId}`)}</span>
      <span>${money(sum)}</span>
    </div>
    <div class="item-qty">${qtyText(qty)} x ${shortMoney(price)}</div>
  </div>`
  }).join('\n')

  const balBefore = sale.bonusBalanceBefore
  const balAfter = sale.bonusBalanceAfter
  const showBalance = balBefore != null && balAfter != null
    && (Number.isFinite(Number(balBefore)) || Number.isFinite(Number(balAfter)))

  const meta = [
    row('Номер заказа', orderNo(sale)),
    sale.number != null ? row('Номер чека', `№${sale.number}`) : '',
    row('Дата', when),
    pos ? row('Касса', pos) : '',
    cashier ? row('Кассир', cashier) : '',
    sale.clientName ? row('Клиент', sale.clientName) : '',
    sale.clientPhone ? row('Тел. клиента', sale.clientPhone) : '',
  ].filter(Boolean).join('\n  ')

  const totals = [
    row('Сумма', money(subtotal)),
    discount > 0.001
      ? `<div class="row"><span>Скидка${discountPct > 0 ? ` ${discountPct}%` : ''}</span><span>-${money(discount)}</span></div>`
      : '',
    bonusEarned > 0.001
      ? `<div class="row"><span>Начислено бонусов</span><span>+${Math.floor(bonusEarned)}</span></div>`
      : '',
    bonusSpent > 0.001
      ? `<div class="row"><span>Списано бонусов</span><span>-${money(bonusSpent)}</span></div>`
      : '',
    `<div class="grand-total row"><span>ИТОГ</span><span>${money(total)}</span></div>`,
  ].filter(Boolean).join('\n    ')

  const payments = [
    row('Оплата', payLabel(sale)),
    moneyRow('Наличные', Number(sale.paidCash) || 0),
    moneyRow('Картой', Number(sale.paidCard) || 0),
    moneyRow('В долг', Number(sale.debtAdded) || 0),
    moneyRow('Дал клиент', Number(sale.cashReceived) || 0),
    moneyRow('Сдача', Number(sale.changeGiven) || 0, { bold: true }),
  ].filter(Boolean).join('\n    ')

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
  .title{font-size:20px;font-weight:800;letter-spacing:1px}
  .sub{font-size:12px}
  .line{border-top:1px dashed #000;margin:8px 0}
  .row{display:flex;justify-content:space-between;gap:8px}
  .row span:last-child{text-align:right;word-break:break-word}
  .item-row{display:flex;justify-content:space-between;margin-top:4px;gap:8px}
  .item-name{flex:1;word-break:break-word}
  .item-qty{color:#000;font-size:12px}
  .totals .row{margin:3px 0}
  .grand-total{font-size:16px;font-weight:800;margin:6px 0}
  .footer{margin-top:10px}
</style>
</head>
<body>
<div class="receipt">
  <div class="center title">${storeName}</div>
  <div class="center sub">магазин · касса</div>
  ${storePhone ? `<div class="center sub">${storePhone}</div>` : ''}

  <div class="line"></div>
  <div class="center bold">${esc(docTitle(sale))}</div>
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
    <div class="row"><span>Баланс бонусов</span><span>${Math.floor(Number(balBefore) || 0)} → ${Math.floor(Number(balAfter) || 0)}</span></div>
  </div>` : ''}

  <div class="line"></div>

  <div class="center footer">
    <div class="bold">Спасибо за покупку!</div>
    <div class="sub">Сохраняйте чек до проверки товара</div>
    <div class="sub" style="margin-top:6px;">www.kakapo.tj</div>
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

  const storeCfg = loadReceiptStore()
  const printOpts: PosReceiptPrintOpts = {
    ...opts,
    storeName: opts?.storeName || storeCfg.storeName,
    storePhone: opts?.storePhone ?? storeCfg.storePhone,
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

    // Plain JSON — чтобы IPC не потерял sale
    const salePayload = JSON.parse(JSON.stringify(sale)) as PosSale
    const payload = {
      printerName,
      sale: salePayload,
      storeName: printOpts.storeName,
      storePhone: printOpts.storePhone,
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
