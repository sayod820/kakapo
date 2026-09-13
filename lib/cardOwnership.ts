/**
 * Desktop-side mirrors of server/kakapo-api/cardCanonical.js ownership guards.
 * Prevents offline/UI paths from stealing another client's card or zeroing debt.
 */

import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import { phonesMatch } from './clientCrm'

export class CardOwnershipConflict extends Error {
  code: string
  details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CardOwnershipConflict'
    this.code = code
    this.details = details
  }
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function cardHasDebt(card: AdminCard | undefined | null): boolean {
  if (!card) return false
  if (round2(Number(card.debt) || 0) > 0.001) return true
  const led = Array.isArray(card.debtLedger) ? card.debtLedger : []
  return led.some(e => round2(Number((e as { remaining?: number })?.remaining) || 0) > 0.001)
}

/** Prove card may be bound to client. Throws CardOwnershipConflict otherwise. */
export function assertCardAssignableToClient(card: AdminCard | undefined | null, client: AdminClient): void {
  if (!card || !client) return
  const ownerId = String(card.clientId || '').trim()
  const cid = String(client.id || '').trim()
  if (ownerId && cid && ownerId !== cid) {
    throw new CardOwnershipConflict(
      'CARD_OWNED_BY_OTHER_CLIENT',
      `Карта ${card.num} уже принадлежит клиенту ${ownerId}, нельзя привязать к ${cid}`,
      { cardNum: card.num, ownerClientId: ownerId, attemptedClientId: cid, cardDebt: round2(Number(card.debt) || 0) },
    )
  }
  if (card.phone && client.phone && !phonesMatch(card.phone, client.phone) && ownerId && ownerId !== cid) {
    throw new CardOwnershipConflict(
      'CARD_PHONE_MISMATCH',
      `Карта ${card.num} привязана к другому телефону`,
      { cardNum: card.num },
    )
  }
  if (card.phone && client.phone && !phonesMatch(card.phone, client.phone) && !ownerId && cardHasDebt(card)) {
    throw new CardOwnershipConflict(
      'CARD_PHONE_MISMATCH',
      `Карта ${card.num} привязана к другому телефону`,
      { cardNum: card.num },
    )
  }
}

export function assertDebtCardUnlinkAllowed(card: AdminCard | undefined | null, opts?: { allowDebtDestroy?: boolean }): void {
  if (!card) return
  if (!cardHasDebt(card)) return
  if (opts?.allowDebtDestroy === true) return
  throw new CardOwnershipConflict(
    'DEBT_CARD_UNLINK_FORBIDDEN',
    `Нельзя отвязать карту ${card.num} с долгом ${round2(Number(card.debt) || 0)} без явного переноса долга`,
    { cardNum: card.num, debt: round2(Number(card.debt) || 0) },
  )
}
