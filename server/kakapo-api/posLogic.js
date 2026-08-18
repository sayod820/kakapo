import { nextOrderId } from './seed.js'
import { stampOrderForClient } from './accountLifecycle.js'
import { findClientByPhone } from './loyaltyBonus.js'
import { appendMoneyLedger } from './financeTruth.js'
import {
  addDebtCharge,
  applyDebtRepayment,
  canTakeNewDebt,
} from './debtLedger.js'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function effectiveDebt(a, b) {
  return round2(Math.max(0, Number(a && a.debt) || 0, Number(b && b.debt) || 0))
}

function nowIso() {
  return new Date().toISOString()
}

/** Время события с кассы: если ушло из офлайна — не подменять временем сервера. */
function stampFromClient(data, field) {
  const raw = data && data[field]
  const clientRef = String((data && data.clientRef) || '').trim()
  if (clientRef && raw && !Number.isNaN(Date.parse(raw))) {
    return new Date(raw).toISOString()
  }
  return nowIso()
}

function nowTimeLocal() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dushanbe',
  })
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function shiftExpectedCash(shift) {
  return round2(
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    + (Number(shift.cashInTotal) || 0)
    - (Number(shift.expenseTotal) || 0),
  )
}

/** Открытая смена: сначала по posId, иначе любая. */
function findOpenShift(db, posId) {
  const opens = (db.posShifts || []).filter(s => s.status === 'open')
  if (!opens.length) return null
  const want = String(posId || '').trim()
  if (want) {
    const match = opens.find(s => String(s.posId || '') === want)
    if (match) return match
  }
  return opens[0]
}

export function ensurePosCollections(db) {
  if (!Array.isArray(db.cashiers)) db.cashiers = []
  if (!Array.isArray(db.posShifts)) db.posShifts = []
  if (!Array.isArray(db.posSales)) db.posSales = []
  if (!Array.isArray(db.stockReceipts)) db.stockReceipts = []
  if (!Array.isArray(db.writeOffs)) db.writeOffs = []
  if (!Array.isArray(db.stockRevisions)) db.stockRevisions = []
  if (!Array.isArray(db.suppliers)) db.suppliers = []
  if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
  if (!Array.isArray(db.expenses)) db.expenses = []
  if (!Array.isArray(db.financeMoves)) db.financeMoves = []
  if (!Array.isArray(db.moneyLedger)) db.moneyLedger = []
  if (!Array.isArray(db.posPoints)) db.posPoints = []
  if (!Array.isArray(db.revokedPosDevices)) db.revokedPosDevices = []
  if (!db.cashVault || typeof db.cashVault !== 'object') {
    db.cashVault = { cashTotal: 0, cardTotal: 0, transfers: [] }
  }
  if (!Array.isArray(db.cashVault.transfers)) db.cashVault.transfers = []
  if (!Array.isArray(db.cashVault.converts)) db.cashVault.converts = []
  if (db.cashVault.cashTotal == null) db.cashVault.cashTotal = 0
  if (db.cashVault.cardTotal == null) db.cashVault.cardTotal = 0
  if (!db._seq || typeof db._seq !== 'object') db._seq = {}
  ensureDefaultPosPoint(db)
}

const DEFAULT_POS_ID = 'POS-DEFAULT'

function ensureDefaultPosPoint(db) {
  if (!db.posPoints.length) {
    db.posPoints.push({
      id: DEFAULT_POS_ID,
      name: 'Магазин · Ленина 42',
      code: 'Касса №1 · KAKAPO',
      note: '',
      active: true,
      opSeq: 0,
      devices: [],
      createdAtIso: nowIso(),
    })
  }
  for (const p of db.posPoints) {
    if (p.opSeq == null || !Number.isFinite(Number(p.opSeq))) p.opSeq = 0
  }
  const fallbackId = db.posPoints[0]?.id || DEFAULT_POS_ID
  for (const s of db.posShifts) {
    if (!s.posId) s.posId = fallbackId
  }
  for (const s of db.posSales) {
    if (!s.posId) s.posId = fallbackId
  }
}

export function listPosPoints(db) {
  ensurePosCollections(db)
  return [...db.posPoints]
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
    .map(publicPosPoint)
}

export function publicPosPoint(row) {
  if (!row) return row
  const devices = Array.isArray(row.devices)
    ? row.devices.map(d => ({
      id: String(d.id || ''),
      name: String(d.name || 'Устройство'),
      boundAtIso: String(d.boundAtIso || ''),
      lastSeenAtIso: d.lastSeenAtIso ? String(d.lastSeenAtIso) : undefined,
    })).filter(d => d.id)
    : []
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    note: row.note,
    receiptPhone: row.receiptPhone,
    active: row.active !== false,
    opSeq: Number(row.opSeq) || 0,
    createdAtIso: row.createdAtIso,
    updatedAtIso: row.updatedAtIso,
    devices,
  }
}

function ensurePointDevices(row) {
  if (!Array.isArray(row.devices)) row.devices = []
  return row.devices
}

export function createPosPoint(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Укажите название точки продаж')
  const n = db.posPoints.length + 1
  const code = String(data.code || '').trim() || `Касса №${n} · KAKAPO`
  const row = {
    id: nextId('POS'),
    name,
    code,
    note: String(data.note || '').trim(),
    receiptPhone: String(data.receiptPhone || '').trim(),
    active: data.active !== false,
    opSeq: 0,
    devices: [],
    createdAtIso: nowIso(),
    updatedAtIso: nowIso(),
  }
  db.posPoints.push(row)
  return publicPosPoint(row)
}

export function updatePosPoint(db, id, data = {}) {
  ensurePosCollections(db)
  const row = db.posPoints.find(p => p.id === id)
  if (!row) throw new Error('Точка продаж не найдена')
  if (data.name != null) {
    const name = String(data.name).trim()
    if (!name) throw new Error('Укажите название')
    row.name = name
  }
  if (data.code != null) row.code = String(data.code).trim()
  if (data.note != null) row.note = String(data.note).trim()
  if (data.receiptPhone != null) row.receiptPhone = String(data.receiptPhone).trim()
  if (data.active != null) row.active = !!data.active
  row.updatedAtIso = nowIso()
  return publicPosPoint(row)
}

const PAIR_TTL_MS = 5 * 60 * 1000

function randomPairCode(db) {
  for (let i = 0; i < 40; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000))
    const taken = (db.posPoints || []).some(p => {
      const pc = p.pairCode
      if (!pc || String(pc.code) !== code) return false
      return Date.parse(pc.expiresAtIso || '') > Date.now()
    })
    if (!taken) return code
  }
  return String(1000 + Math.floor(Math.random() * 9000))
}

export function createPosPairCode(db, posId) {
  ensurePosCollections(db)
  const row = db.posPoints.find(p => p.id === posId)
  if (!row) throw new Error('Точка продаж не найдена')
  if (row.active === false) throw new Error('Точка отключена')
  const expiresAtIso = new Date(Date.now() + PAIR_TTL_MS).toISOString()
  const code = randomPairCode(db)
  row.pairCode = { code, expiresAtIso }
  row.updatedAtIso = nowIso()
  return { posId: row.id, name: row.name, code, expiresAtIso }
}

export function bindPosDevice(db, data = {}) {
  ensurePosCollections(db)
  const code = String(data.code || '').replace(/\D/g, '').slice(0, 4)
  const deviceId = String(data.deviceId || '').trim()
  const deviceName = String(data.deviceName || 'Устройство').trim() || 'Устройство'
  if (code.length !== 4) throw new Error('Введите 4-значный код из админки')
  if (!deviceId) throw new Error('Нет кода устройства')

  const now = Date.now()
  const row = (db.posPoints || []).find(p => {
    const pc = p.pairCode
    return pc && String(pc.code) === code && Date.parse(pc.expiresAtIso || '') > now
  })
  if (!row) throw new Error('Код неверный или уже истек. Возьмите новый в админке.')
  if (row.active === false) throw new Error('Точка отключена')

  db.revokedPosDevices = (db.revokedPosDevices || []).filter(d => String(d.id) !== deviceId)

  for (const p of db.posPoints || []) {
    const list = ensurePointDevices(p)
    const idx = list.findIndex(d => String(d.id) === deviceId)
    if (idx >= 0 && p.id !== row.id) list.splice(idx, 1)
  }

  const devices = ensurePointDevices(row)
  const nameTaken = devices.some(d =>
    String(d.id) !== deviceId
    && String(d.name || '').trim().toLowerCase() === deviceName.toLowerCase(),
  )
  if (nameTaken) throw new Error('На этой точке уже есть устройство с таким именем. Назовите иначе.')
  const existing = devices.find(d => String(d.id) === deviceId)
  const stamp = nowIso()
  if (existing) {
    existing.name = deviceName
    existing.lastSeenAtIso = stamp
  } else {
    devices.push({
      id: deviceId,
      name: deviceName,
      boundAtIso: stamp,
      lastSeenAtIso: stamp,
    })
  }
  row.pairCode = null
  row.updatedAtIso = stamp
  const device = devices.find(d => String(d.id) === deviceId)
  return {
    point: publicPosPoint(row),
    device,
  }
}

export function renamePosDevice(db, posId, deviceId, name) {
  ensurePosCollections(db)
  const row = db.posPoints.find(p => p.id === posId)
  if (!row) throw new Error('Точка продаж не найдена')
  const id = String(deviceId || '').trim()
  const nextName = String(name || '').trim()
  if (!nextName) throw new Error('Укажите имя устройства')
  const taken = ensurePointDevices(row).some(d =>
    String(d.id) !== id && String(d.name || '').trim().toLowerCase() === nextName.toLowerCase(),
  )
  if (taken) throw new Error('На этой точке уже есть устройство с таким именем')
  const device = ensurePointDevices(row).find(d => String(d.id) === id)
  if (!device) throw new Error('Устройство не найдено')
  device.name = nextName
  row.updatedAtIso = nowIso()
  return publicPosPoint(row)
}

export function unbindPosDevice(db, posId, deviceId) {
  ensurePosCollections(db)
  const row = db.posPoints.find(p => p.id === posId)
  if (!row) throw new Error('Точка продаж не найдена')
  const id = String(deviceId || '').trim()
  row.devices = ensurePointDevices(row).filter(d => String(d.id) !== id)
  if (id) {
    const list = db.revokedPosDevices || []
    if (!list.some(d => String(d.id) === id)) {
      list.push({ id, posId: String(posId), unboundAtIso: nowIso() })
    }
    db.revokedPosDevices = list.slice(-500)
  }
  row.updatedAtIso = nowIso()
  return publicPosPoint(row)
}

export function checkPosDevice(db, deviceId) {
  ensurePosCollections(db)
  const id = String(deviceId || '').trim()
  if (!id) return { ok: false }
  if ((db.revokedPosDevices || []).some(d => String(d.id) === id)) return { ok: false }
  for (const p of db.posPoints || []) {
    if (p.active === false) continue
    const device = ensurePointDevices(p).find(d => String(d.id) === id)
    if (!device) continue
    device.lastSeenAtIso = nowIso()
    return { ok: true, point: publicPosPoint(p), device }
  }
  return { ok: false }
}

export function deletePosPoint(db, id) {
  ensurePosCollections(db)
  const idx = db.posPoints.findIndex(p => p.id === id)
  if (idx < 0) throw new Error('Точка продаж не найдена')
  const open = db.posShifts.find(s => s.posId === id && s.status === 'open')
  if (open) throw new Error('Сначала закройте сессию на этой кассе')
  const activeCount = db.posPoints.filter(p => p.active !== false).length
  const row = db.posPoints[idx]
  if (row.active !== false && activeCount <= 1) {
    throw new Error('Нельзя удалить последнюю точку продаж')
  }
  db.posPoints.splice(idx, 1)
  return { id }
}

/** Присвоить сквозные номера старым чекам. true = были изменения. */
export function ensurePosSaleNumbers(db) {
  ensurePosCollections(db)
  const sales = db.posSales || []
  let max = Math.max(0, Number(db._seq.posSale) || 0)
  for (const s of sales) {
    const n = Number(s.number)
    if (n > max) max = n
  }
  const need = sales
    .filter(s => !(Number(s.number) > 0))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  if (!need.length) {
    db._seq.posSale = max
    return false
  }
  for (const s of need) {
    max += 1
    s.number = max
  }
  db._seq.posSale = max
  return true
}

function nextPosSaleNumber(db) {
  ensurePosSaleNumbers(db)
  const n = (Number(db._seq.posSale) || 0) + 1
  db._seq.posSale = n
  return n
}

