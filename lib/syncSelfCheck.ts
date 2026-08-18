/**
 * Самопроверка двустороннего синка (LWW / append / clientRef).
 * Вызов: import { runSyncSelfCheck } from '@/lib/syncSelfCheck'; runSyncSelfCheck()
 */
import { mergeAppendById, mergeByIdLww, mergeInboundById, shouldTakeRemoteLww } from './syncConflict'

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

  const ghosted = mergeAppendById(
    [
      { id: 'off-fin-1', amount: 200, type: 'deposit', createdAtIso: '2026-08-18T10:00:00.000Z', shiftId: 'SH-1' },
      { id: 'off-fin-keep', amount: 50, type: 'deposit', createdAtIso: '2026-08-18T10:00:00.000Z', shiftId: 'SH-1', clientRef: 'pending-ref' },
    ],
    [
      { id: 'FIN-1', amount: 200, type: 'deposit', createdAtIso: '2026-08-18T10:00:01.000Z', shiftId: 'SH-1', clientRef: 'ref-fin' },
    ],
  )
  checks.push({
    name: 'mergeAppendById: снимает локальный дубль вклада без clientRef',
    ok: !ghosted.some(s => s.id === 'off-fin-1')
      && ghosted.some(s => s.id === 'FIN-1')
      && ghosted.some(s => s.id === 'off-fin-keep'),
    detail: JSON.stringify(ghosted.map(s => s.id)),
  })

  const inbound = mergeInboundById(
    [
      { id: 'off-fin-new', clientRef: 'ref-b', amount: 50 },
      { id: 'FIN-gone', amount: 9 },
    ],
    [
      { id: 'FIN-1', clientRef: 'ref-b', amount: 50 },
    ],
  )
  checks.push({
    name: 'mergeInboundById: клеит pending и убирает удалённый серверный id',
    ok: inbound.some(s => s.id === 'FIN-1')
      && !inbound.some(s => s.id === 'off-fin-new')
      && !inbound.some(s => s.id === 'FIN-gone'),
    detail: JSON.stringify(inbound.map(s => s.id)),
  })

  const fresh = mergeInboundById(
    [{ id: 'FIN-fresh', clientRef: 'ref-c', amount: 80, createdAtIso: new Date().toISOString() }],
    [{ id: 'FIN-old', amount: 1, createdAtIso: '2026-01-01T00:00:00.000Z' }],
  )
  checks.push({
    name: 'mergeInboundById: свежий серверный id не пропадает, пока GET догоняет',
    ok: fresh.some(s => s.id === 'FIN-fresh') && fresh.some(s => s.id === 'FIN-old'),
    detail: JSON.stringify(fresh.map(s => s.id)),
  })

  const ok = checks.every(c => c.ok)
  return { ok, checks }
}
