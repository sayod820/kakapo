'use client'

import { useOfflineSync } from '@/lib/offlineSync'
import { QUEUE_KIND_LABEL } from '@/lib/offline'

const CSS = `
  .k-queue-back{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px}
  .k-queue{background:var(--panel);border:1px solid var(--border);border-radius:16px;width:min(560px,100%);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
  .k-queue-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}
  .k-queue-head .t{font-weight:900;font-size:16px}
  .k-queue-head .s{font-size:12px;color:var(--muted)}
  .k-queue-list{overflow:auto;padding:8px}
  .k-queue-row{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin:6px 0;background:var(--card)}
  .k-queue-row .k{font-weight:800}
  .k-queue-row .m{font-size:12px;color:var(--muted);margin-top:2px}
  .k-queue-row .e{font-size:12px;color:var(--red);margin-top:4px}
  .k-queue-row .a{display:flex;gap:8px;margin-top:8px}
  .k-queue-foot{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end}
  .k-queue-empty{padding:28px 16px;text-align:center;color:var(--muted);font-weight:700}
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

export default function OfflineQueuePanel({ onClose }: { onClose: () => void }) {
  const items = useOfflineSync(s => s.items)
  const syncing = useOfflineSync(s => s.syncing)
  const online = useOfflineSync(s => s.online)
  const retry = useOfflineSync(s => s.retry)
  const drop = useOfflineSync(s => s.drop)
  const syncNow = useOfflineSync(s => s.syncNow)

  const waiting = items.filter(i => !i.failed)
  const failed = items.filter(i => i.failed)

  return (
    <div className="k-queue-back" onClick={onClose}>
      <style>{CSS}</style>
      <div className="k-queue" onClick={e => e.stopPropagation()}>
        <div className="k-queue-head">
          <div>
            <div className="t">Очередь операций</div>
            <div className="s">
              {waiting.length > 0 ? `Ждут отправки: ${waiting.length}` : 'Всё отправлено'}
              {failed.length > 0 ? ` · требуют разбора: ${failed.length}` : ''}
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" onClick={onClose}>Закрыть</button>
        </div>

        <div className="k-queue-list">
          {items.length === 0 && <div className="k-queue-empty">Очередь пуста</div>}
          {items.map(row => (
            <div className="k-queue-row" key={row.clientRef}>
              <div className="k">{QUEUE_KIND_LABEL[row.kind] || row.kind}{amountOf(row.payload) ? ` · ${amountOf(row.payload)}` : ''}</div>
              <div className="m">{when(row.createdAtIso)}{row.failed ? ' · отклонено сервером' : ' · ждёт связи'}</div>
              {row.failed && !!row.lastError && <div className="e">{row.lastError}</div>}
              {row.failed && (
                <div className="a">
                  <button type="button" className="k-btn k-btn-s" onClick={() => void retry(row.clientRef)}>
                    Повторить
                  </button>
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    onClick={() => {
                      if (window.confirm('Убрать операцию из очереди? Она не попадёт на сервер.')) void drop(row.clientRef)
                    }}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="k-queue-foot">
          <button
            type="button"
            className="k-btn k-btn-s"
            disabled={syncing || !online}
            onClick={() => void syncNow()}
          >
            {syncing ? 'Синхронизация…' : 'Отправить сейчас'}
          </button>
        </div>
      </div>
    </div>
  )
}
