// ════════════════════════════════════════════════
// KAKAPO — операции кассы без интернета
// Local-first: сразу локально + очередь, синк с сервером в фоне
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import { isLocalId, isOnline, newClientRef, newLocalId, persistPosSnapshot } from './offline'
import { cardNumsMatch } from './cardCrm'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isOfflineV2Full, shadowMirrorPut, shadowMirrorSale, shadowMirrorShift } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { FinanceMove, PosExpense, PosSale, PosShift } from './types'

export type SaleCartLine = {
  productId: number
  qty: number
  weightKg?: number | null
}

export type CreateSaleSafeInput = {
  salePayload: Record<string, unknown>
  cart: SaleCartLine[]
  shiftId: string
  cashPaid: number
  cardPaid: number
  debtAdded: number
  walletPaid?: number
  total: number
  /** Карта / кошелёк / бонусы — нужен живой сервер, если онлайн */
  needsLiveServer: boolean
  /** Браузер реально офлайн */
  forceOffline: boolean
  client?: {
    id: string
    card?: string
    debt?: number
    wallet?: number
  } | null
  bonusSpend?: number
  bonusEarn?: number
}

/** @deprecated — оставлен для совместимости типов */
export type { OfflineResult }

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

/**
 * Local-first: сразу localApply (очередь + стор), сервер в фоне.
 * apiCall игнорируется — оставлен в сигнатуре для совместимости вызовов.
 */
async function raceCashierOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
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

  const res = await raceCashierOp(() => api.openPosShift(payload), applyLocal)
  if (res.data) shadowMirrorShift(res.data)
  return res
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

  const res = await raceCashierOp(
    () => api.closePosShift(shiftId, {
      clientRef,
      closingCash: payload.closingCash,
      note: input.note,
    }),
    applyLocal,
  )
  if (res.data) shadowMirrorShift(res.data)
  return res
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

  // Оплата поставщику с кассы: без V2 — только онлайн; с V2 — локально + очередь
  if (input.supplierId && !isOfflineV2Full()) {
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
      supplierId: payload.supplierId,
    }
    usePosStore.setState(s => ({ financeMoves: [move, ...s.financeMoves] }))
    shadowMirrorPut('finance_move', move.id, move)
    if (payload.shiftId) {
      const shift = shiftById(payload.shiftId)
      if (shift) {
        patchShift(payload.shiftId, payload.type === 'withdraw'
          ? { expenseTotal: round2((shift.expenseTotal || 0) + payload.amount) }
          : { cashInTotal: round2((shift.cashInTotal || 0) + payload.amount) })
      }
    }
    if (payload.supplierId && payload.type === 'withdraw') {
      usePosStore.setState(s => ({
        suppliers: s.suppliers.map(sup => {
          if (sup.id !== payload.supplierId) return sup
          const totalPaid = round2((Number(sup.totalPaid) || 0) + payload.amount)
          const totalSupplied = Number(sup.totalSupplied) || 0
          return {
            ...sup,
            totalPaid,
            payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
          }
        }),
      }))
      void persistPosSnapshot()
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

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('debt_repay', payload)
    const nextDebt = round2(Math.max(0, input.prevDebt - amount))
    if (input.shiftId) {
      const shift = shiftById(input.shiftId)
      if (shift) {
        if (method === 'card') {
          patchShift(shift.id, { salesCard: round2((shift.salesCard || 0) + amount) })
        } else {
          patchShift(shift.id, { salesCash: round2((shift.salesCash || 0) + amount) })
        }
      }
    }
    const { useCardStore } = await import('./cardStore')
    useCardStore.getState().updateCardLoyalty(num, { debt: nextDebt }, { skipApi: true })
    if (input.clientId) {
      const { useClientStore } = await import('./clientStore')
      useClientStore.getState().updateClient(input.clientId, { debt: nextDebt }, { skipApi: true })
    }
    return { nextDebt, bonusEarned: 0 }
  }

  return localFirstOp(applyLocal)
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
    shadowMirrorSale(returned)
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: returned }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('sale_return', payload)
    return applyLocalReturn(sale, input.items)
  }

  const res = await raceCashierOp(
    () => api.returnPosSale(sale.id, {
      clientRef,
      note: input.note,
      cashierId: input.cashierId,
      ...(input.items ? { items: input.items } : {}),
    }),
    applyLocal,
  )
  if (res.data) shadowMirrorSale(res.data)
  return res
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

