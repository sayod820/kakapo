'use strict'

/**
 * HTTP-маршруты очереди для SYNC-канала (main process).
 * Без React/Zustand — только method/path/body. Сложные кейсы → delegate.
 */

function isLocalId(value) {
  return typeof value === 'string' && value.startsWith('off-')
}

function stripMeta(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const next = { ...obj }
  delete next._revert
  delete next._prev
  return next
}

function resolveId(idMap, value) {
  const raw = String(value || '')
  if (!raw) return ''
  if (!isLocalId(raw)) return raw
  return String(idMap[raw] || '')
}

function mustResolve(idMap, value, field) {
  const raw = String(value || '')
  if (!raw || !isLocalId(raw)) return raw
  const real = resolveId(idMap, raw)
  if (!real) {
    const err = new Error(`Связанная операция не отправлена (${field})`)
    err.code = 'BROKEN_REF'
    throw err
  }
  return real
}

function remapItemsProductIds(idMap, items) {
  if (!Array.isArray(items)) return items
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const next = { ...it }
    if (isLocalId(String(next.productId || ''))) {
      const real = resolveId(idMap, next.productId)
      if (real) next.productId = Number(real) || real
    }
    if (isLocalId(String(next.receiptId || ''))) {
      const real = resolveId(idMap, next.receiptId)
      if (real) next.receiptId = real
    }
    return next
  })
}

/**
 * @returns {{ method: string, path: string, body?: any, timeoutMs?: number } | { delegate: true } | null }
 */
