/**
 * ONLINE-O8B — password hashing (bcrypt) + legacy plaintext migration.
 */
'use strict'

import bcrypt from 'bcryptjs'

export const PASSWORD_HASH_VERSION = 1
const BCRYPT_ROUNDS = 10

export function hashPassword(plaintext) {
  const pwd = String(plaintext || '')
  if (!pwd) throw new Error('empty password')
  return bcrypt.hashSync(pwd, BCRYPT_ROUNDS)
}

export function verifyPasswordHash(plaintext, passwordHash) {
  if (!passwordHash) return false
  try {
    return bcrypt.compareSync(String(plaintext || ''), String(passwordHash))
  } catch {
    return false
  }
}

/**
 * Verify employee/admin credential.
 * @returns {{ ok: boolean, migrated?: boolean, passwordHash?: string }}
 */
export function verifyAndMaybeMigrateCredential(row, plaintext) {
  const pwd = String(plaintext || '')
  if (!row || !pwd) return { ok: false }

  if (row.passwordHash) {
    const ok = verifyPasswordHash(pwd, row.passwordHash)
    return { ok, migrated: false, passwordHash: row.passwordHash }
  }

  // Legacy plaintext
  if (row.password != null && String(row.password) === pwd) {
    const passwordHash = hashPassword(pwd)
    return { ok: true, migrated: true, passwordHash }
  }
  return { ok: false }
}

/** Apply migration onto durable row (mutates). */
export function applyPasswordMigration(row, passwordHash) {
  if (!row || !passwordHash) return
  row.passwordHash = passwordHash
  row.passwordHashVersion = PASSWORD_HASH_VERSION
  if (Object.prototype.hasOwnProperty.call(row, 'password')) {
    delete row.password
  }
}

export function setPasswordOnRow(row, plaintext) {
  const pwd = String(plaintext || '')
  if (pwd.length < 4) throw new Error('Пароль не короче 4 символов')
  row.passwordHash = hashPassword(pwd)
  row.passwordHashVersion = PASSWORD_HASH_VERSION
  if (Object.prototype.hasOwnProperty.call(row, 'password')) {
    delete row.password
  }
}

/** Offline device sync hash (SHA-256) — separate from bcrypt server hash. */
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

export function offlinePinHash(plaintext) {
  return createHash('sha256').update('kakapo-emp-v1:' + String(plaintext || '')).digest('hex')
}

/**
 * Offline verifier for Kassa/Android: PBKDF2-SHA256 with a per-employee salt.
 * The device checks it with WebCrypto; short PINs are no longer a one-hash lookup.
 * Format: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>
 */
export const OFFLINE_VERIFIER_ITERATIONS = 100000
const OFFLINE_VERIFIER_RE = /^pbkdf2-sha256\$(\d{4,7})\$([0-9a-f]{32})\$([0-9a-f]{64})$/

export function makeOfflineVerifier(plaintext) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(Buffer.from(String(plaintext || ''), 'utf8'), salt, OFFLINE_VERIFIER_ITERATIONS, 32, 'sha256')
  return `pbkdf2-sha256$${OFFLINE_VERIFIER_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function checkOfflineVerifier(plaintext, verifier) {
  const m = OFFLINE_VERIFIER_RE.exec(String(verifier || ''))
  if (!m) return false
  const expected = Buffer.from(m[3], 'hex')
  const got = pbkdf2Sync(Buffer.from(String(plaintext || ''), 'utf8'), Buffer.from(m[2], 'hex'), Number(m[1]), 32, 'sha256')
  return got.length === expected.length && timingSafeEqual(got, expected)
}
