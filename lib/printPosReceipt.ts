import type { PosSale } from '@/lib/types'

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

function payLabel(sale: PosSale) {
  if (sale.paymentMethod === 'credit') return 'В долг'
  if (sale.paymentMethod === 'mixed') return 'Смешанная'
  if (sale.paymentMethod === 'cash') return 'Наличные'
  if (sale.paymentMethod === 'card') return 'Карта'
  if ((Number(sale.debtAdded) || 0) > 0.001) return 'В долг'
  return sale.paymentMethod || '—'
}

function receiptTitle(sale: PosSale) {
  const oid = String(sale.orderId || '').trim()
  if (oid) return oid
  if (sale.number) return `№${sale.number}`
  return sale.id || 'Чек'
}

export function printPosReceipt(
  sale: PosSale,
  opts?: { storeName?: string; posLabel?: string; cashierName?: string },
) {
  if (typeof window === 'undefined') return
  const store = esc(opts?.storeName || 'KAKAPO')
  const pos = esc(opts?.posLabel || '')
  const cashier = esc(opts?.cashierName || sale.cashierName || '')
  const when = sale.createdAtIso
    ? new Date(sale.createdAtIso).toLocaleString('ru-RU')
    : new Date().toLocaleString('ru-RU')

  const lines = (sale.items || []).map(it => {
    const qty = Number(it.qty) || 0
    const price = Number(it.price) || 0
    const sum = Number(it.lineTotal) || Math.round(price * qty * 100) / 100
    const q = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 1000) / 1000)
    return `<tr>
      <td class="n">${esc(it.productName || `#${it.productId}`)}</td>
      <td class="q">${q}×${money(price)}</td>
      <td class="s">${money(sum)}</td>
    </tr>`
  }).join('')

  const extras: string[] = []
  if ((Number(sale.paidCash) || 0) > 0.001) extras.push(`<div class="row"><span>Наличные</span><b>${money(Number(sale.paidCash))}</b></div>`)
  if ((Number(sale.paidCard) || 0) > 0.001) extras.push(`<div class="row"><span>Карта</span><b>${money(Number(sale.paidCard))}</b></div>`)
  if ((Number(sale.debtAdded) || 0) > 0.001) extras.push(`<div class="row"><span>В долг</span><b>${money(Number(sale.debtAdded))}</b></div>`)
  if ((Number(sale.cashReceived) || 0) > 0.001) extras.push(`<div class="row"><span>Дал клиент</span><b>${money(Number(sale.cashReceived))}</b></div>`)
  if ((Number(sale.changeGiven) || 0) > 0.001) extras.push(`<div class="row"><span>Сдача</span><b>${money(Number(sale.changeGiven))}</b></div>`)
  if (sale.note) extras.push(`<div class="note">${esc(sale.note)}</div>`)

  const w = window.open('', '_blank', 'width=420,height=720')
  if (!w) {
    window.alert('Разрешите всплывающие окна для печати чека')
    return
  }
  w.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Чек ${esc(receiptTitle(sale))}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Courier New',Courier,monospace;background:#fff;color:#111;padding:16px;width:80mm;max-width:100%}
  .shop{text-align:center;font-weight:900;font-size:16px;margin-bottom:2px}
  .meta{text-align:center;font-size:11px;color:#444;line-height:1.45;margin-bottom:10px}
  .sep{border:none;border-top:1px dashed #999;margin:8px 0}
  table{width:100%;border-collapse:collapse;font-size:12px}
  td{padding:3px 0;vertical-align:top}
  td.n{width:46%}
  td.q{width:34%;text-align:right;color:#333;white-space:nowrap}
  td.s{width:20%;text-align:right;font-weight:700;white-space:nowrap}
  .row{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin:3px 0}
  .total{display:flex;justify-content:space-between;font-size:15px;font-weight:900;margin-top:6px}
  .note{font-size:11px;margin-top:8px;color:#333;white-space:pre-wrap}
  .foot{text-align:center;font-size:11px;margin-top:12px;color:#555}
  @media print{body{padding:0;width:80mm}}
</style></head><body>
  <div class="shop">${store}</div>
  <div class="meta">
    ${pos ? `${pos}<br>` : ''}
    Чек ${esc(receiptTitle(sale))}<br>
    ${esc(when)}${cashier ? `<br>Кассир: ${cashier}` : ''}
    ${sale.clientName ? `<br>Клиент: ${esc(sale.clientName)}` : ''}
  </div>
  <hr class="sep"/>
  <table>${lines || '<tr><td colspan="3">Нет позиций</td></tr>'}</table>
  <hr class="sep"/>
  <div class="total"><span>Итого</span><span>${money(Number(sale.total) || 0)}</span></div>
  <div class="row"><span>Оплата</span><b>${esc(payLabel(sale))}</b></div>
  ${extras.join('')}
  <hr class="sep"/>
  <div class="foot">Спасибо за покупку!</div>
  <script>window.onload=function(){window.print()}</script>
</body></html>`)
  w.document.close()
}
