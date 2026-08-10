/**
 * Самопроверка двустороннего синка (LWW / append / clientRef).
 * Вызов: import { runSyncSelfCheck } from '@/lib/syncSelfCheck'; runSyncSelfCheck()
 */
import { mergeAppendById, mergeByIdLww, shouldTakeRemoteLww } from './syncConflict'

export type SelfCheckResult = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }

export function runSyncSelfCheck(): SelfCheckResult {
  const checks: SelfCheckResult['checks'] = []

  const lwwOlder = shouldTakeRemoteLww(
    { id: 1, name: 'A', updatedAtIso: '2026-01-01T10:00:00.000Z' },
    { id: 1, name: 'B', updatedAtIso: '2026-01-02T10:00:00.000Z' },
  )
  checks.push({ name: 'LWW берёт более новый remote', ok: lwwOlder === true })

  const lwwKeep = shouldTakeRemoteLww(
    { id: 1, name: 'A', updatedAtIso: '2026-01-03T10:00:00.000Z' },
    { id: 1, name: 'B', updatedAtIso: '2026-01-02T10:00:00.000Z' },
  )
  checks.push({ name: 'LWW сохраняет более новый local', ok: lwwKeep === false })

  const merged = mergeByIdLww(
    [
      { id: 1, name: 'Local', updatedAtIso: '2026-01-01T00:00:00.000Z' },
      { id: 2, name: 'OnlyLocal', updatedAtIso: '2026-01-01T00:00:00.000Z' },
    ],
    [
      { id: 1, name: 'Remote', updatedAtIso: '2026-01-02T00:00:00.000Z' },
      { id: 3, name: 'OnlyRemote', updatedAtIso: '2026-01-02T00:00:00.000Z' },
    ],
  )
  const m1 = merged.find(x => x.id === 1)
  const m2 = merged.find(x => x.id === 2)
  const m3 = merged.find(x => x.id === 3)
  checks.push({
    name: 'mergeByIdLww: remote wins + local-only + remote-only',
    ok: m1?.name === 'Remote' && m2?.name === 'OnlyLocal' && m3?.name === 'OnlyRemote',
    detail: JSON.stringify(merged.map(x => ({ id: x.id, name: x.name }))),
  })

  const sales = mergeAppendById(
    [
      { id: 'local-1', clientRef: 'ref-a', total: 10 },
      { id: 'local-2', total: 20 },
    ],
    [
      { id: 'srv-1', clientRef: 'ref-a', total: 10 },
      { id: 'srv-3', total: 30 },
    ],
  )
  const hasLocalGhost = sales.some(s => s.id === 'local-1')
  const hasSrv = sales.some(s => s.id === 'srv-1' && s.clientRef === 'ref-a')
  const hasLocalOnly = sales.some(s => s.id === 'local-2')
  checks.push({
    name: 'mergeAppendById: clientRef заменяет локальный id',
    ok: !hasLocalGhost && hasSrv && hasLocalOnly && sales.some(s => s.id === 'srv-3'),
    detail: JSON.stringify(sales.map(s => s.id)),
  })

  const ok = checks.every(c => c.ok)
  return { ok, checks }
}
