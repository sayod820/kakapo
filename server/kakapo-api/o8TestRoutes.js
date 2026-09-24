/**
 * ONLINE-O8 test chaos + probe routes. Mount only when KAKAPO_O8_TEST_API=1.
 */
'use strict'

import {
  getL13ChaosState,
  releaseL13ChaosHold,
  setL13ChaosHoldAt,
} from './pg/l13Chaos.js'
import { flushDbAsync } from './db.js'
import { _clearOtpChallengesForTests } from './otpChallenges.js'
import { _clearRateLimitsForTests } from './authRateLimit.js'
import { _clearAllSessionsForTests, createSession } from './apiAuth.js'

export function registerO8TestRoutes(app, { db } = {}) {
  if (process.env.KAKAPO_O8_TEST_API !== '1') return
  if (!db) throw new Error('registerO8TestRoutes requires db')

  app.get('/__o8/ping', (_req, res) => {
    res.json({ ok: true, service: 'o8-test', pid: process.pid })
  })

  app.get('/__o8/chaos', (_req, res) => {
    res.json(getL13ChaosState())
  })

  app.post('/__o8/chaos/hold-at', (req, res) => {
    setL13ChaosHoldAt(req.body?.point || null)
    res.json({ ok: true, ...getL13ChaosState() })
  })

  app.post('/__o8/chaos/release', (_req, res) => {
    releaseL13ChaosHold()
    res.json({ ok: true, ...getL13ChaosState() })
  })

  /** Preflight for harness — must return 200 when O8 tests run */
  app.get('/__o8/preflight', (_req, res) => {
    res.json({ ok: true, chaos: true, pid: process.pid })
  })

  /** Lab: flush CRM PATCH + snapshot for restart proofs (O4C). */
  app.post('/__o8/flush-db', async (_req, res) => {
    await flushDbAsync()
    res.json({ ok: true })
  })

  /** O8B: plant legacy plaintext employee (lab only). */
  app.post('/__o8/plant-legacy-employee', (req, res) => {
    if (!Array.isArray(db.employees)) db.employees = []
    const id = String(req.body?.id || `EMP-LEGACY-${Date.now()}`)
    const name = String(req.body?.name || 'Legacy Emp')
    const password = String(req.body?.password || 'legacy-pin')
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : ['sales']
    db.employees = db.employees.filter(e => e.id !== id && e.name !== name)
    db.employees.push({
      id,
      name,
      role: 'custom',
      permissions,
      active: true,
      password, // intentional plaintext for migration test
      createdAtIso: new Date().toISOString(),
    })
    res.json({ ok: true, id, name })
  })

  /** O8B: inspect durable credential shape (never for production). */
  app.get('/__o8/employee-secrets/:id', (req, res) => {
    const row = (db.employees || []).find(e => e.id === req.params.id)
    if (!row) return res.status(404).json({ detail: 'not found' })
    res.json({
      id: row.id,
      hasPassword: Object.prototype.hasOwnProperty.call(row, 'password') && row.password != null,
      passwordIsPlain: row.password != null ? String(row.password) : null,
      hasPasswordHash: !!row.passwordHash,
      passwordHashPrefix: row.passwordHash ? String(row.passwordHash).slice(0, 7) : null,
      passwordHashVersion: row.passwordHashVersion || null,
    })
  })

  app.get('/__o8/admin-secrets', (_req, res) => {
    const admin = (db.users || []).find(u => u.role === 'admin')
    const auth = db.settings?.admin?.auth || {}
    res.json({
      hasPassword: admin ? Object.prototype.hasOwnProperty.call(admin, 'password') && admin.password != null : false,
      hasPasswordHash: !!(admin && admin.passwordHash),
      settingsAuthHasPassword: Object.prototype.hasOwnProperty.call(auth, 'password'),
      settingsAuthKeys: Object.keys(auth),
    })
  })

  app.post('/__o8/clear-auth-labs', (_req, res) => {
    _clearOtpChallengesForTests()
    _clearRateLimitsForTests()
    res.json({ ok: true })
  })

  app.post('/__o8/issue-expired-session', (req, res) => {
    const session = createSession({
      principal: String(req.body?.principal || 'STAFF'),
      subjectId: String(req.body?.subjectId || 'expired'),
      name: 'expired',
      permissions: Array.isArray(req.body?.permissions) ? req.body.permissions : ['sales'],
      ttlMs: 1,
    })
    res.json({ access_token: session.token, expiresAtMs: session.expiresAtMs })
  })

  app.post('/__o8/clear-sessions', (_req, res) => {
    _clearAllSessionsForTests()
    res.json({ ok: true })
  })
}
