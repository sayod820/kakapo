/**
 * Keep exactly one canonical active card for a client.
 *
 * Ownership guards (post Holov/Sayod collision):
 * - Never silently reassign a card owned by another clientId/phone.
 * - Never unlink/zero a debt-bearing card that belongs to a different person.
 * - Same-person card reissue: transfer open debt/ledger onto keep card, then archive sibling.
 */

export class CardOwnershipConflict extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CardOwnershipConflict'
    this.code = code
    this.status = 409
    this.details = details
  }
}

export function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '')
}

export function cardNumKey(num) {
  return String(num || '').trim().toUpperCase()
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function samePerson(card, client) {
  if (!card || !client) return false
  const cid = client.id != null ? String(client.id) : ''
  if (cid && String(card.clientId || '') === cid) return true
  const phone = phoneDigits(client.phone)
  const cardPhone = phoneDigits(card.phone)
  if (phone && cardPhone && phone === cardPhone && (!card.clientId || String(card.clientId) === cid)) {
    return true
  }
  return false
}

function cardHasDebt(card) {
  if (!card) return false
  if (round2(card.debt) > 0.001) return true
  const led = Array.isArray(card.debtLedger) ? card.debtLedger : []
  return led.some(e => round2(e?.remaining) > 0.001)
}

function otherOwnerOfCard(card, client) {
  if (!card || !client) return null
  const cid = client.id != null ? String(client.id) : ''
  const ownerId = String(card.clientId || '').trim()
  if (ownerId && cid && ownerId !== cid) return { kind: 'clientId', ownerId }
  const phone = phoneDigits(client.phone)
  const cardPhone = phoneDigits(card.phone)
  if (cardPhone && phone && cardPhone !== phone && ownerId && ownerId !== cid) {
    return { kind: 'phone+clientId', ownerId, cardPhone }
  }
  // Card has a different phone and no matching clientId claim from this client
  if (cardPhone && phone && cardPhone !== phone && ownerId && ownerId !== cid) {
    return { kind: 'phone', cardPhone }
  }
  if (cardPhone && phone && cardPhone !== phone && !ownerId) {
    // orphan card with another phone — treat as foreign
    return { kind: 'phone', cardPhone }
  }
  if (ownerId && cid && ownerId !== cid) return { kind: 'clientId', ownerId }
  return null
}

/**
 * Prove a card may be bound to client. Throws CardOwnershipConflict otherwise.
 * @param {{ allowExplicitTransfer?: boolean }} [opts]
 */
export function assertCardAssignableToClient(db, card, client, opts = {}) {
  if (!card || !client) return { ok: true }
  if (card.status === 'unlinked' && !card.clientId && !phoneDigits(card.phone) && !cardHasDebt(card)) {
    return { ok: true, reason: 'empty_unlinked' }
  }
  const foreign = otherOwnerOfCard(card, client)
  if (!foreign) return { ok: true }

  // Same person if phones match AND (no clientId or clientId matches)
  if (samePerson(card, client) && String(card.clientId || '') === String(client.id || '')) {
    return { ok: true, reason: 'same_person' }
  }

  const phone = phoneDigits(client.phone)
  const cardPhone = phoneDigits(card.phone)
  const ownerId = String(card.clientId || '')
  const cid = String(client.id || '')

  // Different clientId — hard reject (unless explicit transfer, not implemented as silent)
  if (ownerId && cid && ownerId !== cid) {
    if (opts.allowExplicitTransfer === true) {
      return { ok: true, reason: 'explicit_transfer' }
    }
    throw new CardOwnershipConflict(
      'CARD_OWNED_BY_OTHER_CLIENT',
      `Карта ${card.num} уже принадлежит клиенту ${ownerId}, нельзя привязать к ${cid}`,
      { cardNum: card.num, ownerClientId: ownerId, attemptedClientId: cid, cardDebt: round2(card.debt) },
    )
  }

  // Different phone on an active/debt card
  if (cardPhone && phone && cardPhone !== phone) {
    throw new CardOwnershipConflict(
      'CARD_PHONE_MISMATCH',
      `Карта ${card.num} привязана к другому телефону`,
      { cardNum: card.num, cardPhone, attemptedPhone: phone },
    )
  }

  if (cardHasDebt(card) && ownerId && cid && ownerId !== cid) {
    throw new CardOwnershipConflict(
      'DEBT_CARD_REASSIGN_FORBIDDEN',
      `Карта ${card.num} с долгом ${round2(card.debt)} нельзя передать другому клиенту`,
      { cardNum: card.num, debt: round2(card.debt), ownerClientId: ownerId },
    )
  }

  return { ok: true }
}

/**
 * Transfer open debt + ledger from sibling onto keep card (same person reissue).
 */
export function transferCardDebtToCanonical(fromCard, toCard) {
  if (!fromCard || !toCard) return { transferred: 0 }
  const fromDebt = round2(fromCard.debt)
  const fromLed = Array.isArray(fromCard.debtLedger) ? fromCard.debtLedger.map(e => ({ ...e })) : []
  const toLed = Array.isArray(toCard.debtLedger) ? toCard.debtLedger.map(e => ({ ...e })) : []
  const ids = new Set(toLed.map(e => String(e.id || '')))
  for (const e of fromLed) {
    const id = String(e.id || '')
    if (id && ids.has(id)) continue
    toLed.push(e)
    if (id) ids.add(id)
  }
  toCard.debtLedger = toLed
  toCard.debt = round2((Number(toCard.debt) || 0) + fromDebt)
  if (toCard.debt > 0.001) toCard.debtEnabled = true
  // Clear money from sibling without destroying identity history of amounts on canonical
  fromCard.debt = 0
  fromCard.debtLedger = []
  fromCard.debtEnabled = false
  fromCard.debtOverdueStrikes = 0
  fromCard.debtCreditBlocked = false
  return { transferred: fromDebt }
}

/**
 * Unlink non-canonical siblings for the SAME person only.
 * Never matches a different clientId.
 * Never zeros debt of a foreign customer.
 * Same-person siblings with debt: transfer onto keep card, then archive.
 *
 * @returns {{ unlinked: string[], skipped: object[], transferred: object[] }}
 */
export function unlinkNonCanonicalSiblingCards(db, client, keepNum, normalizeCardRow) {
  if (!db || !client || typeof normalizeCardRow !== 'function') {
    return { unlinked: [], skipped: [], transferred: [] }
  }
  const keep = cardNumKey(keepNum || client.card)
  if (!keep) return { unlinked: [], skipped: [], transferred: [] }

  const clientId = client.id != null ? String(client.id) : ''
  const phone = phoneDigits(client.phone)
  const unlinked = []
  const skipped = []
  const transferred = []

  const keepCard = (db.cards || []).find(c => cardNumKey(c.num) === keep) || null

  // Refuse to treat a foreign-owned card as canonical — otherwise same-clientId
  // siblings (the real cards) would be archived/wiped while the stolen keep stays.
  if (keepCard) {
    try {
      assertCardAssignableToClient(db, keepCard, client)
    } catch (e) {
      if (e instanceof CardOwnershipConflict) {
        skipped.push({
          num: keep,
          reason: e.code || 'KEEP_CARD_FOREIGN',
          ownerClientId: keepCard.clientId,
          debt: round2(keepCard.debt),
        })
        return { unlinked, skipped, transferred }
      }
      throw e
    }
  }

  for (const card of db.cards || []) {
    if (!card || card.status === 'unlinked') continue
    const num = cardNumKey(card.num)
    if (!num || num === keep) continue

    const sameClient = clientId && String(card.clientId || '') === clientId
    // Phone-only match is NOT enough if card has a different clientId
    const phoneMatch = phone && phoneDigits(card.phone) === phone
    const foreignId = String(card.clientId || '')
    if (foreignId && clientId && foreignId !== clientId) {
      skipped.push({
        num,
        reason: 'FOREIGN_CLIENT_ID',
        ownerClientId: foreignId,
        debt: round2(card.debt),
      })
      continue
    }

    if (!sameClient && !phoneMatch) continue

    // Phone match without clientId on card — only unlink if no debt OR same person
    if (!sameClient && phoneMatch) {
      if (cardHasDebt(card)) {
        skipped.push({ num, reason: 'DEBT_CARD_PHONE_ONLY', debt: round2(card.debt) })
        continue
      }
    }

    if (cardHasDebt(card)) {
      if (!keepCard) {
        skipped.push({ num, reason: 'NO_KEEP_CARD_FOR_DEBT_TRANSFER', debt: round2(card.debt) })
        continue
      }
      const t = transferCardDebtToCanonical(card, keepCard)
      transferred.push({ from: num, to: keep, amount: t.transferred })
    }

    Object.assign(card, normalizeCardRow({
      num: card.num,
      client: '',
      phone: '',
      clientId: undefined,
      status: 'unlinked',
      level: '',
      bonus: 0,
      // debt already cleared by transfer or was zero
      debt: Number(card.debt) || 0,
      debtLimit: 0,
      vip: false,
      debtEnabled: false,
      debtLedger: Array.isArray(card.debtLedger) ? card.debtLedger : [],
      debtOverdueStrikes: 0,
      debtCreditBlocked: false,
    }))
    // Ensure archived sibling carries no live debt after transfer
    card.debt = 0
    card.debtLedger = []
    card.debtEnabled = false
    unlinked.push(num)
  }

  return { unlinked, skipped, transferred }
}

/**
 * Prefer client.card; never pick unlinked; never return another client's card by phone alone
 * when clientId is known and mismatches.
 */
export function findCanonicalCard(db, client) {
  if (!db || !client) return null
  const cards = db.cards || []
  const want = cardNumKey(client.card)
  if (want) {
    const byNum = cards.find(c => cardNumKey(c.num) === want && c.status !== 'unlinked')
    if (byNum) {
      try {
        assertCardAssignableToClient(db, byNum, client)
        return byNum
      } catch {
        // fall through — do not return a foreign card
      }
    }
  }
  const clientId = client.id != null ? String(client.id) : ''
  if (clientId) {
    const byId = cards.find(c => String(c.clientId || '') === clientId && c.status !== 'unlinked')
    if (byId) return byId
  }
  const phone = phoneDigits(client.phone)
  if (phone) {
    const byPhone = cards.find(c => phoneDigits(c.phone) === phone && c.status !== 'unlinked')
    if (byPhone) {
      const ownerId = String(byPhone.clientId || '')
      if (ownerId && clientId && ownerId !== clientId) return null
      return byPhone
    }
  }
  return null
}

/**
 * Safe bind: set card identity from client only if assignable.
 */
export function bindCardToClient(card, client) {
  if (!card || !client) return
  assertCardAssignableToClient(null, card, client)
  if (!isPlaceholderName(client.name)) card.client = String(client.name).trim()
  if (client.phone) card.phone = client.phone
  if (client.id) card.clientId = client.id
}

function isPlaceholderName(name) {
  const t = String(name || '').trim()
  return !t || t === 'Клиент'
}

export function assertDebtCardUnlinkAllowed(card, opts = {}) {
  if (!card) return
  if (!cardHasDebt(card)) return
  if (opts.allowDebtDestroy === true) return
  throw new CardOwnershipConflict(
    'DEBT_CARD_UNLINK_FORBIDDEN',
    `Нельзя отвязать карту ${card.num} с долгом ${round2(card.debt)} без явного переноса долга`,
    { cardNum: card.num, debt: round2(card.debt) },
  )
}
