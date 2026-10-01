/**
 * Index-backed equivalents of hot linear scans in Trade screens.
 * Every function returns exactly what the scan it replaces returns (same element, same order);
 * indexes are cached per array reference, so a new store array rebuilds them.
 */
import { cardDigits } from './cardCrm'
import { normalizePhone } from './clientCrm'

let ruCollator: Intl.Collator | null = null
let defaultCollator: Intl.Collator | null = null

/** Same result as `a.localeCompare(b, 'ru')`. */
export function compareRu(a: string, b: string): number {
  if (!ruCollator) ruCollator = new Intl.Collator('ru')
  return ruCollator.compare(a, b)
}

/** Same result as `a.localeCompare(b)`. */
export function compareLocale(a: string, b: string): number {
  if (!defaultCollator) defaultCollator = new Intl.Collator()
  return defaultCollator.compare(a, b)
}

const ISO_MS_MAX = 200_000
const isoMsCache = new Map<string, number>()

/** Same result as `new Date(iso).getTime()` for a string argument. */
export function isoMs(iso: string): number {
  let t = isoMsCache.get(iso)
  if (t === undefined) {
    t = new Date(iso).getTime()
    if (isoMsCache.size >= ISO_MS_MAX) isoMsCache.clear()
    isoMsCache.set(iso, t)
  }
  return t
}

type CardLike = { num?: string; status?: string; clientId?: unknown }

type CardIndex = {
  len: number
  byNum: Map<unknown, number>
  byDigits: Map<string, number>
  byClientId: Map<unknown, number>
  anyByNum: Map<unknown, number>
  anyByDigits: Map<string, number>
}

const cardIndexes = new WeakMap<readonly CardLike[], CardIndex>()

function cardIndex(cards: readonly CardLike[]): CardIndex {
  const cached = cardIndexes.get(cards)
  if (cached && cached.len === cards.length) return cached
  const idx: CardIndex = {
    len: cards.length,
    byNum: new Map(),
    byDigits: new Map(),
    byClientId: new Map(),
    anyByNum: new Map(),
    anyByDigits: new Map(),
  }
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    if (c.num) {
      if (!idx.anyByNum.has(c.num)) idx.anyByNum.set(c.num, i)
      const d = cardDigits(c.num)
      if (d && !idx.anyByDigits.has(d)) idx.anyByDigits.set(d, i)
    }
    if (c.status === 'unlinked') continue
    if (!idx.byClientId.has(c.clientId)) idx.byClientId.set(c.clientId, i)
    if (!c.num) continue
    if (!idx.byNum.has(c.num)) idx.byNum.set(c.num, i)
    const d = cardDigits(c.num)
    if (d && !idx.byDigits.has(d)) idx.byDigits.set(d, i)
  }
  cardIndexes.set(cards, idx)
  return idx
}

function firstByNum(byNum: Map<unknown, number>, byDigits: Map<string, number>, num: string): number | undefined {
  const a = byNum.get(num)
  const d = cardDigits(num)
  const b = d ? byDigits.get(d) : undefined
  return a === undefined ? b : b === undefined ? a : Math.min(a, b)
}

/** Same result as `cards.find(c => cardNumsMatch(c.num, num) && c.status !== 'unlinked')`. */
export function findLinkedCardByNum<T extends CardLike>(cards: readonly T[], num: string | undefined): T | undefined {
  if (!num) return undefined
  const idx = cardIndex(cards)
  const i = firstByNum(idx.byNum, idx.byDigits, num)
  return i === undefined ? undefined : cards[i]
}

/** Same result as `cards.find(c => cardNumsMatch(c.num, num))` (any status). */
export function findCardByNum<T extends CardLike>(cards: readonly T[], num: string | undefined): T | undefined {
  if (!num) return undefined
  const idx = cardIndex(cards)
  const i = firstByNum(idx.anyByNum, idx.anyByDigits, num)
  return i === undefined ? undefined : cards[i]
}

/** Same result as `cards.find(c => c.clientId === clientId && c.status !== 'unlinked')`. */
export function findLinkedCardByClientId<T extends CardLike>(cards: readonly T[], clientId: unknown): T | undefined {
  if (typeof clientId === 'number' && Number.isNaN(clientId)) return undefined
  const i = cardIndex(cards).byClientId.get(clientId)
  return i === undefined ? undefined : cards[i]
}

type SaleLike = { clientId?: unknown; clientPhone?: string }

type SalesIndex = {
  len: number
  byClientId: Map<unknown, number[]>
  byPhone: Map<string, number[]>
}

const salesIndexes = new WeakMap<readonly SaleLike[], SalesIndex>()

function salesIndex(sales: readonly SaleLike[]): SalesIndex {
  const cached = salesIndexes.get(sales)
  if (cached && cached.len === sales.length) return cached
  const idx: SalesIndex = { len: sales.length, byClientId: new Map(), byPhone: new Map() }
  for (let i = 0; i < sales.length; i++) {
    const s = sales[i]
    if (s.clientId) {
      const list = idx.byClientId.get(s.clientId)
      if (list) list.push(i)
      else idx.byClientId.set(s.clientId, [i])
    }
    if (s.clientPhone) {
      const p = normalizePhone(s.clientPhone)
      if (p) {
        const list = idx.byPhone.get(p)
        if (list) list.push(i)
        else idx.byPhone.set(p, [i])
      }
    }
  }
  salesIndexes.set(sales, idx)
  return idx
}

/**
 * Same result as
 * `sales.filter(s => (s.clientId && s.clientId === client.id) || (s.clientPhone && phonesMatch(s.clientPhone, client.phone)))`
 * with phonesMatch from clientCrm.
 */
export function salesForClient<T extends SaleLike>(
  sales: readonly T[],
  client: { id?: unknown; phone?: string },
): T[] {
  const idx = salesIndex(sales)
  const byId = client.id ? idx.byClientId.get(client.id) : undefined
  const phone = normalizePhone(client.phone || '')
  const byPhone = phone ? idx.byPhone.get(phone) : undefined
  if (!byId && !byPhone) return []
  if (!byPhone) return byId!.map(i => sales[i])
  if (!byId) return byPhone.map(i => sales[i])
  const out: T[] = []
  let a = 0
  let b = 0
  while (a < byId.length || b < byPhone.length) {
    const ia = a < byId.length ? byId[a] : Infinity
    const ib = b < byPhone.length ? byPhone[b] : Infinity
    if (ia === ib) { out.push(sales[ia]); a++; b++ } else if (ia < ib) { out.push(sales[ia]); a++ } else { out.push(sales[ib]); b++ }
  }
  return out
}
