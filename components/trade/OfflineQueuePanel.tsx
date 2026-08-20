'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOfflineSync } from '@/lib/offlineSync'
import { QUEUE_KIND_LABEL, type PendingOp } from '@/lib/offline'
import { productBarcodes } from '@/lib/productBarcodes'
import { useProducts } from '@/lib/store'

const CSS = `
  .k-queue-back{
    position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;
    display:flex;align-items:center;justify-content:center;padding:16px;
  }
  .k-queue{
    background:var(--panel);border:1px solid var(--border);border-radius:16px;
    width:min(620px,100%);max-height:85vh;display:flex;flex-direction:column;
    overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .k-queue-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .k-queue-head .t{font-weight:900;font-size:16px}
  .k-queue-head .s{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.4}
  .k-queue-sec{padding:10px 12px 4px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .k-queue-list{overflow:auto;padding:4px 8px 8px;flex:1}
  .k-queue-row{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin:6px 0;background:var(--card)}
  .k-queue-row[data-failed="1"]{border-color:rgba(255,90,90,.35);background:rgba(255,90,90,.05)}
  .k-queue-row .k{font-weight:800}
  .k-queue-row .m{font-size:12px;color:var(--muted);margin-top:2px}
  .k-queue-row .d{font-size:12px;margin-top:4px;line-height:1.35}
  .k-queue-row .e{font-size:12px;color:var(--red);margin-top:4px;line-height:1.45;white-space:pre-wrap;word-break:break-word;user-select:text}
  .k-queue-row .a{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .k-queue-foot{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
  .k-queue-empty{padding:36px 16px;text-align:center;color:var(--muted);font-weight:700}
  .k-queue-badge{display:inline-block;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px;vertical-align:middle}
  .k-queue-badge.wait{background:rgba(59,142,240,.15);color:#3B8EF0}
  .k-queue-badge.fail{background:rgba(255,90,90,.15);color:var(--red)}
`

function when(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function amountOf(payload: any): string {
  const value = Number(payload?.total ?? payload?.amount ?? payload?.cash ?? payload?.openingCash ?? payload?.closingCash)
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} ЅМ` : ''
}

function detailOf(row: PendingOp): string {
  const p = row.payload as any
  if (!p || typeof p !== 'object') return ''
  if (row.kind === 'sale') {
    const n = p.number ?? p.orderNumber ?? p.orderSeq
    const client = p.clientName || p.clientPhone || ''
    const items = Array.isArray(p.items) ? p.items.length : 0
    const parts = [
      n != null && n !== '' ? `№${n}` : '',
      items > 0 ? `${items} поз.` : '',
      client ? String(client) : '',
    ].filter(Boolean)
    return parts.join(' · ')
  }
  if (row.kind === 'sale_return') {
    return p.saleNumber || p.orderId || p.saleId || ''
  }
  if (row.kind === 'product_upsert' || row.kind === 'product_delete') {
    return p.name || p.barcode || p.sku || ''
  }
  if (row.kind === 'client_upsert' || row.kind === 'client_delete') {
    return [p.name, p.phone].filter(Boolean).join(' · ')
  }
  if (row.kind === 'expense_create') {
    return p.title || p.comment || p.category || ''
  }
  if (String(row.kind).startsWith('stock_')) {
    return p.comment || p.supplierName || p.note || ''
  }
  return p.name || p.title || p.comment || ''
}

function parseMoneyToken(raw: string): number {
  const n = Number(String(raw || '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

/** Старые ошибки «по цене X» — дополняем артикулом / названием / штрихкодом из чека */
function enrichQueueError(row: PendingOp, catalog: { id: number; name?: string; barcode?: string; barcodes?: string[] }[]): string {
  const err = String(row.lastError || '').trim()
  if (!err) return ''
  if (/арт\.\s*\d+/i.test(err) || /штрих\s+\S+/i.test(err) || /«[^»]+»/.test(err)) return err

  const priceMatch = err.match(/по цене\s+([\d.,]+)/i)
  if (!priceMatch) return err
  const price = parseMoneyToken(priceMatch[1])
  if (!Number.isFinite(price)) return err

  const items = Array.isArray((row.payload as any)?.items) ? (row.payload as any).items as any[] : []
  if (!items.length) return err

  const needMatch = err.match(/нужно\s+([\d.,]+)/i)
  const need = needMatch ? parseMoneyToken(needMatch[1]) : NaN

  const hits = items.filter(it => {
    const layerPrice = it.preferRetailPrice != null ? Number(it.preferRetailPrice) : NaN
    const linePrice = Number(it.price)
    const matchLayer = Number.isFinite(layerPrice) && Math.abs(layerPrice - price) < 0.005
    const matchLine = Number.isFinite(linePrice) && Math.abs(linePrice - price) < 0.005
    return matchLayer || matchLine
  })
  if (!hits.length) return err

  let hit = hits[0]
  if (Number.isFinite(need) && hits.length > 1) {
    const byQty = hits.find(it => Math.abs(Number(it.qty) - need) < 0.005)
    if (byQty) hit = byQty
  }

  const pid = Number(hit.productId)
  const fromCatalog = Number.isFinite(pid) && pid > 0
    ? catalog.find(p => Number(p.id) === pid)
    : undefined
  const name = String(hit.productName || fromCatalog?.name || '').trim() || (pid ? `#${pid}` : 'товар')
  const barcode = String(
    hit.barcode
    || (Array.isArray(hit.barcodes) && hit.barcodes[0])
    || (fromCatalog ? productBarcodes(fromCatalog)[0] : '')
    || '',
  ).trim()

  const parts = [
    Number.isFinite(pid) && pid > 0 ? `арт. ${pid}` : '',
    `«${name}»`,
    barcode ? `штрих ${barcode}` : '',
  ].filter(Boolean)
  return `${parts.join(' · ')}: ${err}`
}

