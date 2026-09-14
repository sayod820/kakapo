/**
 * Pure CRM identity merge helpers (Desktop).
 * Server is authoritative for name/phone/card/clientId unless explicit pending identity op.
 */
import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import {
  mergeCardsServerAuthoritative as mergeCardsCore,
  mergeClientsServerAuthoritative as mergeClientsCore,
  patchHasCardIdentity as patchHasCardIdentityCore,
  patchHasClientIdentity as patchHasClientIdentityCore,
} from './crmIdentityAuthorityCore.mjs'

export function patchHasClientIdentity(patch: Record<string, unknown> | null | undefined): boolean {
  return patchHasClientIdentityCore(patch)
}

export function patchHasCardIdentity(patch: Record<string, unknown> | null | undefined): boolean {
  return patchHasCardIdentityCore(patch)
}

/** Merge remote clients onto local by immutable id only (never by phone). */
export function mergeClientsServerAuthoritative(
  localList: AdminClient[],
  remoteList: AdminClient[],
  opts?: {
    isIdentityPending?: (id: string) => boolean
    mergeLoyalty?: (remote: AdminClient, local?: AdminClient) => AdminClient
  },
): AdminClient[] {
  return mergeClientsCore(localList, remoteList, opts) as AdminClient[]
}

/** Merge remote cards by num (not missing id). Server identity wins unless pending. */
export function mergeCardsServerAuthoritative(
  localList: AdminCard[],
  remoteList: AdminCard[],
  opts?: {
    isIdentityPending?: (clientId: string) => boolean
    isCardPending?: (num: string) => boolean
    mergeLoyalty?: (remote: AdminCard, local?: AdminCard) => AdminCard
  },
): AdminCard[] {
  return mergeCardsCore(localList, remoteList, opts) as AdminCard[]
}

export async function persistAuthoritativeCrmCaches(
  clients: AdminClient[],
  cards: AdminCard[],
): Promise<void> {
  try {
    const { cacheData, cacheClients } = await import('./offline')
    await Promise.all([
      cacheData('clients', clients),
      cacheData('cards', cards),
      cacheClients(clients),
    ])
  } catch { /* offline cache unavailable */ }
}
