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
import { createHash } from 'node:crypto'

export function offlinePinHash(plaintext) {
  return createHash('sha256').update('kakapo-emp-v1:' + String(plaintext || '')).digest('hex')
}
