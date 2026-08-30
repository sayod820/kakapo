/**
 * Координатор ревизий v2: очередь по времени, ожидание устройств (heartbeat).
 */
import {
  ensurePosCollections,
  sumProductLayers,
  setProductStockExact,
} from './posLogic.js'

function getProduct(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) throw new Error(`Товар #${productId} не найден`)
  return product
}

function nowIso() {
  return new Date().toISOString()
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const PENDING_STATUSES = new Set(['pending_queues', 'pending_older', 'applying'])

export function isRevisionV2Payload(data = {}) {
  return Array.isArray(data.waitDevices)
}

export function ensureDeviceRuntime(db) {
  if (!db.deviceRuntime || typeof db.deviceRuntime !== 'object') db.deviceRuntime = {}
  return db.deviceRuntime
}

export function recordDeviceHeartbeat(db, payload = {}) {
  ensurePosCollections(db)
  const deviceId = String(payload.deviceId || '').trim()
  const posId = String(payload.posId || '').trim()
  if (!deviceId || !posId) throw new Error('deviceId и posId обязательны')

  const rt = ensureDeviceRuntime(db)
  const stamp = String(payload.sentAtIso || nowIso())
  rt[deviceId] = {
    deviceId,
    posId,
    deviceName: String(payload.deviceName || '').trim() || undefined,
    queueLen: Math.max(0, Math.floor(Number(payload.queueLen) || 0)),
    queueFailed: Math.max(0, Math.floor(Number(payload.queueFailed) || 0)),
    queueFlushed: !!payload.queueFlushed,
    lastOpSeqByKey: payload.lastOpSeqByKey && typeof payload.lastOpSeqByKey === 'object'
      ? payload.lastOpSeqByKey
      : {},
    lastHeartbeatAtIso: stamp,
  }

  const point = (db.posPoints || []).find(p => String(p.id) === posId)
  if (point) {
    for (const d of point.devices || []) {
      if (String(d.id) === deviceId) {
        d.lastSeenAtIso = stamp
        break
      }
    }
    point.updatedAtIso = nowIso()
  }

  return rt[deviceId]
}

export function listDeviceStatuses(db) {
  ensurePosCollections(db)
  ensureDeviceRuntime(db)
  const out = []
  for (const point of db.posPoints || []) {
    const posId = String(point.id || '')
    for (const device of point.devices || []) {
      const deviceId = String(device.id || '')
      if (!deviceId) continue
      const rt = db.deviceRuntime[deviceId] || {}
      const hb = Date.parse(rt.lastHeartbeatAtIso || device.lastSeenAtIso || '') || 0
      const online = hb > 0 && (Date.now() - hb) < 3 * 60 * 1000
      out.push({
        deviceId,
        posId,
        deviceName: device.name,
        online,
        queueLen: Number(rt.queueLen) || 0,
        queueFlushed: !!rt.queueFlushed,
        lastHeartbeatAtIso: rt.lastHeartbeatAtIso || device.lastSeenAtIso,
        revisionParticipationDefault: device.revisionParticipationDefault !== false,
      })
    }
  }
  return out
}

function revisionSortKey(rev) {
  return String(rev.createdAtIso || rev.submittedAtIso || '')
}

function compareRevisionOrder(a, b) {
  const ta = revisionSortKey(a)
  const tb = revisionSortKey(b)
  if (ta !== tb) return ta.localeCompare(tb)
  return String(a.id || '').localeCompare(String(b.id || ''))
}

function isPendingRevision(rev) {
  return PENDING_STATUSES.has(String(rev.status || ''))
}

function allWaitDevicesReady(db, waitDevices) {
  if (!Array.isArray(waitDevices) || !waitDevices.length) return true
  ensureDeviceRuntime(db)
  for (const w of waitDevices) {
    const deviceId = String(w.deviceId || '').trim()
    const posId = String(w.posId || '').trim()
    if (!deviceId || !posId) return false
    const rt = db.deviceRuntime[deviceId]
    if (!rt) return false
    if (String(rt.posId) !== posId) return false
    if ((Number(rt.queueLen) || 0) > 0) return false
    if (!rt.queueFlushed) return false
  }
  return true
}

function normalizePendingItems(db, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : []
  if (!items.length) throw new Error('Нет строк для ревизии')
  return items.map(raw => {
    const product = getProduct(db, raw.productId)
    if (raw.countedStock === '' || raw.countedStock == null || !Number.isFinite(Number(raw.countedStock))) {
      throw new Error(`Укажите фактическое количество: ${product.name}`)
    }
    const countedStock = round2(raw.countedStock)
    const liveNow = sumProductLayers(db, product.id)
    const frozen = Number.isFinite(Number(raw.systemStock)) ? round2(raw.systemStock) : liveNow
    return {
      productId: product.id,
      productName: product.name,
      systemStock: frozen,
      countedStock,
      diff: round2(countedStock - frozen),
    }
  })
}

function applyRevisionRow(db, row) {
  const createdBy = String(row.createdBy || '').trim()
  const applied = []
  for (const it of row.items || []) {
    const productId = Number(it.productId)
    const liveNow = sumProductLayers(db, productId)
    const frozen = round2(Number(it.systemStock) || 0)
    const counted = round2(Number(it.countedStock) || 0)
    const delta = round2(counted - frozen)
    const target = Math.max(0, round2(liveNow + delta))
    setProductStockExact(db, productId, target, { reason: 'Ревизия', createdBy })
    applied.push({
      ...it,
      diff: delta,
      stockBefore: liveNow,
    })
  }
  row.items = applied
  row.status = 'done'
  row.appliedAtIso = nowIso()
  row.serverAtIso = row.appliedAtIso
  delete row.lastError
}

export function enqueueStockRevisionV2(db, data = {}, extras = {}) {
  ensurePosCollections(db)
  const items = normalizePendingItems(db, data.items)
  const row = {
    id: extras.id || nextId('REV'),
    clientRef: extras.clientRef || data.clientRef,
    createdAtIso: String(data.createdAtIso || nowIso()),
    submittedAtIso: String(data.submittedAtIso || nowIso()),
    createdBy: String(data.createdBy || '').trim(),
    note: String(data.note || '').trim(),
    items,
    status: 'pending_queues',
    waitDevices: Array.isArray(data.waitDevices) ? data.waitDevices : [],
    posCuts: Array.isArray(data.posCuts) ? data.posCuts : [],
    sourceDeviceId: String(data.sourceDeviceId || '').trim() || undefined,
  }
  db.stockRevisions.unshift(row)
  return row
}

export function processRevisionQueue(db) {
  ensurePosCollections(db)
  let changed = false
  const STALE_MS = 12 * 60 * 60 * 1000
  const list = [...(db.stockRevisions || [])]
    .filter(isPendingRevision)
    .sort(compareRevisionOrder)

  for (const rev of list) {
    const submittedAt = Date.parse(String(rev.submittedAtIso || rev.createdAtIso || '')) || 0
    if (submittedAt > 0 && (Date.now() - submittedAt) > STALE_MS) {
      rev.status = 'failed'
      rev.lastError = 'Ревизия слишком долго ждала устройства — отмените или проведите снова'
      changed = true
      continue
    }

    const hasOlder = (db.stockRevisions || []).some(r =>
      r.id !== rev.id
      && isPendingRevision(r)
      && compareRevisionOrder(r, rev) < 0,
    )
    if (hasOlder) {
      if (rev.status !== 'pending_older') {
        rev.status = 'pending_older'
        changed = true
      }
      continue
    }

    const waitList = Array.isArray(rev.waitDevices) ? rev.waitDevices : []
    if (waitList.length && !allWaitDevicesReady(db, waitList)) {
      if (rev.status !== 'pending_queues') {
        rev.status = 'pending_queues'
        changed = true
      }
      continue
    }

    if (rev.status !== 'applying') {
      rev.status = 'applying'
      changed = true
    }
    try {
      applyRevisionRow(db, rev)
      changed = true
    } catch (e) {
      rev.status = 'failed'
      rev.lastError = e?.message || 'Ошибка применения ревизии'
      changed = true
    }
  }

  return changed
}

export function cancelStockRevision(db, id) {
  ensurePosCollections(db)
  const rev = (db.stockRevisions || []).find(r => String(r.id) === String(id))
  if (!rev) throw new Error('Ревизия не найдена')
  const st = String(rev.status || 'done')
  if (st === 'done') throw new Error('Ревизия уже применена — удалите через архив')
  if (st === 'cancelled') return rev
  if (st === 'applying') throw new Error('Ревизия применяется — подождите')
  rev.status = 'cancelled'
  rev.cancelledAtIso = nowIso()
  delete rev.lastError
  return rev
}

export function listRevisionQueue(db) {
  ensurePosCollections(db)
  return [...(db.stockRevisions || [])]
    .filter(isPendingRevision)
    .sort(compareRevisionOrder)
    .map(rev => ({
      id: rev.id,
      createdAtIso: rev.createdAtIso,
      submittedAtIso: rev.submittedAtIso,
      status: rev.status,
      note: rev.note,
      waitDevices: rev.waitDevices,
      itemCount: Array.isArray(rev.items) ? rev.items.length : 0,
    }))
}