// ── Продажа (касса) ──

/**
 * Пробитие чека: local-first (сразу локально + очередь).
 * Банковская карта без V2 — нужен живой сервер/терминал.
 * Offline V2=on: локально правит бонусы и кошелёк в сторе.
 */
export async function createSaleSafe(
  input: CreateSaleSafeInput,
): Promise<OfflineResult<PosSale & { orderId?: string; _offline?: boolean }>> {
  const cashPaid = round2(input.cashPaid)
  const cardPaid = round2(input.cardPaid)
  const debtAdded = round2(input.debtAdded)
  const walletPaid = round2(input.walletPaid || 0)
  const spend = Math.max(0, Math.floor(Number(input.bonusSpend) || 0))
  const earn = Math.max(0, Math.floor(Number(input.bonusEarn) || 0))
  const client = input.client || null
  const salePayload = { ...input.salePayload }

  const applyLocal = async (): Promise<PosSale & { orderId?: string; _offline?: boolean }> => {
    useOfflineSync.getState().markOffline()
    const offlineSaleId = newLocalId('sale')
    await useOfflineSync.getState().queueOp('sale', salePayload, { localId: offlineSaleId })

    try {
      const { useProducts } = await import('./store')
      const ps = useProducts.getState()
      for (const l of input.cart) {
        const p = ps.products.find(x => x.id === l.productId)
        if (!p) continue
        const dec = l.weightKg != null ? l.weightKg : l.qty
        ps.updateProduct(l.productId, { stock: Math.max(0, (Number(p.stock) || 0) - dec) })
      }
      // Партии — в фоне: раньше await entityPut по всем слоям на каждую позицию
      // держал «Пробиваем…» на секунды.
      const layerLines = input.cart.map(l => ({
        productId: l.productId,
        qty: l.weightKg != null ? l.weightKg : l.qty,
      }))
      void import('./stockLayersLocal')
        .then(m => m.consumeLocalLayersFifoBatch(layerLines))
        .catch(() => {})
    } catch { /* ignore */ }

    if (client) {
      const { useClientStore } = await import('./clientStore')
      const { useCardStore } = await import('./cardStore')

      if (debtAdded > 0.001) {
        const nextDebt = round2((Number(client.debt) || 0) + debtAdded)
        useClientStore.getState().updateClient(
          client.id,
          { debt: nextDebt, debtEnabled: true },
          { skipApi: true },
        )
        if (client.card) {
          const currentCard = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
          useCardStore.getState().updateCardLoyalty(
            client.card,
            {
              debt: round2((Number(currentCard?.debt) || 0) + debtAdded),
              debtEnabled: true,
            },
            { skipApi: true },
          )
        }
      }

      if (walletPaid > 0.001) {
        const nextWallet = round2(Math.max(0, (Number(client.wallet) || 0) - walletPaid))
        useClientStore.getState().updateClient(client.id, { wallet: nextWallet }, { skipApi: true })
        if (client.card) {
          const currentCard = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
          useCardStore.getState().updateCardLoyalty(
            client.card,
            { wallet: round2(Math.max(0, (Number(currentCard?.wallet) || Number(client.wallet) || 0) - walletPaid)) },
            { skipApi: true },
          )
        }
      }

      if (client.card && (spend > 0 || earn > 0)) {
        const currentCard = useCardStore.getState().cards.find(c => cardNumsMatch(c.num, client.card!))
        const base = Math.max(0, Math.floor(Number(currentCard?.bonus) || 0))
        const prevPos = Math.max(0, Math.floor(Number(currentCard?.posCashBonus) || 0))
        const nextBonus = Math.max(0, base - spend + earn)
        const nextPos = Math.max(0, prevPos - spend + earn)
        useCardStore.getState().updateCardLoyalty(
          client.card,
          {
            bonus: nextBonus,
            posCashBonus: nextPos,
            ...(spend > 0 ? { allowBonusDecrease: true } : {}),
          } as any,
          { skipApi: true },
        )
        useClientStore.getState().updateClient(client.id, { bonus: nextBonus }, { skipApi: true })
      }
    }

    const offlineSale: PosSale & { orderId?: string; _offline?: boolean } = {
      ...(salePayload as unknown as PosSale),
      id: offlineSaleId,
      orderId: String(salePayload.clientRef || ''),
      total: input.total,
      _offline: true,
    }
    usePosStore.setState(st => ({
      sales: [offlineSale, ...st.sales],
      shifts: st.shifts.map(sh => sh.id === input.shiftId ? {
        ...sh,
        salesCash: round2((sh.salesCash || 0) + cashPaid),
        salesCard: round2((sh.salesCard || 0) + cardPaid),
        salesCredit: round2((sh.salesCredit || 0) + debtAdded),
        salesCount: (sh.salesCount || 0) + 1,
        ...(walletPaid > 0.001
          ? { salesWallet: round2((Number((sh as any).salesWallet) || 0) + walletPaid) }
          : {}),
      } : sh),
    }))
    shadowMirrorSale(offlineSale)
    void persistPosSnapshot()
    return offlineSale
  }

  const patchShiftOnline = (created: PosSale) => {
    usePosStore.setState(st => ({
      sales: [created, ...st.sales.filter(x => x.id !== created.id)],
      shifts: st.shifts.map(sh => sh.id === input.shiftId ? {
        ...sh,
        salesCash: round2((sh.salesCash || 0) + cashPaid),
        salesCard: round2((sh.salesCard || 0) + cardPaid),
        salesCredit: round2((sh.salesCredit || 0) + debtAdded),
        salesCount: (sh.salesCount || 0) + 1,
        ...(walletPaid > 0.001
          ? { salesWallet: round2((Number((sh as any).salesWallet) || 0) + walletPaid) }
          : {}),
      } : sh),
    }))
    void (async () => {
      try {
        const { useProducts } = await import('./store')
        const ps = useProducts.getState()
        for (const l of input.cart) {
          const p = ps.products.find(x => x.id === l.productId)
          if (!p) continue
          const dec = l.weightKg != null ? l.weightKg : l.qty
          ps.updateProduct(l.productId, { stock: Math.max(0, (Number(p.stock) || 0) - dec) })
        }
      } catch { /* ignore */ }
    })()
    shadowMirrorSale(created)
  }

  // Всегда local-first: нал и карта сразу, сервер из очереди в фоне
  return localFirstOp(applyLocal)
}

