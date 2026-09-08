/**
 * Batch apply outbox ops (QueueKind).
 * Helpers — функции из index.js / posLogic (findOpRef, rememberKnownOp, persist, …).
 * client upsert/delete, card_topup, debt_repay, card_loyalty — inline на db.clients/db.cards;
 * apply* helpers из index перекрывают при наличии.
 */

import { allocateProductCodes, allocateProductBarcodes, nextFreeProductCode } from './productCodes.js'
import { stripHeavyPhotoFields } from './productPhotoPipeline.js'

function okResult(clientRef, result, localId, extra = {}) {
  return { clientRef, ok: true, result, localId, ...extra }
}

function failFallback(clientRef, error, kind) {
  return { clientRef, ok: false, error: String(error || 'unsupported'), fallback: true, kind }
}

function failHard(clientRef, error) {
  return { clientRef, ok: false, error: String(error || 'batch op failed'), fallback: true }
}

function takeBody(payload, clientRef) {
  const body = payload && typeof payload === 'object' ? { ...payload } : {}
  if (clientRef) body.clientRef = clientRef
  delete body._revert
  delete body._prev
  return body
}

function isLocalishId(id) {
  const s = String(id || '').trim()
  if (!s) return true
  if (/^local[-_]/i.test(s)) return true
  if (/^tmp[-_]/i.test(s)) return true
  const n = Number(s)
  if (Number.isFinite(n) && n <= 0) return true
  return false
}

function slugifyCategory(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || `cat-${Date.now()}`
}

function applyProductUpsertInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist, broadcastProduct, broadcastPosUpdate, setProductStockExact } = helpers
  const body = { ...(payload.product || payload) }
  delete body.localId
  delete body.clientRef
  delete body._prev
  const rawId = Number(body.id)
  const isLocal = !Number.isFinite(rawId) || rawId <= 0

  if (isLocal) {
    if (typeof db._seq !== 'object' || db._seq == null) db._seq = {}
    if (typeof db._seq.product !== 'number') db._seq.product = 0
    const id = ++db._seq.product
    const sellType = body.sellType || 'piece'
    const needPlu = sellType === 'weight'
    const codes = allocateProductCodes(db.products || [], {
      art: body.art,
      plu: needPlu ? body.plu : '',
    }, null, { needPlu })
    const preferSerial = Number(codes.art) || nextFreeProductCode(db.products || [])
    const bars = allocateProductBarcodes(db.products || [], {
      barcode: body.barcode,
      barcodes: body.barcodes,
    }, preferSerial)
    const p = {
      id,
      art: codes.art,
      e: body.e || '📦',
      name: body.name,
      price: body.price || 0,
      costPrice: body.costPrice ?? null,
      cat: body.cat || '',
      catId: body.catId || '',
      unit: body.unit || 'шт',
      stock: body.stock || 0,
      hot: !!body.hot,
      desc: body.desc,
      brand: body.brand,
      country: body.country,
      barcode: bars.barcode,
      barcodes: bars.barcodes,
      plu: needPlu ? (codes.plu || null) : null,
      organic: !!body.organic,
      sellType,
      unitGrams: body.unitGrams,
      weightStep: body.weightStep,
      minWeight: body.minWeight,
      packWeightGrams: body.packWeightGrams != null && Number(body.packWeightGrams) > 0
        ? Math.round(Number(body.packWeightGrams))
        : undefined,
      old: body.old ?? null,
      photo: body.photo ? String(body.photo) : undefined,
      photoThumb: body.photoThumb ? String(body.photoThumb) : undefined,
      bulkPricing: Array.isArray(body.bulkPricing) ? body.bulkPricing : undefined,
      docVersion: 1,
      updatedAtIso: new Date().toISOString(),
      clientRef,
    }
    if (!Array.isArray(db.products)) db.products = []
    db.products.push(p)
    if (Number(p.stock) > 0 && typeof setProductStockExact === 'function') {
      setProductStockExact(db, p.id, p.stock, { reason: 'Начальный остаток', createdBy: body?.createdBy || '' })
    } else {
      p.stock = Number(p.stock) > 0 ? p.stock : 0
    }
    rememberKnownOp?.('product_upsert', clientRef, p)
    persist?.()
    broadcastProduct?.(p)
    broadcastPosUpdate?.({ kind: 'product', id: p.id })
    return stripHeavyPhotoFields(p)
  }

  const p = (db.products || []).find(x => Number(x.id) === rawId)
  if (!p) {
    const err = new Error('Товар не найден')
    err.status = 404
    throw err
  }
  const expectedDoc = body.expectedDocVersion != null
    ? body.expectedDocVersion
    : (payload.expectedDocVersion != null
      ? payload.expectedDocVersion
      : (body.docVersion != null ? Number(body.docVersion) - 1 : undefined))
  delete body.expectedDocVersion
  if (expectedDoc != null && expectedDoc !== '') {
    const cur = Number(p.docVersion) || 0
    const exp = Number(expectedDoc)
    if (Number.isFinite(exp) && exp !== cur) {
      const err = new Error(`Товар уже меняли (версия ${cur}, ожидали ${exp})`)
      err.status = 409
      throw err
    }
  }
  const patch = { ...body }
  delete patch.id
  delete patch.clientRef
  delete patch.docVersion
  delete patch.stock
  Object.assign(p, patch)
  p.docVersion = (Number(p.docVersion) || 0) + 1
  p.updatedAtIso = new Date().toISOString()
  if (clientRef) p.clientRef = clientRef
  rememberKnownOp?.('product_upsert', clientRef, p)
  persist?.()
  broadcastProduct?.(p)
  broadcastPosUpdate?.({ kind: 'product', id: p.id })
  return stripHeavyPhotoFields(p)
}

function applyCategoryUpsertInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist, broadcastCategory } = helpers
  const body = { ...(payload.category || payload) }
  delete body.localId
  delete body.clientRef
  const rawId = Number(body.id)
  const isLocal = !Number.isFinite(rawId) || rawId <= 0
  if (!Array.isArray(db.categories)) db.categories = []
  if (typeof db._seq !== 'object' || db._seq == null) db._seq = {}
  if (typeof db._seq.category !== 'number') db._seq.category = 0

  if (isLocal) {
    const id = ++db._seq.category
    const slug = String(body.slug || '').trim() || slugifyCategory(body.name)
    if (db.categories.some(c => c.slug === slug)) {
      throw new Error('slug exists')
    }
    const parent_id = body.parent_id ?? null
    if (parent_id != null && !db.categories.some(c => c.id === Number(parent_id))) {
      throw new Error('parent not found')
    }
    const c = {
      id,
      name: String(body.name || '').trim(),
      slug,
      parent_id: parent_id == null ? null : Number(parent_id),
      emoji: body.emoji || '📦',
      desc: String(body.desc || '').trim(),
      order: Number(body.order) || 99,
      active: body.active !== false,
    }
    if (!c.name) throw new Error('name required')
    db.categories.push(c)
    rememberKnownOp?.('category_upsert', clientRef, c)
    persist?.()
    broadcastCategory?.(c)
    return c
  }

  const idx = db.categories.findIndex(c => c.id === rawId)
  if (idx < 0) throw new Error('not found')
  const cur = db.categories[idx]
  const parent_id = body.parent_id !== undefined
    ? (body.parent_id == null ? null : Number(body.parent_id))
    : cur.parent_id
  if (parent_id === rawId) throw new Error('invalid parent')
  if (parent_id != null && !db.categories.some(c => c.id === parent_id)) {
    throw new Error('parent not found')
  }
  const next = {
    ...cur,
    name: body.name != null ? String(body.name).trim() : cur.name,
    emoji: body.emoji != null ? body.emoji : cur.emoji,
    desc: body.desc != null ? String(body.desc).trim() : cur.desc,
    parent_id,
    order: body.order != null ? Number(body.order) : cur.order,
    active: body.active != null ? !!body.active : cur.active !== false,
  }
  if (!next.name) throw new Error('name required')
  db.categories[idx] = next
  rememberKnownOp?.('category_upsert', clientRef, next)
  persist?.()
  broadcastCategory?.(next)
  return next
}

function digitsPhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function findClientInDb(db, body, clientRef) {
  const clients = Array.isArray(db.clients) ? db.clients : []
  const id = body?.id != null ? String(body.id).trim() : ''
  if (id && !isLocalishId(id)) {
    const byId = clients.find(c => String(c.id) === id)
    if (byId) return byId
  }
  const phone = digitsPhone(body?.phone)
  if (phone) {
    const byPhone = clients.find(c => digitsPhone(c.phone) === phone)
    if (byPhone) return byPhone
  }
  if (clientRef) {
    const byRef = clients.find(c => c.clientRef === clientRef)
    if (byRef) return byRef
  }
  return null
}

function applyClientUpsertInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist } = helpers
  if (!Array.isArray(db.clients)) db.clients = []
  const body = { ...(payload.client || payload) }
  delete body.localId
  delete body.clientRef
  delete body._prev
  delete body.expectedDocVersion
  const existing = findClientInDb(db, body, clientRef)
  if (existing) {
    const patch = { ...body }
    delete patch.id
    delete patch.docVersion
    Object.assign(existing, patch)
    existing.docVersion = (Number(existing.docVersion) || 0) + 1
    existing.updatedAtIso = new Date().toISOString()
    if (clientRef) existing.clientRef = clientRef
    rememberKnownOp?.('client_upsert', clientRef, existing)
    persist?.()
    return existing
  }
  const nums = db.clients
    .map(c => parseInt(String(c.id).replace(/\D/g, ''), 10))
    .filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const id = isLocalishId(body.id) || !body.id
    ? `U-${String(n).padStart(2, '0')}`
    : String(body.id)
  const row = {
    id,
    name: body.name || '',
    phone: body.phone || '',
    email: body.email || '',
    addr: body.addr || '',
    card: body.card || '',
    level: body.level || 'basic',
    orders: Number(body.orders) || 0,
    spent: Number(body.spent) || 0,
    debt: Number(body.debt) || 0,
    bonus: Number(body.bonus) || 0,
    wallet: Math.max(0, Number(body.wallet) || 0),
    debtLimit: Number(body.debtLimit) || 0,
    blocked: !!body.blocked,
    vip: !!body.vip,
    note: body.note || '',
    accountStatus: 'active',
    debtEnabled: !!body.debtEnabled || (Number(body.debt) || 0) > 0,
    docVersion: 1,
    updatedAtIso: new Date().toISOString(),
    createdAt: body.createdAt || new Date().toISOString().slice(0, 10),
    clientRef,
  }
  db.clients.push(row)
  rememberKnownOp?.('client_upsert', clientRef, row)
  persist?.()
  return row
}

function applyClientDeleteInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist, recordSyncDelete } = helpers
  if (!Array.isArray(db.clients)) db.clients = []
  const id = String(payload.id || '').trim()
  const phone = digitsPhone(payload.phone)
  let client = id ? db.clients.find(c => String(c.id) === id) : null
  if (!client && phone) {
    client = db.clients.find(c => digitsPhone(c.phone) === phone)
  }
  if (client) {
    const cid = client.id
    db.clients = db.clients.filter(c => c !== client)
    recordSyncDelete?.(db, 'client', cid)
  }
  const result = { ok: true, id: client?.id || id || null }
  rememberKnownOp?.('client_delete', clientRef, result)
  persist?.()
  return result
}

function findCardInDb(db, num) {
  const key = String(num || '').trim().toUpperCase()
  if (!key) return null
  return (db.cards || []).find(c => String(c.num || '').trim().toUpperCase() === key) || null
}

function applyCardTopupInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist, createFinanceMove } = helpers
  if (!Array.isArray(db.cards)) db.cards = []
  const num = String(payload.num || payload.cardNum || '').trim().toUpperCase()
  const card = findCardInDb(db, num)
  if (!card) throw new Error('Карта не найдена')
  const cash = Math.round((Number(payload.cash) || 0) * 100) / 100
  if (!(cash > 0)) throw new Error('Укажите сумму пополнения')
  const credit = Math.round((Number(payload.credit) || cash) * 100) / 100
  const addToBonus = credit > 0 ? credit : cash
  const bonusEarned = Math.max(0, Math.round((addToBonus - cash) * 100) / 100)

  let move = null
  if (typeof createFinanceMove === 'function') {
    move = createFinanceMove(db, {
      type: 'deposit',
      amount: cash,
      note: String(payload.note || `Пополнение бонусов · ${card.client || card.phone || card.num}`),
      reason: 'Пополнение бонусов клиента',
      refType: 'card_topup',
      cardNum: num,
      createdBy: payload.cashierName,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      shiftId: payload.shiftId,
      posId: payload.posId,
      clientRef,
      createdAtIso: payload.createdAtIso,
    })
  }

  if (payload.wallet != null || payload.addToWallet) {
    const wAdd = Math.round((Number(payload.addToWallet || payload.wallet || cash) || 0) * 100) / 100
    card.wallet = Math.round((Math.max(0, Number(card.wallet) || 0) + wAdd) * 100) / 100
  } else {
    card.posCashBonus = Math.round((Math.max(0, Number(card.posCashBonus) || 0) + addToBonus) * 100) / 100
    card.bonus = Math.round((Math.max(0, Number(card.bonus) || 0) + addToBonus) * 100) / 100
    card.bonusPayVersion = (Number(card.bonusPayVersion) || 0) + 1
    card.wallet = 0
  }

  const linked = (db.clients || []).find(c =>
    c.card && String(c.card).toUpperCase() === num
    || (card.phone && digitsPhone(c.phone) === digitsPhone(card.phone)),
  )
  if (linked) {
    linked.bonus = card.bonus
    linked.wallet = card.wallet
  }

  const result = { financeMove: move, bonusEarned, addToBonus, card }
  rememberKnownOp?.('card_topup', clientRef, result)
  persist?.()
  return result
}

function applyDebtRepayInline(db, { clientRef, payload }, helpers) {
  const {
    rememberKnownOp,
    persist,
    applyDebtRepayToShift,
    applyDebtRepayment,
  } = helpers
  const num = String(payload.num || payload.cardNum || '').trim().toUpperCase()
  const card = findCardInDb(db, num)
  if (!card) throw new Error('Карта не найдена')
  const amount = Math.round((Number(payload.amount) || 0) * 100) / 100
  if (!(amount > 0)) throw new Error('Укажите сумму погашения')
  const method = String(payload.method || 'cash').toLowerCase() === 'card' ? 'card' : 'cash'
  const linkedClient = (db.clients || []).find(c =>
    (c.card && String(c.card).toUpperCase() === num)
    || (card.phone && digitsPhone(c.phone) === digitsPhone(card.phone))
    || (payload.clientId && String(c.id) === String(payload.clientId)),
  )
  const prevDebt = Math.max(Number(card.debt) || 0, Number(linkedClient?.debt) || 0)
  const nextDebt = Math.round(Math.max(0, prevDebt - amount) * 100) / 100
  const repaidTowardDebt = Math.round(Math.max(0, prevDebt - nextDebt) * 100) / 100

  if (linkedClient && repaidTowardDebt > 0.001 && typeof applyDebtRepayment === 'function') {
    try {
      applyDebtRepayment(linkedClient, card, repaidTowardDebt, {
        desc: method === 'cash' ? 'Погашение долга наличными' : 'Погашение долга картой',
      })
    } catch { /* журнал; баланс ниже */ }
  }
  if (linkedClient) linkedClient.debt = nextDebt
  card.debt = nextDebt
  card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1

  let till = null
  if (typeof applyDebtRepayToShift === 'function') {
    till = applyDebtRepayToShift(db, {
      amount,
      method,
      shiftId: payload.shiftId,
      posId: payload.posId,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      cardNum: num,
      clientName: card.client || linkedClient?.name || '',
      note: String(payload.note || '').trim(),
    })
  }

  const result = {
    client: linkedClient || null,
    amount,
    method,
    prevDebt,
    nextDebt,
    bonusEarned: 0,
    till,
  }
  rememberKnownOp?.('debt_repay', clientRef, result)
  persist?.()
  return result
}