function snapshotPosCuts(db) {
  const last = {}
  const cutKey = (posId, deviceId) => `${posId}\t${deviceId || ''}`
  for (const p of db.posPoints || []) {
    const id = String(p.id || '')
    if (!id) continue
    last[cutKey(id, '')] = { posId: id, deviceId: '', lastSeq: Math.max(0, Number(p.opSeq) || 0) }
    for (const d of p.devices || []) {
      const did = String(d.id || '')
      if (!did) continue
      last[cutKey(id, did)] = { posId: id, deviceId: did, lastSeq: 0 }
    }
  }
  for (const s of db.posSales || []) {
    const id = String(s.posId || '')
    if (!id) continue
    const did = String(s.deviceId || '')
    const seq = Number(s.opSeq) || 0
    const key = cutKey(id, did)
    const cur = last[key] || { posId: id, deviceId: did, lastSeq: 0 }
    if (seq > (cur.lastSeq || 0)) cur.lastSeq = seq
    last[key] = cur
  }
  return Object.values(last)
}

function bumpPosOpSeq(db, posId, seq) {
  const id = String(posId || '').trim()
  const n = Math.max(0, Math.floor(Number(seq) || 0))
  if (!id || n <= 0) return
  const point = (db.posPoints || []).find(p => String(p.id) === id)
  if (point) point.opSeq = Math.max(Number(point.opSeq) || 0, n)
}

function allocSaleOpSeq(db, posId, clientSeq, deviceId) {
  const id = String(posId || '').trim()
  const dev = String(deviceId || '').trim()
  let max = 0
  if (!dev) {
    const point = (db.posPoints || []).find(p => String(p.id) === id)
    if (point) max = Math.max(max, Number(point.opSeq) || 0)
  }
  for (const s of db.posSales || []) {
    if (String(s.posId || '') !== id) continue
    if (String(s.deviceId || '') !== dev) continue
    const n = Number(s.opSeq) || 0
    if (n > max) max = n
  }
  const fromClient = Math.max(0, Math.floor(Number(clientSeq) || 0))
  if (fromClient > 0) {
    const taken = (db.posSales || []).some(
      s => String(s.posId || '') === id
        && String(s.deviceId || '') === dev
        && Number(s.opSeq) === fromClient,
    )
    if (!taken) {
      bumpPosOpSeq(db, id, Math.max(max, fromClient))
      return fromClient
    }
  }
  const seq = max + 1
  bumpPosOpSeq(db, id, seq)
  return seq
}

function stockRowsWithoutConsume(db, items) {
  return items.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    const unitCost = Number(product.costPrice) || 0
    return {
      product,
      qty,
      cogs: round2(unitCost * qty),
      receiptId: String(raw.receiptId || '').trim(),
      preferRetailPrice: null,
    }
  })
}

/** Офлайн-чек после ревизии: номер выше среза. Судья — opSeq, не часы кассы.
 *  queuedOffline: чек лежал в очереди без сети; ревизия уже поправила остаток. */
function shouldSkipSaleStock(db, posId, opSeq, productIds, deviceId, queuedOffline) {
  if (!queuedOffline) return null
  const ids = new Set((productIds || []).map(n => Number(n)).filter(n => n > 0))
  if (!ids.size || !(Number(opSeq) > 0)) return null
  const dev = String(deviceId || '')
  for (const rev of db.stockRevisions || []) {
    const cuts = Array.isArray(rev.posCuts) ? rev.posCuts : []
    if (!cuts.length) continue
    const overlap = (rev.items || []).some(it => ids.has(Number(it.productId)))
    if (!overlap) continue
    const cut = cuts.find(c =>
      String(c.posId) === String(posId)
      && String(c.deviceId || '') === dev,
    ) || (!dev ? cuts.find(c => String(c.posId) === String(posId)) : null)
    const lastSeq = Number(cut?.lastSeq) || 0
    if (!(Number(opSeq) > lastSeq)) continue
    return { revisionId: String(rev.id || '') }
  }
  return null
}

function getProduct(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) throw new Error(`Товар #${productId} не найден`)
  return product
}

function getClientById(db, clientId) {
  return (db.clients || []).find(c => String(c.id) === String(clientId)) || null
}

function cardNumDigits(num) {
  return String(num || '').replace(/\D/g, '')
}

function getCardByNum(db, cardNum) {
  const key = String(cardNum || '').trim().toUpperCase()
  if (!key) return null
  const cards = db.cards || []
  const exact = cards.find(c => String(c.num || '').trim().toUpperCase() === key)
  if (exact) return exact
  const digits = cardNumDigits(key)
  if (!digits) return null
  return cards.find(c => cardNumDigits(c.num) === digits) || null
}

function getClientByCard(db, card) {
  if (!card) return null
  if (card.clientId) {
    const byId = getClientById(db, card.clientId)
    if (byId) return byId
  }
  if (card.phone) {
    const byPhone = findClientByPhone(db, card.phone)
    if (byPhone) return byPhone
  }
  const digits = cardNumDigits(card.num)
  if (!digits) return null
  return (db.clients || []).find(c => cardNumDigits(c.card) === digits) || null
}

/** Клиент и карта чека: id / телефон / номер карты, в обе стороны. */
function resolveSaleClientAndCard(db, sale) {
  let client = getClientById(db, sale.clientId)
    || (sale.clientPhone ? findClientByPhone(db, sale.clientPhone) : null)
  let card = getCardByNum(db, sale.cardNum)
    || (client?.card ? getCardByNum(db, client.card) : null)
  if (!client && card) client = getClientByCard(db, card)
  if (!card && client) {
    card = getCardByNum(db, client.card)
      || (db.cards || []).find(c =>
        String(c.clientId || '') === String(client.id) && c.status !== 'unlinked')
      || null
  }
  return { client, card }
}

function applyDebtToPair(client, card, nextDebt) {
  const d = Math.max(0, round2(nextDebt))
  if (client) {
    client.debt = d
    if (d > 0) client.debtEnabled = true
  }
  if (card) {
    card.debt = d
    if (d > 0) card.debtEnabled = true
  }
}

function syncSupplierPayable(supplier) {
  if (!supplier) return supplier
  supplier.payableAmount = round2(Math.max(0, (supplier.totalSupplied || 0) - (supplier.totalPaid || 0)))
  return supplier
}

function updateSupplierDebt(db, supplierId, receiptTotal, paidNow) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  supplier.totalSupplied = round2((supplier.totalSupplied || 0) + receiptTotal)
  supplier.totalPaid = round2((supplier.totalPaid || 0) + Math.max(0, round2(paidNow)))
  syncSupplierPayable(supplier)
  supplier.lastDeliveryAtIso = nowIso()
  return supplier
}

function normalizeBulkPricing(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(t => ({
      minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)),
      price: round2(t.price),
    }))
    .filter(t => t.minQty > 0 && t.price > 0)
    .sort((a, b) => a.minQty - b.minQty)
}

function getActiveStockLayer(db, productId) {
  ensurePosCollections(db)
  const receipts = [...(db.stockReceipts || [])].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (!(Number(item.remainingQty) > 0)) continue
      return { receipt, item }
    }
  }
  return null
}

function syncProductPricingFromActiveLayer(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) return
  const active = getActiveStockLayer(db, productId)
  if (!active) return
  const item = active.item
  const retail = round2(item.retailPrice ?? product.price)
  if (retail > 0) product.price = retail
  const cost = round2(item.costPrice)
  if (cost > 0) product.costPrice = cost
  const bulk = normalizeBulkPricing(item.bulkPricing)
  if (bulk.length) product.bulkPricing = bulk
  else delete product.bulkPricing
}

export function listProductStockLayers(db, productId) {
  ensurePosCollections(db)
  const layers = []
  const receipts = [...(db.stockReceipts || [])].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  let queueIndex = 0
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      const remainingQty = round2(item.remainingQty)
      if (!(remainingQty > 0)) continue
      layers.push({
        receiptId: receipt.id,
        productId: Number(item.productId),
        productName: item.productName,
        qty: round2(item.qty),
        remainingQty,
        costPrice: round2(item.costPrice),
        retailPrice: round2(item.retailPrice),
        bulkPricing: normalizeBulkPricing(item.bulkPricing),
        expiryDate: item.expiryDate || null,
        createdAtIso: receipt.createdAtIso,
        supplierName: receipt.supplierName || '',
        queueIndex,
        isActive: queueIndex === 0,
      })
      queueIndex += 1
    }
  }
  return layers
}

/** Все открытые партии склада — один проход по приходам (не O(products × receipts)). */
export function listAllOpenStockLayers(db) {
  ensurePosCollections(db)
  const receipts = [...(db.stockReceipts || [])].sort((a, b) =>
    String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')),
  )
  /** @type {Map<number, any[]>} */
  const byProduct = new Map()
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      const remainingQty = round2(item.remainingQty)
      if (!(remainingQty > 0)) continue
      const productId = Number(item.productId)
      let list = byProduct.get(productId)
      if (!list) {
        list = []
        byProduct.set(productId, list)
      }
      const queueIndex = list.length
      list.push({
        receiptId: receipt.id,
        productId,
        productName: item.productName,
        qty: round2(item.qty),
        remainingQty,
        costPrice: round2(item.costPrice),
        retailPrice: round2(item.retailPrice),
        bulkPricing: normalizeBulkPricing(item.bulkPricing),
        expiryDate: item.expiryDate || null,
        createdAtIso: receipt.createdAtIso,
        supplierName: receipt.supplierName || '',
        queueIndex,
        isActive: queueIndex === 0,
      })
    }
  }
  const out = []
  for (const list of byProduct.values()) {
    for (const layer of list) out.push(layer)
  }
  return out
}

/**
 * Единственный источник правды по остатку — сумма открытых партий (FIFO).
 * product.stock — кэш этой суммы для кассы/магазина/сборщика.
 */
export function sumProductLayers(db, productId) {
  ensurePosCollections(db)
  let sum = 0
  for (const receipt of db.stockReceipts || []) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      sum = round2(sum + (Number(item.remainingQty) || 0))
    }
  }
  return round2(sum)
}

function hasStockLayerHistory(db, productId) {
  for (const receipt of db.stockReceipts || []) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) === Number(productId)) return true
    }
  }
  return false
}

export function syncProductStock(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) return 0
  const sum = sumProductLayers(db, productId)
  product.stock = sum
  syncProductPricingFromActiveLayer(db, productId)
  return sum
}

function createStockAdjustmentLayer(db, product, qty, meta = {}) {
  const add = round2(qty)
  if (!(add > 0)) return null
  const costPrice = round2(meta.costPrice ?? product.costPrice ?? 0)
  const retailPrice = round2(meta.retailPrice ?? product.price ?? 0)
  const receipt = {
    id: nextId('REC'),
    supplierId: null,
    supplierName: String(meta.reason || 'Корректировка остатка'),
    createdAtIso: meta.createdAtIso || nowIso(),
    serverAtIso: nowIso(),
    createdBy: String(meta.createdBy || '').trim(),
    stockAdjustment: true,
    totalCost: round2(add * costPrice),
    paidNow: 0,
    debtAdded: 0,
    items: [{
      productId: product.id,
      productName: product.name,
      qty: add,
      remainingQty: add,
      costPrice,
      retailPrice,
      expiryDate: null,
    }],
  }
  db.stockReceipts.unshift(receipt)
  return receipt
}

/** Привести партии к точному количеству (ревизия / ручная правка). */
export function setProductStockExact(db, productId, targetQty, meta = {}) {
  ensurePosCollections(db)
  const product = getProduct(db, productId)
  const target = Math.max(0, round2(targetQty))
  const current = sumProductLayers(db, product.id)
  const diff = round2(target - current)
  if (diff > 0) restoreReceiptBalances(db, product.id, diff, meta)
  else if (diff < 0) consumeReceiptBalances(db, product.id, Math.abs(diff))
  return syncProductStock(db, product.id)
}

export function reconcileAllProductStock(db, meta = {}) {
  ensurePosCollections(db)
  const fixed = []
  for (const product of db.products || []) {
    const before = round2(product.stock)
    if (before > 0 && !hasStockLayerHistory(db, product.id)) {
      createStockAdjustmentLayer(db, product, before, {
        reason: 'Перенос остатка',
        createdBy: meta.createdBy || 'system',
      })
    }
    const after = syncProductStock(db, product.id)
    if (Math.abs(after - before) > 0.0001) {
      fixed.push({ id: product.id, name: product.name, before, after })
    }
  }
  return fixed
}

