/**
 * L6 — targeted CRM fetch + surgical Zustand/SQLite patch.
 * Prefer delta; fall back to GET /clients/:id or GET /cards/:num when needed.
 */
import { api } from './api'
import { CRM_MERGE_MODE, mergeCardsServerAuthoritativeDetailed, mergeClientsServerAuthoritativeDetailed } from './crmIdentityAuthority'
import { noteSyncEvent } from './syncDiagnostics'
import { entityUpsertMany } from './localEntities'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'

export type CrmPatchMetrics = {
  remoteEntitiesReceived: number
  localRowsWritten: number
  zustandEntitiesPatched: number
  fullArrayReplacements: number
  fullGetCount: number
}

let lastMetrics: CrmPatchMetrics = {
  remoteEntitiesReceived: 0,
  localRowsWritten: 0,
  zustandEntitiesPatched: 0,
  fullArrayReplacements: 0,
  fullGetCount: 0,
}

export function getLastCrmPatchMetrics(): CrmPatchMetrics {
  return { ...lastMetrics }
}

export function resetCrmPatchMetrics() {
  lastMetrics = {
    remoteEntitiesReceived: 0,
    localRowsWritten: 0,
    zustandEntitiesPatched: 0,
    fullArrayReplacements: 0,
    fullGetCount: 0,
  }
}

function bumpMetrics(partial: Partial<CrmPatchMetrics>) {
  lastMetrics = {
    remoteEntitiesReceived: lastMetrics.remoteEntitiesReceived + (partial.remoteEntitiesReceived || 0),
    localRowsWritten: lastMetrics.localRowsWritten + (partial.localRowsWritten || 0),
    zustandEntitiesPatched: lastMetrics.zustandEntitiesPatched + (partial.zustandEntitiesPatched || 0),
    fullArrayReplacements: lastMetrics.fullArrayReplacements + (partial.fullArrayReplacements || 0),
    fullGetCount: lastMetrics.fullGetCount + (partial.fullGetCount || 0),
  }
}

/** Persist only the patched CRM entities (entity table), not a 5k blob rewrite. */
export async function persistCrmEntityPatches(opts: {
  clients?: AdminClient[]
  cards?: AdminCard[]
}): Promise<number> {
  let written = 0
  if (opts.clients?.length) {
    await entityUpsertMany(
      'client',
      opts.clients.map(c => ({
        id: String(c.id),
        data: c,
        updatedAtIso: String((c as { updatedAtIso?: string }).updatedAtIso || new Date().toISOString()),
      })),
    )
    written += opts.clients.length
  }
  if (opts.cards?.length) {
    await entityUpsertMany(
      'card',
      opts.cards.map(c => ({
        id: String(c.num),
        data: c,
        updatedAtIso: String((c as { updatedAtIso?: string }).updatedAtIso || new Date().toISOString()),
      })),
    )
    written += opts.cards.length
  }
  bumpMetrics({ localRowsWritten: written })
  noteSyncEvent('crm_entity_patch_persist', { written })
  return written
}

/**
 * Apply a small client delta into the live store without treating it as a full snapshot.
 * Does NOT rewrite KV blob of all clients (entity upsert only).
 */
