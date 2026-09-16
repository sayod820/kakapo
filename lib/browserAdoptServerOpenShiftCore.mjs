/**
 * Pure helpers: merge server shifts into local projection (browser adopt).
 * Server OPEN for a POS wins over stale local "closed"/missing.
 */
export function mergeServerShiftsAuthoritative(localShifts = [], serverShifts = []) {
  const byId = new Map()
  for (const s of localShifts || []) {
    if (s?.id != null) byId.set(String(s.id), { ...s })
  }
  for (const s of serverShifts || []) {
    if (s?.id == null) continue
    const id = String(s.id)
    const prev = byId.get(id)
    byId.set(id, prev ? { ...prev, ...s } : { ...s })
  }

  // For each posId with a server-open shift, drop conflicting local-only open off-* ghosts
  const serverOpenByPos = new Map()
  for (const s of serverShifts || []) {
    if (String(s?.status || '') !== 'open') continue
    if (String(s.id || '').startsWith('off-')) continue
    const pos = String(s.posId || '').trim() || '_'
    serverOpenByPos.set(pos, s)
  }

  const out = []
  for (const s of byId.values()) {
    const pos = String(s.posId || '').trim() || '_'
    const serverOpen = serverOpenByPos.get(pos)
    if (
      serverOpen
      && String(s.status) === 'open'
      && String(s.id).startsWith('off-')
      && String(s.id) !== String(serverOpen.id)
    ) {
      // local ghost open superseded by server open — mark closed projection-only
      out.push({
        ...s,
        status: 'closed',
        closedAtIso: s.closedAtIso || new Date().toISOString(),
        note: [s.note, 'reconcile:adopted-server-open'].filter(Boolean).join(' · '),
      })
      continue
    }
    out.push(s)
  }

  // Ensure every server open is present
  for (const [, open] of serverOpenByPos) {
    if (!out.some(s => String(s.id) === String(open.id))) out.unshift({ ...open })
  }

  out.sort((a, b) => String(b.openedAtIso || '').localeCompare(String(a.openedAtIso || '')))
  return out
}

/**
 * True when local projection has no server-open shift for pos, but server list does.
 */
export function needsServerOpenShiftAdopt(localShifts = [], serverShifts = [], posId = '') {
  const pos = String(posId || '').trim()
  const serverOpen = (serverShifts || []).filter(s =>
    String(s?.status || '') === 'open'
    && !String(s.id || '').startsWith('off-')
    && (!pos || String(s.posId || '') === pos))
  if (!serverOpen.length) return false
  const localHas = (localShifts || []).some(s =>
    String(s?.status || '') === 'open'
    && !String(s.id || '').startsWith('off-')
    && serverOpen.some(o => String(o.id) === String(s.id)))
  return !localHas
}
