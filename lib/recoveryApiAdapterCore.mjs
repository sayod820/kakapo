/**
 * PC-4 — Recovery API adapter contract (pure core).
 * Maps queue kinds → existing production HTTP contracts.
 * Does NOT call production; callers inject baseUrl / fetch.
 */
import { businessPayloadFingerprint } from './desktopRecoveryEngineCore.mjs'

/** @typedef {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} HttpMethod */

/**
 * Certified recovery kind → production API contract.
 * Paths match lib/api.ts / server kakapo-api.
 */
export function recoveryHttpContractMatrix() {
  return [
    {
      kind: 'sale',
      apiFn: 'api.createPosSale',
      method: 'POST',
      path: '/pos/sales',
      clientRefField: 'clientRef',
      idempotency: 'clientRef unique on pos sales',
      responseShape: '{ id, clientRef, items, paidCash, paidCard, debtAdded, shiftId, ... }',
      verify: { method: 'GET', path: '/pos/sales', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED', 'SHIFT_CLOSED', 'SHIFT_NOT_FOUND'],
    },
    {
      kind: 'stock_receipt_create',
      apiFn: 'api.createStockReceipt',
      method: 'POST',
      path: '/stock/receipts',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, clientRef, items, ... }',
      verify: { method: 'GET', path: '/stock/receipts', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'shift_open',
      apiFn: 'api.openPosShift',
      method: 'POST',
      path: '/pos/shifts/open',
      clientRefField: 'clientRef',
      idempotency: 'same clientRef returns existing row',
      responseShape: '{ id: SHIFT-*, clientRef, status }',
      verify: { method: 'GET', path: '/pos/shifts', match: 'clientRef' },
      errorCodes: ['already open on POS/cashier'],
      note: 'recovery uses ensureRecoveryServerShift only',
    },
    {
      kind: 'shift_close',
      apiFn: 'api.closePosShift',
      method: 'PATCH',
      path: '/pos/shifts/:id/close',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, status: closed }',
      verify: { method: 'GET', path: '/pos/shifts', match: 'id' },
      errorCodes: [],
      replaySupported: false,
      note: 'never close already-closed ghost on server',
    },
    {
      kind: 'debt_repay',
      apiFn: 'api.debtRepayCard',
      method: 'POST',
      path: '/cards/:num/debt-repay',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ card, amount, nextDebt, ... }',
      verify: { method: 'GET', path: '/cards', match: 'clientRef via ledger/journal' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED', 'DEBT_*'],
    },
    {
      kind: 'cash_advance',
      apiFn: 'api.cashAdvanceCard',
      method: 'POST',
      path: '/cards/:num/cash-advance',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ card, amount, nextDebt, debtLedgerEntryId? }',
      verify: { method: 'GET', path: '/cards', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'card_topup',
      apiFn: 'api.cashTopupCard',
      method: 'POST',
      path: '/cards/:num/cash-topup',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ card, financeMove }',
      verify: { method: 'GET', path: '/cards', match: 'num' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'finance_move',
      apiFn: 'api.createFinanceMove',
      method: 'POST',
      path: '/finance/moves',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, clientRef, amount, type }',
      verify: { method: 'GET', path: '/finance/moves', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'sale_return',
      apiFn: 'api.returnPosSale',
      method: 'POST',
      path: '/pos/sales/:id/return',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, ... }',
      verify: { method: 'GET', path: '/pos/sales', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'stock_writeoff_create',
      apiFn: 'api.createStockWriteoff',
      method: 'POST',
      path: '/stock/writeoffs',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, clientRef }',
      verify: { method: 'GET', path: '/stock/writeoffs', match: 'clientRef' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED'],
    },
    {
      kind: 'stock_layer_delete',
      apiFn: 'api.deleteProductStockLayer',
      method: 'DELETE',
      path: '/stock/receipts/:receiptId/layers/:productId',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id }',
      verify: { method: 'GET', path: '/stock/receipts', match: 'layer absent' },
      errorCodes: ['IDEMPOTENCY_KEY_REUSED', '404'],
    },
    {
      kind: 'client_upsert',
      apiFn: 'api.updateClient / createClient',
      method: 'POST',
      path: '/clients',
      clientRefField: 'clientRef',
      idempotency: 'clientRef',
      responseShape: '{ id, ... }',
      verify: { method: 'GET', path: '/clients', match: 'id' },
      errorCodes: ['409 phone conflict'],
    },
    {
      kind: 'card_loyalty_patch',
      apiFn: 'api card loyalty patch',
      method: 'PATCH',
      path: '/cards/:num',
      clientRefField: 'clientRef',
      idempotency: 'clientRef / version',
      responseShape: '{ ...card }',
      verify: { method: 'GET', path: '/cards', match: 'num' },
      errorCodes: ['409 version'],
    },
  ]
}