export function addProductStockLayer(db, productId, data = {}) {
  ensurePosCollections(db)
  const product = getProduct(db, productId)
  const qty = round2(data.qty)
  const costPrice = round2(data.costPrice)
  const retailPrice = round2(data.retailPrice ?? product.price)
  const bulkPricing = normalizeBulkPricing(data.bulkPricing)
  if (!(qty > 0)) throw new Error('Укажите количество прихода')
  const receipt = {
    id: nextId('REC'),
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || '',
    createdAtIso: nowIso(),
    createdBy: String(data.createdBy || '').trim(),
    totalCost: round2(qty * costPrice),
    paidNow: round2(data.paidNow),
    debtAdded: 0,
    items: [{
      productId: product.id,
      productName: product.name,
      qty,
      remainingQty: qty,
      costPrice,
      retailPrice,
      bulkPricing: bulkPricing.length ? bulkPricing : undefined,
      expiryDate: data.expiryDate || null,
    }],
  }
  db.stockReceipts.unshift(receipt)
  syncProductStock(db, product.id)
  return { receipt, layers: listProductStockLayers(db, product.id) }
}

export function updateProductStockLayer(db, receiptId, productId, patch = {}) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === receiptId)
  if (!receipt) throw new Error('Приход не найден')
  const item = (receipt.items || []).find(i => Number(i.productId) === Number(productId))
  if (!item) throw new Error('Партия не найдена')
  if (!(Number(item.remainingQty) > 0)) throw new Error('Партия уже израсходована')
  if (patch.retailPrice != null) item.retailPrice = round2(patch.retailPrice)
  if (patch.costPrice != null) item.costPrice = round2(patch.costPrice)
  if (patch.bulkPricing != null) {
    const bulk = normalizeBulkPricing(patch.bulkPricing)
    if (bulk.length) item.bulkPricing = bulk
    else delete item.bulkPricing
  }
  if (patch.expiryDate !== undefined) item.expiryDate = patch.expiryDate || null
  syncProductPricingFromActiveLayer(db, productId)
  return listProductStockLayers(db, productId)
}

/** Удалить одну партию (позицию прихода). Если в приходе больше ничего нет — удаляет весь приход. */
export function deleteProductStockLayer(db, receiptId, productId) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === receiptId)
  if (!receipt) throw new Error('Приход не найден')
  const itemIdx = (receipt.items || []).findIndex(i => Number(i.productId) === Number(productId))
  if (itemIdx < 0) throw new Error('Партия не найдена')
  const item = receipt.items[itemIdx]
  if (!(Number(item.remainingQty) > 0)) throw new Error('Партия уже израсходована')

  const itemsLeft = (receipt.items || []).filter((_, i) => i !== itemIdx)
  if (!itemsLeft.length) {
    reverseStockReceipt(db, receipt)
    return {
      receiptId,
      productId: Number(productId),
      deletedReceipt: true,
      layers: listProductStockLayers(db, productId),
    }
  }

  const oldTotal = round2(receipt.totalCost)
  const oldDebt = round2(receipt.debtAdded)
  const oldPaid = round2(receipt.paidNow)
  if (receipt.supplierId) {
    reverseSupplierDebt(db, receipt.supplierId, oldTotal, oldDebt)
  }

  receipt.items = itemsLeft
  const newTotal = round2(itemsLeft.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.costPrice) || 0),
    0,
  ))
  const newPaid = round2(Math.min(oldPaid, newTotal))
  receipt.totalCost = newTotal
  receipt.paidNow = newPaid
  receipt.debtAdded = round2(Math.max(0, newTotal - newPaid))

  if (receipt.supplierId) {
    updateSupplierDebt(db, receipt.supplierId, newTotal, newPaid)
  }

  syncProductStock(db, productId)
  syncProductPricingFromActiveLayer(db, productId)
  return {
    receiptId,
    productId: Number(productId),
    deletedReceipt: false,
    layers: listProductStockLayers(db, productId),
  }
}

function consumeReceiptBalances(db, productId, qty, preferReceiptId = '', preferRetailPrice = null) {
  let left = round2(qty)
  let cogs = 0
  const retailKey = preferRetailPrice != null && Number.isFinite(Number(preferRetailPrice))
    ? round2(preferRetailPrice)
    : null

  const receipts = (db.stockReceipts || [])
    .filter(r => Array.isArray(r.items) && r.items.some(i => {
      if (Number(i.productId) !== Number(productId)) return false
      if (!(Number(i.remainingQty) > 0)) return false
      if (retailKey == null) return true
      return round2(i.retailPrice) === retailKey
    }))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))

  if (preferReceiptId && retailKey == null) {
    const target = (db.stockReceipts || []).find(r => r.id === preferReceiptId)
    if (!target) throw new Error('Выбранная партия не найдена')
    const item = (target.items || []).find(i => Number(i.productId) === Number(productId))
    const rem = round2(item?.remainingQty)
    if (!(rem >= left)) {
      throw new Error(`В выбранной партии осталось ${rem || 0} — нужно ${left}`)
    }
  }

  if (retailKey != null) {
    const pool = round2(receipts.reduce((s, r) => {
      const item = (r.items || []).find(i => Number(i.productId) === Number(productId))
      return s + (Number(item?.remainingQty) || 0)
    }, 0))
    if (!(pool >= left)) {
      throw new Error(`По цене ${retailKey.toFixed(2)} осталось ${pool} — нужно ${left}`)
    }
  }

  const ordered = preferReceiptId && retailKey == null
    ? [
        ...receipts.filter(r => r.id === preferReceiptId),
        ...receipts.filter(r => r.id !== preferReceiptId),
      ]
    : receipts

  for (const receipt of ordered) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (left <= 0) break
      if (preferReceiptId && retailKey == null && receipt.id !== preferReceiptId) continue
      if (retailKey != null && round2(item.retailPrice) !== retailKey) continue
      const take = Math.min(Number(item.remainingQty) || 0, left)
      if (!(take > 0)) continue
      const unitCost = Number(item.costPrice) || 0
      cogs = round2(cogs + take * unitCost)
      item.remainingQty = round2((Number(item.remainingQty) || 0) - take)
      left = round2(left - take)
    }
  }
  if ((preferReceiptId || retailKey != null) && left > 0.0001) {
    throw new Error(retailKey != null
      ? 'Недостаточно остатка по выбранной цене'
      : 'Недостаточно остатка в выбранной партии')
  }
  if (left > 0.0001) {
    throw new Error('Недостаточно остатка по партиям')
  }
  syncProductPricingFromActiveLayer(db, productId)
  return cogs
}

function restoreReceiptBalance(db, productId, qty, receiptId = '') {
  const add = round2(qty)
  if (!(add > 0)) return
  if (receiptId) {
    const receipt = (db.stockReceipts || []).find(r => r.id === receiptId)
    const item = receipt?.items?.find(i => Number(i.productId) === Number(productId))
    if (item) {
      item.remainingQty = round2((Number(item.remainingQty) || 0) + add)
      syncProductStock(db, productId)
      return
    }
  }
  restoreReceiptBalances(db, productId, add, { reason: 'Возврат товара' })
}

/**
 * Снимок остатков партий по товарам — чтобы откатить частичное списание,
 * если многострочная операция упала на середине (касса, заказ, списание).
 */
export function snapshotProductLayers(db, productIds) {
  ensurePosCollections(db)
  const ids = new Set([...productIds].map(Number))
  const rows = []
  for (const receipt of db.stockReceipts || []) {
    for (const item of receipt.items || []) {
      if (!ids.has(Number(item.productId))) continue
      rows.push({ item, remainingQty: item.remainingQty, qty: item.qty })
    }
  }
  return { ids: [...ids], rows, receiptCount: (db.stockReceipts || []).length }
}

export function rollbackProductLayers(db, snapshot) {
  if (!snapshot) return
  // Слои, добавленные во время упавшей операции, лежат в начале списка
  const extra = (db.stockReceipts || []).length - snapshot.receiptCount
  if (extra > 0) db.stockReceipts.splice(0, extra)
  for (const row of snapshot.rows) {
    row.item.remainingQty = row.remainingQty
    row.item.qty = row.qty
  }
  for (const id of snapshot.ids) syncProductStock(db, id)
}

function consumeStock(db, items) {
  const planned = new Map()
  const normalized = items.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    const alreadyPlanned = planned.get(product.id) || 0
    const available = round2(sumProductLayers(db, product.id) - alreadyPlanned)
    if (available < qty) throw new Error(`Недостаточно остатка: ${product.name} (есть ${available})`)
    planned.set(product.id, round2(alreadyPlanned + qty))
    const receiptId = String(raw.receiptId || '').trim()
    const preferRetailPrice = raw.preferRetailPrice != null && Number.isFinite(Number(raw.preferRetailPrice))
      ? round2(raw.preferRetailPrice)
      : null
    return { product, qty, cogs: 0, receiptId, preferRetailPrice }
  })
  // Всё или ничего: иначе первая позиция уже списана, а на второй ошибка
  const snapshot = snapshotProductLayers(db, normalized.map(r => r.product.id))
  try {
    for (const row of normalized) {
      row.cogs = consumeReceiptBalances(db, row.product.id, row.qty, row.receiptId, row.preferRetailPrice)
      syncProductStock(db, row.product.id)
    }
  } catch (e) {
    rollbackProductLayers(db, snapshot)
    throw e
  }
  return normalized
}

/** Списание остатка по FIFO (онлайн-заказ, касса и т.п.). */
export function deductStockLines(db, items) {
  return consumeStock(db, items)
}

/** Возврат остатка в партии (отмена заказа / правка состава). */
export function restoreStockLines(db, items, reason = 'Возврат на склад') {
  for (const raw of items || []) {
    const qty = round2(raw.qty)
    if (!(qty > 0)) continue
    const productId = Number(raw.productId)
    if (!productId) continue
    restoreReceiptBalances(db, productId, qty, { reason })
  }
}

export function listCashiers(db) {
  ensurePosCollections(db)
  return db.cashiers
}

export function createCashier(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  const pin = String(data.pin || '').trim()
  if (!name) throw new Error('Укажите имя кассира')
  if (pin.length < 4) throw new Error('PIN должен быть не короче 4 символов')
  const row = {
    id: nextId('CASHIER'),
    name,
    pin,
    active: data.active !== false,
    salesCount: 0,
    salesTotal: 0,
    createdAtIso: nowIso(),
  }
  db.cashiers.unshift(row)
  return row
}

export function updateCashier(db, id, patch = {}) {
  ensurePosCollections(db)
  const row = db.cashiers.find(x => x.id === id)
  if (!row) throw new Error('Кассир не найден')
  Object.assign(row, patch)
  row.name = String(row.name || '').trim()
  row.pin = String(row.pin || '').trim()
  return row
}

export function listPosShifts(db) {
  ensurePosCollections(db)
  return [...db.posShifts].sort((a, b) => String(b.openedAtIso || '').localeCompare(String(a.openedAtIso || '')))
}

export function openPosShift(db, data = {}) {
  ensurePosCollections(db)
  const cashier = data.cashierId ? db.cashiers.find(c => c.id === data.cashierId) : null
  if (!cashier) throw new Error('Кассир не найден')
  const named = String(data.cashierName || '').trim()
  if (named && named !== cashier.name && !/^кассир$/i.test(named)) {
    cashier.name = named
  }
  const posId = String(data.posId || '').trim() || (db.posPoints[0]?.id || DEFAULT_POS_ID)
  const pos = db.posPoints.find(p => p.id === posId)
  if (!pos || pos.active === false) throw new Error('Точка продаж не найдена')
  const openOnPos = db.posShifts.find(s => s.posId === posId && s.status === 'open')
  if (openOnPos) throw new Error('На этой точке продаж уже открыта сессия')
  const existing = db.posShifts.find(s => s.cashierId === cashier.id && s.status === 'open')
  if (existing) throw new Error('У кассира уже открыта смена')
  const cashierName = named || String(cashier.name || '').trim() || 'Кассир'
  const openedAtIso = stampFromClient(data, 'openedAtIso')
  const row = {
    id: nextId('SHIFT'),
    posId,
    cashierId: cashier.id,
    cashierName,
    openedAtIso,
    closedAtIso: null,
    openingCash: round2(data.openingCash),
    closingCash: null,
    salesCash: 0,
    salesCard: 0,
    salesCredit: 0,
    salesCount: 0,
    expenseTotal: 0,
    cashInTotal: 0,
    status: 'open',
    note: String(data.note || '').trim(),
  }
  db.posShifts.unshift(row)
  // Разменный фонд уже в кассе — в книгу не добавляем (иначе баланс растёт на каждое открытие)
  appendMoneyLedger(db, {
    type: 'shift_open',
    amount: row.openingCash,
    direction: 'info',
    cashAffect: false,
    signedAmount: 0,
    posId,
    shiftId: row.id,
    cashierId: cashier.id,
    cashierName,
    refType: 'shift',
    refId: row.id,
    reason: 'Открытие смены · разменный фонд',
    note: row.note,
    createdAtIso: openedAtIso,
  })
  return row
}