function applyCardLoyaltyPatchInline(db, { clientRef, payload }, helpers) {
  const { rememberKnownOp, persist } = helpers
  if (!Array.isArray(db.cards)) db.cards = []
  const num = String(payload.num || payload.cardNum || '').trim().toUpperCase()
  if (!num) throw new Error('num required')
  let card = findCardInDb(db, num)
  if (!card) {
    card = {
      num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      issued: new Date().toISOString().slice(0, 10),
    }
    db.cards.push(card)
  }
  const patch = { ...(payload.cardPatch || payload) }
  delete patch.num
  delete patch.cardNum
  delete patch.clientRef
  delete patch.clientId
  delete patch.clientPatch
  delete patch.cardPatch
  delete patch.localId
  delete patch.debtPayVersion
  delete patch.bonusPayVersion
  for (const key of ['bonus', 'debt', 'debtLimit', 'level', 'vip', 'debtEnabled', 'wallet', 'status', 'client', 'phone', 'posCashBonus']) {
    if (patch[key] !== undefined) card[key] = patch[key]
  }
  if (payload.clientId || payload.clientPatch) {
    const clientId = String(payload.clientId || '')
    const client = (db.clients || []).find(c =>
      (clientId && String(c.id) === clientId)
      || (c.card && String(c.card).toUpperCase() === num)
      || (card.phone && digitsPhone(c.phone) === digitsPhone(card.phone)),
    )
    if (client) {
      const cp = { ...(payload.clientPatch || {}) }
      for (const key of ['bonus', 'debt', 'debtLimit', 'level', 'vip', 'debtEnabled', 'wallet']) {
        if (cp[key] !== undefined) client[key] = cp[key]
        else if (patch[key] !== undefined && cp[key] === undefined) client[key] = patch[key]
      }
    }
  }
  rememberKnownOp?.('card_loyalty_patch', clientRef, card)
  persist?.()
  return card
}

/**
 * @param {object} db
 * @param {{ kind: string, clientRef: string, payload?: object, localId?: string }} op
 * @param {object} helpers
 */
