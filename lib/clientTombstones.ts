'use client'

const TOMBSTONES_KEY = 'kakapo-deleted-phones'

function loadSet(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((p: unknown) => String(p)).filter(Boolean))
  } catch {
    return new Set()
  }
}

function saveSet(set: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify([...set]))
  } catch { /* quota */ }
}

function phoneKey(phone?: string | null): string {
  return (phone || '').replace(/\D/g, '').slice(-9)
}

export function isPhoneDeleted(phone?: string | null): boolean {
  const key = phoneKey(phone)
  if (!key) return false
  return loadSet().has(key)
}

export function markPhoneDeleted(phone?: string | null): void {
  const key = phoneKey(phone)
  if (!key) return
  const set = loadSet()
  set.add(key)
  saveSet(set)
}

export function unmarkPhoneDeleted(phone?: string | null): void {
  const key = phoneKey(phone)
  if (!key) return
  const set = loadSet()
  set.delete(key)
  saveSet(set)
}

/** ID из заказов вида U-501903141 — не существует на сервере */
export function isSyntheticOrderClientId(id?: string | null): boolean {
  const t = (id || '').trim()
  if (!t.startsWith('U-')) return false
  const tail = t.slice(2)
  return tail.length >= 9 && /^\d+$/.test(tail)
}
