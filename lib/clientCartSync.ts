'use client'

import { api } from './api'
import { USE_API } from './config'
import { normalizeClient, phonesMatch, type AdminClient } from './clientCrm'

export type ClientCartMeta = Record<string, { emoji?: string; name?: string; price?: number; restId?: string }>

export type CartBundle = {
  cart: Record<string, number>
  cartMeta: ClientCartMeta
  cartUpdatedAt?: string
}

function sanitizeCart(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [id, qty] of Object.entries(raw)) {
    const n = Number(qty)
    if (!id || !Number.isFinite(n) || n <= 0) continue
    out[id] = n
  }
  return out
}

function sanitizeCartMeta(raw: unknown): ClientCartMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as ClientCartMeta
}

export function cartSyncTimestamp(ts?: string): number {
  if (!ts) return 0
  const n = Date.parse(ts)
  return Number.isFinite(n) ? n : 0
}

export function clientCartPayload(client?: AdminClient | null): CartBundle {
  return {
    cart: sanitizeCart(client?.cart),
    cartMeta: sanitizeCartMeta(client?.cartMeta),
    cartUpdatedAt: client?.cartUpdatedAt,
  }
}

export async function findSyncClient(phone: string, clientId?: string): Promise<AdminClient | undefined> {
  if (!USE_API) return undefined
  const clients = (await api.getClients()).map(c => normalizeClient(c))
  return clientId
    ? clients.find(c => c.id === clientId)
    : clients.find(c => phonesMatch(c.phone, phone))
}

/** Последняя запись побеждает; пустая корзина после заказа не затирается старой локальной копией. */
export function mergeCartData(local: CartBundle, remote: CartBundle): CartBundle {
  const localTs = cartSyncTimestamp(local.cartUpdatedAt)
  const remoteTs = cartSyncTimestamp(remote.cartUpdatedAt)

  if (remoteTs > localTs) {
    return {
      cart: { ...sanitizeCart(remote.cart) },
      cartMeta: { ...sanitizeCartMeta(remote.cartMeta) },
      cartUpdatedAt: remote.cartUpdatedAt,
    }
  }
  if (localTs > remoteTs) {
    return {
      cart: { ...sanitizeCart(local.cart) },
      cartMeta: { ...sanitizeCartMeta(local.cartMeta) },
      cartUpdatedAt: local.cartUpdatedAt,
    }
  }

  const localCart = sanitizeCart(local.cart)
  const remoteCart = sanitizeCart(remote.cart)
  const localEmpty = !Object.keys(localCart).length
  const remoteEmpty = !Object.keys(remoteCart).length

  if (localEmpty && remoteEmpty) {
    return { cart: {}, cartMeta: {}, cartUpdatedAt: remote.cartUpdatedAt || local.cartUpdatedAt }
  }
  if (remoteEmpty && !localEmpty) {
    return { cart: localCart, cartMeta: sanitizeCartMeta(local.cartMeta), cartUpdatedAt: local.cartUpdatedAt }
  }
  if (localEmpty && !remoteEmpty) {
    return { cart: remoteCart, cartMeta: sanitizeCartMeta(remote.cartMeta), cartUpdatedAt: remote.cartUpdatedAt }
  }

  return {
    cart: remoteCart,
    cartMeta: sanitizeCartMeta(remote.cartMeta),
    cartUpdatedAt: remote.cartUpdatedAt || local.cartUpdatedAt,
  }
}

export async function fetchRemoteCart(
  phone: string,
  clientId?: string,
): Promise<CartBundle> {
  if (!USE_API) return { cart: {}, cartMeta: {} }
  return clientCartPayload(await findSyncClient(phone, clientId))
}

export async function saveRemoteCart(
  clientId: string,
  cart: Record<string, number>,
  cartMeta: ClientCartMeta,
  cartUpdatedAt?: string,
): Promise<string> {
  const ts = cartUpdatedAt || new Date().toISOString()
  if (!USE_API || !clientId) return ts
  await api.updateClient(clientId, {
    cart: sanitizeCart(cart),
    cartMeta: sanitizeCartMeta(cartMeta),
    cartUpdatedAt: ts,
  })
  return ts
}