// ── Расход (FinanceModule, Offline V2) ──

function openShiftId(): string | undefined {
  return usePosStore.getState().shifts.find(s => s.status === 'open')?.id
}

function applyExpenseToShift(shiftId: string | undefined, amount: number, dir: 1 | -1) {
  if (!shiftId || !(amount > 0)) return
  const shift = shiftById(shiftId)
  if (!shift) return
  const next = round2(Math.max(0, (Number(shift.expenseTotal) || 0) + dir * amount))
  patchShift(shiftId, { expenseTotal: next })
}

export async function expenseCreateSafe(input: {
  category: string
  amount: number
  note?: string
  createdBy?: string
  shiftId?: string
}): Promise<OfflineResult<PosExpense>> {
  const clientRef = newClientRef()
  const shiftId = input.shiftId || openShiftId()
  const payload = {
    ...input,
    shiftId,
    clientRef,
    amount: round2(input.amount),
    category: String(input.category || 'Прочее').trim() || 'Прочее',
  }

  if (!isOfflineV2Full()) {
    const exp = await api.createExpense(payload)
    if (exp?.shiftId) {
      applyExpenseToShift(String(exp.shiftId), Number(exp.amount) || payload.amount, 1)
    } else if (shiftId) {
      // сервер мог не вернуть shiftId — локально всё равно учтём открытую смену
      applyExpenseToShift(shiftId, payload.amount, 1)
    }
    usePosStore.setState(s => ({ expenses: [exp, ...s.expenses.filter(e => e.id !== exp.id)] }))
    void persistPosSnapshot()
    return { offline: false, data: exp }
  }

  const applyLocal = async () => {
    const localId = newLocalId('exp')
    await useOfflineSync.getState().queueOp('expense_create', payload, { localId, clientRef })
    const exp: PosExpense = {
      id: localId,
      category: payload.category,
      amount: payload.amount,
      note: payload.note,
      createdBy: payload.createdBy,
      createdAtIso: new Date().toISOString(),
      shiftId: payload.shiftId,
    }
    usePosStore.setState(s => ({ expenses: [exp, ...s.expenses] }))
    applyExpenseToShift(payload.shiftId, payload.amount, 1)
    void persistPosSnapshot()
    shadowMirrorPut('finance_move', `exp:${exp.id}`, exp)
    return exp
  }

  const res = await raceCashierOp(() => api.createExpense(payload), applyLocal)
  if (res.data) shadowMirrorPut('finance_move', `exp:${res.data.id}`, res.data)
  return res
}

