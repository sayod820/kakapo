'use client'

import { api } from './api'
import { USE_API } from './config'
import { normalizeClient, phonesMatch, type AdminClient } from './clientCrm'

export type ClientCartMeta = Record<string, { emoji?: string; name?: string; price?: number; restId?: string }>

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

function clientCartPayload(client?: AdminClient | null) {
  return {
    cart: sanitizeCart(client?.cart),
    cartMeta: sanitizeCartMeta(client?.cartMeta),
  }
}

export function mergeCartData(
  local: { cart: Record<string, number>; cartMeta: ClientCartMeta },
  remote: { cart: Record<string, number>; cartMeta: ClientCartMeta },
): { cart: Record<string, number>; cartMeta: ClientCartMeta } {
  const hasRemote = Object.keys(remote.cart).length > 0
  const hasLocal = Object.keys(local.cart).length > 0
  if (hasRemote && !hasLocal) return remote
  if (hasLocal && !hasRemote) return local
  if (!hasRemote && !hasLocal) return { cart: {}, cartMeta: {} }

  const cart = { ...remote.cart }
  const cartMeta = { ...remote.cartMeta, ...local.cartMeta }
  for (const [id, qty] of Object.entries(local.cart)) {
    const n = Number(qty) || 0
    if (n <= 0) continue
    cart[id] = Math.max(cart[id] || 0, n)
  }
  return { cart, cartMeta }
}

export async function fetchRemoteCart(
  phone: string,
  clientId?: string,
): Promise<{ cart: Record<string, number>; cartMeta: ClientCartMeta }> {
  if (!USE_API) return { cart: {}, cartMeta: {} }
  const clients = (await api.getClients()).map(c => normalizeClient(c))
  const client = clientId
    ? clients.find(c => c.id === clientId)
    : clients.find(c => phonesMatch(c.phone, phone))
  return clientCartPayload(client)
}

export async function saveRemoteCart(
  clientId: string,
  cart: Record<string, number>,
  cartMeta: ClientCartMeta,
): Promise<void> {
  if (!USE_API || !clientId) return
  await api.updateClient(clientId, {
    cart: sanitizeCart(cart),
    cartMeta: sanitizeCartMeta(cartMeta),
    cartUpdatedAt: new Date().toISOString(),
  })
}
