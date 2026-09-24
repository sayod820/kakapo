/**
 * Pure CRM identity merge helpers (Desktop).
 * Server is authoritative for name/phone/card/clientId unless explicit pending identity op.
 *
 * Callers MUST pass mode explicitly when semantics matter:
 * - Browser / full GET → FULL_AUTHORITATIVE_SNAPSHOT
 * - Desktop sync delta → PARTIAL_DELTA_UPSERT
 */
import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import {
  CRM_MERGE_MODE,
  mergeCardsServerAuthoritative as mergeCardsCore,
  mergeCardsServerAuthoritativeDetailed as mergeCardsDetailedCore,
  mergeClientsServerAuthoritative as mergeClientsCore,
  mergeClientsServerAuthoritativeDetailed as mergeClientsDetailedCore,
  patchHasCardIdentity as patchHasCardIdentityCore,
  patchHasClientIdentity as patchHasClientIdentityCore,
} from './crmIdentityAuthorityCore.mjs'

export { CRM_MERGE_MODE }

export type CrmMergeMode =
  | 'FULL_AUTHORITATIVE_SNAPSHOT'
  | 'PARTIAL_DELTA_UPSERT'

export function patchHasClientIdentity(patch: Record<string, unknown> | null | undefined): boolean {
  return patchHasClientIdentityCore(patch)
}

export function patchHasCardIdentity(patch: Record<string, unknown> | null | undefined): boolean {
  return patchHasCardIdentityCore(patch)
}

type ClientMergeOpts = {
  mode?: CrmMergeMode
  isIdentityPending?: (id: string) => boolean
  mergeLoyalty?: (remote: AdminClient, local?: AdminClient) => AdminClient
}

type CardMergeOpts = {
  mode?: CrmMergeMode
  isIdentityPending?: (clientId: string) => boolean
  isCardPending?: (num: string) => boolean
  mergeLoyalty?: (remote: AdminCard, local?: AdminCard) => AdminCard
}

/** Merge remote clients onto local by immutable id only (never by phone). */
export function mergeClientsServerAuthoritative(
  localList: AdminClient[],
  remoteList: AdminClient[],
  opts?: ClientMergeOpts,
): AdminClient[] {
  return mergeClientsCore(localList, remoteList, opts) as AdminClient[]
}

export function mergeClientsServerAuthoritativeDetailed(
  localList: AdminClient[],
  remoteList: AdminClient[],
  opts?: ClientMergeOpts,
) {
  return mergeClientsDetailedCore(localList, remoteList, opts) as {
    merged: AdminClient[]
    patched: number
    pruned: number
    kept: number
    mode: string
  }
}

/** Merge remote cards by num (not missing id). Server identity wins unless pending. */
export function mergeCardsServerAuthoritative(
  localList: AdminCard[],
  remoteList: AdminCard[],
  opts?: CardMergeOpts,
): AdminCard[] {
  return mergeCardsCore(localList, remoteList, opts) as AdminCard[]
}

export function mergeCardsServerAuthoritativeDetailed(
  localList: AdminCard[],
  remoteList: AdminCard[],
  opts?: CardMergeOpts,
) {
  return mergeCardsDetailedCore(localList, remoteList, opts) as {
    merged: AdminCard[]
    patched: number
    pruned: number
    kept: number
    mode: string
  }
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
