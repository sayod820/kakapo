/**
 * ONLINE-O8B — client OTP challenges (no fixed 1234 in production).
 */
'use strict'

import crypto from 'node:crypto'
import { isProductionRuntime } from './apiAuth.js'

/** @type {Map<string, object>} */
const challenges = new Map()

const OTP_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5

export function isOtpLabMode() {
  if (String(process.env.KAKAPO_OTP_LAB || '') === '1') return true
  if (String(process.env.KAKAPO_O8_TEST_API || '') === '1') return true
  if (String(process.env.NODE_ENV || '') === 'test') return true
  if (String(process.env.KAKAPO_LAB_AUTO_AUTH || '') === '1') return true
  return !isProductionRuntime()
}

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function hashOtpCode(code) {
  return crypto.createHash('sha256').update(`kakapo-otp-v1:${String(code)}`).digest('hex')
}

function prune() {
  const now = Date.now()
  for (const [id, c] of challenges) {
    if (c.expiresAtMs <= now || c.consumed) challenges.delete(id)
  }
}

export function createOtpChallenge({ phone } = {}) {
  prune()
  if (isProductionRuntime() && !isOtpLabMode()) {
    const err = new Error('OTP delivery is not configured for production')
    err.status = 503
    err.code = 'OTP_UNAVAILABLE'
    throw err
  }
  const digits = phoneDigits(phone)
  if (!digits || digits.length < 9) {
    const err = new Error('Укажите телефон')
    err.status = 400
    err.code = 'OTP_PHONE_REQUIRED'
    throw err
  }
  const challengeId = `otp_${crypto.randomBytes(16).toString('hex')}`
  const code = isOtpLabMode() ? '1234' : String(crypto.randomInt(100000, 999999))
  const row = {
    challengeId,
    phone: digits,
    codeHash: hashOtpCode(code),
    expiresAtMs: Date.now() + OTP_TTL_MS,
    attempts: 0,
    consumed: false,
    createdAtMs: Date.now(),
  }
  challenges.set(challengeId, row)
  return {
    ok: true,
    challengeId,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    demo: isOtpLabMode(),
    ...(isOtpLabMode() ? { demoCode: '1234' } : {}),
    delivery: isOtpLabMode() ? 'lab' : 'unavailable',
  }
}

export function verifyOtpChallenge({ challengeId, phone, code } = {}) {
  prune()
  if (isProductionRuntime() && !isOtpLabMode()) {
    if (String(code) === '1234') {
      const err = new Error('Неверный код')
      err.status = 400
      err.code = 'OTP_INVALID'
      throw err
    }
    const err = new Error('OTP delivery is not configured for production')
    err.status = 503
    err.code = 'OTP_UNAVAILABLE'
    throw err
  }

  const id = String(challengeId || '').trim()
  const digits = phoneDigits(phone)
  const rawCode = String(code || '').trim()

  let row = id ? challenges.get(id) : null
  if (!row) {
    const err = new Error('Неверный или просроченный код')
    err.status = 400
    err.code = 'OTP_INVALID'
    throw err
  }
  if (row.consumed) {
    const err = new Error('Код уже использован')
    err.status = 400
    err.code = 'OTP_REPLAY'
    throw err
  }
  if (row.expiresAtMs <= Date.now()) {
    challenges.delete(id)
    const err = new Error('Код просрочен')
    err.status = 400
    err.code = 'OTP_EXPIRED'
    throw err
  }
  if (digits && row.phone !== digits) {
    const err = new Error('Неверный код')
    err.status = 400
    err.code = 'OTP_PHONE_MISMATCH'
    throw err
  }
  row.attempts += 1
  if (row.attempts > MAX_ATTEMPTS) {
    challenges.delete(id)
    const err = new Error('Слишком много попыток')
    err.status = 429
    err.code = 'OTP_ATTEMPTS_EXCEEDED'
    throw err
  }
  if (hashOtpCode(rawCode) !== row.codeHash) {
    const err = new Error('Неверный код')
    err.status = 400
    err.code = 'OTP_INVALID'
    throw err
  }
  row.consumed = true
  challenges.delete(id)
  return { ok: true, phone: row.phone }
}

export function _clearOtpChallengesForTests() {
  challenges.clear()
}
