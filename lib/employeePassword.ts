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

export async function authRowFromServer(r: {
  id: string
  name?: string
  role?: string
  roleLabel?: string
  permissions?: string[]
  active?: boolean
  password?: string
  passwordHash?: string
}): Promise<{
  id: string
  name: string
  role: string
  roleLabel?: string
  permissions: string[]
  active: boolean
  password: string
  passwordHash: string
}> {
  const hashIn = String(r.passwordHash || '').trim()
  const plain = String(r.password || '').trim()
  const passwordHash = hashIn.length >= 32
    ? hashIn
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

export async function employeePasswordMatches(
  typed: string,
  stored: { password?: string; passwordHash?: string },
): Promise<boolean> {
  const pin = String(typed || '').trim()
  if (pin.length < 4) return false
  const hash = String(stored?.passwordHash || '').trim()
  if (hash.length >= 32) {
    return (await hashEmployeePassword(pin)) === hash
  }
  const plain = String(stored?.password || '')
  return plain.length >= 4 && plain === pin
}
