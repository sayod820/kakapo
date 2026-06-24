import type { ClientCartMeta } from './clientCartSync'

export function cartHasQty(cart: Record<string, number> = {}): boolean {
  return Object.values(cart).some(q => Number(q) > 0)
}

/** id корзины ресторана: RR-01_1 */
export function isRestCartLineId(id: string): boolean {
  return /^R.+_\d+$/.test(String(id))
}

type CartLine = {
  id: string
  qty: number
  e?: string
  name: string
  price: number
  isRest: boolean
  restId?: string
  [key: string]: unknown
}

/** Строки корзины для UI — ресторанные позиции из cart, не только из cartMeta */
export function buildCartLineItems(
  cart: Record<string, number>,
  cartMeta: ClientCartMeta,
  prods: Array<{ id: string | number; [key: string]: unknown }>,
): CartLine[] {
  const prodById = new Map(prods.map(p => [String(p.id), p]))
  const prodItems = prods
    .filter(p => (cart[p.id] || 0) > 0)
    .map(p => ({ ...p, qty: cart[p.id], isRest: false } as CartLine))

  const restIds = new Set<string>()
  for (const id of Object.keys(cartMeta)) {
    if ((cart[id] || 0) > 0) restIds.add(id)
  }
  for (const id of Object.keys(cart)) {
    if ((cart[id] || 0) <= 0) continue
    if (prodById.has(String(id))) continue
    if (cartMeta[id] || isRestCartLineId(id)) restIds.add(id)
  }

  const restItems: CartLine[] = [...restIds].map(id => ({
    id,
    e: cartMeta[id]?.emoji || '🍽',
    name: cartMeta[id]?.name || 'Блюдо',
    price: Number(cartMeta[id]?.price) || 0,
    qty: cart[id],
    isRest: true,
    restId: cartMeta[id]?.restId,
  }))

  return [...prodItems, ...restItems]
}