export function closePosShift(db, id, data = {}) {
  ensurePosCollections(db)
  const row = db.posShifts.find(s => s.id === id)
  if (!row) throw new Error('Смена не найдена')
  if (row.status === 'closed') {
    // идемпотентность: уже закрыта — только убедимся, что сдача в ящик есть
    transferClosedShiftToVault(db, row)
    return row
  }
  const expectedCash = round2(
    (Number(row.openingCash) || 0)
    + (Number(row.salesCash) || 0)
    + (Number(row.cashInTotal) || 0)
    - (Number(row.expenseTotal) || 0),
  )
  const actualCash = round2(data.closingCash)
  const cashDiff = round2(actualCash - expectedCash)
  row.status = 'closed'
  row.closedAtIso = stampFromClient(data, 'closedAtIso')
  row.closingCash = actualCash
  row.expectedCash = expectedCash
  row.actualCash = actualCash
  row.cashDiff = cashDiff
  row.note = String(data.note || row.note || '').trim()
  appendMoneyLedger(db, {
    type: 'shift_close',
    amount: Math.abs(cashDiff),
    direction: 'info',
    cashAffect: false,
    signedAmount: cashDiff,
    posId: row.posId || '',
    shiftId: row.id,
    cashierId: row.cashierId,
    cashierName: row.cashierName,
    refType: 'shift',
    refId: row.id,
    reason: Math.abs(cashDiff) < 0.009
      ? 'Сверка кассы · без расхождения'
      : cashDiff < 0
        ? `Недостача ${Math.abs(cashDiff).toFixed(2)} сом`
        : `Излишек ${cashDiff.toFixed(2)} сом`,
    note: row.note,
    meta: { expectedCash, actualCash, cashDiff },
    createdAtIso: row.closedAtIso,
  })
  transferClosedShiftToVault(db, row)
  return row
}

/** Сдача закрытой смены в основной ящик (нал факт + карта). Идемпотентно по shiftId. */
export function transferClosedShiftToVault(db, shift) {
  ensurePosCollections(db)
  if (!shift || shift.status !== 'closed') return null
  const shiftId = String(shift.id || '')
  if (!shiftId) return null
  if ((db.cashVault.transfers || []).some(t => String(t.shiftId) === shiftId)) return null

  const cashAmount = round2(
    shift.actualCash != null ? shift.actualCash : (shift.closingCash != null ? shift.closingCash : 0),
  )
  const cardAmount = round2(Number(shift.salesCard) || 0)
  const transfer = {
    id: nextId('VTR'),
    shiftId,
    posId: shift.posId || '',
    closedAtIso: shift.closedAtIso || nowIso(),
    cashAmount,
    cardAmount,
    cashierId: shift.cashierId || '',
    cashierName: shift.cashierName || '',
    note: shift.note || '',
  }
  db.cashVault.transfers.unshift(transfer)
  db.cashVault.cashTotal = round2((Number(db.cashVault.cashTotal) || 0) + cashAmount)
  db.cashVault.cardTotal = round2((Number(db.cashVault.cardTotal) || 0) + cardAmount)

  if (cashAmount > 0.001) {
    appendMoneyLedger(db, {
      type: 'vault_cash_in',
      amount: cashAmount,
      direction: 'in',
      cashAffect: false,
      posId: transfer.posId,
      shiftId,
      cashierId: transfer.cashierId,
      cashierName: transfer.cashierName,
      refType: 'vault_transfer',
      refId: transfer.id,
      reason: 'Сдача смены · нал в основной',
    })
  }
  if (cardAmount > 0.001) {
    appendMoneyLedger(db, {
      type: 'vault_card_in',
      amount: cardAmount,
      direction: 'in',
      cashAffect: false,
      posId: transfer.posId,
      shiftId,
      cashierId: transfer.cashierId,
      cashierName: transfer.cashierName,
      refType: 'vault_transfer',
      refId: transfer.id,
      reason: 'Сдача смены · карта в основной',
    })
  }
  return transfer
}

export function getCashVault(db) {
  ensurePosCollections(db)
  return {
    cashTotal: round2(db.cashVault.cashTotal),
    cardTotal: round2(db.cashVault.cardTotal),
    transfers: [...(db.cashVault.transfers || [])].sort((a, b) =>
      String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')),
    ),
    converts: [...(db.cashVault.converts || [])].sort((a, b) =>
      String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')),
    ),
  }
}

/** Карта → нал: сначала основной ящик, потом открытые смены. */
export function convertVaultCardToCash(db, data = {}) {
  ensurePosCollections(db)
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  const openShifts = (db.posShifts || []).filter(s => s.status === 'open')
  const mainCard = round2(db.cashVault.cardTotal)
  const openCard = round2(openShifts.reduce((a, s) => a + (Number(s.salesCard) || 0), 0))
  const available = round2(mainCard + openCard)
  if (amount > available + 0.009) {
    throw new Error(`На карте только ${available.toFixed(2)} сом`)
  }

  let left = amount
  const fromMain = Math.min(left, mainCard)
  if (fromMain > 0.001) {
    db.cashVault.cardTotal = round2(mainCard - fromMain)
    db.cashVault.cashTotal = round2((Number(db.cashVault.cashTotal) || 0) + fromMain)
    left = round2(left - fromMain)
  }

  const fromShifts = []
  for (const s of openShifts) {
    if (left <= 0.001) break
    const have = round2(Number(s.salesCard) || 0)
    if (!(have > 0.001)) continue
    const take = Math.min(left, have)
    s.salesCard = round2(have - take)
    s.cashInTotal = round2((Number(s.cashInTotal) || 0) + take)
    fromShifts.push({ shiftId: s.id, posId: s.posId || '', amount: take })
    left = round2(left - take)
  }

  const row = {
    id: nextId('VCC'),
    amount,
    fromMain,
    fromShifts,
    createdAtIso: nowIso(),
    note: String(data.note || '').trim(),
    clientRef: data.clientRef || undefined,
  }
  db.cashVault.converts.unshift(row)

  appendMoneyLedger(db, {
    type: 'vault_card_to_cash',
    amount,
    direction: 'info',
    cashAffect: false,
    signedAmount: 0,
    reason: 'Карта → нал',
    note: row.note,
    refType: 'vault_convert',
    refId: row.id,
    meta: { fromMain, fromShifts },
  })
  return row
}

/** Нал → карта: сначала основной ящик, потом открытые смены. */
export function convertVaultCashToCard(db, data = {}) {
  ensurePosCollections(db)
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  const openShifts = (db.posShifts || []).filter(s => s.status === 'open')
  const mainCash = round2(db.cashVault.cashTotal)
  const openCash = round2(openShifts.reduce((a, s) => a + shiftExpectedCash(s), 0))
  const available = round2(mainCash + openCash)
  if (amount > available + 0.009) {
    throw new Error(`Наличных только ${available.toFixed(2)} сом`)
  }

  let left = amount
  const fromMain = Math.min(left, mainCash)
  if (fromMain > 0.001) {
    db.cashVault.cashTotal = round2(mainCash - fromMain)
    db.cashVault.cardTotal = round2((Number(db.cashVault.cardTotal) || 0) + fromMain)
    left = round2(left - fromMain)
  }

  const fromShifts = []
  for (const s of openShifts) {
    if (left <= 0.001) break
    const have = shiftExpectedCash(s)
    if (!(have > 0.001)) continue
    const take = Math.min(left, have)
    let rest = take
    const fromIn = Math.min(rest, round2(Number(s.cashInTotal) || 0))
    if (fromIn > 0.001) {
      s.cashInTotal = round2((Number(s.cashInTotal) || 0) - fromIn)
      rest = round2(rest - fromIn)
    }
    const fromSales = Math.min(rest, round2(Number(s.salesCash) || 0))
    if (fromSales > 0.001) {
      s.salesCash = round2((Number(s.salesCash) || 0) - fromSales)
      rest = round2(rest - fromSales)
    }
    if (rest > 0.001) {
      s.openingCash = round2(Math.max(0, (Number(s.openingCash) || 0) - rest))
    }
    s.salesCard = round2((Number(s.salesCard) || 0) + take)
    fromShifts.push({ shiftId: s.id, posId: s.posId || '', amount: take })
    left = round2(left - take)
  }

  const row = {
    id: nextId('VCT'),
    amount,
    dir: 'cash_to_card',
    fromMain,
    fromShifts,
    createdAtIso: nowIso(),
    note: String(data.note || '').trim(),
    clientRef: data.clientRef || undefined,
  }
  db.cashVault.converts.unshift(row)

  appendMoneyLedger(db, {
    type: 'vault_cash_to_card',
    amount,
    direction: 'info',
    cashAffect: false,
    signedAmount: 0,
    reason: 'Нал → карта',
    note: row.note,
    refType: 'vault_convert',
    refId: row.id,
    meta: { fromMain, fromShifts },
  })
  return row
}

export function listSuppliers(db) {
  ensurePosCollections(db)
  return db.suppliers
}

export function createSupplier(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Укажите название поставщика')
  const row = {
    id: nextId('SUP'),
    name,
    category: String(data.category || '').trim(),
    phone: String(data.phone || '').trim(),
    address: String(data.address || '').trim(),
    note: String(data.note || '').trim(),
    payableAmount: 0,
    totalSupplied: 0,
    totalPaid: 0,
    lastDeliveryAtIso: null,
  }
  db.suppliers.unshift(row)
  return row
}

export function updateSupplier(db, id, patch = {}) {
  ensurePosCollections(db)
  const row = db.suppliers.find(s => s.id === id)
  if (!row) throw new Error('Поставщик не найден')
  Object.assign(row, patch)
  row.name = String(row.name || '').trim()
  return row
}

export function createSupplierPayment(db, supplierId, data = {}) {
  ensurePosCollections(db)
  const supplier = db.suppliers.find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму оплаты')
  supplier.totalPaid = round2((supplier.totalPaid || 0) + amount)
  syncSupplierPayable(supplier)
  const payment = {
    id: nextId('SPAY'),
    supplierId: supplier.id,
    supplierName: supplier.name,
    amount,
    paidAtIso: nowIso(),
    note: String(data.note || '').trim(),
  }
  db.supplierPayments.unshift(payment)
  return payment
}

export function listSupplierPayments(db, supplierId) {
  ensurePosCollections(db)
  return (db.supplierPayments || [])
    .filter(p => !supplierId || p.supplierId === supplierId)
    .sort((a, b) => String(b.paidAtIso || '').localeCompare(String(a.paidAtIso || '')))
}

export function deleteSupplierPayment(db, supplierId, paymentId) {
  ensurePosCollections(db)
  const idx = (db.supplierPayments || []).findIndex(p => p.id === paymentId && p.supplierId === supplierId)
  if (idx < 0) throw new Error('Платёж не найден')
  const payment = db.supplierPayments[idx]
  const supplier = db.suppliers.find(s => s.id === supplierId)
  if (supplier) {
    supplier.totalPaid = round2(Math.max(0, (supplier.totalPaid || 0) - payment.amount))
    syncSupplierPayable(supplier)
  }
  db.supplierPayments.splice(idx, 1)
  return { id: paymentId }
}

export function deleteSupplier(db, id) {
  ensurePosCollections(db)
  const idx = (db.suppliers || []).findIndex(s => s.id === id)
  if (idx < 0) throw new Error('Поставщик не найден')
  const supplier = db.suppliers[idx]
  if (Number(supplier.payableAmount) > 0) {
    throw new Error('Нельзя удалить поставщика с непогашенным долгом — сначала погасите задолженность')
  }
  db.suppliers.splice(idx, 1)
  db.supplierPayments = (db.supplierPayments || []).filter(p => p.supplierId !== id)
  if (!Array.isArray(db.syncDeletes)) db.syncDeletes = []
  db.syncDeletes.push({ kind: 'supplier', id: String(id), atIso: nowIso() })
  return { id }
}

