'use strict'

import { isPostgresEnabled } from './pg/client.js'
import { runBusinessMutationTx } from './pg/businessMutationTx.js'
import { buildO8Fingerprint } from './pg/o8Fingerprint.js'
import { markResponseEphemeral } from './durableHttpResponse.js'

export function useDurableMasterCreate(clientRef) {
  return Boolean(String(clientRef || '').trim() && isPostgresEnabled())
}

export function masterCreateFingerprint(operationKind, fields) {
  return buildO8Fingerprint(operationKind, fields)
}

/**
 * @returns {Promise<{ replay: boolean, result: any }>}
 */
export async function runDurableMasterCreate(db, {
  clientRef,
  operationKind,
  fingerprint,
  mutate,
  advisoryLocks,
}) {
  const out = await runBusinessMutationTx({
    db,
    clientRef,
    operationKind,
    fingerprint,
    mutate,
    advisoryLocks,
  })
  return { replay: !!out.replay, result: out.result }
}

export function finishDurableMasterJson(res, result, replay) {
  markResponseEphemeral(res)
  if (replay) {
    return res.json({
      ...result,
      replayed: true,
      idempotentReplay: true,
      duplicate: true,
    })
  }
  return res.json(result)
}

/**
 * Hex fingerprint replay/conflict (master creates — not debt object fingerprints).
 * @returns {boolean} true if response sent
 */
export function replyMasterCreateReplayOrConflict(res, kind, clientRef, fingerprint, findOpRefRow) {
  const ref = String(clientRef || '').trim()
  if (!ref) return false
  const row = findOpRefRow(kind, ref)
  if (!row || row.result == null) return false
  const stored = String(row.fingerprint || '')
  const incoming = String(fingerprint || '')
  if (stored && incoming && stored !== incoming) {
    res.status(409).json({
      detail: 'Тот же clientRef уже использован с другими параметрами',
      code: 'IDEMPOTENCY_KEY_REUSED',
      clientRef: ref,
      kind,
    })
    return true
  }
  if (Array.isArray(row.result)) {
    res.json(row.result)
    return true
  }
  res.json({
    ...(row.result && typeof row.result === 'object' ? row.result : { result: row.result }),
    clientRef: ref,
    kind,
    replayed: true,
    duplicate: true,
    idempotentReplay: true,
  })
  return true
}

export function respondMasterTxError(res, e, fallback = 'Ошибка операции') {
  if (e?.status === 409 || e?.code === 'IDEMPOTENCY_KEY_REUSED') {
    return res.status(409).json({
      detail: e.message || 'Тот же clientRef уже использован с другими параметрами',
      code: e.code || 'IDEMPOTENCY_KEY_REUSED',
    })
  }
  const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 400
  return res.status(status).json({ detail: e?.message || fallback, error: e?.message })
}