export function contractForKind(kind) {
  return recoveryHttpContractMatrix().find(r => r.kind === kind) || null
}

/**
 * Classify production-shaped HTTP errors for the recovery executor.
 * Matches server kakapo-api JSON: { detail, code, conflict? }
 */
export function classifyRecoveryHttpError(input = {}) {
  const status = Number(input.status) || 0
  const body = input.body && typeof input.body === 'object' ? input.body : null
  const text = String(input.text || body?.detail || body?.error || body?.message || '')
  const code = String(body?.code || '').trim()
  const detail = String(body?.detail || text || '')

  if (input.network || /timeout|timed?\s*out|ECONN|ECONNRESET|connection reset|abort|network/i.test(text)) {
    if (input.afterCommit) {
      return { class: 'TIMEOUT_AFTER_COMMIT', retrySameClientRef: true, message: detail || text }
    }
    return { class: 'TIMEOUT_BEFORE_COMMIT', retrySameClientRef: true, message: detail || text }
  }

  if (code === 'IDEMPOTENCY_KEY_REUSED' || /IDEMPOTENCY_KEY_REUSED|тот же clientRef/i.test(detail)) {
    return {
      class: 'IDEMPOTENCY_KEY_REUSED',
      retrySameClientRef: false,
      needsCanonicalLookup: true,
      message: detail,
      code,
    }
  }
  if (code === 'SHIFT_CLOSED' || /SHIFT_CLOSED|смена уже закрыта/i.test(detail)) {
    return { class: 'SHIFT_CLOSED', stopChain: true, message: detail, code: code || 'SHIFT_CLOSED' }
  }
  if (status === 400 || /validation|обязател|некоррект/i.test(detail)) {
    return { class: 'VALIDATION_400', stopChain: true, message: detail, status }
  }
  if (status === 404) {
    return { class: 'NOT_FOUND_404', stopChain: true, message: detail, status }
  }
  if (status === 409) {
    return {
      class: 'CONFLICT_409',
      needsCanonicalLookup: true,
      message: detail,
      status,
      code: code || undefined,
    }
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    if (input.afterCommit) {
      return { class: 'SERVER_500_AFTER_COMMIT', retrySameClientRef: true, needsCanonicalLookup: true, status }
    }
    return { class: 'SERVER_500_BEFORE_COMMIT', retrySameClientRef: true, status }
  }
  return { class: 'UNKNOWN_HTTP', stopChain: true, message: detail || text, status, code }
}

