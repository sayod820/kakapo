// ════════════════════════════════════════════════
// KAKAPO — операции кассы без интернета
// Быстрое подтверждение: ждём сервер коротко; если медленно —
// сразу локально + очередь (как офлайн), синхронизация в фоне
// ════════════════════════════════════════════════
import { api, isNetworkError, NetworkError } from './api'
import { isLocalId, newClientRef, newLocalId } from './offline'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { FinanceMove, PosSale, PosShift } from './types'

/** Сколько ждём живой ответ сервера, прежде чем подтвердить локально */
const CASHIER_FAST_MS = 1600

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function patchShift(shiftId: string, patch: Partial<PosShift>) {
  usePosStore.setState(s => ({
    shifts: s.shifts.map(x => (x.id === shiftId ? { ...x, ...patch } : x)),
  }))
}

function shiftById(shiftId: string): PosShift | undefined {
  return usePosStore.getState().shifts.find(s => s.id === shiftId)
}

export interface OfflineResult<T> {
  /** true — операция ушла в очередь / подтверждена локально, сервер догонит */
  offline: boolean
  data: T
}

/**
 * Ждём API до CASHIER_FAST_MS. Если сеть медленная или упала —
 * сразу localApply + sync в фоне (касса не «висит»).
 */
async function raceCashierOp<T>(
  apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  try {
    const data = await Promise.race([
      apiCall(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new NetworkError('Медленная связь — сохранено локально')),
          CASHIER_FAST_MS,
        )
      }),
    ])
    return { offline: false, data }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const data = await localApply()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }
}

// ── Смена ──

export async function openShiftSafe(input: {
  cashierId: string
  cashierName: string
  openingCash: number
  posId?: string
  note?: string
}): Promise<OfflineResult<PosShift>> {
  const clientRef = newClientRef()
  const payload = {
    clientRef,
    cashierId: input.cashierId,
    openingCash: round2(input.openingCash),
    posId: input.posId,
    note: input.note,
  }

  const applyLocal = async () => {
    const localId = newLocalId('shift')
    const shift: PosShift = {
      id: localId,
      posId: input.posId,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      openedAtIso: new Date().toISOString(),
      openingCash: round2(input.openingCash),
      salesCash: 0,
      salesCard: 0,
      salesCredit: 0,
      salesCount: 0,
      expenseTotal: 0,
      cashInTotal: 0,
      status: 'open',
      note: input.note,
    }
    await useOfflineSync.getState().queueOp('shift_open', payload, { localId })
    usePosStore.setState(s => ({ shifts: [shift, ...s.shifts] }))
    return shift
  }

  return raceCashierOp(() => api.openPosShift(payload), applyLocal)
}

export async function closeShiftSafe(
  shiftId: string,
  input: { closingCash: number; note?: string },
): Promise<OfflineResult<PosShift | null>> {
  const clientRef = newClientRef()
  const payload = { clientRef, shiftId, closingCash: round2(input.closingCash), note: input.note }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('shift_close', payload)
    const current = shiftById(shiftId)
    const expected = current
      ? round2((current.openingCash || 0) + (current.salesCash || 0) + (current.cashInTotal || 0) - (current.expenseTotal || 0))
      : payload.closingCash
    patchShift(shiftId, {
      status: 'closed',
      closedAtIso: new Date().toISOString(),
      closingCash: payload.closingCash,
      actualCash: payload.closingCash,
      expectedCash: expected,
      cashDiff: round2(payload.closingCash - expected),
    })
    return current ? { ...current, status: 'closed' as const } : null
  }

  return raceCashierOp(
    () => api.closePosShift(shiftId, {
      clientRef,
      closingCash: payload.closingCash,
      note: input.note,
    }),
    applyLocal,
  )
}

// ── Движение по кассе ──

