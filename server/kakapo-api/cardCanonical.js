'use strict'

/**
 * Keep exactly one canonical active card for a client.
 * Sibling cards stay in history as status=unlinked with cleared identity/debt.
 */

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function cardNumKey(num) {
  return String(num || '').trim().toUpperCase()
}

/**
 * @param {object} db
 * @param {{ id?: string, phone?: string, card?: string }} client
 * @param {string} keepNum canonical card number to keep active
 * @param {(raw: object) => object} normalizeCardRow
 * @returns {{ unlinked: string[] }}
 */
export function unlinkNonCanonicalSiblingCards(db, client, keepNum, normalizeCardRow) {
  if (!db || !client || typeof normalizeCardRow !== 'function') return { unlinked: [] }
  const keep = cardNumKey(keepNum || client.card)
  if (!keep) return { unlinked: [] }

  const clientId = client.id != null ? String(client.id) : ''
  const phone = phoneDigits(client.phone)
  const unlinked = []

  for (const card of db.cards || []) {
    if (!card || card.status === 'unlinked') continue
    const num = cardNumKey(card.num)
    if (num === keep) continue

    const sameClient = clientId && String(card.clientId || '') === clientId
    const samePhone = phone && phoneDigits(card.phone) === phone
    if (!sameClient && !samePhone) continue

    Object.assign(card, normalizeCardRow({
      num: card.num,
      client: '',
      phone: '',
      clientId: undefined,
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      vip: false,
      debtEnabled: false,
      debtLedger: [],
      debtOverdueStrikes: 0,
      debtCreditBlocked: false,
    }))
    unlinked.push(num)
  }

  return { unlinked }
}

/**
 * Prefer client.card; never pick unlinked; avoid phone-first orphan matches.
 */
export function findCanonicalCard(db, client) {
  if (!db || !client) return null
  const cards = db.cards || []
  const want = cardNumKey(client.card)
  if (want) {
    const byNum = cards.find(c => cardNumKey(c.num) === want && c.status !== 'unlinked')
    if (byNum) return byNum
  }
  const clientId = client.id != null ? String(client.id) : ''
  if (clientId) {
    const byId = cards.find(c => String(c.clientId || '') === clientId && c.status !== 'unlinked')
    if (byId) return byId
  }
  const phone = phoneDigits(client.phone)
  if (phone) {
    return cards.find(c => phoneDigits(c.phone) === phone && c.status !== 'unlinked') || null
  }
  return null
}
