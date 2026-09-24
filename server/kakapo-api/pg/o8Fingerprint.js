'use strict'

import crypto from 'crypto'

/** Stable semantic fingerprint for O8 durable mutations (hex, 32 chars). */
export function buildO8Fingerprint(operationKind, fields = {}) {
  const kind = String(operationKind || '').trim()
  const norm = {}
  const keys = Object.keys(fields).sort()
  for (const k of keys) {
    const v = fields[k]
    if (v === undefined) continue
    norm[k] = v
  }
  const raw = JSON.stringify({ kind, ...norm })
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}
