import type { AdminClient, ClientLevel } from './clientCrm'
import { normalizePhone, phonesMatch, vipFromNote, debtFromNote } from './clientCrm'

export type CardStatus = 'active' | 'unlinked' | 'blocked'

export interface AdminCard {
  num: string
  client: string
  phone: string
  clientId?: string
  status: CardStatus
  level: ClientLevel | ''
  bonus: number
  debtLimit: number
  debt: number
  issued?: string
  note?: string
  vip?: boolean
  /** Раздел долга в приложении и админке (не зависит от VIP) */
  debtEnabled?: boolean
  /** Месяц (YYYY-MM), за который действует статус на карте */
  loyaltyPeriod?: string
  /** С какого момента (ISO) начислять кэшбэк после ручной смены статуса */
  bonusEligibleFrom?: string
}

export function cardHasDebtSection(card: Pick<AdminCard, 'debtEnabled' | 'debt' | 'debtLimit'>): boolean {
  if (card.debtEnabled !== undefined) return !!card.debtEnabled
  return (Number(card.debt) || 0) > 0 || (Number(card.debtLimit) || 0) > 0
}

/** Явное значение переключателя «Раздел долга» — карта или клиент, плюс маркер в note */
export function resolveDebtEnabled(
  card?: Pick<AdminCard, 'debtEnabled' | 'note'>,
  client?: Pick<AdminClient, 'debtEnabled' | 'note'>,
): boolean {
  if (card?.debtEnabled === true || client?.debtEnabled === true) return true
  if (debtFromNote(card?.note) || debtFromNote(client?.note)) return true
  if (card?.debtEnabled === false && client?.debtEnabled !== true && !debtFromNote(client?.note)) return false
  if (client?.debtEnabled === false && card?.debtEnabled !== true && !debtFromNote(card?.note)) return false
  return false
}

/** Цифры номера карты (КАКАПО-0099 и KAKAPO-0099 → 0099) */
export function cardDigits(num: string | undefined): string {
  return String(num || '').replace(/\D/g, '')
}

export function cardNumsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const da = cardDigits(a)
  const db = cardDigits(b)
  return da.length > 0 && da === db
}

/** Канонический номер для API — сохраняем префикс карты (KAKAPO или КАКАПО) */
export function canonicalCardNum(num: string | undefined): string {
  const raw = String(num || '').trim().toUpperCase()
  const digits = cardDigits(num)
  if (!digits) return raw
  const padded = digits.padStart(4, '0')
  if (raw.includes('KAKAPO')) return `KAKAPO-${padded}`
  if (raw.includes('КАКАПО')) return `КАКАПО-${padded}`
  return `KAKAPO-${padded}`
}

export const CARD_STATUS_LABELS: Record<CardStatus, { l: string; c: string }> = {
  active: { l: 'Активна', c: '#1FD760' },
  unlinked: { l: 'Не привязана', c: '#FFB800' },
  blocked: { l: 'Заблок.', c: '#FF4545' },
}

