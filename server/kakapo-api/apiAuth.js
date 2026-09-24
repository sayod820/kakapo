/**
 * ONLINE-O8 — API authentication / authorization.
 *
 * Principals: ADMIN | STAFF | CASHIER | CLIENT | DEVICE
 * Credentials: Bearer session tokens issued by /auth/login and /employees/login
 *              (and OTP verify for CLIENT). Device bind alone is NOT write authority.
 *
 * Lab: KAKAPO_LAB_AUTO_AUTH=1 grants ADMIN to loopback requests without Bearer
 * (online O1–O7 regression only). Never set in production.
 */
'use strict'

import crypto from 'node:crypto'

/** @typedef {'ADMIN'|'STAFF'|'CASHIER'|'CLIENT'|'DEVICE'} Principal */
/** @typedef {'PUBLIC_STORE'|'AUTHENTICATED_CLIENT'|'STAFF'|'CASHIER'|'ADMIN'|'DEVICE'|'INTERNAL'|'TEST_ONLY'} AccessClass */

export const SESSION_TTL_MS = {
  ADMIN: 12 * 3600 * 1000,
  STAFF: 12 * 3600 * 1000,
  CASHIER: 12 * 3600 * 1000,
  CLIENT: 30 * 24 * 3600 * 1000,
  DEVICE: 365 * 24 * 3600 * 1000,
}

/** Capability keys used by route policies */
export const CAP = {
  SALE_CREATE: 'SALE_CREATE',
  SALE_RETURN: 'SALE_RETURN',
  SHIFT_OPEN: 'SHIFT_OPEN',
  SHIFT_CLOSE: 'SHIFT_CLOSE',
  FINANCE_MOVE: 'FINANCE_MOVE',
  EXPENSE: 'EXPENSE',
  SUPPLIER_PAY: 'SUPPLIER_PAY',
  STOCK_RECEIPT: 'STOCK_RECEIPT',
  WRITEOFF: 'WRITEOFF',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  CLIENT_DEBT_REPAY: 'CLIENT_DEBT_REPAY',
  CASH_ADVANCE: 'CASH_ADVANCE',
  BONUS_ADJUSTMENT: 'BONUS_ADJUSTMENT',
  PRODUCT_EDIT: 'PRODUCT_EDIT',
  CLIENT_CRM: 'CLIENT_CRM',
  STAFF_EDIT: 'STAFF_EDIT',
  SETTINGS_EDIT: 'SETTINGS_EDIT',
  DEVICE_PAIR: 'DEVICE_PAIR',
  ADMIN_RECOVERY: 'ADMIN_RECOVERY',
  ORDER_STAFF: 'ORDER_STAFF',
  READ_STAFF: 'READ_STAFF',
}

const ALL_CAPS = Object.values(CAP)

/** Map Trade page permissions → capabilities */
export function capsFromTradePermissions(permissions = []) {
  const set = new Set([CAP.READ_STAFF])
  const pages = new Set((permissions || []).map(String))
  if (pages.has('sales')) {
    set.add(CAP.SALE_CREATE)
    set.add(CAP.SALE_RETURN)
    set.add(CAP.SHIFT_OPEN)
    set.add(CAP.SHIFT_CLOSE)
    set.add(CAP.CLIENT_CRM)
  }
  if (pages.has('clients')) set.add(CAP.CLIENT_CRM)
  if (pages.has('debts')) {
    set.add(CAP.CLIENT_DEBT_REPAY)
    set.add(CAP.CASH_ADVANCE)
    set.add(CAP.BONUS_ADJUSTMENT)
    set.add(CAP.CLIENT_CRM)
  }
  if (pages.has('products')) set.add(CAP.PRODUCT_EDIT)
  if (pages.has('warehouse')) {
    set.add(CAP.STOCK_RECEIPT)
    set.add(CAP.WRITEOFF)
    set.add(CAP.STOCK_ADJUSTMENT)
    set.add(CAP.PRODUCT_EDIT)
  }
  if (pages.has('suppliers')) set.add(CAP.SUPPLIER_PAY)
  if (pages.has('finance')) {
    set.add(CAP.FINANCE_MOVE)
    set.add(CAP.EXPENSE)
  }
  if (pages.has('reports')) set.add(CAP.READ_STAFF)
  return [...set]
}