export function listExpenses(db) {
  ensurePosCollections(db)
  return [...db.expenses].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createExpense(db, data = {}) {
  ensurePosCollections(db)
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму расхода')
  let shift = null
  if (data.shiftId) {
    shift = db.posShifts.find(s => s.id === data.shiftId)
    if (!shift) throw new Error('Смена не найдена')
    if (shift.status !== 'open') throw new Error('Смена уже закрыта')
  } else {
    shift = findOpenShift(db, data.posId)
  }
  if (shift) {
    const expected = shiftExpectedCash(shift)
    if (amount > expected + 0.009) {
      throw new Error(`В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`)
    }
  }
  const row = {
    id: nextId('EXP'),
    category: String(data.category || '').trim() || 'Прочее',
    amount,
    note: String(data.note || '').trim(),
    createdBy: String(data.createdBy || '').trim(),
    shiftId: shift?.id || undefined,
    createdAtIso: stampFromClient(data, 'createdAtIso'),
    clientRef: data.clientRef || undefined,
  }
  db.expenses.unshift(row)
  if (shift) {
    shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + amount)
  }
  appendMoneyLedger(db, {
    type: 'expense',
    amount,
    direction: 'out',
    cashAffect: true,
    posId: shift?.posId || data.posId || '',
    shiftId: row.shiftId || '',
    cashierId: shift?.cashierId || '',
    cashierName: row.createdBy || shift?.cashierName || '',
    refType: 'expense',
    refId: row.id,
    reason: `Расход · ${row.category}`,
    note: row.note,
  })
  return row
}

export function deleteExpense(db, id) {
  ensurePosCollections(db)
  const idx = db.expenses.findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Расход не найден')
  const row = db.expenses[idx]
  const amount = round2(row.amount)
  db.expenses.splice(idx, 1)
  if (row.shiftId) {
    const shift = db.posShifts.find(s => s.id === row.shiftId)
    if (shift) {
      shift.expenseTotal = round2(Math.max(0, (Number(shift.expenseTotal) || 0) - amount))
    }
  }
  db.moneyLedger = (db.moneyLedger || []).filter(
    e => !(e.refType === 'expense' && String(e.refId) === String(id)),
  )
  return { id }
}

/** Вклады / снятия — с открытой смены списывают/вносят наличные в кассу */
export function listFinanceMoves(db) {
  ensurePosCollections(db)
  return [...db.financeMoves].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createFinanceMove(db, data = {}) {
  ensurePosCollections(db)
  const type = data.type === 'withdraw' ? 'withdraw' : 'deposit'
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  let shift = null
  if (data.shiftId) {
    shift = db.posShifts.find(s => s.id === data.shiftId)
    if (!shift) throw new Error('Смена не найдена')
    if (shift.status !== 'open') throw new Error('Смена уже закрыта')
  } else {
    // Вклады/снятия из Финансов всегда цепляем к открытой смене — иначе сверка кассы врёт
    shift = findOpenShift(db, data.posId)
  }

  if (type === 'withdraw' && shift) {
    const expected = shiftExpectedCash(shift)
    if (amount > expected + 0.009) {
      throw new Error(`В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`)
    }
  }

  const cashierName = String(data.createdBy || data.cashierName || shift?.cashierName || '').trim()
  const cashierId = String(data.cashierId || shift?.cashierId || '').trim()
  const supplierId = String(data.supplierId || '').trim()
  let supplier = null
  let payment = null

  if (type === 'withdraw' && supplierId) {
    supplier = db.suppliers.find(s => s.id === supplierId)
    if (!supplier) throw new Error('Поставщик не найден')
  }

  const note = String(data.note || '').trim()
  const reason = String(data.reason || '').trim()
    || (type === 'deposit'
      ? 'Внесение в кассу'
      : supplier
        ? `Оплата поставщику · ${supplier.name}`
        : 'Снятие из кассы')

  const row = {
    id: nextId('FIN'),
    type,
    amount,
    note,
    createdBy: cashierName,
    createdAtIso: stampFromClient(data, 'createdAtIso'),
    shiftId: shift?.id || undefined,
    posId: shift?.posId || data.posId || '',
    supplierId: supplier?.id,
    supplierName: supplier?.name,
    clientRef: data.clientRef || undefined,
  }
  db.financeMoves.unshift(row)

  if (shift) {
    if (type === 'withdraw') {
      shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + amount)
    } else {
      shift.cashInTotal = round2((Number(shift.cashInTotal) || 0) + amount)
    }
  }

  if (supplier) {
    supplier.totalPaid = round2((Number(supplier.totalPaid) || 0) + amount)
    syncSupplierPayable(supplier)
    payment = {
      id: nextId('SPAY'),
      supplierId: supplier.id,
      supplierName: supplier.name,
      amount,
      paidAtIso: row.createdAtIso,
      note: note || `С кассы · ${shift?.id || ''}`,
      financeMoveId: row.id,
      shiftId: shift?.id,
    }
    if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
    db.supplierPayments.unshift(payment)
  }

  appendMoneyLedger(db, {
    type: type === 'deposit' ? 'deposit' : 'withdraw',
    amount,
    direction: type === 'deposit' ? 'in' : 'out',
    cashAffect: true,
    posId: row.posId || '',
    shiftId: row.shiftId || '',
    cashierId,
    cashierName,
    refType: 'finance_move',
    refId: row.id,
    reason,
    note,
    meta: supplier ? { supplierId: supplier.id, supplierName: supplier.name, paymentId: payment?.id } : {},
  })
  return { ...row, payment }
}

/**
 * Погашение долга клиента наличными/картой с открытой смены.
 * Нал увеличивает salesCash смены (ожидаемая касса), карта — только журнал.
 */
export function applyDebtRepayToShift(db, data = {}) {
  ensurePosCollections(db)
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму погашения')
  const method = data.method === 'card' ? 'card' : 'cash'

  let shift = null
  if (data.shiftId) {
    shift = db.posShifts.find(s => s.id === data.shiftId)
    if (!shift) throw new Error('Смена не найдена')
    if (shift.status !== 'open') throw new Error('Смена уже закрыта')
  }

  const cashierName = String(data.cashierName || shift?.cashierName || '').trim()
  const cashierId = String(data.cashierId || shift?.cashierId || '').trim()
  const posId = String(shift?.posId || data.posId || '').trim()
  const note = String(data.note || '').trim()
  const clientLabel = String(data.clientName || data.cardNum || '').trim()

  if (method === 'cash' && shift) {
    shift.salesCash = round2((Number(shift.salesCash) || 0) + amount)
  }

  appendMoneyLedger(db, {
    type: method === 'cash' ? 'debt_repay_cash' : 'debt_repay_card',
    amount,
    direction: 'in',
    cashAffect: method === 'cash',
    posId,
    shiftId: shift?.id || '',
    cashierId,
    cashierName,
    refType: 'debt_repay',
    refId: String(data.cardNum || ''),
    reason: method === 'cash'
      ? `Погашение долга нал · ${clientLabel}`
      : `Погашение долга карта · ${clientLabel}`,
    note,
    meta: {
      cardNum: data.cardNum || '',
      clientName: data.clientName || '',
      method,
    },
  })

  return {
    shiftId: shift?.id || null,
    posId,
    method,
    amount,
    salesCash: shift ? Number(shift.salesCash) || 0 : null,
  }
}

export function deleteFinanceMove(db, id) {
  ensurePosCollections(db)
  const idx = db.financeMoves.findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Запись не найдена')
  const row = db.financeMoves[idx]
  const amount = round2(row.amount)
  const type = row.type === 'withdraw' ? 'withdraw' : 'deposit'
  db.financeMoves.splice(idx, 1)

  if (row.shiftId) {
    const shift = db.posShifts.find(s => s.id === row.shiftId)
    if (shift) {
      if (type === 'withdraw') {
        shift.expenseTotal = round2(Math.max(0, (Number(shift.expenseTotal) || 0) - amount))
      } else {
        shift.cashInTotal = round2(Math.max(0, (Number(shift.cashInTotal) || 0) - amount))
      }
    }
  }

  if (row.supplierId) {
    const supplier = (db.suppliers || []).find(s => s.id === row.supplierId)
    if (supplier) {
      supplier.totalPaid = round2(Math.max(0, (Number(supplier.totalPaid) || 0) - amount))
      syncSupplierPayable(supplier)
    }
  }

  db.supplierPayments = (db.supplierPayments || []).filter(
    p => String(p.financeMoveId || '') !== String(id),
  )

  db.moneyLedger = (db.moneyLedger || []).filter(
    e => !(e.refType === 'finance_move' && String(e.refId) === String(id)),
  )

  return { id }
}

export function listStockReceipts(db) {
  ensurePosCollections(db)
  return [...db.stockReceipts].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

function reverseSupplierDebt(db, supplierId, receiptTotal, debtAdded) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const paidNow = Math.max(0, round2(receiptTotal - debtAdded))
  supplier.totalSupplied = round2(Math.max(0, (supplier.totalSupplied || 0) - receiptTotal))
  supplier.totalPaid = round2(Math.max(0, (supplier.totalPaid || 0) - paidNow))
  syncSupplierPayable(supplier)
  return supplier
}

function restoreReceiptBalances(db, productId, qty, meta = {}) {
  let left = round2(qty)
  const receipts = [...(db.stockReceipts || [])]
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (left <= 0) break
      const consumed = round2((Number(item.qty) || 0) - (Number(item.remainingQty) || 0))
      if (consumed <= 0) continue
      const add = Math.min(consumed, left)
      item.remainingQty = round2((Number(item.remainingQty) || 0) + add)
      left = round2(left - add)
    }
  }
  // Излишек сверх ранее списанного не «дописываем» в чужой приход поставщика
  // (это раздувало бы закуп и себестоимость) — заводим отдельный слой-корректировку
  if (left > 0) {
    const product = (db.products || []).find(p => Number(p.id) === Number(productId))
    if (product) {
      createStockAdjustmentLayer(db, product, left, {
        reason: meta.reason || 'Корректировка остатка',
        createdBy: meta.createdBy,
      })
    }
  }
  syncProductStock(db, productId)
}

function reverseStockReceipt(db, receipt) {
  const productIds = (receipt.items || []).map(item => Number(item.productId))
  if (receipt.supplierId) {
    reverseSupplierDebt(db, receipt.supplierId, receipt.totalCost, receipt.debtAdded)
  }
  const paid = round2(receipt.paidNow)
  if (paid > 0.001) {
    const ledgers = (db.moneyLedger || []).filter(
      e => e.type === 'purchase_pay' && e.refType === 'receipt' && String(e.refId) === String(receipt.id),
    )
    for (const e of ledgers) {
      if (e.shiftId) {
        const shift = db.posShifts.find(s => s.id === e.shiftId)
        if (shift) {
          shift.expenseTotal = round2(Math.max(0, (Number(shift.expenseTotal) || 0) - paid))
        }
      }
    }
    db.moneyLedger = (db.moneyLedger || []).filter(
      e => !(e.type === 'purchase_pay' && e.refType === 'receipt' && String(e.refId) === String(receipt.id)),
    )
  }
  const idx = (db.stockReceipts || []).findIndex(r => r.id === receipt.id)
  if (idx >= 0) db.stockReceipts.splice(idx, 1)
  for (const productId of productIds) syncProductStock(db, productId)
}

function reverseStockWriteoff(db, writeoff) {
  for (const item of writeoff.items || []) {
    restoreReceiptBalances(db, item.productId, round2(item.qty), { reason: 'Отмена списания' })
  }
}

function buildStockReceipt(db, data = {}, meta = {}) {
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Добавьте товары в приход')
  const items = rawItems.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    const costPrice = round2(raw.costPrice)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    return {
      product,
      qty,
      costPrice,
      retailPrice: round2(raw.retailPrice ?? product.price),
      bulkPricing: normalizeBulkPricing(raw.bulkPricing),
      expiryDate: raw.expiryDate || null,
    }
  })
  let totalCost = 0
  for (const row of items) {
    if (row.costPrice > 0) row.product.costPrice = row.costPrice
    totalCost = round2(totalCost + row.qty * row.costPrice)
  }
  const paidNow = round2(data.paidNow)
  const supplier = updateSupplierDebt(db, data.supplierId || '', totalCost, paidNow)
  const receipt = {
    id: meta.id || nextId('REC'),
    supplierId: supplier?.id || null,
    supplierName: supplier?.name || '',
    createdAtIso: meta.createdAtIso || nowIso(),
    serverAtIso: nowIso(),
    createdBy: String(meta.createdBy || data.createdBy || '').trim(),
    totalCost,
    paidNow,
    debtAdded: round2(Math.max(0, totalCost - paidNow)),
    items: items.map(row => ({
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
      remainingQty: row.qty,
      costPrice: row.costPrice,
      retailPrice: row.retailPrice,
      bulkPricing: row.bulkPricing.length ? row.bulkPricing : undefined,
      expiryDate: row.expiryDate,
    })),
  }
  db.stockReceipts.unshift(receipt)
  for (const row of items) syncProductStock(db, row.product.id)
  return receipt
}