export const DEFAULT_ADMIN_CARDS: AdminCard[] = [
  { num: 'КАКАПО-0001', client: 'Диловар Рахимов', phone: '+992 93 456 78 90', status: 'active', level: 'platinum', bonus: 4850, debtLimit: 3000, debt: 1200, issued: '2022-01-01', vip: true, debtEnabled: true },
  { num: 'КАКАПО-0042', client: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', status: 'active', level: 'gold', bonus: 1240, debtLimit: 1000, debt: 0, issued: '2023-03-15' },
  { num: 'КАКАПО-0118', client: 'Бахром Каримов', phone: '+992 88 789 01 23', status: 'active', level: 'silver', bonus: 560, debtLimit: 0, debt: 0, issued: '2023-06-10' },
  { num: 'КАКАПО-0099', client: '', phone: '', status: 'unlinked', level: '', bonus: 0, debtLimit: 0, debt: 0, issued: '2024-05-01' },
  { num: 'КАКАПО-0234', client: 'Зафар Мирзоев', phone: '+992 91 654 32 10', status: 'active', level: 'gold', bonus: 2100, debtLimit: 2000, debt: 4500, issued: '2023-02-05', debtEnabled: true },
  { num: 'КАКАПО-0055', client: 'Рустам Давлатов', phone: '+992 90 445 23 11', status: 'blocked', level: 'gold', bonus: 890, debtLimit: 0, debt: 0, issued: '2022-11-10' },
  { num: 'KAKAPO-0236', client: 'Сайёд Гафуров', phone: '+992 50 190 31 41', status: 'active', level: 'silver', bonus: 100, debtLimit: 0, debt: 0, issued: '2025-06-01', clientId: 'U-07' },
]

export function normalizeCard(raw: Partial<AdminCard> & { num: string }): AdminCard {
  const status = (['active', 'unlinked', 'blocked'] as CardStatus[]).includes(raw.status as CardStatus)
    ? (raw.status as CardStatus)
    : 'unlinked'
  const level = (['basic', 'bronze', 'silver', 'gold', 'platinum'] as ClientLevel[]).includes(raw.level as ClientLevel)
    ? (raw.level as ClientLevel)
    : ''
  return {
    num: String(raw.num || '').toUpperCase(),
    client: raw.client || '',
    phone: raw.phone || '',
    clientId: raw.clientId,
    status,
    level,
    bonus: Number(raw.bonus) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    debt: Number(raw.debt) || 0,
    issued: raw.issued,
    note: raw.note || '',
    vip: !!raw.vip || vipFromNote(raw.note),
    debtEnabled: raw.debtEnabled === true
      || debtFromNote(raw.note)
      || (raw.debtEnabled === undefined && !debtFromNote(raw.note) && ((Number(raw.debt) || 0) > 0 || (Number(raw.debtLimit) || 0) > 0)),
    loyaltyPeriod: raw.loyaltyPeriod || undefined,
    bonusEligibleFrom: raw.bonusEligibleFrom || undefined,
  }
}

export function nextCardNumber(cards: AdminCard[]): string {
  const nums = cards.map(c => parseInt(c.num.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `КАКАПО-${String(n).padStart(4, '0')}`
}

export function previewCardRange(cards: AdminCard[], count: number): { from: string; to: string } {
  const nums = cards.map(c => parseInt(c.num.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const start = (nums.length ? Math.max(...nums) : 0) + 1
  const end = start + Math.max(1, count) - 1
  return {
    from: `КАКАПО-${String(start).padStart(4, '0')}`,
    to: `КАКАПО-${String(end).padStart(4, '0')}`,
  }
}

export type CardLoyaltyForm = {
  clientId: string
  phone: string
  level: ClientLevel
  debtLimit: number
  bonus: number
  debt: number
  vip: boolean
  debtEnabled: boolean
}

export function emptyCardLoyaltyForm(): CardLoyaltyForm {
  return { clientId: '', phone: '', level: 'basic', debtLimit: 0, bonus: 0, debt: 0, vip: false, debtEnabled: false }
}

export function cardLoyaltyFromCard(card: AdminCard, client?: AdminClient): CardLoyaltyForm {
  return {
    clientId: client?.id || card.clientId || '',
    phone: card.phone || client?.phone || '',
    level: (card.level || client?.level || 'basic') as ClientLevel,
    debtLimit: card.debtLimit ?? client?.debtLimit ?? 0,
    bonus: card.bonus ?? client?.bonus ?? 0,
    debt: card.debt ?? client?.debt ?? 0,
    vip: !!(card.vip ?? client?.vip),
    debtEnabled: resolveDebtEnabled(card, client),
  }
}

/** @deprecated use emptyCardLoyaltyForm */
export function emptyLinkForm(): CardLoyaltyForm {
  return emptyCardLoyaltyForm()
}

export function findClientForCard(clients: AdminClient[], card: AdminCard): AdminClient | undefined {
  if (card.clientId) return clients.find(c => c.id === card.clientId)
  if (card.num) {
    const byCard = clients.find(c => cardNumsMatch(c.card, card.num))
    if (byCard) return byCard
  }
  if (card.phone) return clients.find(c => phonesMatch(c.phone, card.phone))
  return undefined
}

export function enrichCardWithClient(card: AdminCard, clients: AdminClient[]): AdminCard {
  const client = findClientForCard(clients, card)
  if (!client) return normalizeCard(card)
  const status: CardStatus = client.blocked
    ? 'blocked'
    : card.status === 'unlinked' && client.card === card.num
      ? 'active'
      : card.status
  return normalizeCard({
    ...card,
    client: client.name || card.client,
    phone: client.phone || card.phone,
    clientId: client.id,
    level: client.level || card.level,
    bonus: Math.max(card.bonus, client.bonus),
    debtLimit: client.debtLimit ?? card.debtLimit,
    debt: Math.max(card.debt, client.debt),
    vip: !!(card.vip || client.vip),
    debtEnabled: resolveDebtEnabled(card, client),
    status,
  })
}

export function mergeCardsWithClients(cards: AdminCard[], clients: AdminClient[]): AdminCard[] {
  const byNum = new Map<string, AdminCard>()
  for (const c of cards) byNum.set(c.num, normalizeCard(c))

  const findKey = (cardNum: string) => {
    if (byNum.has(cardNum)) return cardNum
    for (const k of byNum.keys()) {
      if (cardNumsMatch(k, cardNum)) return k
    }
    return undefined
  }

  for (const client of clients) {
    if (!client.card) continue
    const key = findKey(client.card) || client.card
    const prev = byNum.get(key)
    if (prev) {
      byNum.set(key, enrichCardWithClient(prev, [client]))
    } else {
      byNum.set(key, normalizeCard({
        num: client.card,
        client: client.name,
        phone: client.phone,
        clientId: client.id,
        status: client.blocked ? 'blocked' : 'active',
        level: client.level,
        bonus: client.bonus,
        debtLimit: client.debtLimit,
        debt: client.debt,
        vip: !!client.vip,
        debtEnabled: client.debtEnabled,
      }))
    }
  }

  return [...byNum.values()].sort((a, b) => {
    const na = parseInt(a.num.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(b.num.replace(/\D/g, ''), 10) || 0
    return na - nb
  })
}

export function cardMatchesSearch(card: AdminCard, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const qDigits = q.replace(/\D/g, '')
  const hay = `${card.num} ${card.client} ${card.phone}`.toLowerCase()
  if (hay.includes(q)) return true
  if (qDigits.length >= 3 && normalizePhone(card.phone).includes(qDigits.slice(-9))) return true
  return card.num.replace(/\D/g, '').includes(qDigits)
}
