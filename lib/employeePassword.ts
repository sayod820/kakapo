const PEPPER = 'kakapo-emp-v1:'

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Отпечаток пароля для диска кассы. Сам пароль на сервер в GET больше не едет. */
export async function hashEmployeePassword(password: string): Promise<string> {
  const raw = PEPPER + String(password || '')
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    return toHex(buf)
  }
  throw new Error('Нет WebCrypto')
}

/** Только SHA-256 кассы; bcrypt сервера ($2…) на кассе проверить нельзя. */
export function isOfflinePasswordHash(hash: unknown): boolean {
  return /^[0-9a-f]{64}$/i.test(String(hash || '').trim())
}

const VERIFIER_RE = /^pbkdf2-sha256\$(\d{4,7})\$([0-9a-f]{32})\$([0-9a-f]{64})$/

/** Серверный офлайн-отпечаток: PBKDF2-SHA256 с солью сотрудника. */
export function isOfflineVerifier(v: unknown): boolean {
  return VERIFIER_RE.test(String(v || '').trim())
}

function fromHex(hex: string) {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function verifierMatches(pin: string, verifier: string): Promise<boolean> {
  const m = VERIFIER_RE.exec(verifier.trim())
  if (!m) return false
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Нет WebCrypto')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(m[2]), iterations: Number(m[1]) },
    key,
    256,
  )
  return toHex(bits) === m[3]
}

export type LocalAuthRow = {
  id: string
  name: string
  role: string
  roleLabel?: string
  permissions: string[]
  active: boolean
  password: string
  passwordHash: string
  offlineVerifier?: string
}

export async function authRowFromServer(r: {
  id: string
  name?: string
  role?: string
  roleLabel?: string
  permissions?: string[]
  active?: boolean
  password?: string
  passwordHash?: string | null
  offlinePinHash?: string | null
  offlineVerifier?: string | null
}): Promise<LocalAuthRow> {
  const plain = String(r.password || '').trim()
  const passwordHash = isOfflinePasswordHash(r.offlinePinHash)
    ? String(r.offlinePinHash).trim().toLowerCase()
    : isOfflinePasswordHash(r.passwordHash)
      ? String(r.passwordHash).trim().toLowerCase()
      : (plain.length >= 4 ? await hashEmployeePassword(plain) : '')
  return {
    id: String(r.id),
    name: String(r.name || ''),
    role: String(r.role || 'custom'),
    roleLabel: r.roleLabel,
    permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
    active: r.active !== false,
    password: '',
    passwordHash,
    offlineVerifier: isOfflineVerifier(r.offlineVerifier) ? String(r.offlineVerifier).trim() : '',
  }
}

/** Есть ли у строки кэша, чем проверить пароль без интернета. */
export function hasOfflineCredential(row: { passwordHash?: string; offlineVerifier?: string; password?: string } | null | undefined): boolean {
  if (!row) return false
  return isOfflineVerifier(row.offlineVerifier)
    || isOfflinePasswordHash(row.passwordHash)
    || String(row.password || '').length >= 4
}

/**
 * Свежий список с сервера поверх кэша кассы: если сервер не дал проверяемый
 * отпечаток, остаётся тот, что касса запомнила при прошлом входе.
 */
export async function mergeServerAuthRows(
  serverRows: Parameters<typeof authRowFromServer>[0][],
  prev: Array<{ id: string; passwordHash?: string; offlineVerifier?: string }> | null | undefined,
): Promise<LocalAuthRow[]> {
  const prevById = new Map((prev || []).map(p => [String(p.id), p]))
  return Promise.all((serverRows || []).map(async r => {
    const row = await authRowFromServer(r)
    if (!row.passwordHash && !row.offlineVerifier) {
      const old = prevById.get(row.id)
      if (old && isOfflineVerifier(old.offlineVerifier)) row.offlineVerifier = String(old.offlineVerifier)
      if (old && isOfflinePasswordHash(old.passwordHash)) row.passwordHash = String(old.passwordHash)
    }
    return row
  }))
}

/** Серверный отпечаток главнее: он меняется сразу при смене пароля в админке. */
export async function employeePasswordMatches(
  typed: string,
  stored: { password?: string; passwordHash?: string; offlineVerifier?: string },
): Promise<boolean> {
  const pin = String(typed || '').trim()
  if (pin.length < 4) return false
  const verifier = String(stored?.offlineVerifier || '').trim()
  if (isOfflineVerifier(verifier)) return verifierMatches(pin, verifier)
  const hash = String(stored?.passwordHash || '').trim()
  if (isOfflinePasswordHash(hash)) {
    return (await hashEmployeePassword(pin)) === hash.toLowerCase()
  }
  const plain = String(stored?.password || '')
  return plain.length >= 4 && plain === pin
}