// ── Удаление расхода (Offline V2) ──

function reverseExpenseLocal(id: string) {
  const exp = usePosStore.getState().expenses.find(e => e.id === id)
  if (exp) {
    applyExpenseToShift(exp.shiftId, Number(exp.amount) || 0, -1)
  }
  usePosStore.setState(s => ({ expenses: s.expenses.filter(e => e.id !== id) }))
}

export async function expenseDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isOfflineV2Full()) {
    await api.deleteExpense(id)
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('expense_delete', { clientRef, id }, { clientRef })
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteExpense(id)
    reverseExpenseLocal(id)
    void persistPosSnapshot()
    return { id }
  }, applyLocal)
}

// ── Удаление движения (Offline V2) ──

function reverseFinanceMoveLocal(id: string) {
  const move = usePosStore.getState().financeMoves.find(m => m.id === id)
  if (!move) {
    usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => m.id !== id) }))
    return
  }
  const amount = round2(Number(move.amount) || 0)
  if (move.shiftId && amount > 0) {
    const shift = shiftById(move.shiftId)
    if (shift) {
      if (move.type === 'withdraw') {
        patchShift(move.shiftId, {
          expenseTotal: round2(Math.max(0, (Number(shift.expenseTotal) || 0) - amount)),
        })
      } else {
        patchShift(move.shiftId, {
          cashInTotal: round2(Math.max(0, (Number(shift.cashInTotal) || 0) - amount)),
        })
      }
    }
  }
  if (move.supplierId && move.type === 'withdraw' && amount > 0) {
    usePosStore.setState(s => ({
      suppliers: s.suppliers.map(sup => {
        if (sup.id !== move.supplierId) return sup
        const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) - amount))
        const totalSupplied = Number(sup.totalSupplied) || 0
        return {
          ...sup,
          totalPaid,
          payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
        }
      }),
    }))
  }
  usePosStore.setState(s => ({ financeMoves: s.financeMoves.filter(m => m.id !== id) }))
}

export async function financeMoveDeleteSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isOfflineV2Full()) {
    await api.deleteFinanceMove(id)
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('finance_move_delete', { clientRef, id }, { clientRef })
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceCashierOp(async () => {
    await api.deleteFinanceMove(id)
    reverseFinanceMoveLocal(id)
    void persistPosSnapshot()
    return { id }
  }, applyLocal)
}

