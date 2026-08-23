import type { StockRevision, StockRevisionStatus } from './types'

const PENDING: StockRevisionStatus[] = ['pending_queues', 'pending_older', 'applying']

export function revisionEffectiveStatus(rev: StockRevision | null | undefined): StockRevisionStatus | 'done' {
  if (!rev) return 'done'
  return rev.status || 'done'
}

export function revisionAwaitingServer(rev: StockRevision | null | undefined): boolean {
  const st = revisionEffectiveStatus(rev)
  return PENDING.includes(st as StockRevisionStatus)
}

export function canCancelRevision(rev: StockRevision | null | undefined): boolean {
  if (!rev) return false
  const st = revisionEffectiveStatus(rev)
  return st === 'pending_queues' || st === 'pending_older' || st === 'failed'
}

export function revisionStatusLabel(status?: StockRevisionStatus | 'done' | null): string {
  switch (status) {
    case 'pending_queues': return 'Ждём устройства'
    case 'pending_older': return 'Ждём ревизию раньше'
    case 'applying': return 'Применяем…'
    case 'failed': return 'Ошибка'
    case 'cancelled': return 'Отменена'
    case 'draft': return 'Черновик'
    case 'done':
    default: return 'Готово'
  }
}

export function revisionStatusColor(status?: StockRevisionStatus | 'done' | null): string {
  switch (status) {
    case 'pending_queues':
    case 'pending_older': return 'var(--gold)'
    case 'applying': return '#3B8EF0'
    case 'failed': return 'var(--red)'
    case 'cancelled': return 'var(--muted)'
    case 'done':
    default: return 'var(--green)'
  }
}

export function sortRevisionsByQueue(revisions: StockRevision[]): StockRevision[] {
  return [...revisions].sort((a, b) => {
    const ta = String(a.createdAtIso || a.submittedAtIso || '')
    const tb = String(b.createdAtIso || b.submittedAtIso || '')
    return ta.localeCompare(tb)
  })
}

export function listPendingRevisions(revisions: StockRevision[]): StockRevision[] {
  return sortRevisionsByQueue(revisions.filter(revisionAwaitingServer))
}
