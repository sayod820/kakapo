/**
 * ONLINE-O4E — POST /cards/ensure is card-record provisioning only.
 * Financial client↔card relation must go through O8 link/unlink handlers.
 */

const FINANCIAL_ENSURE_KEYS = new Set([
  'status',
  'debt',
  'bonus',
  'debtLimit',
  'unlink',
  'card',
])

/**
 * @param {Record<string, unknown>} body
 * @param {{ name?: string, phone?: string, id?: string } | undefined} baseClient
 * @param {(row: object) => object} normalizeCardRow
 */
export function buildEnsureNewCardRow(body, baseClient, normalizeCardRow) {
  const num = String(body.num || '').toUpperCase()
  const clientId = body.clientId != null && String(body.clientId).trim()
    ? String(body.clientId).trim()
    : undefined
  return normalizeCardRow({
    num,
    client: body.client || baseClient?.name || '',
    phone: body.phone || baseClient?.phone || '',
    clientId,
    status: 'unlinked',
    level: body.level || baseClient?.level || '',
    bonus: 0,
    debt: 0,
    debtLimit: 0,
    vip: !!(body.vip ?? baseClient?.vip),
    debtEnabled: body.debtEnabled !== undefined ? body.debtEnabled === true : baseClient?.debtEnabled === true,
    loyaltyPeriod: body.loyaltyPeriod || baseClient?.loyaltyPeriod,
    issued: new Date().toISOString().slice(0, 10),
  })
}

/**
 * Metadata-only patch for an existing card row (no financial relation side effects).
 * @param {Record<string, unknown>} body
 * @param {object} card
 */
export function buildEnsureExistingCardPatch(body, card) {
  const patch = { ...body, num: card.num }
  delete patch.unlink
  for (const k of FINANCIAL_ENSURE_KEYS) delete patch[k]

  return { patch, vipChanged: patch.vip !== undefined && !!patch.vip !== !!card.vip, levelChanged: patch.level != null && patch.level !== card.level }
}