export async function applyClientDeltaPatches(
  remoteClients: AdminClient[],
  opts?: { isIdentityPending?: (id: string) => boolean },
): Promise<{ patched: number; total: number }> {
  if (!remoteClients?.length) return { patched: 0, total: 0 }
  const { useClientStore, isClientIdentityPending } = await import('./clientStore')
  const { mergeClientLoyaltyIfRecent } = await import('./loyaltySaveGuard')
  const local = useClientStore.getState().clients || []
  const detail = mergeClientsServerAuthoritativeDetailed(local, remoteClients, {
    mode: CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT,
    isIdentityPending: opts?.isIdentityPending || isClientIdentityPending,
    mergeLoyalty: (remote, prev) => mergeClientLoyaltyIfRecent(remote, prev),
  })
  const patchedIds = new Set(remoteClients.map(c => String(c.id)))
  const byId = new Map(detail.merged.map(c => [String(c.id), c]))
  // Surgical Zustand update: keep object identity for untouched rows
  useClientStore.setState(s => ({
    clients: s.clients.map(c => (patchedIds.has(String(c.id)) ? (byId.get(String(c.id)) || c) : c)).concat(
      [...patchedIds]
        .filter(id => !s.clients.some(c => String(c.id) === id))
        .map(id => byId.get(id)!)
        .filter(Boolean),
    ),
  }))
  await persistCrmEntityPatches({ clients: remoteClients.map(c => byId.get(String(c.id))!).filter(Boolean) })
  bumpMetrics({
    remoteEntitiesReceived: remoteClients.length,
    zustandEntitiesPatched: detail.patched,
  })
  noteSyncEvent('client_delta_patch', { patched: detail.patched, total: detail.merged.length })
  return { patched: detail.patched, total: detail.merged.length }
}

export async function applyCardDeltaPatches(
  remoteCards: AdminCard[],
  opts?: { isIdentityPending?: (id: string) => boolean },
): Promise<{ patched: number; total: number }> {
  if (!remoteCards?.length) return { patched: 0, total: 0 }
  const { useCardStore } = await import('./cardStore')
  const { isClientIdentityPending } = await import('./clientStore')
  const { mergeCardLoyaltyIfRecent } = await import('./loyaltySaveGuard')
  const local = useCardStore.getState().cards || []
  const detail = mergeCardsServerAuthoritativeDetailed(local, remoteCards, {
    mode: CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT,
    isIdentityPending: opts?.isIdentityPending || isClientIdentityPending,
    mergeLoyalty: (remote, prev) => mergeCardLoyaltyIfRecent(remote, prev),
  })
  const patchedNums = new Set(remoteCards.map(c => String(c.num || '').toUpperCase()))
  const byNum = new Map(detail.merged.map(c => [String(c.num || '').toUpperCase(), c]))
  useCardStore.setState(s => ({
    cards: s.cards.map(c => {
      const key = String(c.num || '').toUpperCase()
      return patchedNums.has(key) ? (byNum.get(key) || c) : c
    }).concat(
      [...patchedNums]
        .filter(n => !s.cards.some(c => String(c.num || '').toUpperCase() === n))
        .map(n => byNum.get(n)!)
        .filter(Boolean),
    ),
  }))
  await persistCrmEntityPatches({
    cards: remoteCards.map(c => byNum.get(String(c.num || '').toUpperCase())!).filter(Boolean),
  })
  bumpMetrics({
    remoteEntitiesReceived: remoteCards.length,
    zustandEntitiesPatched: detail.patched,
  })
  noteSyncEvent('card_delta_patch', { patched: detail.patched, total: detail.merged.length })
  return { patched: detail.patched, total: detail.merged.length }
}

/** Targeted GET + patch one client. Returns null on 404. */
export async function fetchAndPatchClientById(id: string): Promise<AdminClient | null> {
  const cid = String(id || '').trim()
  if (!cid) return null
  try {
    const row = await api.getClient(cid)
    if (!row || !row.id) return null
    await applyClientDeltaPatches([row])
    return row
  } catch (e) {
    const status = Number((e as { status?: number })?.status || 0)
    if (status === 404) {
      noteSyncEvent('client_targeted_404', { id: cid })
      return null
    }
    throw e
  }
}

/** Targeted GET + patch one card. Returns null on 404. */
export async function fetchAndPatchCardByNum(num: string): Promise<AdminCard | null> {
  const n = String(num || '').trim()
  if (!n) return null
  try {
    const row = await api.getCard(n)
    if (!row || !row.num) return null
    await applyCardDeltaPatches([row])
    return row
  } catch (e) {
    const status = Number((e as { status?: number })?.status || 0)
    if (status === 404) {
      noteSyncEvent('card_targeted_404', { num: n })
      return null
    }
    throw e
  }
}

export { bumpMetrics }