// ── Точки продаж / кассиры (мгновенно локально) ──

export async function createPosPointSafe(input: {
  name: string
  code?: string
  note?: string
  receiptPhone?: string
}): Promise<OfflineResult<import('./types').PosPoint>> {
  const clientRef = newClientRef()
  const localId = newLocalId('pos')
  const point = {
    id: localId,
    name: String(input.name || '').trim(),
    code: input.code?.trim() || undefined,
    note: input.note?.trim() || undefined,
    receiptPhone: input.receiptPhone?.trim() || undefined,
    active: true,
    createdAtIso: new Date().toISOString(),
  }
  const applyLocal = async () => {
    usePosStore.setState(s => ({ posPoints: [point, ...s.posPoints] }))
    await useOfflineSync.getState().queueOp(
      'pos_point_upsert',
      { clientRef, localId, point },
      { localId, clientRef },
    )
    void persistPosSnapshot()
    return point
  }
  return localFirstOp(applyLocal)
}

export async function updatePosPointSafe(
  id: string,
  patch: Partial<{ name: string; code: string; note: string; receiptPhone: string; active: boolean }>,
): Promise<OfflineResult<import('./types').PosPoint>> {
  const clientRef = newClientRef()
  const applyLocal = async () => {
    const cur = usePosStore.getState().posPoints.find(p => p.id === id)
    if (!cur) throw new Error('Точка не найдена')
    const point = {
      ...cur,
      ...patch,
      name: patch.name != null ? String(patch.name).trim() : cur.name,
      code: patch.code != null ? String(patch.code).trim() : cur.code,
      note: patch.note != null ? String(patch.note).trim() : cur.note,
      receiptPhone: patch.receiptPhone != null ? String(patch.receiptPhone).trim() : cur.receiptPhone,
    }
    usePosStore.setState(s => ({
      posPoints: s.posPoints.map(p => (p.id === id ? point : p)),
    }))
    await useOfflineSync.getState().queueOp(
      'pos_point_upsert',
      { clientRef, localId: id, point },
      { localId: id, clientRef },
    )
    void persistPosSnapshot()
    return point
  }
  return localFirstOp(applyLocal)
}

export async function deletePosPointSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const applyLocal = async () => {
    usePosStore.setState(s => ({
      posPoints: s.posPoints.filter(p => p.id !== id),
    }))
    if (!isLocalId(id)) {
      await useOfflineSync.getState().queueOp(
        'pos_point_delete',
        { clientRef, id },
        { clientRef },
      )
    }
    void persistPosSnapshot()
    return { id }
  }
  return localFirstOp(applyLocal)
}

export async function ensureCashierSafe(input: {
  name: string
  preferredId?: string
}): Promise<OfflineResult<import('./types').PosCashier>> {
  const preferredId = input.preferredId
  if (preferredId && preferredId !== 'local') {
    const found = usePosStore.getState().cashiers.find(c => c.id === preferredId)
    if (found) return { offline: false, data: found }
  }
  const trimmed = String(input.name || '').trim() || 'Кассир'
  const existing = usePosStore.getState().cashiers.find(c => c.name === trimmed)
  if (existing) return { offline: false, data: existing }

  const clientRef = newClientRef()
  const localId = newLocalId('csh')
  const cashier = {
    id: localId,
    name: trimmed,
    pin: '0000',
    active: true,
    salesCount: 0,
    salesTotal: 0,
    createdAtIso: new Date().toISOString(),
  }
  const applyLocal = async () => {
    usePosStore.setState(s => ({ cashiers: [...s.cashiers, cashier] }))
    await useOfflineSync.getState().queueOp(
      'cashier_upsert',
      { clientRef, localId, cashier },
      { localId, clientRef },
    )
    void persistPosSnapshot()
    return cashier
  }
  return localFirstOp(applyLocal)
}
