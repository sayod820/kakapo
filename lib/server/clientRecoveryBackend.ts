import { backendFetch } from '@/lib/server/backendFetch'

const RECOVERY_NOTE_PREFIX = 'kakapo-recovery'

function phoneDigits(phone: string) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

async function unlinkRemoteCardsForClient(
  id: string,
  client: { phone?: string; card?: string },
): Promise<void> {
  const cardsRes = await backendFetch('/cards')
  if (!cardsRes.ok) return
  const cards = await cardsRes.json() as Array<{ num: string; clientId?: string; phone?: string; status?: string }>
  for (const card of cards) {
    if (card.status === 'unlinked') continue
    const linked = card.clientId === id
      || (client.phone && card.phone && phoneDigits(card.phone) === phoneDigits(client.phone))
      || (client.card && card.num === client.card)
    if (!linked) continue
    await backendFetch(`/cards/${encodeURIComponent(card.num)}`, {
      method: 'PATCH',
      body: JSON.stringify({ unlink: true }),
    })
  }
}

async function legacyRecoveryPatch(id: string, client: { phone?: string; card?: string }): Promise<Response> {
  const enc = encodeURIComponent(id)
  await unlinkRemoteCardsForClient(id, client)
  const deletedAt = new Date().toISOString().slice(0, 10)
  return backendFetch(`/clients/${enc}`, {
    method: 'PATCH',
    body: JSON.stringify({
      accountStatus: 'recovery',
      deletedAt,
      card: '',
      note: `${RECOVERY_NOTE_PREFIX} ${deletedAt}`,
    }),
  })
}

export async function moveToRecoveryOnBackend(id: string, phone?: string): Promise<Response> {
  const enc = encodeURIComponent(id)
  let res = await backendFetch(`/clients/${enc}/recovery`, { method: 'POST' })
  if (res.ok) return res

  const err = await res.text()
  const missingRoute = /Cannot POST|Not Found|<!DOCTYPE/i.test(err)

  if (phone) {
    res = await backendFetch('/clients/recovery-by-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: phoneDigits(phone) }),
    })
    if (res.ok) return res
  }

  if (!missingRoute && res.status !== 404) return res

  const clientsRes = await backendFetch('/clients')
  if (!clientsRes.ok) return clientsRes
  const clients = await clientsRes.json() as Array<{ id: string; phone?: string; card?: string }>
  let client = clients.find(c => c.id === id)
  if (!client && phone) {
    client = clients.find(c => phoneDigits(c.phone || '') === phoneDigits(phone))
  }
  if (!client) {
    return new Response(JSON.stringify({ detail: 'Клиент не найден' }), { status: 404 })
  }

  return legacyRecoveryPatch(client.id, client)
}

export async function restoreClientOnBackend(id: string): Promise<Response> {
  const enc = encodeURIComponent(id)
  let res = await backendFetch(`/clients/${enc}/restore`, { method: 'POST' })
  if (res.ok) return res

  const err = await res.text()
  if (!/Cannot POST|Not Found|<!DOCTYPE/i.test(err)) return res

  const clientsRes = await backendFetch('/clients')
  if (!clientsRes.ok) return clientsRes
  const clients = await clientsRes.json() as Array<{ id: string; note?: string }>
  const client = clients.find(c => c.id === id)
  if (!client) {
    return new Response(JSON.stringify({ detail: 'Клиент не найден' }), { status: 404 })
  }

  const note = (client.note || '').replace(/^kakapo-recovery\s*\d{4}-\d{2}-\d{2}?\s*/i, '').trim()
  return backendFetch(`/clients/${enc}`, {
    method: 'PATCH',
    body: JSON.stringify({
      accountStatus: 'active',
      deletedAt: null,
      blocked: false,
      note,
    }),
  })
}