export function applySyncBatchOp(db, op, helpers) {
  const kind = String(op?.kind || '').trim()
  const clientRef = String(op?.clientRef || '').trim()
  const payload = op?.payload && typeof op.payload === 'object' ? op.payload : {}
  const localId = op?.localId != null ? String(op.localId) : undefined

  if (!kind || !clientRef) {
    return failFallback(clientRef, 'missing kind/clientRef', kind)
  }

  const h = helpers || {}
  const {
    findOpRef,
    rememberKnownOp,
    persist,
    broadcastPosUpdate,
    broadcastProduct,
    broadcastCategory,
    recordSyncDelete,
    createPosSale,
    openPosShift,
    closePosShift,
    returnPosSale,
    createFinanceMove,
    deleteFinanceMove,
    applyDebtRepayToShift,
    applyDebtRepayment,
    convertVaultCardToCash,
    convertVaultCashToCard,
    createStockReceipt,
    updateStockReceipt,
    deleteStockReceipt,
    createStockWriteoff,
    updateStockWriteoff,
    deleteStockWriteoff,
    updateProductStockLayer,
    deleteProductStockLayer,
    createStockRevision,
    updateStockRevision,
    deleteStockRevision,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    createSupplierPayment,
    deleteSupplierPayment,
    createExpense,
    deleteExpense,
    createPosPoint,
    updatePosPoint,
    deletePosPoint,
    createCashier,
    updateCashier,
    setProductStockExact,
    removeCategoryTree,
    applyProductUpsert,
    applyProductDelete,
    applyClientUpsert,
    applyClientDelete,
    applyCategoryUpsert,
    applyCategoryDelete,
    applyCategoryReorder,
    applyCardTopup,
    applyDebtRepay,
    applyCardLoyaltyPatch,
  } = h

  try {
    const known = findOpRef?.(kind, clientRef)
    if (known != null) {
      return okResult(clientRef, known, localId, { idempotent: true })
    }

    switch (kind) {
      case 'sale': {
        const body = takeBody(payload, clientRef)
        const dup = (db.posSales || []).find(s => s.clientRef === clientRef)
        if (dup) {
          rememberKnownOp?.(kind, clientRef, dup)
          return okResult(clientRef, dup, localId, { idempotent: true })
        }
        const row = createPosSale(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'sale', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'shift_open': {
        const body = takeBody(payload, clientRef)
        const knownShift = (db.posShifts || []).find(s => s.clientRef === clientRef)
        if (knownShift) {
          rememberKnownOp?.(kind, clientRef, knownShift)
          return okResult(clientRef, knownShift, localId, { idempotent: true })
        }
        const row = openPosShift(db, body)
        if (clientRef) row.clientRef = clientRef
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'shift', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'shift_close': {
        const body = takeBody(payload, clientRef)
        const shiftId = String(body.id || body.shiftId || payload.id || '')
        const knownClose = (db.posShifts || []).find(s => s.closeClientRef === clientRef)
        if (knownClose) {
          rememberKnownOp?.(kind, clientRef, knownClose)
          return okResult(clientRef, knownClose, localId, { idempotent: true })
        }
        if (!shiftId || isLocalishId(shiftId)) {
          return failFallback(clientRef, 'shift id required', kind)
        }
        const row = closePosShift(db, shiftId, body)
        if (clientRef) row.closeClientRef = clientRef
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'shift', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'sale_return': {
        const body = takeBody(payload, clientRef)
        const saleId = String(body.saleId || body.id || payload.saleId || '')
        if (!saleId || isLocalishId(saleId)) {
          return failFallback(clientRef, 'saleId required', kind)
        }
        const row = returnPosSale(db, saleId, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'sale', id: saleId })
        return okResult(clientRef, row, localId)
      }

      case 'finance_move': {
        const body = takeBody(payload, clientRef)
        const row = createFinanceMove(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'finance-move', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'finance_move_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteFinanceMove(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'finance-move', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'vault_card_to_cash': {
        const body = takeBody(payload, clientRef)
        const row = convertVaultCardToCash(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'vault-convert', id: row?.id })
        return okResult(clientRef, row, localId)
      }

      case 'vault_cash_to_card': {
        const body = takeBody(payload, clientRef)
        const row = convertVaultCashToCard(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'vault-convert', id: row?.id })
        return okResult(clientRef, row, localId)
      }

      case 'stock_receipt_create': {
        const body = takeBody(payload, clientRef)
        const row = createStockReceipt(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'receipt', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'stock_receipt_update': {
        const body = takeBody(payload, clientRef)
        const id = String(body.id || payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = updateStockReceipt(db, id, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'receipt', id: row.id, updated: true })
        return okResult(clientRef, row, localId)
      }

      case 'stock_receipt_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteStockReceipt(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'receipt', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'stock_writeoff_create': {
        const body = takeBody(payload, clientRef)
        const row = createStockWriteoff(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'writeoff', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'stock_writeoff_update': {
        const body = takeBody(payload, clientRef)
        const id = String(body.id || payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = updateStockWriteoff(db, id, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'writeoff', id: row.id, updated: true })
        return okResult(clientRef, row, localId)
      }

      case 'stock_writeoff_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteStockWriteoff(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'writeoff', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'stock_layer_update': {
        const receiptId = String(payload.receiptId || '')
        const productId = Number(payload.productId)
        if (!receiptId || !Number.isFinite(productId)) {
          return failFallback(clientRef, 'receiptId/productId required', kind)
        }
        const row = updateProductStockLayer(db, receiptId, productId, takeBody(payload, clientRef))
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'stock-layer', receiptId, productId })
        return okResult(clientRef, row, localId)
      }

      case 'stock_layer_delete': {
        const receiptId = String(payload.receiptId || '')
        const productId = Number(payload.productId)
        if (!receiptId || !Number.isFinite(productId)) {
          return failFallback(clientRef, 'receiptId/productId required', kind)
        }
        const row = deleteProductStockLayer(db, receiptId, productId)
        rememberKnownOp?.(kind, clientRef, row || { receiptId, productId, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'stock-layer', receiptId, productId, deleted: true })
        return okResult(clientRef, row || { receiptId, productId, ok: true }, localId)
      }

      case 'stock_revision_create': {
        const body = takeBody(payload, clientRef)
        const row = createStockRevision(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'revision', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'stock_revision_update': {
        const body = takeBody(payload, clientRef)
        const id = String(body.id || payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = updateStockRevision(db, id, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'revision', id: row.id, updated: true })
        return okResult(clientRef, row, localId)
      }

      case 'stock_revision_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteStockRevision(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'revision', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'supplier_upsert': {
        const body = { ...(payload.supplier || payload) }
        delete body.localId
        delete body.clientRef
        delete body.payableAmount
        delete body.totalSupplied
        delete body.totalPaid
        delete body.payVersion
        delete body.supplyVersion
        delete body.debtVersion
        delete body.lastDeliveryAtIso
        const rawId = String(body.id || '')
        let row
        if (!rawId || isLocalishId(rawId)) {
          const { id: _drop, ...createBody } = body
          row = createSupplier(db, { ...createBody, clientRef })
        } else {
          row = updateSupplier(db, rawId, { ...body, clientRef })
        }
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'supplier', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'supplier_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteSupplier(db, id)
        recordSyncDelete?.(db, 'supplier', id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'supplier', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'supplier_payment_create': {
        const supplierId = String(payload.supplierId || '')
        if (!supplierId || isLocalishId(supplierId)) {
          return failFallback(clientRef, 'supplierId required', kind)
        }
        const row = createSupplierPayment(db, supplierId, takeBody(payload, clientRef))
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'supplier_payment', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'supplier_payment_delete': {
        const supplierId = String(payload.supplierId || '')
        const paymentId = String(payload.paymentId || payload.id || '')
        if (!supplierId || !paymentId || isLocalishId(paymentId)) {
          return failFallback(clientRef, 'supplierId/paymentId required', kind)
        }
        const row = deleteSupplierPayment(db, supplierId, paymentId, takeBody(payload, clientRef))
        rememberKnownOp?.(kind, clientRef, row || { id: paymentId, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'supplier_payment', id: paymentId, deleted: true })
        return okResult(clientRef, row || { id: paymentId, ok: true }, localId)
      }

      case 'expense_create': {
        const body = takeBody(payload, clientRef)
        const row = createExpense(db, body)
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'expense', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'expense_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deleteExpense(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'expense', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'pos_point_upsert': {
        const body = { ...(payload.point || payload) }
        delete body.localId
        delete body.clientRef
        const rawId = String(body.id || localId || '')
        let row
        if (!rawId || isLocalishId(rawId)) {
          const { id: _drop, ...createBody } = body
          row = createPosPoint(db, { ...createBody, clientRef })
        } else {
          row = updatePosPoint(db, rawId, { ...body, clientRef })
        }
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'pos', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'pos_point_delete': {
        const id = String(payload.id || '')
        if (!id || isLocalishId(id)) return failFallback(clientRef, 'id required', kind)
        const row = deletePosPoint(db, id)
        rememberKnownOp?.(kind, clientRef, row || { id, ok: true })
        persist?.()
        broadcastPosUpdate?.({ kind: 'pos', id, deleted: true })
        return okResult(clientRef, row || { id, ok: true }, localId)
      }

      case 'cashier_upsert': {
        const body = { ...(payload.cashier || payload) }
        delete body.localId
        delete body.clientRef
        const rawId = String(body.id || localId || '')
        let row
        if (!rawId || isLocalishId(rawId)) {
          row = createCashier(db, {
            name: String(body.name || 'Кассир'),
            pin: String(body.pin || '0000'),
            clientRef,
          })
        } else if (typeof updateCashier === 'function') {
          row = updateCashier(db, rawId, { ...body, clientRef })
        } else {
          row = { id: rawId, ...body }
        }
        rememberKnownOp?.(kind, clientRef, row)
        persist?.()
        broadcastPosUpdate?.({ kind: 'cashier', id: row.id })
        return okResult(clientRef, row, localId)
      }

      case 'product_upsert': {
        if (typeof applyProductUpsert === 'function') {
          const row = applyProductUpsert(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyProductUpsertInline(db, { clientRef, payload }, {
          rememberKnownOp, persist, broadcastProduct, broadcastPosUpdate, setProductStockExact,
        })
        return okResult(clientRef, row, localId)
      }

      case 'product_delete': {
        if (typeof applyProductDelete === 'function') {
          const row = applyProductDelete(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const id = Number(payload.id)
        if (!Number.isFinite(id) || id <= 0) return failFallback(clientRef, 'id required', kind)
        const idx = (db.products || []).findIndex(p => Number(p.id) === id)
        if (idx < 0) {
          const stub = { id, ok: true }
          rememberKnownOp?.(kind, clientRef, stub)
          return okResult(clientRef, stub, localId, { idempotent: true })
        }
        const [removed] = db.products.splice(idx, 1)
        recordSyncDelete?.(db, 'product', id)
        rememberKnownOp?.(kind, clientRef, { id, ok: true })
        persist?.()
        if (removed) broadcastProduct?.(removed)
        broadcastPosUpdate?.({ kind: 'product', id, deleted: true })
        return okResult(clientRef, { id, ok: true }, localId)
      }

      case 'category_upsert': {
        if (typeof applyCategoryUpsert === 'function') {
          const row = applyCategoryUpsert(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyCategoryUpsertInline(db, { clientRef, payload }, {
          rememberKnownOp, persist, broadcastCategory,
        })
        return okResult(clientRef, row, localId)
      }

      case 'category_delete': {
        if (typeof applyCategoryDelete === 'function') {
          const row = applyCategoryDelete(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const ids = Array.isArray(payload.ids)
          ? payload.ids.map(Number)
          : [Number(payload.id)]
        const serverIds = ids.filter(id => Number.isFinite(id) && id > 0)
        if (!serverIds.length) return failFallback(clientRef, 'id required', kind)
        const deleted = []
        for (const id of serverIds) {
          if (typeof removeCategoryTree === 'function') {
            const result = removeCategoryTree(db, id)
            if (result?.ok) {
              deleted.push(...(result.deleted || [id]))
              for (const cid of (result.deleted || [id])) {
                recordSyncDelete?.(db, 'category', cid)
              }
            }
          } else {
            const before = (db.categories || []).length
            db.categories = (db.categories || []).filter(c => Number(c.id) !== id)
            if (db.categories.length < before) {
              deleted.push(id)
              recordSyncDelete?.(db, 'category', id)
            }
          }
        }
        const payloadOut = { ok: true, deleted }
        rememberKnownOp?.(kind, clientRef, payloadOut)
        persist?.()
        return okResult(clientRef, payloadOut, localId)
      }

      case 'category_reorder': {
        if (typeof applyCategoryReorder === 'function') {
          const row = applyCategoryReorder(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const items = Array.isArray(payload.items) ? payload.items : []
        for (const it of items) {
          const id = Number(it.id)
          const cat = (db.categories || []).find(c => Number(c.id) === id)
          if (cat) cat.order = Number(it.order) || 0
        }
        const out = { ok: true, count: items.length }
        rememberKnownOp?.(kind, clientRef, out)
        persist?.()
        return okResult(clientRef, out, localId)
      }

      case 'client_upsert': {
        if (typeof applyClientUpsert === 'function') {
          const row = applyClientUpsert(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyClientUpsertInline(db, { clientRef, payload }, h)
        return okResult(clientRef, row, localId)
      }

      case 'client_delete': {
        if (typeof applyClientDelete === 'function') {
          const row = applyClientDelete(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyClientDeleteInline(db, { clientRef, payload }, h)
        return okResult(clientRef, row, localId)
      }

      case 'card_topup': {
        if (typeof applyCardTopup === 'function') {
          const row = applyCardTopup(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyCardTopupInline(db, { clientRef, payload }, h)
        return okResult(clientRef, row, localId)
      }

      case 'debt_repay': {
        if (typeof applyDebtRepay === 'function') {
          const row = applyDebtRepay(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyDebtRepayInline(db, { clientRef, payload }, {
          ...h,
          applyDebtRepayToShift,
          applyDebtRepayment,
        })
        return okResult(clientRef, row, localId)
      }

      case 'card_loyalty_patch': {
        if (typeof applyCardLoyaltyPatch === 'function') {
          const row = applyCardLoyaltyPatch(db, { clientRef, payload, localId })
          return okResult(clientRef, row, localId)
        }
        const row = applyCardLoyaltyPatchInline(db, { clientRef, payload }, h)
        return okResult(clientRef, row, localId)
      }

      default:
        return failFallback(clientRef, 'unsupported', kind)
    }
  } catch (e) {
    return failHard(clientRef, e?.message || 'batch op failed')
  }
}
