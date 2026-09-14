/**
 * Phase D3 — write-ahead debt op envelope (pure).
 * Used when platform cannot offer multi-record SQLite transactions (Android file store).
 * Desktop continues to use native sqlDebtRepayCommit.
 *
 * Crash model:
 * 1) persist envelope state=intent (single atomic KV write)
 * 2) apply absolute effects (queue / projections / shift / cash ledger)
 * 3) remove envelope
 * Recover: re-apply absolute effects from remaining intent envelopes (idempotent).
 */

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export const DEBT_OP_ENVELOPE_KV_KEY = 'debt_op_envelopes'

/**
 * Upsert one row into a JSON array collection by id field.
 * Returns next array (does not mutate input).
 */
export function upsertArrayRow(list, idField, idValue, row) {
  const id = String(idValue || '').trim()
  const base = Array.isArray(list) ? list.map(x => (x && typeof x === 'object' ? { ...x } : x)) : []
  if (!id || !row || typeof row !== 'object') return base
  const idx = base.findIndex(x => x && String(x[idField] || '') === id)
  if (idx >= 0) {
    base[idx] = { ...base[idx], ...row, [idField]: base[idx][idField] }
  } else {
    base.push({ ...row })
  }
  return base
}

/**
 * Upsert cash repay ledger row by clientRef (idempotent amount keep-first).
 */
export function upsertCashRepayLedger(list, entry) {
  const clientRef = String(entry?.clientRef || '').trim()
  const shiftId = String(entry?.shiftId || '').trim()
  const method = String(entry?.method || 'cash') === 'card' ? 'card' : 'cash'
  const amount = round2(Number(entry?.amount) || 0)
  const base = Array.isArray(list) ? list.map(x => ({ ...x })) : []
  if (!clientRef || !shiftId || !(amount > 0) || method === 'card') return base
  const idx = base.findIndex(r => String(r.clientRef || '').trim() === clientRef)
  const next = {
    clientRef,
    shiftId,
    amount,
    method: 'cash',
    orderId: String(entry?.orderId || '').trim() || undefined,
    createdAtIso: String(entry?.createdAtIso || '').trim() || new Date().toISOString(),
  }
  if (idx >= 0) {
    const prev = base[idx]
    base[idx] = {
      ...prev,
      ...next,
      amount: round2(Number(prev.amount) || amount),
      shiftId: String(prev.shiftId || shiftId),
    }
  } else {
    base.push(next)
  }
  return base
}

/**
 * Patch shift list by id with absolute shift row (replace counters from envelope).
 */
export function upsertShiftRow(list, shift) {
  if (!shift || !shift.id) return Array.isArray(list) ? list.slice() : []
  const base = Array.isArray(list) ? list.map(x => ({ ...x })) : []
  const id = String(shift.id)
  const idx = base.findIndex(s => String(s?.id || '') === id)
  if (idx >= 0) base[idx] = { ...base[idx], ...shift, id: base[idx].id }
  else base.push({ ...shift })
  return base
}

/**
 * Build repay envelope (absolute projections).
 */
export function buildDebtRepayEnvelope(input = {}) {
  const clientRef = String(input.clientRef || input.operationId || '').trim()
  return {
    operationId: clientRef,
    clientRef,
    kind: 'debt_repay',
    state: 'intent',
    queueRow: input.queueRow || null,
    client: input.client || null,
    card: input.card || null,
    shift: input.shift || null,
    cashRepayLedgerEntry: input.cashRepayLedgerEntry || null,
    createdAtIso: String(input.createdAtIso || new Date().toISOString()),
  }
}

/**
 * Build cash-advance envelope (absolute projections).
 */
export function buildCashAdvanceEnvelope(input = {}) {
  const clientRef = String(input.clientRef || input.operationId || '').trim()
  return {
    operationId: clientRef,
    clientRef,
    kind: 'cash_advance',
    state: 'intent',
    queueRow: input.queueRow || null,
    client: input.client || null,
    card: input.card || null,
    shift: input.shift || null,
    cashRepayLedgerEntry: null,
    createdAtIso: String(input.createdAtIso || new Date().toISOString()),
  }
}

/**
 * In-memory store simulator for tests / pure apply.
 * store: { queue: Map, kv: Map }
 * failAt: before_intent | after_intent | after_queue | after_card | after_client | after_shift | after_ledger | before_clear
 */