/** @type {Map<string, object>} */
const sessions = new Map()

function nowMs() {
  return Date.now()
}

function newToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`
}

export function isAuthEnforced() {
  if (String(process.env.KAKAPO_AUTH_ENFORCE || '') === '0') return false
  return true
}

export function isLabAutoAuthEnabled() {
  return String(process.env.KAKAPO_LAB_AUTO_AUTH || '') === '1'
}

/** Temporary bridge: old PC kassa without Bearer until full ONLINE login migration. */
export function isLegacyPosWriteEnabled() {
  return String(process.env.KAKAPO_LEGACY_POS_WRITE || '') === '1'
}

export function isProductionRuntime() {
  return String(process.env.NODE_ENV || '') === 'production'
}

export function assertSafeAuthEnvOrThrow() {
  if (!isProductionRuntime()) return
  if (String(process.env.KAKAPO_O8_TEST_API || '') === '1') {
    throw new Error('KAKAPO_O8_TEST_API must not be set in production')
  }
  if (String(process.env.KAKAPO_L13_TEST_API || '') === '1') {
    throw new Error('KAKAPO_L13_TEST_API must not be set in production')
  }
  if (isLabAutoAuthEnabled()) {
    throw new Error('KAKAPO_LAB_AUTO_AUTH must not be set in production')
  }
  if (String(process.env.KAKAPO_OTP_LAB || '') === '1') {
    throw new Error('KAKAPO_OTP_LAB must not be set in production')
  }
  // Wildcard CORS is unsafe for production browser clients — require explicit origins.
  const cors = String(process.env.CORS_ORIGINS || '').trim()
  if (!cors || cors === '*' || cors.split(',').map((s) => s.trim()).includes('*')) {
    throw new Error('CORS_ORIGINS must be an explicit allowlist in production (no *)')
  }
}

export function pruneExpiredSessions() {
  const t = nowMs()
  for (const [token, s] of sessions) {
    if (s.expiresAtMs && s.expiresAtMs <= t) sessions.delete(token)
  }
}

/**
 * @param {{ principal: Principal, subjectId: string, roles?: string[], permissions?: string[], caps?: string[], deviceId?: string, phone?: string, name?: string, ttlMs?: number }} data
 */
export function createSession(data) {
  pruneExpiredSessions()
  const principal = String(data.principal || '').toUpperCase()
  const subjectId = String(data.subjectId || '').trim()
  if (!principal || !subjectId) throw new Error('createSession requires principal+subjectId')
  const ttl = data.ttlMs != null ? Number(data.ttlMs) : (SESSION_TTL_MS[principal] || SESSION_TTL_MS.STAFF)
  let caps = Array.isArray(data.caps) ? [...data.caps] : null
  if (!caps) {
    if (principal === 'ADMIN') caps = [...ALL_CAPS]
    else if (principal === 'STAFF' || principal === 'CASHIER') caps = capsFromTradePermissions(data.permissions || [])
    else if (principal === 'CLIENT') caps = []
    else caps = []
  }
  const token = newToken(principal.toLowerCase())
  const ttlSafe = Number.isFinite(ttl) ? ttl : 60_000
  const row = {
    token,
    principal,
    subjectId,
    roles: Array.isArray(data.roles) ? data.roles.map(String) : [principal.toLowerCase()],
    permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
    caps,
    deviceId: data.deviceId ? String(data.deviceId) : '',
    phone: data.phone ? String(data.phone).replace(/\D/g, '') : '',
    name: data.name ? String(data.name) : '',
    createdAtMs: nowMs(),
    // Allow ttlMs < 60s for lab expiry tests (O8B); production callers use SESSION_TTL_MS defaults.
    expiresAtMs: nowMs() + Math.max(1, ttlSafe),
  }
  sessions.set(token, row)
  return row
}

export function revokeSession(token) {
  sessions.delete(String(token || ''))
}

export function getSession(token) {
  if (!token) return null
  pruneExpiredSessions()
  const s = sessions.get(String(token))
  if (!s) return null
  if (s.expiresAtMs && s.expiresAtMs <= nowMs()) {
    sessions.delete(String(token))
    return null
  }
  return s
}

export function parseBearer(req) {
  const h = String(req.headers?.authorization || req.headers?.Authorization || '')
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

export function isLoopbackReq(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '')
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1')
}

export function authSubjectKey(session) {
  if (!session) return ''
  return `${session.principal}:${session.subjectId}`
}

/** Attach req.auth from Bearer or lab auto-auth. */
export function attachAuth(req) {
  if (req.auth) return req.auth
  const token = parseBearer(req)
  const session = getSession(token)
  if (session) {
    req.auth = session
    req.authToken = token
    return session
  }
  if (isLabAutoAuthEnabled() && isLoopbackReq(req)) {
    req.auth = {
      token: 'lab-auto-admin',
      principal: 'ADMIN',
      subjectId: 'lab-auto',
      roles: ['admin'],
      permissions: [],
      caps: [...ALL_CAPS],
      deviceId: '',
      phone: '',
      name: 'LabAutoAdmin',
      createdAtMs: nowMs(),
      expiresAtMs: nowMs() + SESSION_TTL_MS.ADMIN,
      labAuto: true,
    }
    req.authToken = 'lab-auto-admin'
    return req.auth
  }
  req.auth = null
  return null
}

export function hasCap(auth, cap) {
  if (!auth) return false
  if (auth.principal === 'ADMIN') return true
  return Array.isArray(auth.caps) && auth.caps.includes(cap)
}

export function hasAnyCap(auth, caps = []) {
  if (!auth) return false
  if (auth.principal === 'ADMIN') return true
  return (caps || []).some(c => hasCap(auth, c))
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, detail: string, code: string }}
 */
export function evaluateAccess(req, policy) {
  if (!policy) {
    return { ok: false, status: 403, detail: 'Маршрут без политики доступа', code: 'AUTH_POLICY_MISSING' }
  }
  if (!isAuthEnforced()) return { ok: true }

  const access = policy.access
  if (access === 'PUBLIC_STORE' || access === 'INTERNAL') return { ok: true }
  if (access === 'TEST_ONLY') {
    // Test routes only exist when env mounts them; still require lab or admin
    const auth = attachAuth(req)
    if (auth?.principal === 'ADMIN' || auth?.labAuto) return { ok: true }
    return { ok: false, status: 403, detail: 'Тестовый маршрут недоступен', code: 'AUTH_TEST_ONLY' }
  }

  const auth = attachAuth(req)
  if (!auth) {
    return { ok: false, status: 401, detail: 'Требуется авторизация', code: 'AUTH_REQUIRED' }
  }

  if (policy.requireCaps?.length) {
    if (!hasAnyCap(auth, policy.requireCaps)) {
      return { ok: false, status: 403, detail: 'Недостаточно прав', code: 'AUTH_FORBIDDEN' }
    }
  }

  if (access === 'ADMIN') {
    if (auth.principal !== 'ADMIN') {
      return { ok: false, status: 403, detail: 'Только администратор', code: 'AUTH_ADMIN_ONLY' }
    }
  } else if (access === 'STAFF' || access === 'CASHIER') {
    if (!['ADMIN', 'STAFF', 'CASHIER'].includes(auth.principal)) {
      return { ok: false, status: 403, detail: 'Только персонал', code: 'AUTH_STAFF_ONLY' }
    }
  } else if (access === 'AUTHENTICATED_CLIENT') {
    if (!['ADMIN', 'STAFF', 'CASHIER', 'CLIENT'].includes(auth.principal)) {
      return { ok: false, status: 403, detail: 'Требуется клиентская сессия', code: 'AUTH_CLIENT_ONLY' }
    }
  } else if (access === 'DEVICE') {
    if (!['ADMIN', 'STAFF', 'CASHIER', 'DEVICE'].includes(auth.principal)) {
      return { ok: false, status: 403, detail: 'Требуется устройство/персонал', code: 'AUTH_DEVICE_ONLY' }
    }
  }

  // Horizontal: CLIENT may only touch own phone/card resources when policy says so
  if (auth.principal === 'CLIENT' && policy.clientSelfOnly) {
    const phoneTail = (p) => String(p || '').replace(/\D/g, '').slice(-9)
    const phoneQ = phoneTail(req.query?.phone || req.body?.phone || req.body?.clientPhone || '')
    const selfPhone = phoneTail(auth.phone)
    const cardNum = String(req.params?.num || req.body?.cardNum || req.body?.num || '').trim().toUpperCase()
    const clientIdQ = String(req.query?.clientId || req.body?.clientId || req.params?.clientId || '').trim()
    if (phoneQ && selfPhone && phoneQ !== selfPhone) {
      return { ok: false, status: 403, detail: 'Нет доступа к чужим данным', code: 'AUTH_HORIZONTAL' }
    }
    if (clientIdQ && auth.subjectId && clientIdQ !== auth.subjectId && phoneTail(clientIdQ) !== selfPhone) {
      return { ok: false, status: 403, detail: 'Нет доступа к чужим данным', code: 'AUTH_HORIZONTAL' }
    }
    if (policy.bindClientCard && cardNum && auth.cardNum && cardNum !== String(auth.cardNum).toUpperCase()) {
      return { ok: false, status: 403, detail: 'Нет доступа к чужой карте', code: 'AUTH_HORIZONTAL' }
    }
  }

  return { ok: true }
}

/** Express middleware factory using route matcher */
export function createAuthMiddleware(matchPolicy, opts = {}) {
  return function apiAuthMiddleware(req, res, next) {
    try {
      attachAuth(req)
      const path = String(req.path || req.url || '').split('?')[0]
      const method = String(req.method || 'GET').toUpperCase()
      // Skip static update assets
      if (path.startsWith('/updates/')) return next()
      // Test-only mounts (__o8 / __l13) — allow only when explicit test env is on
      if (path.startsWith('/__o8') || path.startsWith('/__l13')) {
        const o8 = String(process.env.KAKAPO_O8_TEST_API || '') === '1'
        const l13 = String(process.env.KAKAPO_L13_TEST_API || '') === '1'
        if ((path.startsWith('/__o8') && o8) || (path.startsWith('/__l13') && l13)) {
          return next()
        }
        return res.status(404).json({ detail: 'Not found' })
      }
      const policy = matchPolicy(method, path)
      if (!policy) {
        // Unknown mutating route → deny when enforced
        if (isAuthEnforced() && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          return res.status(403).json({ detail: 'Маршрут не классифицирован', code: 'AUTH_UNKNOWN_ROUTE' })
        }
        return next()
      }
      let verdict = evaluateAccess(req, policy)
      // Migration window: bound device + active employee may write POS sales without Bearer
      if (!verdict.ok && verdict.code === 'AUTH_REQUIRED' && typeof opts.tryLegacyAuth === 'function') {
        const legacy = opts.tryLegacyAuth(req, policy, { method, path })
        if (legacy && legacy.ok) {
          verdict = evaluateAccess(req, policy)
        } else if (legacy && legacy.deny) {
          return res.status(legacy.deny.status || 403).json({
            detail: legacy.deny.detail || 'Нет доступа',
            code: legacy.deny.code || 'AUTH_FORBIDDEN',
          })
        }
      }
      if (!verdict.ok) {
        return res.status(verdict.status).json({ detail: verdict.detail, code: verdict.code })
      }
      // ONLINE-O10: live staff status/caps — disabled or role-reduced employees lose access immediately
      if (typeof opts.refreshStaffAuth === 'function' && req.auth) {
        const refreshed = opts.refreshStaffAuth(req)
        if (refreshed && refreshed.ok === false) {
          if (req.authToken) revokeSession(req.authToken)
          return res.status(refreshed.status || 401).json({
            detail: refreshed.detail || 'Сессия сотрудника недействительна',
            code: refreshed.code || 'AUTH_STAFF_REVOKED',
          })
        }
      }
      return next()
    } catch (e) {
      console.error('[apiAuth]', e?.message || e)
      return res.status(500).json({ detail: 'Ошибка авторизации' })
    }
  }
}

export function sessionCount() {
  pruneExpiredSessions()
  return sessions.size
}

/** Test helper */
export function _clearAllSessionsForTests() {
  sessions.clear()
}

const WS_STAFF_ROLES = new Set(['admin', 'pos', 'courier', 'assembler', 'restaurant'])
const WS_PUBLIC_EVENTS_ROLE = 'catalog'

/**
 * Resolve WebSocket identity from URL role + optional Bearer/query token.
 * Privileged roles require a live session. Spoofed admin/pos without token → reject.
 * Unauthenticated client connections are demoted to catalog (public product events only).
 *
 * @param {{ role: string, phone?: string, token?: string }} meta
 * @returns {{ ok: true, wsRole: string, clientPhone: string, principal: string|null }
 *         | { ok: false, reason: string }}
 */
export function resolveWsAuth(meta = {}) {
  const claimed = String(meta.role || 'client').toLowerCase().replace(/[^a-z]/g, '') || 'client'
  const token = String(meta.token || '').trim()
  const session = token ? getSession(token) : null
  const phoneTail = (p) => String(p || '').replace(/\D/g, '').slice(-9)
  const claimPhone = phoneTail(meta.phone)

  if (WS_STAFF_ROLES.has(claimed)) {
    if (!session) {
      return { ok: false, reason: 'WS_AUTH_REQUIRED' }
    }
    if (claimed === 'admin' && session.principal !== 'ADMIN') {
      return { ok: false, reason: 'WS_ADMIN_ONLY' }
    }
    if (!['ADMIN', 'STAFF', 'CASHIER', 'DEVICE'].includes(session.principal)) {
      return { ok: false, reason: 'WS_STAFF_ONLY' }
    }
    return {
      ok: true,
      wsRole: claimed,
      clientPhone: '',
      principal: session.principal,
    }
  }

  // client (or unknown) path
  if (!session) {
    return {
      ok: true,
      wsRole: WS_PUBLIC_EVENTS_ROLE,
      clientPhone: '',
      principal: null,
    }
  }

  if (session.principal === 'CLIENT') {
    const self = phoneTail(session.phone)
    // Never trust a different phone from the query string
    if (claimPhone && self && claimPhone !== self) {
      return { ok: false, reason: 'WS_HORIZONTAL' }
    }
    return {
      ok: true,
      wsRole: 'client',
      clientPhone: self || claimPhone,
      principal: 'CLIENT',
    }
  }

  // Staff/admin may open a client-scoped socket (support) with explicit phone
  if (['ADMIN', 'STAFF', 'CASHIER'].includes(session.principal)) {
    return {
      ok: true,
      wsRole: 'client',
      clientPhone: claimPhone,
      principal: session.principal,
    }
  }

  return {
    ok: true,
    wsRole: WS_PUBLIC_EVENTS_ROLE,
    clientPhone: '',
    principal: session.principal,
  }
}

/**
 * Extract WS auth token from Sec-WebSocket-Protocol (preferred) or Authorization.
 * Query-string tokens are ignored in production (RAW_WS_AUTH_TOKEN_IN_URL=NO).
 */
export function extractWsToken(req, urlQueryToken = '') {
  const protos = String(req?.headers?.['sec-websocket-protocol'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Protocols: "kakapo", "<token>" or just "<token>"
  const fromProto = protos.find((p) => /^(admin|staff|cashier|client|device)_/i.test(p))
    || protos.find((p) => p !== 'kakapo' && p.length > 16)
  if (fromProto) return fromProto
  const bearer = parseBearer(req || {})
  if (bearer) return bearer
  if (isProductionRuntime()) return ''
  // Lab/dev only: allow ?token= for harnesses that have not migrated yet
  return String(urlQueryToken || '').trim()
}

export function isWsStaffRole(role) {
  return WS_STAFF_ROLES.has(String(role || '').toLowerCase())
}

export function isWsPublicCatalogRole(role) {
  return String(role || '') === WS_PUBLIC_EVENTS_ROLE
}