export async function financeMoveSafe(input: {
  type: 'deposit' | 'withdraw'
  amount: number
  note?: string
  createdBy?: string
  cashierId?: string
  cashierName?: string
  shiftId?: string
  posId?: string
  supplierId?: string
  reason?: string
}): Promise<OfflineResult<FinanceMove | null>> {
  const clientRef = newClientRef()
  const payload = { ...input, clientRef, amount: round2(input.amount) }

  // Оплата поставщику — только онлайн (нужен актуальный долг)
  if (input.supplierId) {
    try {
      const move = await api.createFinanceMove(payload)
      return { offline: false, data: move }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      throw new Error('Оплата поставщику недоступна без связи')
    }
  }

  const applyLocal = async () => {
    const localId = newLocalId('fin')
    await useOfflineSync.getState().queueOp('finance_move', payload, { localId })
    const move: FinanceMove = {
      id: localId,
      type: payload.type,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
      createdAtIso: new Date().toISOString(),
      shiftId: payload.shiftId,
      posId: payload.posId,
    }
    usePosStore.setState(s => ({ financeMoves: [move, ...s.financeMoves] }))
    if (payload.shiftId) {
      const shift = shiftById(payload.shiftId)
      if (shift) {
        patchShift(payload.shiftId, payload.type === 'withdraw'
          ? { expenseTotal: round2((shift.expenseTotal || 0) + payload.amount) }
          : { cashInTotal: round2((shift.cashInTotal || 0) + payload.amount) })
      }
    }
    return move
  }

  return raceCashierOp(() => api.createFinanceMove(payload), applyLocal)
}

// ── Пополнение карты наличными ──

export async function cardTopupSafe(
  num: string,
  input: {
    cash: number
    credit: number
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId: string
    posId?: string
  },
): Promise<OfflineResult<null>> {
  const clientRef = newClientRef()
  const payload = { ...input, clientRef, cash: round2(input.cash), credit: round2(input.credit), num }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('card_topup', payload)
    const shift = input.shiftId ? shiftById(input.shiftId) : undefined
    if (shift) {
      patchShift(shift.id, { cashInTotal: round2((shift.cashInTotal || 0) + payload.cash) })
      usePosStore.setState(s => ({
        financeMoves: [{
          id: newLocalId('fin'),
          type: 'deposit',
          amount: payload.cash,
          note: input.note,
          createdBy: input.cashierName,
          createdAtIso: new Date().toISOString(),
          shiftId: shift.id,
          posId: input.posId,
        }, ...s.financeMoves],
      }))
    }
    const { useCardStore } = await import('./cardStore')
    const card = useCardStore.getState().cards.find(c => c.num === num)
    useCardStore.getState().updateCardLoyalty(
      num,
      {
        bonus: round2((Number(card?.bonus) || 0) + payload.credit),
        posCashBonus: round2((Number(card?.posCashBonus) || 0) + payload.credit),
      },
      { skipApi: true },
    )
    return null
  }

  return raceCashierOp(
    async () => {
      await api.cashTopupCard(num, {
        clientRef,
        cash: payload.cash,
        credit: payload.credit,
        note: input.note,
        cashierId: input.cashierId,
        cashierName: input.cashierName,
        shiftId: input.shiftId,
        posId: input.posId,
      })
      return null
    },
    applyLocal,
  )
}

// ── Погашение долга ──