export function createStockReceipt(db, data = {}) {
  ensurePosCollections(db)
  const meta = {}
  if (data.createdAtIso) meta.createdAtIso = data.createdAtIso
  const receipt = buildStockReceipt(db, data, meta)
  if ((Number(receipt.paidNow) || 0) > 0) {
    let shift = null
    if (data.shiftId) {
      shift = db.posShifts.find(s => s.id === data.shiftId && s.status === 'open') || null
    }
    if (!shift) shift = findOpenShift(db, data.posId)
    if (shift) {
      const expected = shiftExpectedCash(shift)
      if (receipt.paidNow > expected + 0.009) {
        // откат прихода — иначе касса уйдёт в минус без предупреждения
        reverseStockReceipt(db, receipt)
        throw new Error(`В кассе недостаточно наличных для оплаты закупа (доступно ${expected.toFixed(2)} сом)`)
      }
      shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + receipt.paidNow)
      receipt.shiftId = shift.id
      receipt.posId = shift.posId || ''
    }
    appendMoneyLedger(db, {
      type: 'purchase_pay',
      amount: receipt.paidNow,
      direction: 'out',
      cashAffect: true,
      posId: receipt.posId || shift?.posId || data.posId || '',
      shiftId: shift?.id || '',
      cashierName: receipt.createdBy || shift?.cashierName || '',
      cashierId: shift?.cashierId || '',
      refType: 'receipt',
      refId: receipt.id,
      reason: `Оплата закупа · ${receipt.supplierName || 'поставщик'}`,
      note: '',
    })
  }
  return receipt
}

export function updateStockReceipt(db, id, data = {}) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === id)
  if (!receipt) throw new Error('Приход не найден')
  const newPaid = round2(data.paidNow)
  if (newPaid > 0) {
    let shift = null
    if (data.shiftId) {
      shift = db.posShifts.find(s => s.id === data.shiftId && s.status === 'open') || null
    }
    if (!shift) shift = findOpenShift(db, data.posId)
    if (shift) {
      // Учитываем, что старая оплата уже в expenseTotal и reverse её вернёт
      const oldPaid = round2(receipt.paidNow)
      const expected = round2(shiftExpectedCash(shift) + oldPaid)
      if (newPaid > expected + 0.009) {
        throw new Error(`В кассе недостаточно наличных для оплаты закупа (доступно ${expected.toFixed(2)} сом)`)
      }
    }
  }
  const meta = {
    id: receipt.id,
    createdAtIso: receipt.createdAtIso,
    createdBy: receipt.createdBy,
  }
  reverseStockReceipt(db, receipt)
  const next = buildStockReceipt(db, data, meta)
  if ((Number(next.paidNow) || 0) > 0) {
    let shift = null
    if (data.shiftId) {
      shift = db.posShifts.find(s => s.id === data.shiftId && s.status === 'open') || null
    }
    if (!shift) shift = findOpenShift(db, data.posId)
    if (shift) {
      shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + next.paidNow)
      next.shiftId = shift.id
      next.posId = shift.posId || ''
    }
    appendMoneyLedger(db, {
      type: 'purchase_pay',
      amount: next.paidNow,
      direction: 'out',
      cashAffect: true,
      posId: next.posId || shift?.posId || data.posId || '',
      shiftId: shift?.id || '',
      cashierName: next.createdBy || shift?.cashierName || '',
      cashierId: shift?.cashierId || '',
      refType: 'receipt',
      refId: next.id,
      reason: `Оплата закупа · ${next.supplierName || 'поставщик'}`,
      note: '',
    })
  }
  return next
}

export function deleteStockReceipt(db, id) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === id)
  if (!receipt) throw new Error('Приход не найден')
  reverseStockReceipt(db, receipt)
  return { id }
}

function buildStockWriteoff(db, data = {}, meta = {}) {
  const rows = consumeStock(db, Array.isArray(data.items) ? data.items : [])
  const writeoff = {
    id: meta.id || nextId('WOF'),
    createdAtIso: meta.createdAtIso || nowIso(),
    serverAtIso: nowIso(),
    createdBy: String(meta.createdBy || data.createdBy || '').trim(),
    reason: String(data.reason || '').trim() || 'Списание',
    note: String(data.note || '').trim(),
    totalCost: round2(rows.reduce((sum, row) => sum + (Number(row.product.costPrice) || 0) * row.qty, 0)),
    items: rows.map(row => {
      const unitCost = round2(Number(row.product.costPrice) || 0)
      return {
        productId: row.product.id,
        productName: row.product.name,
        qty: row.qty,
        unitCost,
        lineCost: round2(unitCost * row.qty),
      }
    }),
  }
  db.writeOffs.unshift(writeoff)
  return writeoff
}

