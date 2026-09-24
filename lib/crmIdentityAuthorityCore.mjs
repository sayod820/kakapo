/**
 * Pure CRM identity merge helpers (no DOM). Shared by Desktop TS + node tests.
 *
 * Merge modes:
 * - FULL_AUTHORITATIVE_SNAPSHOT — remote list is complete; absent locals may be dropped
 *   (pending-identity locals are still kept).
 * - PARTIAL_DELTA_UPSERT — upsert only entities present in remote; never infer deletion
 *   from absence (deletes require tombstone / explicit delete event / full snapshot).
 */

export const CRM_MERGE_MODE = Object.freeze({
  FULL_AUTHORITATIVE_SNAPSHOT: 'FULL_AUTHORITATIVE_SNAPSHOT',
  PARTIAL_DELTA_UPSERT: 'PARTIAL_DELTA_UPSERT',
})

export function patchHasClientIdentity(patch) {
  if (!patch || typeof patch !== 'object') return false
  return ['name', 'phone', 'card', 'email', 'addr', 'note', 'blocked']
    .some(k => Object.prototype.hasOwnProperty.call(patch, k))
}

export function patchHasCardIdentity(patch) {
  if (!patch || typeof patch !== 'object') return false
  return ['clientId', 'client', 'phone', 'status']
    .some(k => Object.prototype.hasOwnProperty.call(patch, k))
}

function cardKey(num) {
  return String(num || '').trim().toUpperCase()
}

function resolveMergeMode(opts = {}) {
  const m = String(opts.mode || CRM_MERGE_MODE.FULL_AUTHORITATIVE_SNAPSHOT)
  if (m === CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT) return CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT
  return CRM_MERGE_MODE.FULL_AUTHORITATIVE_SNAPSHOT
}

/**
 * @returns {{ merged: any[], patched: number, pruned: number, kept: number, mode: string }}
 */
export function mergeClientsServerAuthoritativeDetailed(localList, remoteList, opts = {}) {
  const mode = resolveMergeMode(opts)
  const localById = new Map((localList || []).map(c => [String(c.id), c]))
  const out = []
  let patched = 0
  for (const remote of remoteList || []) {
    const id = String(remote?.id || '')
    if (!id) continue
    const local = localById.get(id)
    let row = opts.mergeLoyalty ? opts.mergeLoyalty(remote, local) : { ...remote }
    if (local && opts.isIdentityPending?.(id)) {
      row = {
        ...row,
        name: local.name,
        phone: local.phone,
        card: local.card,
        email: local.email,
        addr: local.addr,
        note: local.note,
        blocked: local.blocked,
      }
    } else {
      row = {
        ...row,
        name: remote.name,
        phone: remote.phone,
        card: remote.card,
        email: remote.email,
        addr: remote.addr,
        note: remote.note,
        blocked: remote.blocked,
      }
    }
    out.push(row)
    patched += 1
    localById.delete(id)
  }

  let pruned = 0
  let kept = 0
  if (mode === CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT) {
    for (const [, local] of localById) {
      out.push(local)
      kept += 1
    }
  } else {
    for (const [id, local] of localById) {
      if (opts.isIdentityPending?.(id)) {
        out.push(local)
        kept += 1
      } else {
        pruned += 1
      }
    }
  }

  return { merged: out, patched, pruned, kept, mode }
}

export function mergeClientsServerAuthoritative(localList, remoteList, opts = {}) {
  return mergeClientsServerAuthoritativeDetailed(localList, remoteList, opts).merged
}

/**
 * @returns {{ merged: any[], patched: number, pruned: number, kept: number, mode: string }}
 */
export function mergeCardsServerAuthoritativeDetailed(localList, remoteList, opts = {}) {
  const mode = resolveMergeMode(opts)
  const localByNum = new Map()
  for (const c of localList || []) {
    const key = cardKey(c.num)
    if (key) localByNum.set(key, c)
  }
  const out = []
  const seen = new Set()
  let patched = 0
  for (const remote of remoteList || []) {
    const key = cardKey(remote.num)
    if (!key) continue
    seen.add(key)
    const local = localByNum.get(key)
    let row = opts.mergeLoyalty ? opts.mergeLoyalty(remote, local) : { ...remote }
    const clientId = String(local?.clientId || remote.clientId || '')
    const pending = !!(local && (
      (clientId && opts.isIdentityPending?.(clientId))
      || opts.isCardPending?.(remote.num)
    ))
    if (pending && local) {
      row = {
        ...row,
        client: local.client || row.client,
        phone: local.phone || row.phone,
        clientId: local.clientId || row.clientId,
        status: local.status,
      }
    } else {
      row = {
        ...row,
        client: remote.client,
        phone: remote.phone,
        clientId: remote.clientId,
        status: remote.status,
      }
    }
    out.push(row)
    patched += 1
  }

  let pruned = 0
  let kept = 0
  for (const [key, local] of localByNum) {
    if (seen.has(key)) continue
    if (mode === CRM_MERGE_MODE.PARTIAL_DELTA_UPSERT) {
      out.push(local)
      kept += 1
      continue
    }
    if (opts.isCardPending?.(local.num)) {
      out.push(local)
      kept += 1
    } else {
      pruned += 1
    }
  }

  return { merged: out, patched, pruned, kept, mode }
}

export function mergeCardsServerAuthoritative(localList, remoteList, opts = {}) {
  return mergeCardsServerAuthoritativeDetailed(localList, remoteList, opts).merged
}
