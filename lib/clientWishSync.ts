'use client'

import { api } from './api'
import { USE_API } from './config'
import { type AdminClient } from './clientCrm'
import { cartSyncTimestamp, findSyncClient } from './clientCartSync'

export type WishBundle = {
  wished: Record<string, boolean>
  wishedUpdatedAt?: string
}

function sanitizeWished(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [id, val] of Object.entries(raw)) {
    if (!id || !val) continue
    out[id] = true
  }
  return out
}

export function wishBundleFromClient(client?: AdminClient | null): WishBundle {
  return {
    wished: sanitizeWished(client?.wished),
    wishedUpdatedAt: client?.wishedUpdatedAt,
  }
}

/** Последняя запись побеждает; при равном времени — объединение избранного с обоих устройств. */
export function mergeWishData(local: WishBundle, remote: WishBundle): WishBundle {
  const localTs = cartSyncTimestamp(local.wishedUpdatedAt)
  const remoteTs = cartSyncTimestamp(remote.wishedUpdatedAt)

  if (remoteTs > localTs) {
    return {
      wished: { ...sanitizeWished(remote.wished) },
      wishedUpdatedAt: remote.wishedUpdatedAt,
    }
  }
  if (localTs > remoteTs) {
    return {
      wished: { ...sanitizeWished(local.wished) },
      wishedUpdatedAt: local.wishedUpdatedAt,
    }
  }

  const localWished = sanitizeWished(local.wished)
  const remoteWished = sanitizeWished(remote.wished)
  const merged: Record<string, boolean> = { ...localWished }
  for (const [id, val] of Object.entries(remoteWished)) {
    if (val) merged[id] = true
  }

  return {
    wished: merged,
    wishedUpdatedAt: remote.wishedUpdatedAt || local.wishedUpdatedAt,
  }
}

export async function fetchRemoteWish(phone: string, clientId?: string): Promise<WishBundle> {
  if (!USE_API) return { wished: {} }
  return wishBundleFromClient(await findSyncClient(phone, clientId))
}

export async function saveRemoteWish(
  clientId: string,
  wished: Record<string, boolean>,
  wishedUpdatedAt?: string,
): Promise<string> {
  const ts = wishedUpdatedAt || new Date().toISOString()
  if (!USE_API || !clientId) return ts
  await api.updateClient(clientId, {
    wished: sanitizeWished(wished),
    wishedUpdatedAt: ts,
  })
  return ts
}