export function listStockWriteoffs(db) {
  ensurePosCollections(db)
  return [...db.writeOffs].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createStockWriteoff(db, data = {}) {
  ensurePosCollections(db)
  const meta = {}
  if (data.createdAtIso) meta.createdAtIso = data.createdAtIso
  return buildStockWriteoff(db, data, meta)
}

export function updateStockWriteoff(db, id, data = {}) {
  ensurePosCollections(db)
  const idx = (db.writeOffs || []).findIndex(w => w.id === id)
  if (idx < 0) throw new Error('Списание не найдено')
  const old = db.writeOffs[idx]
  const meta = {
    id: old.id,
    createdAtIso: old.createdAtIso,
    createdBy: old.createdBy,
  }
  reverseStockWriteoff(db, old)
  db.writeOffs.splice(idx, 1)
  return buildStockWriteoff(db, data, meta)
}

export function deleteStockWriteoff(db, id) {
  ensurePosCollections(db)
  const idx = (db.writeOffs || []).findIndex(w => w.id === id)
  if (idx < 0) throw new Error('Списание не найдено')
  const old = db.writeOffs[idx]
  reverseStockWriteoff(db, old)
  db.writeOffs.splice(idx, 1)
  return { id }
}

export function listStockRevisions(db) {
  ensurePosCollections(db)
  return [...db.stockRevisions].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

function reverseStockRevision(db, revision) {
  for (const item of revision.items || []) {
    const restore = item.stockBefore != null ? item.stockBefore : item.systemStock
    setProductStockExact(db, item.productId, restore, { reason: 'Откат ревизии' })
  }
}

function buildStockRevision(db, data = {}, meta = {}) {
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Нет строк для ревизии')
  const createdBy = String(meta.createdBy || data.createdBy || '').trim()
  const items = rawItems.map(raw => {
    const product = getProduct(db, raw.productId)
    // Без явного факта остаток обнулился бы молча — требуем число
    if (raw.countedStock === '' || raw.countedStock == null || !Number.isFinite(Number(raw.countedStock))) {
      throw new Error(`Укажите фактическое количество: ${product.name}`)
    }
    const countedStock = round2(raw.countedStock)
    const liveNow = sumProductLayers(db, product.id)
    // Заморозка с клиента (момент подсчёта). Если нет — считаем от текущего (старое поведение).
    const frozen = Number.isFinite(Number(raw.systemStock)) ? round2(raw.systemStock) : liveNow
    const delta = round2(countedStock - frozen)
    // Продажи/приходы после подсчёта уже в liveNow → к нему применяем только разницу ревизии
    const target = Math.max(0, round2(liveNow + delta))
    setProductStockExact(db, product.id, target, { reason: 'Ревизия', createdBy })
    return {
      productId: product.id,
      productName: product.name,
      systemStock: frozen,
      countedStock,
      diff: delta,
      stockBefore: liveNow,
    }
  })
  const row = {
    id: meta.id || nextId('REV'),
    createdAtIso: meta.createdAtIso || nowIso(),
    serverAtIso: nowIso(),
    createdBy,
    note: String(data.note || '').trim(),
    items,
    // Срез уже известных серверу номеров касс — поздние офлайн-чеки с большим opSeq не минусуют склад повторно
    posCuts: Array.isArray(meta.posCuts) ? meta.posCuts : snapshotPosCuts(db),
  }
  db.stockRevisions.unshift(row)
  return row
}

export function createStockRevision(db, data = {}) {
  ensurePosCollections(db)
  return buildStockRevision(db, data)
}

export function updateStockRevision(db, id, data = {}) {
  ensurePosCollections(db)
  const idx = (db.stockRevisions || []).findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Ревизия не найдена')
  const old = db.stockRevisions[idx]
  const meta = {
    id: old.id,
    createdAtIso: old.createdAtIso,
    createdBy: old.createdBy,
    // Срез касс с первого проведения — иначе поздние офлайн-чеки снова спишут остаток
    posCuts: Array.isArray(old.posCuts) ? old.posCuts : undefined,
  }
  reverseStockRevision(db, old)
  db.stockRevisions.splice(idx, 1)
  return buildStockRevision(db, data, meta)
}

export function deleteStockRevision(db, id) {
  ensurePosCollections(db)
  const idx = (db.stockRevisions || []).findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Ревизия не найдена')
  const old = db.stockRevisions[idx]
  reverseStockRevision(db, old)
  db.stockRevisions.splice(idx, 1)
  return { id }
}

export function listExpiryItems(db, days = 14) {
  ensurePosCollections(db)
  const ms = Math.max(1, Number(days) || 14) * 24 * 60 * 60 * 1000
  const now = Date.now()
  const out = []
  for (const receipt of db.stockReceipts) {
    for (const item of receipt.items || []) {
      if (!(Number(item.remainingQty) > 0) || !item.expiryDate) continue
      const ts = new Date(item.expiryDate).getTime()
      if (Number.isNaN(ts)) continue
      const diff = ts - now
      if (diff > ms) continue
      out.push({
        receiptId: receipt.id,
        receiptCreatedAtIso: receipt.createdAtIso,
        productId: item.productId,
        productName: item.productName,
        qty: item.remainingQty,
        costPrice: Number(item.costPrice) || 0,
        retailPrice: Number(item.retailPrice) || 0,
        expiryDate: item.expiryDate,
        daysLeft: Math.ceil(diff / (24 * 60 * 60 * 1000)),
      })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

export function listPosSales(db) {
  ensurePosCollections(db)
  ensurePosSaleNumbers(db)
  return [...db.posSales].sort((a, b) => {
    const nb = Number(b.number) || 0
    const na = Number(a.number) || 0
    if (nb !== na) return nb - na
    return String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || ''))
  })
}

export function createPosSale(db, data = {}) {
  ensurePosCollections(db)
  // Защита от дублей при офлайн-синхронизации: чек с тем же clientRef не создаём повторно
  const clientRef = data.clientRef ? String(data.clientRef).trim() : ''
  if (clientRef) {
    const existing = (db.posSales || []).find(s => s.clientRef === clientRef)
    if (existing) return existing
  }
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Добавьте товары в продажу')
  const cashier = data.cashierId ? db.cashiers.find(c => c.id === data.cashierId) : null
  const shift = data.shiftId ? db.posShifts.find(s => s.id === data.shiftId) : null
  if (data.shiftId && !shift) throw new Error('Смена не найдена')
  const posId = String(data.posId || shift?.posId || (db.posPoints[0]?.id || DEFAULT_POS_ID)).trim()
  const deviceId = String(data.deviceId || '').trim()
  const deviceName = String(data.deviceName || '').trim()
  const opSeq = allocSaleOpSeq(db, posId, data.opSeq, deviceId)
  const skipStock = shouldSkipSaleStock(
    db,
    posId,
    opSeq,
    rawItems.map(it => it.productId),
    deviceId,
    !!(data.queuedOffline || data.skipStockAfterRevision),
  )
  const rows = skipStock
    ? stockRowsWithoutConsume(db, rawItems)
    : consumeStock(db, rawItems)
  const items = rows.map((row, idx) => {
    const raw = rawItems[idx] || {}
    const price = round2(raw.price ?? row.product.price)
    const lineCost = round2(row.cogs || 0)
    const unitCost = row.qty > 0 ? round2(lineCost / row.qty) : 0
    const rawUnit = String(raw.unit || '').trim()
    const productUnit = String(row.product.unit || '').trim()
    const sellType = String(row.product.sellType || '').toLowerCase()
    const unit = rawUnit
      || (sellType === 'weight' || sellType === 'weighted' ? 'кг' : '')
      || productUnit
      || 'шт'
    return {
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
      price,
      lineTotal: round2(price * row.qty),
      unit,
      unitCost,
      lineCost,
      receiptId: row.receiptId || undefined,
    }
  })
  const itemsTotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const totalCost = round2(items.reduce((sum, item) => sum + (Number(item.lineCost) || 0), 0))
  const bonusSpent = Math.max(0, Math.floor(Number(data.bonusSpent) || 0))
  const bonusEarned = Math.max(0, Math.floor(Number(data.bonusEarned) || 0))
  const orderGoodsTotal = round2(Number(data.orderGoodsTotal) || 0)
  const discountAmount = round2(Number(data.discountAmount) || 0)
  const bonusBalanceBefore = Number.isFinite(Number(data.bonusBalanceBefore))
    ? Math.max(0, Math.floor(Number(data.bonusBalanceBefore)))
    : undefined
  const bonusBalanceAfter = Number.isFinite(Number(data.bonusBalanceAfter))
    ? Math.max(0, Math.floor(Number(data.bonusBalanceAfter)))
    : undefined
  const total = orderGoodsTotal > 0
    ? Math.max(0, round2(orderGoodsTotal - discountAmount - bonusSpent))
    : itemsTotal
  const profit = round2(total - totalCost)
  const paymentMethod = ['cash', 'card', 'credit', 'wallet', 'mixed'].includes(data.paymentMethod) ? data.paymentMethod : 'cash'
  const paidCash = round2(data.paidCash ?? (paymentMethod === 'cash' ? total : 0))
  const paidCard = round2(data.paidCard ?? (paymentMethod === 'card' ? total : 0))
  const paidWallet = round2(data.paidWallet ?? (paymentMethod === 'wallet' ? total : 0))
  const debtAdded = round2(data.debtAdded ?? (paymentMethod === 'credit' ? total : 0))
  const cashReceived = round2(data.cashReceived ?? 0)
  const changeGiven = round2(data.changeGiven ?? 0)
  // Один счётчик с онлайн-заказами: K-4864 …
  const orderId = nextOrderId(db)
  const cashierName = String(
    data.cashierName
    || shift?.cashierName
    || cashier?.name
    || '',
  ).trim()
  if (cashier && cashierName && cashierName !== cashier.name && !/^кассир$/i.test(cashierName)) {
    cashier.name = cashierName
  }

  const offlineIso = clientRef && data.createdAtIso && !Number.isNaN(Date.parse(data.createdAtIso))
    ? new Date(data.createdAtIso).toISOString()
    : nowIso()
  const sale = {
    id: nextId('SALE'),
    number: nextPosSaleNumber(db),
    orderId,
    clientRef: clientRef || undefined,
    createdAtIso: offlineIso,
    serverAtIso: nowIso(),
    cashierId: cashier?.id || data.cashierId || '',
    cashierName,
    shiftId: shift?.id || '',
    posId,
    deviceId: deviceId || undefined,
    deviceName: deviceName || undefined,
    opSeq,
    ...(skipStock
      ? {
          stockSkipped: true,
          stockSkipRevisionId: skipStock.revisionId || undefined,
        }
      : {}),
    clientId: data.clientId || '',
    clientName: String(data.clientName || '').trim(),
    clientPhone: String(data.clientPhone || '').trim(),
    cardNum: String(data.cardNum || '').trim(),
    paymentMethod,
    total,
    totalCost,
    profit,
    paidCash,
    paidCard,
    paidWallet,
    debtAdded,
    cashReceived,
    changeGiven,
    note: String(data.note || '').trim(),
    orderGoodsTotal: orderGoodsTotal > 0 ? orderGoodsTotal : undefined,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    bonusSpent: bonusSpent > 0 ? bonusSpent : undefined,
    bonusEarned: bonusEarned > 0 ? bonusEarned : undefined,
    bonusBalanceBefore,
    bonusBalanceAfter,
    items,
  }
  const skipBalances = !!(data.appliedLocal || data.skipBalances)

  if (cashier) {
    cashier.salesCount = Number(cashier.salesCount || 0) + 1
    cashier.salesTotal = round2((Number(cashier.salesTotal) || 0) + total)
  }
  if (shift) {
    shift.salesCount = Number(shift.salesCount || 0) + 1
    shift.salesCash = round2((Number(shift.salesCash) || 0) + paidCash)
    shift.salesCard = round2((Number(shift.salesCard) || 0) + paidCard)
    shift.salesCredit = round2((Number(shift.salesCredit) || 0) + debtAdded)
    if (paidWallet > 0) shift.salesWallet = round2((Number(shift.salesWallet) || 0) + paidWallet)
  }
  // Оплата с кошелька (предоплаченные деньги) — списываем баланс клиента.
  // На наличку кассы НЕ влияет: деньги уже были внесены при пополнении.
  if (paidWallet > 0 && !skipBalances) {
    const { client: walletClient, card: walletCard } = resolveSaleClientAndCard(db, data)
    const balance = Math.max(
      Number(walletCard?.wallet) || 0,
      Number(walletClient?.wallet) || 0,
    )
    if (paidWallet > balance + 0.001) {
      throw new Error('Недостаточно средств на кошельке клиента')
    }
    if (walletCard) {
      walletCard.wallet = round2(Math.max(0, (Number(walletCard.wallet) || 0) - paidWallet))
    }
    if (walletClient) {
      walletClient.wallet = round2(Math.max(0, (Number(walletClient.wallet) || 0) - paidWallet))
    }
  }
  if (debtAdded > 0 && !skipBalances) {
    const { client, card } = resolveSaleClientAndCard(db, data)
    // Касса (торговая точка) оформляет долг без лимита. Лимит действует только
    // в приложении клиента; включить проверку тут можно флагом data.enforceDebtLimit.
    if (client && data.enforceDebtLimit === true) {
      const gate = canTakeNewDebt(client, card, debtAdded)
      if (!gate.ok) throw new Error(gate.reason)
    }
    const nextDebt = round2(effectiveDebt(client, card) + debtAdded)
    applyDebtToPair(client, card, nextDebt)
    if (client) {
      const itemsSummary = items.slice(0, 5).map(it => `${it.productName} ×${it.qty}`).join(', ')
      const { notifications } = addDebtCharge(client, card, {
        amount: debtAdded,
        source: 'pos',
        orderId: sale.orderId,
        saleId: sale.id,
        desc: String(data.note || '').trim() || `Касса · ${sale.orderId || sale.number}`,
        createdAtIso: sale.createdAtIso,
      })
      sale._debtNotifications = notifications
      if (itemsSummary) sale._debtItemsSummary = itemsSummary
    }
  }
  if (skipBalances) {
    const { client, card } = resolveSaleClientAndCard(db, data)
    if (data.clientDebtAfter != null) {
      applyDebtToPair(client, card, data.clientDebtAfter)
    }
    if (data.walletAfter != null) {
      const w = round2(data.walletAfter)
      if (client) client.wallet = w
      if (card) card.wallet = w
    }
    if (data.bonusAfter != null || data.bonusBalanceAfter != null) {
      const b = Math.max(0, Math.floor(Number(data.bonusAfter ?? data.bonusBalanceAfter)))
      if (card) card.bonus = b
      if (client) client.bonus = b
    }
    if (debtAdded > 0 && client) {
      const itemsSummary = items.slice(0, 5).map(it => `${it.productName} ×${it.qty}`).join(', ')
      const { notifications } = addDebtCharge(client, card, {
        amount: debtAdded,
        source: 'pos',
        orderId: sale.orderId,
        saleId: sale.id,
        desc: String(data.note || '').trim() || `Касса · ${sale.orderId || sale.number}`,
        createdAtIso: sale.createdAtIso,
      })
      sale._debtNotifications = notifications
      if (itemsSummary) sale._debtItemsSummary = itemsSummary
    }
  }
  db.posSales.unshift(sale)
  const baseLed = {
    posId,
    shiftId: shift?.id || '',
    cashierId: cashier?.id || data.cashierId || '',
    cashierName: cashierName || cashier?.name || '',
    refType: 'sale',
    refId: sale.id,
    createdAtIso: sale.createdAtIso,
  }
  if (paidCash > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_cash',
      amount: paidCash,
      direction: 'in',
      cashAffect: true,
      reason: `Продажа нал · ${sale.orderId || sale.number}`,
    })
  }
  if (paidCard > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_card',
      amount: paidCard,
      direction: 'in',
      cashAffect: false,
      reason: `Продажа карта · ${sale.orderId || sale.number}`,
    })
  }
  if (debtAdded > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_credit',
      amount: debtAdded,
      direction: 'info',
      cashAffect: false,
      reason: `Продажа в долг · ${sale.clientName || sale.clientPhone || ''}`,
    })
  }
  if (paidWallet > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_wallet',
      amount: paidWallet,
      direction: 'info',
      cashAffect: false,
      reason: `Продажа с кошелька · ${sale.clientName || sale.clientPhone || ''}`,
    })
  }
  return sale
}

/**
 * Покупка на кассе с клиентом → заказ в «Мои заказы» (сразу delivered).
 * Номер заказа берётся из sale.orderId (общий счётчик онлайн + касса).
 */
export function createClientOrderFromPosSale(db, sale, extras = {}) {
  if (!sale) return null
  const phone = String(sale.clientPhone || extras.clientPhone || '').trim()
  if (!phone) return null

  const client =
    getClientById(db, sale.clientId || extras.clientId) ||
    findClientByPhone(db, phone)

  const goodsTotal = round2(
    Number(extras.orderGoodsTotal ?? extras.goodsTotal ?? sale.total) || 0,
  )
  const bonusSpent = Math.max(0, Math.floor(Number(extras.bonusSpent) || 0))
  const payable = Math.max(0, round2(goodsTotal - bonusSpent))
  const debtAdded = round2(Number(sale.debtAdded) || 0)
  const createdAtIso = sale.createdAtIso || nowIso()
  const createdAt = nowTimeLocal()

  const items = (sale.items || []).map(item => {
    let product = null
    try {
      product = getProduct(db, item.productId)
    } catch {
      product = null
    }
    return {
      id: Number(item.productId) || 0,
      product_id: Number(item.productId) || 0,
      art: product?.art || '',
      e: product?.e || '📦',
      name: item.productName || product?.name || 'Товар',
      qty: Number(item.qty) || 0,
      unit: product?.unit || '',
      price: round2(Number(item.price) || 0),
      source: 'market',
      done: true,
    }
  })

  const pay =
    sale.paymentMethod === 'mixed'
      ? 'mixed'
      : sale.paymentMethod === 'credit'
        ? 'credit'
        : sale.paymentMethod === 'card'
          ? 'card'
          : 'cash'

  const orderId = String(sale.orderId || '').trim() || nextOrderId(db)
  sale.orderId = orderId

  const order = {
    id: orderId,
    type: 'market',
    status: 'delivered',
    channel: 'pos',
    posSaleId: sale.id,
    posSaleNumber: sale.number,
    createdAt,
    createdAtIso,
    deliveredAt: createdAt,
    deliveredAtIso: createdAtIso,
    total: payable,
    goodsTotal,
    deliveryFee: 0,
    deliveryFeeLocked: true,
    comment: extras.note || sale.note || 'Покупка в магазине',
    payment_method: pay,
    pay,
    creditAmount: debtAdded > 0 ? debtAdded : undefined,
    paidCash: round2(Number(sale.paidCash) || 0),
    vip: client?.vip === true,
    priority: 'normal',
    client: {
      name: sale.clientName || client?.name || '',
      phone: phone || client?.phone || '',
      addr: client?.addr || 'Касса КАКАПО',
    },
    items,
    marketStatus: 'done',
    bonusSpent: bonusSpent > 0 ? bonusSpent : 0,
    pickupIds: ['store'],
    // Склад уже списан чеком кассы — повторно не трогаем
    stockFromPos: true,
    stockReserved: true,
    stockReserveLines: [],
  }

  stampOrderForClient(order, client)
  db.orders.push(order)
  return order
}

