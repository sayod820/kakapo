/** Срок восстановления после самоудаления / отправки в recovery админом */
export const RECOVERY_RETENTION_DAYS = 30

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export function defaultAccountGeneration(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

export function recoveryExpiresAtIso(deletedAt = new Date()) {
  const base = deletedAt instanceof Date ? deletedAt : new Date(deletedAt || Date.now())
  const exp = new Date(base.getTime())
  exp.setDate(exp.getDate() + RECOVERY_RETENTION_DAYS)
  return exp.toISOString().slice(0, 10)
}

export function isRecoveryExpired(client) {
  if (!client || client.accountStatus !== 'recovery') return false
  const exp = client.recoveryExpiresAt || recoveryExpiresAtIso(client.deletedAt)
  if (!exp) return false
  const today = new Date().toISOString().slice(0, 10)
  return exp < today
}

/** Максимальный generation по телефону (клиенты + заказы) */
export function maxAccountGenerationForPhone(db, phone) {
  const key = normalizePhoneDigits(phone)
  if (!key) return 1
  let max = 1
  for (const c of db.clients || []) {
    if (normalizePhoneDigits(c.phone) === key) {
      max = Math.max(max, defaultAccountGeneration(c.accountGeneration))
    }
  }
  for (const o of db.orders || []) {
    if (normalizePhoneDigits(o.client?.phone) === key) {
      max = Math.max(max, defaultAccountGeneration(o.accountGeneration))
    }
  }
  return max
}

export function nextAccountGeneration(db, phone) {
  return maxAccountGenerationForPhone(db, phone) + 1
}

export function stampOrderForClient(order, client) {
  if (!client) return order
  order.clientAccountId = client.id
  order.accountGeneration = defaultAccountGeneration(client.accountGeneration)
  return order
}

export function orderBelongsToClientAccount(order, client) {
  if (!order || !client) return false
  const gen = defaultAccountGeneration(client.accountGeneration)
  const orderGen = defaultAccountGeneration(order.accountGeneration)
  if (order.clientAccountId) {
    if (!client.id || order.clientAccountId !== client.id) return false
    return orderGen === gen
  }
  const key = normalizePhoneDigits(client.phone)
  const op = normalizePhoneDigits(order.client?.phone)
  if (!key || op !== key) return false
  if (gen > 1 && orderGen < gen) return false
  return orderGen === gen
}

/** Истёкший recovery → полное удаление профиля (заказы остаются) */
export function expireRecoveryClients(db, { unlinkCardsForClient, persist }) {
  let expired = 0
  for (const client of [...(db.clients || [])]) {
    if (client.accountStatus !== 'recovery') continue
    if (!isRecoveryExpired(client)) continue
    hardDeleteClientProfile(db, client, { unlinkCardsForClient, rememberDeleted: false })
    expired += 1
  }
  if (expired > 0) persist()
  return expired
}

/** Закрепить заказы за поколением аккаунта до удаления профиля */
export function sealOrdersForClientAccount(db, client) {
  if (!client) return
  const key = normalizePhoneDigits(client.phone)
  if (!key) return
  for (const order of db.orders || []) {
    if (normalizePhoneDigits(order.client?.phone) !== key) continue
    if (!order.clientAccountId) {
      stampOrderForClient(order, client)
    } else if (!order.accountGeneration) {
      order.accountGeneration = defaultAccountGeneration(client.accountGeneration)
    }
  }
}

/** Полное удаление профиля клиента — заказы в базе не трогаем */
export function hardDeleteClientProfile(db, client, { unlinkCardsForClient, rememberDeleted = false, rememberDeletedPhone }) {
  if (!client) return
  sealOrdersForClientAccount(db, client)
  if (rememberDeleted && rememberDeletedPhone) rememberDeletedPhone(client.phone)
  unlinkCardsForClient(client)
  const idx = (db.clients || []).findIndex(x => x.id === client.id)
  if (idx >= 0) db.clients.splice(idx, 1)
}
