import type { Order } from './types'
import type { AdminClient } from './clientCrm'
import type { StoreUser } from './clientSession'

export const RECOVERY_RETENTION_DAYS = 30

export function defaultAccountGeneration(raw?: number | string | null): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

export function recoveryExpiresAtIso(deletedAt?: string): string {
  const base = deletedAt ? new Date(deletedAt) : new Date()
  const exp = new Date(base.getTime())
  exp.setDate(exp.getDate() + RECOVERY_RETENTION_DAYS)
  return exp.toISOString().slice(0, 10)
}

export function isRecoveryExpired(client?: Pick<AdminClient, 'accountStatus' | 'deletedAt' | 'recoveryExpiresAt'> | null): boolean {
  if (!client || client.accountStatus !== 'recovery') return false
  const exp = client.recoveryExpiresAt || recoveryExpiresAtIso(client.deletedAt)
  if (!exp) return false
  return exp < new Date().toISOString().slice(0, 10)
}

export function orderBelongsToClientAccount(
  order: Pick<Order, 'client' | 'clientAccountId' | 'accountGeneration'>,
  client: Pick<AdminClient, 'id' | 'phone' | 'accountGeneration'>,
): boolean {
  const gen = defaultAccountGeneration(client.accountGeneration)
  const orderGen = defaultAccountGeneration(order.accountGeneration)
  if (order.clientAccountId) {
    if (!client.id || order.clientAccountId !== client.id) return false
    return orderGen === gen
  }
  const key = (client.phone || '').replace(/\D/g, '').slice(-9)
  const op = (order.client?.phone || '').replace(/\D/g, '').slice(-9)
  if (!key || op !== key) return false
  if (gen > 1 && orderGen < gen) return false
  return orderGen === gen
}

export function orderBelongsToStoreUser(
  order: Pick<Order, 'client' | 'clientAccountId' | 'accountGeneration'>,
  user: Pick<StoreUser, 'phone' | 'clientId' | 'accountGeneration'> | null | undefined,
): boolean {
  if (!user?.phone) return false
  return orderBelongsToClientAccount(order, {
    id: user.clientId || '',
    phone: user.phone,
    accountGeneration: user.accountGeneration,
  })
}

export function filterOrdersForStoreUser(orders: Order[], user: StoreUser | null | undefined): Order[] {
  if (!user?.phone) return []
  return orders.filter(o => orderBelongsToStoreUser(o, user))
}