export function returnPosSale(db, saleId, meta = {}) {
  ensurePosCollections(db)
  const sale = (db.posSales || []).find(s => String(s.id) === String(saleId))
  if (!sale) throw new Error('Чек не найден')
  if (sale.status === 'returned') throw new Error('Чек уже полностью возвращён')

  const items = Array.isArray(sale.items) ? sale.items : []
  if (!items.length) throw new Error('В чеке нет позиций')

  /** @type {{ index: number, productId: number, qty: number }[]} */
  let plan = []
  const requested = Array.isArray(meta.items) ? meta.items : null

  if (requested && requested.length) {
    for (const row of requested) {
      const index = Number.isInteger(Number(row.index)) ? Number(row.index) : -1
      let item = index >= 0 && index < items.length ? items[index] : null
      if (!item && row.productId != null) {
        item = items.find(it => {
          const left = round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0))
          return String(it.productId) === String(row.productId) && left > 0
        }) || null
      }
      if (!item) throw new Error('Позиция для возврата не найдена')
      const idx = items.indexOf(item)
      const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
      const qty = round2(row.qty != null ? Number(row.qty) : left)
      if (!(qty > 0)) throw new Error('Количество возврата должно быть больше 0')
      if (qty > left + 1e-9) throw new Error(`Можно вернуть не больше ${left}`)
      plan.push({ index: idx, productId: Number(item.productId), qty })
    }
  } else {
    items.forEach((item, index) => {
      const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
      if (left > 0) plan.push({ index, productId: Number(item.productId), qty: left })
    })
  }

  if (!plan.length) throw new Error('Нечего возвращать')

  // merge same index
  const byIndex = new Map()
  for (const p of plan) {
    const prev = byIndex.get(p.index)
    byIndex.set(p.index, prev ? { ...p, qty: round2(prev.qty + p.qty) } : p)
  }
  plan = [...byIndex.values()]

  const returnLines = []
  let returnTotal = 0
  for (const p of plan) {
    const item = items[p.index]
    const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
    if (p.qty > left + 1e-9) throw new Error(`Можно вернуть не больше ${left}`)
    const unit = Number(item.qty) > 0
      ? round2((Number(item.lineTotal) || 0) / Number(item.qty))
      : round2(Number(item.price) || 0)
    const lineReturn = round2(unit * p.qty)
    item.returnedQty = round2((Number(item.returnedQty) || 0) + p.qty)
    // Чек не трогал склад, или касса уже вернула остаток локально (очередь)
    const skipStockRestore = !!(
      sale.stockSkipped
      || meta.appliedLocal
      || meta.queuedOffline
      || meta.skipStock
    )
    if (!skipStockRestore) {
      restoreReceiptBalance(db, item.productId, p.qty, item.receiptId || '')
    }
    returnLines.push({
      productId: item.productId,
      productName: item.productName,
      qty: p.qty,
      price: unit,
      lineTotal: lineReturn,
    })
    returnTotal = round2(returnTotal + lineReturn)
  }

  if (!(returnTotal > 0)) throw new Error('Сумма возврата равна 0')

  if (sale.originalTotal == null) sale.originalTotal = round2(Number(sale.total) || 0)

  // Бонусы возвращаем пропорционально сумме возврата (смешанная оплата: бонусы + нал/карта)
  const bonusBefore = round2(Number(sale.bonusSpent) || 0)
  const origGoods = round2(
    Number(sale.orderGoodsTotal)
    || (Number(sale.originalTotal) || 0) + bonusBefore
    || returnTotal,
  )
  let cutBonus = 0
  if (bonusBefore > 0 && origGoods > 0) {
    cutBonus = round2(Math.min(bonusBefore, bonusBefore * (returnTotal / origGoods)))
  }

  let remainCashCut = round2(Math.max(0, returnTotal - cutBonus))
  let cutDebt = 0
  let cutCash = 0
  let cutCard = 0
  let cutWallet = 0
  const debtBefore = round2(
    Number(sale.debtAdded) > 0
      ? Number(sale.debtAdded)
      : (sale.paymentMethod === 'credit' ? (Number(sale.total) || 0) : 0),
  )
  if (debtBefore > 0 && remainCashCut > 0) {
    cutDebt = Math.min(debtBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutDebt)
  }
  const walletBefore = round2(Number(sale.paidWallet) || 0)
  if (walletBefore > 0 && remainCashCut > 0) {
    cutWallet = Math.min(walletBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutWallet)
  }
  const cashBefore = round2(Number(sale.paidCash) || 0)
  if (cashBefore > 0 && remainCashCut > 0) {
    cutCash = Math.min(cashBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCash)
  }
  const cardBefore = round2(Number(sale.paidCard) || 0)
  if (cardBefore > 0 && remainCashCut > 0) {
    cutCard = Math.min(cardBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCard)
  }
  // leftover (rounding) → cash then card; остаток — снова в бонусы
  if (remainCashCut > 0) {
    if (cashBefore - cutCash > 0) {
      const extra = Math.min(cashBefore - cutCash, remainCashCut)
      cutCash = round2(cutCash + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
    if (remainCashCut > 0 && cardBefore - cutCard > 0) {
      const extra = Math.min(cardBefore - cutCard, remainCashCut)
      cutCard = round2(cutCard + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
    if (remainCashCut > 0 && bonusBefore - cutBonus > 0) {
      const extra = Math.min(bonusBefore - cutBonus, remainCashCut)
      cutBonus = round2(cutBonus + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
  }

  sale.debtAdded = Math.max(0, round2(debtBefore - cutDebt))
  sale.paidCash = Math.max(0, round2(cashBefore - cutCash))
  sale.paidCard = Math.max(0, round2(cardBefore - cutCard))
  sale.paidWallet = Math.max(0, round2(walletBefore - cutWallet))
  sale.bonusSpent = Math.max(0, round2(bonusBefore - cutBonus))
  sale.total = Math.max(0, round2((Number(sale.total) || 0) - (returnTotal - cutBonus)))

  const skipBalanceRestore = !!(meta.appliedLocal || meta.queuedOffline || meta.skipBalances)

  if (cutDebt > 0) {
    const { client, card } = resolveSaleClientAndCard(db, sale)
    if (skipBalanceRestore && meta.clientDebtAfter != null) {
      applyDebtToPair(client, card, meta.clientDebtAfter)
    } else {
      applyDebtToPair(client, card, effectiveDebt(client, card) - cutDebt)
    }
    if (client) {
      applyDebtRepayment(client, card, cutDebt, {
        desc: `Возврат · ${sale.orderId || sale.number}`,
        saleId: sale.id,
        orderId: sale.orderId,
      })
    }
  }

  // Возврат денег на кошелёк клиента (если платили с кошелька)
  if (cutWallet > 0 && !skipBalanceRestore) {
    const { client, card } = resolveSaleClientAndCard(db, sale)
    if (card) card.wallet = round2((Number(card.wallet) || 0) + cutWallet)
    if (client) client.wallet = round2((Number(client.wallet) || 0) + cutWallet)
  }

  // Возврат бонусов клиенту
  if (cutBonus > 0 && !skipBalanceRestore) {
    const { client, card } = resolveSaleClientAndCard(db, sale)
    if (card) {
      card.bonus = round2((Number(card.bonus) || 0) + cutBonus)
    }
    if (client) {
      client.bonus = card
        ? card.bonus
        : round2((Number(client.bonus) || 0) + cutBonus)
    }
    const order = (db.orders || []).find(o => String(o.id) === String(sale.orderId || ''))
    if (order) {
      order.bonusSpent = Math.max(0, round2((Number(order.bonusSpent) || 0) - cutBonus))
    }
    sale._bonusRefunded = cutBonus
    sale._bonusRefundPhone = client?.phone || sale.clientPhone || ''
  }

  const fullyReturned = items.every(it => {
    const left = round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0))
    return left <= 0
  })

  const cashier = sale.cashierId ? db.cashiers.find(c => c.id === sale.cashierId) : null
  if (cashier) {
    if (fullyReturned) cashier.salesCount = Math.max(0, Number(cashier.salesCount || 0) - 1)
    cashier.salesTotal = Math.max(0, round2((Number(cashier.salesTotal) || 0) - returnTotal))
  }
  const shift = sale.shiftId ? db.posShifts.find(s => s.id === sale.shiftId) : null
  if (shift && shift.status === 'open' && !skipBalanceRestore) {
    if (fullyReturned) shift.salesCount = Math.max(0, Number(shift.salesCount || 0) - 1)
    shift.salesCash = Math.max(0, round2((Number(shift.salesCash) || 0) - cutCash))
    shift.salesCard = Math.max(0, round2((Number(shift.salesCard) || 0) - cutCard))
    shift.salesCredit = Math.max(0, round2((Number(shift.salesCredit) || 0) - cutDebt))
    if (cutWallet > 0) shift.salesWallet = Math.max(0, round2((Number(shift.salesWallet) || 0) - cutWallet))
  }

  if (!Array.isArray(sale.returns)) sale.returns = []
  sale.returns.push({
    atIso: nowIso(),
    total: returnTotal,
    cutCash,
    cutCard,
    cutDebt,
    cutWallet,
    cutBonus,
    note: String(meta.note || '').trim(),
    cashierId: String(meta.cashierId || '').trim(),
    items: returnLines,
  })

  sale.returnedAtIso = nowIso()
  sale.returnNote = String(meta.note || '').trim()
  sale.returnedByCashierId = String(meta.cashierId || '').trim()
  sale.status = fullyReturned ? 'returned' : 'partial'
  sale.lastReturnTotal = returnTotal
  if (sale.totalCost != null && Number(sale.originalTotal) > 0) {
    const ratio = returnTotal / Number(sale.originalTotal)
    const cutCost = round2((Number(sale.totalCost) || 0) * Math.min(1, ratio))
    sale.totalCost = Math.max(0, round2((Number(sale.totalCost) || 0) - cutCost))
    sale.profit = round2((Number(sale.total) || 0) - (Number(sale.totalCost) || 0))
  }
  const ledBase = {
    posId: sale.posId || '',
    shiftId: sale.shiftId || '',
    cashierId: String(meta.cashierId || sale.cashierId || ''),
    cashierName: sale.cashierName || '',
    refType: 'sale_return',
    refId: sale.id,
  }
  if (cutCash > 0) {
    appendMoneyLedger(db, {
      ...ledBase,
      type: 'sale_return_cash',
      amount: cutCash,
      direction: 'out',
      cashAffect: true,
      reason: `Возврат нал · ${sale.orderId || sale.number}`,
      note: String(meta.note || '').trim(),
    })
  }
  if (cutCard > 0) {
    appendMoneyLedger(db, {
      ...ledBase,
      type: 'sale_return_card',
      amount: cutCard,
      direction: 'out',
      cashAffect: false,
      reason: `Возврат карта · ${sale.orderId || sale.number}`,
      note: String(meta.note || '').trim(),
    })
  }
  if (cutWallet > 0) {
    appendMoneyLedger(db, {
      ...ledBase,
      type: 'sale_return_wallet',
      amount: cutWallet,
      direction: 'info',
      cashAffect: false,
      reason: `Возврат на кошелёк · ${sale.orderId || sale.number}`,
      note: String(meta.note || '').trim(),
    })
  }
  return sale
}

export function getPosFinanceSummary(db) {
  ensurePosCollections(db)
  const sales = db.posSales || []
  const receipts = db.stockReceipts || []
  const expenses = db.expenses || []
  const supplierPayments = db.supplierPayments || []
  return {
    revenue: round2(sales.reduce((sum, row) => sum + (Number(row.total) || 0), 0)),
    cashRevenue: round2(sales.reduce((sum, row) => sum + (Number(row.paidCash) || 0), 0)),
    cardRevenue: round2(sales.reduce((sum, row) => sum + (Number(row.paidCard) || 0), 0)),
    creditIssued: round2(sales.reduce((sum, row) => sum + (Number(row.debtAdded) || 0), 0)),
    cogs: round2(receipts.reduce((sum, row) => sum + (row.stockAdjustment ? 0 : Number(row.totalCost) || 0), 0)),
    expenses: round2(expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    supplierPayments: round2(supplierPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    supplierDebt: round2((db.suppliers || []).reduce((sum, row) => sum + (Number(row.payableAmount) || 0), 0)),
    clientDebt: round2((db.clients || []).reduce((sum, row) => sum + (Number(row.debt) || 0), 0)),
    salesCount: sales.length,
  }
}

export function getPosReport(db) {
  ensurePosCollections(db)
  return {
    summary: getPosFinanceSummary(db),
    topProducts: Object.values((db.posSales || []).reduce((acc, sale) => {
      for (const item of sale.items || []) {
        const key = String(item.productId)
        const prev = acc[key] || { productId: item.productId, productName: item.productName, qty: 0, revenue: 0 }
        prev.qty = round2(prev.qty + (Number(item.qty) || 0))
        prev.revenue = round2(prev.revenue + (Number(item.lineTotal) || 0))
        acc[key] = prev
      }
      return acc
    }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    recentSales: listPosSales(db).slice(0, 20),
    openShifts: (db.posShifts || []).filter(s => s.status === 'open'),
  }
}