function joinUrl(base, path) {
  return String(base || '').replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`)
}

async function parseJsonSafe(res) {
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { text, body }
}

/**
 * Create RecoveryApiAdapter bound to an isolated base URL (mock or lab).
 * NEVER point at production without operator override (blocked by default).
 *
 * PC-4B: production mutations require assertProductionReplayAllowed() gates
 * (recoveryMode + RECOVERY_REPLAY + durable session + backup + operator token +
 * allowlist + clean classification + freeze watermark). Env alone is insufficient.
 * allowProductionHost remains a hard second latch — must be true AND gates pass.
 */
export function createRecoveryHttpAdapter(opts = {}) {
  const baseUrl = String(opts.baseUrl || '').replace(/\/$/, '')
  const fetchFn = opts.fetchFn || globalThis.fetch
  const allowProductionHost = !!opts.allowProductionHost
  const mutationLog = []
  const productionHosts = [/kakappo\.shop/i, /kakapo\.shop/i]
  const isProdHost = productionHosts.some(re => re.test(baseUrl))
  let productionReplayGate = opts.productionReplayGate || null

  if (!baseUrl) throw new Error('baseUrl_required')
  if (isProdHost && !allowProductionHost) {
    throw new Error('REFUSE_PRODUCTION_HOST: adapter blocked from production mutation hosts')
  }
  // Production mutations require an explicit gate object. GETs may proceed once host is allowed
  // so Desktop can classify before enabling replay (PC-5).
  function assertMutationAllowed() {
    if (!isProdHost) return
    if (opts.requireProductionReplayGate === false && productionReplayGate?.ok === true) return
    if (!productionReplayGate || productionReplayGate.ok !== true || productionReplayGate.code !== 'PRODUCTION_REPLAY_ENABLED') {
      throw new Error('REFUSE_PRODUCTION_REPLAY: productionReplayGate required for mutations')
    }
    if (String(productionReplayGate.baseUrl || '').replace(/\/$/, '') !== baseUrl) {
      throw new Error('REFUSE_PRODUCTION_REPLAY: gate baseUrl mismatch')
    }
  }
  // If caller passed a gate at construction, validate it now
  if (isProdHost && productionReplayGate) {
    assertMutationAllowed()
  } else if (isProdHost && opts.requireProductionReplayGate !== false && !opts.allowProductionGetClassify) {
    // Legacy PC-4B: require gate at construction unless classify-get mode
    throw new Error('REFUSE_PRODUCTION_REPLAY: productionReplayGate required')
  }

  const state = {
    posts: 0,
    byRef: new Map(),
  }

  async function http(method, path, body, meta = {}) {
    const url = joinUrl(baseUrl, path)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      assertMutationAllowed()
      state.posts += 1
    }
    mutationLog.push({ method, path, clientRef: body?.clientRef, at: new Date().toISOString() })

    let res
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), meta.timeoutMs || 15000)
      res = await fetchFn(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      })
      clearTimeout(t)
    } catch (e) {
      const msg = String(e?.message || e)
      const classified = classifyRecoveryHttpError({
        network: true,
        text: msg,
        afterCommit: meta.afterCommitHint,
      })
      const err = new Error(classified.message || msg)
      err.recoveryClass = classified.class
      err.recovery = classified
      throw err
    }

    const { text, body: parsed } = await parseJsonSafe(res)
    if (!res.ok) {
      const classified = classifyRecoveryHttpError({
        status: res.status,
        body: parsed,
        text,
        afterCommit: meta.afterCommitHint,
      })
      const err = new Error(
        classified.code
          ? `${classified.code}: ${classified.message || text}`
          : (classified.message || text || `HTTP ${res.status}`),
      )
      err.status = res.status
      err.body = parsed
      err.recoveryClass = classified.class
      err.recovery = classified
      throw err
    }
    return parsed
  }

  function cardNum(payload) {
    return String(payload.num || payload.cardNum || '').trim()
  }

  const api = {
    baseUrl,
    mutationLog,
    getMutationCount: () => mutationLog.filter(m => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m.method)).length,
    setProductionReplayGate: (gate) => {
      productionReplayGate = gate
      assertMutationAllowed()
    },
    listOpenShifts: async () => {
      const rows = await http('GET', '/pos/shifts')
      const list = Array.isArray(rows) ? rows : (rows?.shifts || [])
      return list.filter(s => String(s.status) === 'open')
    },
    listAllShifts: async () => {
      const rows = await http('GET', '/pos/shifts')
      return Array.isArray(rows) ? rows : (rows?.shifts || [])
    },
    listPosSales: async () => {
      const rows = await http('GET', '/pos/sales')
      return Array.isArray(rows) ? rows : (rows?.sales || [])
    },
    getShiftByClientRef: async (clientRef) => {
      const rows = await http('GET', '/pos/shifts')
      const list = Array.isArray(rows) ? rows : (rows?.shifts || [])
      return list.find(s => String(s.clientRef || '') === clientRef) || null
    },
    openPosShift: async (data) => http('POST', '/pos/shifts/open', data),
    createPosSale: async (payload) => {
      const row = await http('POST', '/pos/sales', payload)
      const fp = businessPayloadFingerprint('sale', payload)
      state.byRef.set(payload.clientRef, {
        kind: 'sale',
        id: row.id || row.saleId,
        fingerprint: fp,
        payload,
        raw: row,
      })
      return { id: row.id || row.saleId, ...row, fingerprint: fp }
    },
    createStockReceipt: async (payload) => {
      const row = await http('POST', '/stock/receipts', payload)
      const fp = businessPayloadFingerprint('stock_receipt_create', payload)
      state.byRef.set(payload.clientRef, { kind: 'stock_receipt_create', id: row.id, fingerprint: fp, payload, raw: row })
      return { id: row.id, ...row, fingerprint: fp }
    },
    createDebtRepay: async (payload) => {
      const num = cardNum(payload)
      const row = await http('POST', `/cards/${encodeURIComponent(num)}/debt-repay`, payload)
      const fp = businessPayloadFingerprint('debt_repay', payload)
      state.byRef.set(payload.clientRef, { kind: 'debt_repay', id: row.id || `DR-${payload.clientRef}`, fingerprint: fp, payload, raw: row })
      return { id: row.id || `DR-${payload.clientRef}`, ...row, fingerprint: fp }
    },
    createCashAdvance: async (payload) => {
      const num = cardNum(payload)
      const row = await http('POST', `/cards/${encodeURIComponent(num)}/cash-advance`, payload)
      const fp = businessPayloadFingerprint('cash_advance', payload)
      state.byRef.set(payload.clientRef, { kind: 'cash_advance', id: row.debtLedgerEntryId || `CA-${payload.clientRef}`, fingerprint: fp, payload, raw: row })
      return { id: row.debtLedgerEntryId || `CA-${payload.clientRef}`, ...row, fingerprint: fp }
    },
    createCardTopup: async (payload) => {
      const num = cardNum(payload)
      const row = await http('POST', `/cards/${encodeURIComponent(num)}/cash-topup`, payload)
      const fp = businessPayloadFingerprint('card_topup', payload)
      state.byRef.set(payload.clientRef, { kind: 'card_topup', id: row.financeMove?.id || `CT-${payload.clientRef}`, fingerprint: fp, payload, raw: row })
      return { id: row.financeMove?.id || `CT-${payload.clientRef}`, ...row, fingerprint: fp }
    },
    createFinanceMove: async (payload) => {
      const row = await http('POST', '/finance/moves', payload)
      const fp = businessPayloadFingerprint('finance_move', payload)
      state.byRef.set(payload.clientRef, { kind: 'finance_move', id: row.id, fingerprint: fp, payload, raw: row })
      return { id: row.id, ...row, fingerprint: fp }
    },
    createSaleReturn: async (payload) => {
      const saleId = String(payload.saleId || payload.id || '').trim()
      const row = await http('POST', `/pos/sales/${encodeURIComponent(saleId)}/return`, payload)
      const fp = businessPayloadFingerprint('sale_return', payload)
      state.byRef.set(payload.clientRef, { kind: 'sale_return', id: row.id || `RET-${payload.clientRef}`, fingerprint: fp, payload, raw: row })
      return { id: row.id || `RET-${payload.clientRef}`, ...row, fingerprint: fp }
    },
    createStockWriteoff: async (payload) => {
      const row = await http('POST', '/stock/writeoffs', payload)
      const fp = businessPayloadFingerprint('stock_writeoff_create', payload)
      state.byRef.set(payload.clientRef, { kind: 'stock_writeoff_create', id: row.id, fingerprint: fp, payload, raw: row })
      return { id: row.id, ...row, fingerprint: fp }
    },
    deleteStockLayer: async (payload) => {
      const receiptId = String(payload.receiptId || '')
      const productId = Number(payload.productId)
      const row = await http('DELETE', `/stock/receipts/${encodeURIComponent(receiptId)}/layers/${productId}`, payload)
      const fp = businessPayloadFingerprint('stock_layer_delete', payload)
      state.byRef.set(payload.clientRef, { kind: 'stock_layer_delete', id: row?.id || `LAYER-${payload.clientRef}`, fingerprint: fp, payload, raw: row })
      return { id: row?.id || `LAYER-${payload.clientRef}`, ...row, fingerprint: fp }
    },
    postKind: async (kind, payload) => {
      if (kind === 'stock_layer_delete') {
        const receiptId = String(payload.receiptId || '')
        const productId = Number(payload.productId)
        const row = await http('DELETE', `/stock/receipts/${encodeURIComponent(receiptId)}/layers/${productId}`, payload)
        const fp = businessPayloadFingerprint('stock_layer_delete', payload)
        state.byRef.set(payload.clientRef, {
          kind: 'stock_layer_delete',
          id: row?.id || `LAYER-${payload.clientRef}`,
          fingerprint: fp,
          payload,
          raw: row,
        })
        return { id: row?.id || `LAYER-${payload.clientRef}`, ...row, fingerprint: fp }
      }
      const c = contractForKind(kind)
      if (!c || c.replaySupported === false) throw new Error(`unsupported_kind_${kind}`)
      throw new Error(`postKind_not_wired_${kind}`)
    },
    getByClientRef: async (kind, clientRef) => {
      // Prefer local index from this adapter session
      const local = state.byRef.get(clientRef)
      if (local && (!kind || local.kind === kind)) return local

      // Canonical list GET by kind
      const c = contractForKind(kind)
      if (!c?.verify?.path) return null
      try {
        const rows = await http('GET', c.verify.path)
        const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.items) ? rows.items : [])
        const hit = list.find(r => String(r.clientRef || '') === clientRef)
        if (!hit) return null
        return {
          kind,
          id: hit.id,
          clientRef,
          fingerprint: hit.fingerprint || businessPayloadFingerprint(kind, hit),
          payload: hit,
          raw: hit,
        }
      } catch (e) {
        // 404 / empty verify endpoint → no hit (do not escalate to STOP)
        if (/404|NOT_FOUND|miss/i.test(String(e?.message || e)) || e?.status === 404) return null
        throw e
      }
    },
  }

  return api
}

/** Data conservation snapshot for LAB before/after */
export function captureConservationSnapshot(queue, sales = []) {
  const saleOps = (queue || []).filter(r => r.kind === 'sale')
  const fromQueue = saleOps.map(r => ({
    clientRef: r.clientRef,
    seq: r.seq,
    createdAtIso: r.createdAtIso,
    shiftId: r.payload?.shiftId,
    fingerprint: businessPayloadFingerprint('sale', r.payload),
    paidCash: r.payload?.paidCash,
    paidCard: r.payload?.paidCard,
    paidWallet: r.payload?.paidWallet,
    debtAdded: r.payload?.debtAdded,
    bonusSpent: r.payload?.bonusSpent,
    items: r.payload?.items,
  }))
  const fromSales = (sales || []).map(s => ({
    clientRef: s.clientRef,
    shiftId: s.shiftId,
    paidCash: s.paidCash,
    paidCard: s.paidCard,
  }))
  return {
    saleCount: fromQueue.length || fromSales.length,
    clientRefs: fromQueue.map(x => x.clientRef).sort(),
    fingerprints: fromQueue.map(x => x.fingerprint).sort(),
    totals: {
      cash: fromQueue.reduce((a, x) => a + (Number(x.paidCash) || 0), 0),
      card: fromQueue.reduce((a, x) => a + (Number(x.paidCard) || 0), 0),
      debt: fromQueue.reduce((a, x) => a + (Number(x.debtAdded) || 0), 0),
    },
    rows: fromQueue,
  }
}

export function assertConservation(before, after, opts = {}) {
  const errors = []
  if (before.saleCount !== after.saleCount && !opts.allowCountChange) {
    // After replay, queue sales gone but server/local sales must match fingerprints
  }
  const beforeRefs = new Set(before.clientRefs)
  const afterRefs = new Set(after.clientRefs)
  for (const r of beforeRefs) {
    if (!afterRefs.has(r) && !(opts.serverRefs || []).includes(r) && !(opts.completedRefs || []).includes(r)) {
      errors.push(`LOST_SALE:${r}`)
    }
  }
  // duplicates
  if (after.clientRefs.length !== new Set(after.clientRefs).size) {
    errors.push('DUPLICATE_CLIENTREF')
  }
  if (Math.abs(before.totals.cash - after.totals.cash) > 0.001 && opts.compareTotals) {
    errors.push('PAYMENT_CASH_CHANGED')
  }
  if (Math.abs(before.totals.card - after.totals.card) > 0.001 && opts.compareTotals) {
    errors.push('PAYMENT_CARD_CHANGED')
  }
  if (Math.abs(before.totals.debt - after.totals.debt) > 0.001 && opts.compareTotals) {
    errors.push('DEBT_CHANGED')
  }
  // fingerprints for completed must match before
  if (opts.fingerprintByRef) {
    for (const [ref, fp] of Object.entries(opts.fingerprintByRef)) {
      const row = before.rows.find(r => r.clientRef === ref)
      if (row && row.fingerprint !== fp) errors.push(`FP_CHANGED:${ref}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Rollback policies (LAB / runbook).
 */
export function planRollback(scenario, session) {
  if (scenario === 'BEFORE_SERVER_REPLAY') {
    return {
      mode: 'RESTORE_SQLITE_TRIPLET',
      steps: [
        'close Desktop',
        'restore final kakapo.sqlite + wal + shm from backup',
        'keep recoveryMode=true',
        'do not resend queue',
      ],
      allowBlindRestore: true,
      sessionRetain: false,
    }
  }
  if (scenario === 'AFTER_PARTIAL_REPLAY') {
    return {
      mode: 'RECLASSIFY_RESUME',
      steps: [
        'DO NOT restore old SQLite blindly',
        'retain recovery session + checkpoints',
        'reclassify server by same clientRefs',
        'ACK exact committed',
        'resume executeRecoveryReplay from cursor',
      ],
      allowBlindRestore: false,
      sessionRetain: true,
      recoverySessionId: session?.recoverySessionId,
    }
  }
  return { mode: 'UNKNOWN', allowBlindRestore: false }
}

export function applyRollbackDecision(scenario, world, session, backupWorld) {
  const plan = planRollback(scenario, session)
  if (plan.allowBlindRestore) {
    return {
      ok: true,
      plan,
      world: JSON.parse(JSON.stringify(backupWorld)),
      session: {
        ...session,
        status: 'PAUSED',
        stoppedReason: 'rollback_before_replay',
      },
    }
  }
  // partial: keep world (server committed), reclassify
  return {
    ok: true,
    plan,
    world,
    session: {
      ...session,
      status: 'PAUSED',
      stoppedReason: 'rollback_after_partial_reclassify',
    },
    resumeRequired: true,
  }
}