export default function OfflineQueuePanel({ onClose }: { onClose: () => void }) {
  const items = useOfflineSync(s => s.items)
  const syncing = useOfflineSync(s => s.syncing)
  const online = useOfflineSync(s => s.online)
  const lastError = useOfflineSync(s => s.lastError)
  const forceSync = useOfflineSync(s => s.forceSync)
  const refresh = useOfflineSync(s => s.refresh)
  const products = useProducts(s => s.products)
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  /** Не закрывать по клику на фон в том же жесте, что открыл окно */
  const [canCloseBackdrop, setCanCloseBackdrop] = useState(false)

  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => setCanCloseBackdrop(true), 280)
    void refresh()
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [refresh])

  const waiting = items.filter(i => !i.failed)
  const failed = items.filter(i => i.failed)

  async function sendOne(row: PendingOp) {
    if (syncing || busyRef) return
    setBusyRef(row.clientRef)
    try {
      await forceSync({ clientRef: row.clientRef })
    } finally {
      setBusyRef(null)
      await refresh()
    }
  }

  async function sendAll() {
    if (syncing || busyRef) return
    setBusyRef('__all__')
    try {
      await forceSync()
    } finally {
      setBusyRef(null)
      await refresh()
    }
  }

  function renderRow(row: PendingOp) {
    const amt = amountOf(row.payload)
    const detail = detailOf(row)
    const errText = row.failed ? enrichQueueError(row, products) : ''
    const isBusy = syncing || busyRef === row.clientRef || busyRef === '__all__'
    return (
      <div className="k-queue-row" key={row.clientRef} data-failed={row.failed ? '1' : '0'}>
        <div className="k">
          {QUEUE_KIND_LABEL[row.kind] || row.kind}
          {amt ? ` · ${amt}` : ''}
          <span className={`k-queue-badge ${row.failed ? 'fail' : 'wait'}`}>
            {row.failed ? 'ошибка' : 'ждёт'}
          </span>
        </div>
        <div className="m">
          {when(row.createdAtIso)}
          {row.failed ? ' · повтор при следующей отправке' : ' · ещё не на сервере'}
          {row.attempts > 0 ? ` · попыток: ${row.attempts}` : ''}
        </div>
        {!!detail && <div className="d">{detail}</div>}
        {!!errText && <div className="e">{errText}</div>}
        <div className="a">
          <button
            type="button"
            className="k-btn k-btn-g"
            disabled={isBusy}
            onClick={() => void sendOne(row)}
          >
            {busyRef === row.clientRef ? 'Отправка…' : 'Отправить сейчас'}
          </button>
        </div>
      </div>
    )
  }

  const forcing = syncing || busyRef === '__all__'

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="k-queue-back"
      onMouseDown={e => {
        if (!canCloseBackdrop) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <style>{CSS}</style>
      <div className="k-queue" onMouseDown={e => e.stopPropagation()}>
        <div className="k-queue-head">
          <div>
            <div className="t">Очередь синхронизации</div>
            <div className="s">
              {waiting.length > 0 ? `Ждут отправки: ${waiting.length}` : 'Нет ожидающих'}
              {failed.length > 0 ? ` · повторим сами: ${failed.length}` : ''}
              {online ? ' · связь есть' : ' · нет связи с сервером'}
              {lastError ? ` · ${lastError}` : ''}
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" onClick={onClose}>Закрыть</button>
        </div>

        <div className="k-queue-list">
          {items.length === 0 && (
            <div className="k-queue-empty">
              Очередь пуста — всё уже на сервере
            </div>
          )}

          {failed.length > 0 && (
            <>
              <div className="k-queue-sec">Ошибка — отправим снова</div>
              {failed.map(renderRow)}
            </>
          )}

          {waiting.length > 0 && (
            <>
              <div className="k-queue-sec">Ждут отправки</div>
              {waiting.map(renderRow)}
            </>
          )}
        </div>

        <div className="k-queue-foot">
          <button
            type="button"
            className="k-btn k-btn-s"
            disabled={forcing || !!busyRef}
            onClick={() => void refresh()}
          >
            Обновить список
          </button>
          <button
            type="button"
            className="k-btn k-btn-g"
            disabled={forcing || !!busyRef || items.length === 0}
            onClick={() => void sendAll()}
          >
            {forcing ? 'Принудительная отправка…' : 'Принудительно отправить всё'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