export function applyDebtOpEnvelopeToStore(store, envelope, failAt = '') {
  const stage = String(failAt || '').trim()
  const env = envelope && typeof envelope === 'object' ? { ...envelope } : null
  if (!env || !env.clientRef || !env.queueRow) {
    return { ok: false, error: 'missing_envelope' }
  }

  const scratch = {
    queue: new Map(store.queue),
    kv: new Map([...store.kv.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
  }

  const writeEnvelopes = (mapObj) => {
    scratch.kv.set(DEBT_OP_ENVELOPE_KV_KEY, mapObj)
  }

  try {
    if (stage === 'before_intent') {
      throw Object.assign(new Error('TEST_FAIL_BEFORE_INTENT'), { code: 'TEST_FAIL_BEFORE_INTENT' })
    }

    const existing = scratch.kv.get(DEBT_OP_ENVELOPE_KV_KEY)
    const map = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing }
      : {}
    map[env.clientRef] = { ...env, state: 'intent' }
    writeEnvelopes(map)
    if (stage === 'after_intent') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_INTENT'), { code: 'TEST_FAIL_AFTER_INTENT' })
    }

    // queue (absolute upsert by clientRef)
    scratch.queue.set(env.clientRef, JSON.parse(JSON.stringify(env.queueRow)))
    if (stage === 'after_queue') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_QUEUE'), { code: 'TEST_FAIL_AFTER_QUEUE' })
    }

    if (env.card && (env.card.num || env.card.id)) {
      const num = String(env.card.num || env.card.id)
      scratch.kv.set('data_cards', upsertArrayRow(scratch.kv.get('data_cards'), 'num', num, env.card))
    }
    if (stage === 'after_card') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_CARD'), { code: 'TEST_FAIL_AFTER_CARD' })
    }

    if (env.client && env.client.id) {
      const id = String(env.client.id)
      scratch.kv.set('data_clients', upsertArrayRow(scratch.kv.get('data_clients'), 'id', id, env.client))
      scratch.kv.set('catalog_clients', upsertArrayRow(scratch.kv.get('catalog_clients'), 'id', id, env.client))
    }
    if (stage === 'after_client') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_CLIENT'), { code: 'TEST_FAIL_AFTER_CLIENT' })
    }

    if (env.shift && env.shift.id) {
      const snap = scratch.kv.get('data_pos_snapshot')
      const base = snap && typeof snap === 'object' ? { ...snap } : {}
      base.shifts = upsertShiftRow(base.shifts, env.shift)
      scratch.kv.set('data_pos_snapshot', base)
    }
    if (stage === 'after_shift') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_SHIFT'), { code: 'TEST_FAIL_AFTER_SHIFT' })
    }

    if (env.cashRepayLedgerEntry) {
      scratch.kv.set(
        'data_debt_repay_cash_ledger',
        upsertCashRepayLedger(scratch.kv.get('data_debt_repay_cash_ledger'), env.cashRepayLedgerEntry),
      )
    }
    if (stage === 'after_ledger') {
      throw Object.assign(new Error('TEST_FAIL_AFTER_LEDGER'), { code: 'TEST_FAIL_AFTER_LEDGER' })
    }

    if (stage === 'before_clear') {
      throw Object.assign(new Error('TEST_FAIL_BEFORE_CLEAR'), { code: 'TEST_FAIL_BEFORE_CLEAR' })
    }

    const after = scratch.kv.get(DEBT_OP_ENVELOPE_KV_KEY)
    const nextMap = after && typeof after === 'object' && !Array.isArray(after) ? { ...after } : {}
    delete nextMap[env.clientRef]
    writeEnvelopes(nextMap)

    // COMMIT
    store.queue = scratch.queue
    store.kv = scratch.kv
    return { ok: true, clientRef: env.clientRef }
  } catch (e) {
    // ROLLBACK of this attempt — durable intent may already be in scratch;
    // for true Android, intent write is durable before apply. Simulator:
    // if we threw after_intent, persist intent into store so recover can finish.
    if (String(e?.code || '').startsWith('TEST_FAIL_AFTER_INTENT')
      || String(e?.code || '').startsWith('TEST_FAIL_AFTER_QUEUE')
      || String(e?.code || '').startsWith('TEST_FAIL_AFTER_CARD')
      || String(e?.code || '').startsWith('TEST_FAIL_AFTER_CLIENT')
      || String(e?.code || '').startsWith('TEST_FAIL_AFTER_SHIFT')
      || String(e?.code || '').startsWith('TEST_FAIL_AFTER_LEDGER')
      || String(e?.code || '').startsWith('TEST_FAIL_BEFORE_CLEAR')) {
      // Partial durable: keep intent (+ any applied effects already in scratch) as "crash mid-apply"
      store.queue = scratch.queue
      store.kv = scratch.kv
    }
    throw e
  }
}

/**
 * Recover all intent envelopes: re-apply absolute effects and clear.
 * Returns number recovered.
 */
export function recoverDebtOpEnvelopesInStore(store, failAt = '') {
  const raw = store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const refs = Object.keys(map)
  let n = 0
  for (const ref of refs) {
    const env = map[ref]
    if (!env || env.state === 'committed') {
      delete map[ref]
      continue
    }
    // Re-run apply; clear happens inside on success
    applyDebtOpEnvelopeToStore(store, env, failAt)
    n += 1
  }
  return n
}
