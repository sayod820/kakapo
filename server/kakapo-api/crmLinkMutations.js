/**
 * ONLINE-O4D — atomic client ↔ card financial link/unlink (in-transaction mutations only).
 */
'use strict'

import { CardOwnershipConflict, cardNumKey } from './cardCanonical.js'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function cardHasDebt(card) {
  if (!card) return false
  if (round2(card.debt) > 0.001) return true
  const led = Array.isArray(card.debtLedger) ? card.debtLedger : []
  return led.some(e => round2(e?.remaining) > 0.001)
}

/** O4D: allow unlink when debt is canonical on the linked client (mirror tombstone only). */
export function assertFinancialCardUnlinkAllowed(db, card, opts = {}) {
  if (!card) return
  if (!cardHasDebt(card)) return
  if (opts.allowDebtDestroy === true) return
  const num = cardNumKey(card.num)
  const owner = (db.clients || []).find(c =>
    String(c.card || '').toUpperCase() === num
    || (card.clientId && String(c.id) === String(card.clientId)),
  )
  if (owner && round2(Number(owner.debt) || 0) + 0.001 >= round2(card.debt)) {
    return
  }
  throw new CardOwnershipConflict(
    'DEBT_CARD_UNLINK_FORBIDDEN',
    `Нельзя отвязать карту ${card.num} с долгом ${round2(card.debt)} без явного переноса долга`,
    { cardNum: card.num, debt: round2(card.debt) },
  )
}

/**
 * Unlink card: preserve client canonical debt/bonus; tombstone card mirror.
 * @returns {{ card: object, client: object|null, prevClientId: string|null }}
 */
export function applyFinancialCardUnlink(db, cardNum, helpers, opts = {}) {
  const {
    findCardByNum,
    normalizeCardRow,
  } = helpers

  const num = String(cardNum || '').trim().toUpperCase()
  const card = findCardByNum(num)
  if (!card) {
    const err = new Error('Карта не найдена')
    err.status = 404
    err.code = 'CARD_NOT_FOUND'
    throw err
  }

  assertFinancialCardUnlinkAllowed(db, card, { allowDebtDestroy: opts.allowDebtDestroy === true })

  let client = null
  const prevClientId = card.clientId != null ? String(card.clientId) : null
  if (prevClientId) {
    client = (db.clients || []).find(c => String(c.id) === prevClientId) || null
  }
  if (!client) {
    client = (db.clients || []).find(x => String(x.card || '').trim().toUpperCase() === num) || null
  }

  if (client && String(client.card || '').trim().toUpperCase() === num) {
    client.card = ''
    client.updatedAtIso = new Date().toISOString()
    client.docVersion = (Number(client.docVersion) || 0) + 1
  }

  Object.assign(card, normalizeCardRow({
    num: card.num,
    client: '',
    phone: '',
    status: 'unlinked',
    level: '',
    bonus: 0,
    debt: 0,
    debtLimit: 0,
    vip: false,
    debtEnabled: false,
  }))
  const stamp = new Date().toISOString()
  card.updatedAtIso = stamp
  card.serverAtIso = stamp

  return { card, client, prevClientId }
}

/**
 * Link / relink / replace: client.card → cardNum; mirror debt/bonus from client canonical.
 * @returns {{ client: object, card: object|null, prevCardNum: string|null }}
 */
export function applyFinancialClientCardLink(db, client, cardNum, helpers) {
  const {
    findCardByNum,
    ensureCardRowForClient,
    unlinkNonCanonicalSiblingCards,
    normalizeCardRow,
    assertCardAssignableToClient,
  } = helpers

  if (!client) {
    const err = new Error('Клиент не найден')
    err.status = 404
    throw err
  }

  const num = String(cardNum || '').trim().toUpperCase()
  if (!num) {
    const err = new Error('Укажите номер карты')
    err.status = 400
    err.code = 'CARD_NUM_REQUIRED'
    throw err
  }

  const prevCardNum = client.card ? String(client.card).trim().toUpperCase() : null
  if (prevCardNum && prevCardNum !== num) {
    const prevCard = findCardByNum(prevCardNum)
    if (prevCard && prevCard.status === 'active') {
      Object.assign(prevCard, normalizeCardRow({
        num: prevCard.num,
        client: '',
        phone: '',
        status: 'unlinked',
        level: '',
        bonus: 0,
        debt: 0,
        debtLimit: 0,
        vip: false,
        debtEnabled: false,
      }))
    }
  }
  let card = findCardByNum(num)
  if (card) {
    try {
      assertCardAssignableToClient(db, card, client)
    } catch (e) {
      if (e instanceof CardOwnershipConflict) throw e
      throw e
    }
  }

  const other = (db.clients || []).find(x =>
    x.id !== client.id
    && String(x.card || '').trim().toUpperCase() === num,
  )
  if (other) {
    const err = new Error(`Карта ${num} уже указана у клиента ${other.id}`)
    err.status = 409
    err.code = 'CLIENT_CARD_ALREADY_BOUND'
    err.details = { cardNum: num, ownerClientId: other.id, attemptedClientId: client.id }
    throw err
  }

  client.card = num
  client.docVersion = (Number(client.docVersion) || 0) + 1
  client.updatedAtIso = new Date().toISOString()

  const linked = ensureCardRowForClient(client)
  unlinkNonCanonicalSiblingCards(db, client, num, normalizeCardRow)
  for (const sibling of db.cards || []) {
    if (!sibling || sibling.status !== 'active') continue
    if (String(sibling.clientId || '') !== String(client.id || '')) continue
    if (cardNumKey(sibling.num) === cardNumKey(num)) continue
    Object.assign(sibling, normalizeCardRow({
      num: sibling.num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      vip: false,
      debtEnabled: false,
    }))
  }

  if (linked) {
    linked.bonus = round2(Number(client.bonus) || 0)
    linked.debt = round2(Number(client.debt) || 0)
    linked.debtLimit = round2(Number(client.debtLimit) || 0)
    if (client.blocked) linked.status = 'blocked'
    else if (linked.status === 'blocked') linked.status = 'active'
    const stamp = new Date().toISOString()
    linked.updatedAtIso = stamp
    linked.serverAtIso = stamp
  }

  return { client, card: linked, prevCardNum }
}
