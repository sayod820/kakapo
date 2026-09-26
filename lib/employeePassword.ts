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

export type LocalAuthRow = {
  id: string
  name: string
  role: string
  roleLabel?: string
  permissions: string[]
  active: boolean
  password: string
  passwordHash: string
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
  }
}

/**
 * Свежий список с сервера поверх кэша кассы: если сервер не дал проверяемый
 * отпечаток, остаётся тот, что касса запомнила при прошлом входе.
 */
export async function mergeServerAuthRows(
  serverRows: Parameters<typeof authRowFromServer>[0][],
  prev: Array<{ id: string; passwordHash?: string }> | null | undefined,
): Promise<LocalAuthRow[]> {
  const prevById = new Map((prev || []).map(p => [String(p.id), p]))
  return Promise.all((serverRows || []).map(async r => {
    const row = await authRowFromServer(r)
    if (!row.passwordHash) {
      const old = prevById.get(row.id)
      if (old && isOfflinePasswordHash(old.passwordHash)) row.passwordHash = String(old.passwordHash)
    }
    return row
  }))
}

export async function employeePasswordMatches(
  typed: string,
  stored: { password?: string; passwordHash?: string },
): Promise<boolean> {
  const pin = String(typed || '').trim()
  if (pin.length < 4) return false
  const hash = String(stored?.passwordHash || '').trim()
  if (isOfflinePasswordHash(hash)) {
    return (await hashEmployeePassword(pin)) === hash.toLowerCase()
  }
  const plain = String(stored?.password || '')
  return plain.length >= 4 && plain === pin
}