export async function debtRepaySafe(
  num: string,
  input: {
    amount: number
    method?: 'cash' | 'card'
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId?: string
    posId?: string
    clientId?: string
    prevDebt: number
  },
): Promise<OfflineResult<{ nextDebt: number; bonusEarned: number }>> {
  const clientRef = newClientRef()
  const method: 'cash' | 'card' = input.method === 'card' ? 'card' : 'cash'
  const amount = round2(input.amount)
  const payload = {
    clientRef,
    num,
    amount,
    method,
    note: input.note,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    shiftId: input.shiftId,
    posId: input.posId,
  }

  // Картой — только онлайн (терминал / банк)
  if (method === 'card') {
    try {
      const res = await api.debtRepayCard(num, payload)
      return {
        offline: false,
        data: { nextDebt: Number(res.nextDebt) || 0, bonusEarned: Number(res.bonusEarned) || 0 },
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      throw new Error('Погашение картой недоступно без связи — примите наличными')
    }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('debt_repay', payload)
    const nextDebt = round2(Math.max(0, input.prevDebt - amount))
    if (input.shiftId) {
      const shift = shiftById(input.shiftId)
      if (shift) patchShift(shift.id, { salesCash: round2((shift.salesCash || 0) + amount) })
    }
    const { useCardStore } = await import('./cardStore')
    useCardStore.getState().updateCardLoyalty(num, { debt: nextDebt }, { skipApi: true })
    if (input.clientId) {
      const { useClientStore } = await import('./clientStore')
      useClientStore.getState().updateClient(input.clientId, { debt: nextDebt }, { skipApi: true })
    }
    return { nextDebt, bonusEarned: 0 }
  }

  return raceCashierOp(
    async () => {
      const res = await api.debtRepayCard(num, payload)
      return { nextDebt: Number(res.nextDebt) || 0, bonusEarned: Number(res.bonusEarned) || 0 }
    },
    applyLocal,
  )
}

// ── Возврат чека ──

export async function returnSaleSafe(
  sale: PosSale,
  input: {
    note?: string
    cashierId?: string
    items?: { index?: number; productId?: number; qty: number }[]
  },
): Promise<OfflineResult<PosSale>> {
  const clientRef = newClientRef()
  const payload = {
    clientRef,
    saleId: sale.id,
    note: input.note,
    cashierId: input.cashierId,
    items: input.items,
  }

  // Локальный id чека — только очередь (на сервере ещё нет)
  if (isLocalId(sale.id)) {
    await useOfflineSync.getState().queueOp('sale_return', payload)
    const returned = applyLocalReturn(sale, input.items)
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: returned }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('sale_return', payload)
    return applyLocalReturn(sale, input.items)
  }

  return raceCashierOp(
    () => api.returnPosSale(sale.id, {
      clientRef,
      note: input.note,
      cashierId: input.cashierId,
      ...(input.items ? { items: input.items } : {}),
    }),
    applyLocal,
  )
}

/** Локальный возврат: товары на склад, чек помечен возвращённым */
function applyLocalReturn(
  sale: PosSale,
  items?: { index?: number; productId?: number; qty: number }[],
): PosSale {
  const lines = Array.isArray(sale.items) ? sale.items : []
  const backByProduct = new Map<number, number>()

  const nextItems = lines.map((line, idx) => {
    const already = Number(line.returnedQty) || 0
    const left = Math.max(0, round2((Number(line.qty) || 0) - already))
    const asked = items
      ? Number(items.find(i => (i.index != null ? i.index === idx : i.productId === line.productId))?.qty) || 0
      : left
    const back = Math.min(left, round2(asked))
    if (back > 0) {
      backByProduct.set(line.productId, round2((backByProduct.get(line.productId) || 0) + back))
    }
    return back > 0 ? { ...line, returnedQty: round2(already + back) } : line
  })

  const fullyReturned = nextItems.every(l => (Number(l.returnedQty) || 0) >= (Number(l.qty) || 0) - 0.001)
  const lastReturnTotal = nextItems.reduce((sum, l, idx) => {
    const before = Number(lines[idx]?.returnedQty) || 0
    const after = Number(l.returnedQty) || 0
    return sum + Math.max(0, after - before) * (Number(l.price) || 0)
  }, 0)

  const updated: PosSale = {
    ...sale,
    items: nextItems,
    status: fullyReturned ? 'returned' : 'partial',
    lastReturnTotal: round2(lastReturnTotal),
  } as PosSale

  usePosStore.setState(s => ({ sales: s.sales.map(x => (x.id === sale.id ? updated : x)) }))

  void (async () => {
    const { useProducts } = await import('./store')
    const ps = useProducts.getState()
    for (const [productId, qty] of backByProduct) {
      const p = ps.products.find(x => x.id === productId)
      if (!p) continue
      ps.updateProduct(productId, { stock: round2((Number(p.stock) || 0) + qty) })
    }
  })()

  return updated
}
