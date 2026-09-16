/**
 * PC-4B — Explicit operator-controlled production replay enablement.
 * Default: REFUSE all production mutation hosts.
 * Env flag alone is NEVER sufficient.
 */
import { sha256Hex } from './sha256Pure.mjs'

export const PRODUCTION_ALLOWLIST = Object.freeze([
  'https://kakappo.shop/api/kakapo',
  'https://www.kakappo.shop/api/kakapo',
])

export const REFUSE_PRODUCTION_REPLAY = 'REFUSE_PRODUCTION_REPLAY'
export const OPERATOR_TOKEN_PREFIX = 'ENABLE_PRODUCTION_REPLAY_V1'

function normalizeBase(url) {
  return String(url || '').replace(/\/$/, '').trim()
}

export function isProductionMutationHost(baseUrl) {
  const u = normalizeBase(baseUrl)
  return /kakappo\.shop/i.test(u) || /kakapo\.shop/i.test(u)
}

export function isAllowlistedProductionBase(baseUrl) {
  const u = normalizeBase(baseUrl)
  return PRODUCTION_ALLOWLIST.includes(u)
}

/**
 * Create an operator enable token bound to sessionId + baseUrl.
 * Must be passed explicitly — never derived from env alone.
 */
export function createOperatorEnableToken(input = {}) {
  const sessionId = String(input.sessionId || '').trim()
  const baseUrl = normalizeBase(input.baseUrl)
  const issuedAt = input.issuedAt || new Date().toISOString()
  const nonce = String(input.nonce || Math.random().toString(36).slice(2, 12))
  if (!sessionId) throw new Error('sessionId_required')
  if (!baseUrl) throw new Error('baseUrl_required')
  const material = `${OPERATOR_TOKEN_PREFIX}|${sessionId}|${baseUrl}|${issuedAt}|${nonce}`
  const sig = sha256Hex(material)
  return {
    v: 1,
    sessionId,
    baseUrl,
    issuedAt,
    nonce,
    sig,
  }
}

export function verifyOperatorEnableToken(token, expected = {}) {
  if (!token || typeof token !== 'object') return { ok: false, error: 'token_missing' }
  const sessionId = String(expected.sessionId || '').trim()
  const baseUrl = normalizeBase(expected.baseUrl)
  if (String(token.sessionId || '') !== sessionId) return { ok: false, error: 'token_session_mismatch' }
  if (normalizeBase(token.baseUrl) !== baseUrl) return { ok: false, error: 'token_baseUrl_mismatch' }
  const material = `${OPERATOR_TOKEN_PREFIX}|${token.sessionId}|${normalizeBase(token.baseUrl)}|${token.issuedAt}|${token.nonce}`
  const sig = sha256Hex(material)
  if (sig !== String(token.sig || '')) return { ok: false, error: 'token_sig_invalid' }
  return { ok: true }
}

/**
 * All gates must pass. Env flag alone never enables production replay.
 */
export function assertProductionReplayAllowed(input = {}) {
  const fails = []
  if (!input.recoveryMode) fails.push('recoveryMode_false')
  if (String(input.phase || '') !== 'RECOVERY_REPLAY') fails.push('phase_not_RECOVERY_REPLAY')
  if (!String(input.sessionId || '').trim()) fails.push('sessionId_missing')
  if (!input.snapshotExists) fails.push('snapshot_missing')
  if (!input.backupManifestPresent) fails.push('backup_manifest_missing')
  if (!input.classificationClean) fails.push('classification_not_clean')
  if (!input.freezeWatermarkUnchanged) fails.push('freeze_watermark_changed')
  if (!isAllowlistedProductionBase(input.baseUrl)) fails.push('baseUrl_not_allowlisted')

  const tok = verifyOperatorEnableToken(input.operatorToken, {
    sessionId: input.sessionId,
    baseUrl: input.baseUrl,
  })
  if (!tok.ok) fails.push(`operator_token:${tok.error}`)

  // Document that env alone is insufficient (even if set)
  if (input.envFlag && !input.operatorToken) {
    fails.push('env_flag_alone_insufficient')
  }

  if (fails.length) {
    return {
      ok: false,
      code: REFUSE_PRODUCTION_REPLAY,
      error: 'production_replay_refused',
      fails,
      defaultRefuse: true,
    }
  }
  return {
    ok: true,
    code: 'PRODUCTION_REPLAY_ENABLED',
    sessionId: input.sessionId,
    baseUrl: normalizeBase(input.baseUrl),
  }
}
