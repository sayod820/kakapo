'use client'

import type { StockRevision } from '@/lib/types'
import {
  canCancelRevision,
  revisionEffectiveStatus,
  revisionStatusColor,
  revisionStatusLabel,
} from '@/lib/revisionStatusUi'
import { fmtDateTime } from './warehouseShared'

type Props = {
  pending: StockRevision[]
  cancellingId?: string | null
  onCancel?: (id: string) => void
}

export default function RevisionQueuePanel({ pending, cancellingId, onCancel }: Props) {
  if (!pending.length) return null

  return (
    <div
      style={{
        margin: '0 0 12px',
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid rgba(255,193,7,.35)',
        background: 'rgba(255,193,7,.08)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, color: 'var(--gold)' }}>
        Очередь ревизий на сервере · {pending.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pending.map((rev, idx) => {
          const st = revisionEffectiveStatus(rev)
          return (
            <div
              key={rev.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                padding: '6px 8px',
                borderRadius: 8,
                background: 'rgba(0,0,0,.15)',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>#{idx + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtDateTime(rev.createdAtIso)}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: revisionStatusColor(st) }}>
                {revisionStatusLabel(st)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{rev.items.length} поз.</span>
              {rev.waitDevices?.length ? (
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  ждём {rev.waitDevices.length} устр.
                </span>
              ) : null}
              {rev.lastError ? (
                <span style={{ fontSize: 10, color: 'var(--red)', flex: '1 1 100%' }}>{rev.lastError}</span>
              ) : null}
              {onCancel && canCancelRevision(rev) ? (
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ marginLeft: 'auto', color: 'var(--red)', padding: '2px 8px', fontSize: 11 }}
                  disabled={cancellingId === rev.id}
                  onClick={() => onCancel(rev.id)}
                >
                  {cancellingId === rev.id ? '…' : 'Отменить'}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