function buildHttpJob(row, idMap) {
  const kind = String(row?.kind || '')
  const p = stripMeta(row?.payload || {})
  const idMapSafe = idMap || {}

  try {
    switch (kind) {
      case 'sale': {
        const body = { ...p }
        if (isLocalId(String(body.shiftId || ''))) {
          body.shiftId = mustResolve(idMapSafe, body.shiftId, 'shiftId')
        }
        body.items = remapItemsProductIds(idMapSafe, body.items || [])
        return { method: 'POST', path: '/pos/sales', body, timeoutMs: 20000 }
      }
      case 'shift_open':
        return {
          method: 'POST',
          path: '/pos/shifts/open',
          body: {
            clientRef: p.clientRef,
            cashierId: mustResolve(idMapSafe, p.cashierId, 'cashierId') || p.cashierId,
            cashierName: p.cashierName,
            openingCash: Number(p.openingCash) || 0,
            note: p.note,
            posId: mustResolve(idMapSafe, p.posId, 'posId') || p.posId,
            openedAtIso: p.openedAtIso || undefined,
          },
        }
      case 'shift_close': {
        const shiftId = mustResolve(idMapSafe, p.shiftId, 'shiftId')
        return {
          method: 'PATCH',
          path: `/pos/shifts/${encodeURIComponent(shiftId)}/close`,
          body: {
            clientRef: p.clientRef,
            closingCash: Number(p.closingCash) || 0,
            closingCard: p.closingCard != null ? Number(p.closingCard) : undefined,
            note: p.note,
            closedAtIso: p.closedAtIso || undefined,
          },
        }
      }
      case 'sale_return': {
        const saleId = mustResolve(idMapSafe, p.saleId, 'saleId')
        return {
          method: 'POST',
          path: `/pos/sales/${encodeURIComponent(saleId)}/return`,
          body: {
            clientRef: p.clientRef,
            note: p.note,
            cashierId: p.cashierId,
            items: p.items,
            appliedLocal: true,
            skipBalances: true,
            queuedOffline: !!p.queuedOffline,
            cutDebt: p.cutDebt,
            expectedDebtPayVersion: p.expectedDebtPayVersion != null ? Number(p.expectedDebtPayVersion) : undefined,
            expectedBonusPayVersion: p.expectedBonusPayVersion != null ? Number(p.expectedBonusPayVersion) : undefined,
          },
        }
      }
      case 'card_topup': {
        const num = String(p.num || '').trim()
        return {
          method: 'POST',
          path: `/cards/${encodeURIComponent(num)}/cash-topup`,
          body: {
            clientRef: p.clientRef,
            cash: Number(p.cash) || 0,
            credit: Number(p.credit) || 0,
            note: p.note,
            cashierId: p.cashierId,
            cashierName: p.cashierName,
            shiftId: mustResolve(idMapSafe, p.shiftId, 'shiftId') || p.shiftId,
            posId: p.posId,
            createdAtIso: p.createdAtIso,
            appliedLocal: true,
            skipBalances: true,
            expectedBonusPayVersion: p.expectedBonusPayVersion != null ? Number(p.expectedBonusPayVersion) : undefined,
          },
        }
      }
      case 'debt_repay': {
        const num = String(p.num || '').trim()
        return {
          method: 'POST',
          path: `/cards/${encodeURIComponent(num)}/debt-repay`,
          body: {
            clientRef: p.clientRef,
            amount: Number(p.amount) || 0,
            method: p.method,
            note: p.note,
            cashierId: p.cashierId,
            cashierName: p.cashierName,
            shiftId: mustResolve(idMapSafe, p.shiftId, 'shiftId') || p.shiftId,
            posId: p.posId,
            appliedLocal: true,
            skipBalances: true,
            nextDebt: p.nextDebt,
            expectedDebtPayVersion: p.expectedDebtPayVersion != null ? Number(p.expectedDebtPayVersion) : undefined,
          },
        }
      }
      case 'finance_move':
        return {
          method: 'POST',
          path: '/finance/moves',
          body: {
            clientRef: p.clientRef,
            type: p.type,
            amount: Number(p.amount) || 0,
            note: p.note,
            createdBy: p.createdBy,
            cashierId: p.cashierId,
            cashierName: p.cashierName,
            shiftId: mustResolve(idMapSafe, p.shiftId, 'shiftId') || p.shiftId,
            posId: p.posId,
            supplierId: p.supplierId,
            expectedPayVersion: p.expectedPayVersion != null ? Number(p.expectedPayVersion) : undefined,
            expectedVaultVersion: p.expectedVaultVersion != null ? Number(p.expectedVaultVersion) : undefined,
            reason: p.reason,
            createdAtIso: p.createdAtIso,
            payFrom: p.payFrom,
            method: p.method,
          },
        }
      case 'vault_card_to_cash':
        return {
          method: 'POST',
          path: '/finance/vault/card-to-cash',
          body: {
            clientRef: p.clientRef,
            amount: Number(p.amount) || 0,
            note: p.note,
            expectedVaultVersion: p.expectedVaultVersion != null ? Number(p.expectedVaultVersion) : undefined,
          },
        }
      case 'vault_cash_to_card':
        return {
          method: 'POST',
          path: '/finance/vault/cash-to-card',
          body: {
            clientRef: p.clientRef,
            amount: Number(p.amount) || 0,
            note: p.note,
            expectedVaultVersion: p.expectedVaultVersion != null ? Number(p.expectedVaultVersion) : undefined,
          },
        }
      case 'stock_receipt_create': {
        const supplierId = resolveId(idMapSafe, p.supplierId) || p.supplierId
        if (isLocalId(String(supplierId || ''))) return { delegate: true }
        return {
          method: 'POST',
          path: '/stock/receipts',
          body: {
            clientRef: p.clientRef,
            supplierId: supplierId || undefined,
            createdBy: p.createdBy,
            paidNow: Number(p.paidNow) || 0,
            payFrom: p.payFrom,
            method: p.method,
            items: remapItemsProductIds(idMapSafe, p.items || []),
            createdAtIso: p.createdAtIso,
            expectedSupplyVersion: p.expectedSupplyVersion != null ? Number(p.expectedSupplyVersion) : undefined,
          },
        }
      }
      case 'stock_receipt_update': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        const supplierId = resolveId(idMapSafe, p.supplierId) || p.supplierId
        if (isLocalId(String(supplierId || ''))) return { delegate: true }
        return {
          method: 'PUT',
          path: `/stock/receipts/${encodeURIComponent(id)}`,
          body: {
            clientRef: p.clientRef,
            supplierId: supplierId || undefined,
            paidNow: Number(p.paidNow) || 0,
            payFrom: p.payFrom,
            method: p.method,
            items: remapItemsProductIds(idMapSafe, p.items || []),
            expectedSupplyVersion: p.expectedSupplyVersion != null ? Number(p.expectedSupplyVersion) : undefined,
          },
        }
      }
      case 'stock_receipt_delete': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        return {
          method: 'DELETE',
          path: `/stock/receipts/${encodeURIComponent(id)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'stock_writeoff_create':
        return {
          method: 'POST',
          path: '/stock/writeoffs',
          body: {
            clientRef: p.clientRef,
            reason: p.reason,
            note: p.note,
            createdBy: p.createdBy,
            items: remapItemsProductIds(idMapSafe, p.items || []),
            createdAtIso: p.createdAtIso,
          },
        }
      case 'stock_writeoff_update': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        return {
          method: 'PUT',
          path: `/stock/writeoffs/${encodeURIComponent(id)}`,
          body: {
            clientRef: p.clientRef,
            reason: p.reason,
            note: p.note,
            createdBy: p.createdBy,
            items: remapItemsProductIds(idMapSafe, p.items || []),
          },
        }
      }
      case 'stock_writeoff_delete': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        return {
          method: 'DELETE',
          path: `/stock/writeoffs/${encodeURIComponent(id)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'stock_layer_update': {
        const receiptId = mustResolve(idMapSafe, p.receiptId, 'receiptId')
        return {
          method: 'PUT',
          path: `/stock/layers/${encodeURIComponent(receiptId)}/${Number(p.productId)}`,
          body: {
            costPrice: p.costPrice,
            retailPrice: p.retailPrice,
            bulkPricing: p.bulkPricing,
            expiryDate: p.expiryDate,
            clientRef: p.clientRef,
          },
        }
      }
      case 'stock_layer_delete': {
        const receiptId = mustResolve(idMapSafe, p.receiptId, 'receiptId')
        return {
          method: 'DELETE',
          path: `/stock/layers/${encodeURIComponent(receiptId)}/${Number(p.productId)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'stock_revision_create':
      case 'stock_revision_update':
      case 'stock_revision_delete':
      case 'supplier_payment_create':
      case 'supplier_payment_delete':
      case 'category_upsert':
      case 'category_delete':
      case 'category_reorder':
      case 'card_loyalty_patch':
      case 'pos_point_upsert':
      case 'pos_point_delete':
        // Редкие / сложные — один раз через UI sendOp (не на горячем пути кассы)
        return { delegate: true }
      case 'product_upsert': {
        const body = { ...(p.product || p) }
        delete body.localId
        delete body.clientRef
        delete body._prev
        const rawId = Number(body.id)
        const isLocal = !Number.isFinite(rawId) || rawId <= 0
        if (isLocal) {
          const { id: _drop, docVersion: _dv, ...createBody } = body
          return {
            method: 'POST',
            path: '/products',
            body: { ...createBody, clientRef: p.clientRef },
          }
        }
        return {
          method: 'PATCH',
          path: `/products/${rawId}`,
          body: {
            ...body,
            clientRef: p.clientRef,
            expectedDocVersion: p.expectedDocVersion != null
              ? Number(p.expectedDocVersion)
              : (body.docVersion != null ? Number(body.docVersion) - 1 : undefined),
          },
        }
      }
      case 'product_delete': {
        let id = String(p.id || '')
        if (idMapSafe[id]) id = idMapSafe[id]
        const num = Number(id)
        if (!(Number.isFinite(num) && num > 0)) return null
        return {
          method: 'DELETE',
          path: `/products/${num}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'client_upsert': {
        const body = { ...(p.client || p) }
        delete body.localId
        delete body.clientRef
        delete body._prev
        const rawId = String(body.id || '')
        const isLocal = !rawId || isLocalId(rawId)
        if (isLocal) {
          const { id: _drop, docVersion: _dv, ...createBody } = body
          return {
            method: 'POST',
            path: '/clients',
            body: { ...createBody, clientRef: p.clientRef },
          }
        }
        return {
          method: 'PATCH',
          path: `/clients/${encodeURIComponent(rawId)}`,
          body: {
            ...body,
            clientRef: p.clientRef,
            expectedDocVersion: p.expectedDocVersion != null
              ? Number(p.expectedDocVersion)
              : (body.docVersion != null ? Number(body.docVersion) - 1 : undefined),
          },
        }
      }
      case 'client_delete': {
        let id = String(p.id || '')
        if (idMapSafe[id]) id = idMapSafe[id]
        if (!id || isLocalId(id)) return null
        return {
          method: 'DELETE',
          path: `/clients/${encodeURIComponent(id)}`,
          body: { phone: p.phone, clientRef: p.clientRef },
        }
      }
      case 'supplier_upsert': {
        const body = { ...(p.supplier || p) }
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
        const isLocal = !rawId || isLocalId(rawId)
        if (isLocal) {
          const { id: _drop, ...createBody } = body
          return {
            method: 'POST',
            path: '/suppliers',
            body: { ...createBody, clientRef: p.clientRef },
          }
        }
        return {
          method: 'PATCH',
          path: `/suppliers/${encodeURIComponent(rawId)}`,
          body: { ...body, clientRef: p.clientRef },
        }
      }
      case 'supplier_delete': {
        let id = String(p.id || '')
        if (idMapSafe[id]) id = idMapSafe[id]
        if (!id || isLocalId(id)) return null
        return {
          method: 'DELETE',
          path: `/suppliers/${encodeURIComponent(id)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'expense_create':
        return {
          method: 'POST',
          path: '/expenses',
          body: {
            category: p.category,
            amount: Number(p.amount) || 0,
            note: p.note,
            createdBy: p.createdBy,
            cashierId: p.cashierId,
            cashierName: p.cashierName,
            shiftId: mustResolve(idMapSafe, p.shiftId, 'shiftId') || p.shiftId,
            posId: p.posId,
            clientRef: p.clientRef,
            createdAtIso: p.createdAtIso,
            expectedVaultVersion: p.expectedVaultVersion != null ? Number(p.expectedVaultVersion) : undefined,
          },
        }
      case 'expense_delete': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        return {
          method: 'DELETE',
          path: `/expenses/${encodeURIComponent(id)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'finance_move_delete': {
        const id = mustResolve(idMapSafe, p.id, 'id')
        return {
          method: 'DELETE',
          path: `/finance/moves/${encodeURIComponent(id)}`,
          body: { clientRef: p.clientRef },
        }
      }
      case 'cashier_upsert': {
        const body = { ...(p.cashier || p) }
        delete body.localId
        delete body.clientRef
        const rawId = String(body.id || p.localId || '')
        const isLocal = !rawId || isLocalId(rawId)
        if (!isLocal) return null
        return {
          method: 'POST',
          path: '/cashiers',
          body: {
            name: String(body.name || 'Кассир'),
            pin: String(body.pin || '0000'),
            clientRef: p.clientRef,
          },
        }
      }
      default:
        return { delegate: true }
    }
  } catch (e) {
    if (e && e.code === 'BROKEN_REF') throw e
    return { delegate: true }
  }
}

function extractServerId(kind, json, row) {
  if (!json || typeof json !== 'object') return ''
  if (kind === 'card_topup') return String(json.financeMove?.id || json.id || '')
  if (kind === 'debt_repay') return ''
  return String(json.id || row?.localId || '')
}

module.exports = {
  buildHttpJob,
  extractServerId,
  isLocalId,
  resolveId,
}
