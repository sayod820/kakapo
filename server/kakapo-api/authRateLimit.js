/**
 * ONLINE-O8B — in-memory rate limiting (single-instance model).
 */
'use strict'

/** @type {Map<string, { count: number, resetAt: number, blockedUntil?: number }>} */
const buckets = new Map()

export function rateLimitCheck(key, {
  windowMs = 60_000,
  max = 20,
  blockMs = 60_000,
} = {}) {
  const k = String(key || '')
  const now = Date.now()
  let b = buckets.get(k)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(k, b)
  }
  if (b.blockedUntil && b.blockedUntil > now) {
    return {
      ok: false,
      status: 429,
      detail: 'Слишком много попыток. Подождите.',
      code: 'RATE_LIMITED',
      retryAfterMs: b.blockedUntil - now,
    }
  }
  b.count += 1
  if (b.count > max) {
    b.blockedUntil = now + blockMs
    return {
      ok: false,
      status: 429,
      detail: 'Слишком много попыток. Подождите.',
      code: 'RATE_LIMITED',
      retryAfterMs: blockMs,
    }
  }
  return { ok: true, remaining: Math.max(0, max - b.count) }
}

export function rateLimitReset(key) {
  buckets.delete(String(key || ''))
}

export function _clearRateLimitsForTests() {
  buckets.clear()
}

export function clientIp(req) {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  if (xf) return xf
  return String(req.ip || req.socket?.remoteAddress || 'unknown')
}
