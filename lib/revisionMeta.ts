/**
 * Метаданные ревизии для сервера: posCuts, waitDevices, sourceDeviceId.
 * Пока ± локально как раньше — сервер только получает и сохраняет поля.
 */
import { getPosOpSeqSnapshot } from './posOpSeq'
import { usePosStore } from './posStore'
import { getTradeDeviceBindSync, getTradeDeviceIdSync } from './tradeDevice'
import type { RevisionPosCut, RevisionWaitDevice } from './types'

export function deviceParticipatesInRevision(device: { revisionParticipationDefault?: boolean }): boolean {
  return device.revisionParticipationDefault !== false
}

export function buildRevisionPosCuts(): RevisionPosCut[] {
  const byKey = new Map<string, RevisionPosCut>()

  function set(posId: string, lastSeq: number, deviceId?: string) {
    const pid = String(posId || '').trim()
    const seq = Math.max(0, Math.floor(Number(lastSeq) || 0))
    if (!pid || seq <= 0) return
    const did = String(deviceId || '').trim()
    const key = did ? `${pid}::${did}` : pid
    const prev = byKey.get(key)
    if (!prev || seq > prev.lastSeq) {
      byKey.set(key, { posId: pid, ...(did ? { deviceId: did } : {}), lastSeq: seq })
    }
  }

  for (const [k, raw] of Object.entries(getPosOpSeqSnapshot())) {
    const sep = k.indexOf('::')
    if (sep >= 0) set(k.slice(0, sep), Number(raw), k.slice(sep + 2))
    else set(k, Number(raw))
  }

  try {
    for (const p of usePosStore.getState().posPoints || []) {
      set(String(p.id || ''), Number(p.opSeq) || 0)
    }
    for (const s of usePosStore.getState().sales || []) {
      set(String(s.posId || ''), Number(s.opSeq) || 0, s.deviceId)
    }
  } catch { /* ignore */ }

  return [...byKey.values()]
}

export function buildRevisionWaitDevices(): RevisionWaitDevice[] {
  const out: RevisionWaitDevice[] = []
  try {
    for (const point of usePosStore.getState().posPoints || []) {
      const posId = String(point.id || '').trim()
      if (!posId) continue
      for (const device of point.devices || []) {
        const deviceId = String(device.id || '').trim()
        if (!deviceId || !deviceParticipatesInRevision(device)) continue
        out.push({
          posId,
          deviceId,
          label: `${point.name || posId} · ${device.name || deviceId}`,
        })
      }
    }
  } catch { /* ignore */ }

  if (out.length === 0) {
    const bind = getTradeDeviceBindSync()
    const deviceId = getTradeDeviceIdSync()
    const posId = String(bind?.posId || '').trim()
    if (posId && deviceId) {
      out.push({
        posId,
        deviceId,
        label: `${bind?.posName || posId} · ${bind?.deviceName || deviceId}`,
      })
    }
  }

  return out
}

export type RevisionSubmitMeta = {
  sourceDeviceId: string
  waitDevices: RevisionWaitDevice[]
  posCuts: RevisionPosCut[]
  submittedAtIso: string
}

export function buildRevisionSubmitMeta(): RevisionSubmitMeta {
  return {
    sourceDeviceId: getTradeDeviceIdSync(),
    waitDevices: buildRevisionWaitDevices(),
    posCuts: buildRevisionPosCuts(),
    submittedAtIso: new Date().toISOString(),
  }
}

/** Поля ревизии для POST/PUT — без items (их мапят отдельно) */
export function revisionApiFieldsFromPayload(p: Record<string, unknown>) {
  return {
    clientRef: p.clientRef as string | undefined,
    createdAtIso: p.createdAtIso as string | undefined,
    submittedAtIso: p.submittedAtIso as string | undefined,
    createdBy: p.createdBy as string | undefined,
    note: p.note as string | undefined,
    sourceDeviceId: p.sourceDeviceId as string | undefined,
    waitDevices: p.waitDevices as RevisionWaitDevice[] | undefined,
    posCuts: p.posCuts as RevisionPosCut[] | undefined,
  }
}
