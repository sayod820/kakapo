/**
 * Pure CRM identity merge helpers (no DOM). Shared by Desktop TS + node tests.
 */
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

export function mergeClientsServerAuthoritative(localList, remoteList, opts = {}) {
  const localById = new Map((localList || []).map(c => [String(c.id), c]))
  const out = []
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
    localById.delete(id)
  }
  for (const [id, local] of localById) {
    if (opts.isIdentityPending?.(id)) out.push(local)
  }
  return out
}

export function mergeCardsServerAuthoritative(localList, remoteList, opts = {}) {
  const localByNum = new Map()
  for (const c of localList || []) {
    const key = cardKey(c.num)
    if (key) localByNum.set(key, c)
  }
  const out = []
  const seen = new Set()
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
  }
  for (const [key, local] of localByNum) {
    if (seen.has(key)) continue
    if (opts.isCardPending?.(local.num)) out.push(local)
  }
  return out
}
