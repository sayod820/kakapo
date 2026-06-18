import { backendFetch } from '@/lib/server/backendFetch'

function phoneDigits(phone: string) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export async function deleteClientOnBackend(id: string): Promise<Response> {
  const enc = encodeURIComponent(id)

  const attempts: Array<{ path: string; init: RequestInit }> = [
    { path: `/clients/${enc}/delete`, init: { method: 'POST' } },
    { path: `/clients/${enc}`, init: { method: 'DELETE' } },
    { path: `/clients/${enc}`, init: { method: 'PATCH', body: JSON.stringify({ purge: true }) } },
  ]

  for (const { path, init } of attempts) {
    const res = await backendFetch(path, init)
    if (res.ok) return res
    const err = await res.text()
    if (res.status === 404 && !/<!DOCTYPE|Cannot/i.test(err)) {
      return new Response(err, { status: 404 })
    }
    if (!/Cannot DELETE|Cannot POST|Not Found|<!DOCTYPE/i.test(err)) {
      return new Response(err, { status: res.status })
    }
  }

  return softDeleteClientOnBackend(id)
}

async function softDeleteClientOnBackend(id: string): Promise<Response> {
  const enc = encodeURIComponent(id)

  const clientsRes = await backendFetch('/clients')
  if (!clientsRes.ok) return clientsRes
  const clients = await clientsRes.json() as Array<{ id: string; phone?: string; card?: string }>
  const client = clients.find(c => c.id === id)
  if (!client) {
    return new Response(JSON.stringify({ detail: 'Клиент не найден' }), { status: 404 })
  }

  const cardsRes = await backendFetch('/cards')
  if (cardsRes.ok) {
    const cards = await cardsRes.json() as Array<{ num: string; clientId?: string; phone?: string; status?: string }>
    const linked = cards.filter(c => {
      if (c.status === 'unlinked') return false
      if (c.clientId === id) return true
      if (client.phone && c.phone && phoneDigits(c.phone) === phoneDigits(client.phone)) return true
      if (client.card && c.num === client.card) return true
      return false
    })
    for (const card of linked) {
      await backendFetch(`/cards/${encodeURIComponent(card.num)}`, {
        method: 'PATCH',
        body: JSON.stringify({ unlink: true }),
      })
    }
  }

  return backendFetch(`/clients/${enc}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: 'Удалён',
      phone: `+0000000${id.replace(/\D/g, '').slice(-4) || '0000'}`,
      email: '',
      addr: '',
      card: '',
      blocked: true,
      note: 'deleted',
    }),
  })
}

export async function deleteClientByPhoneOnBackend(phone: string): Promise<Response> {
  const digits = phoneDigits(phone)
  const clientsRes = await backendFetch('/clients')
  if (!clientsRes.ok) return clientsRes

  const clients = await clientsRes.json() as Array<{ id: string; phone?: string }>
  const client = clients.find(c => phoneDigits(c.phone || '') === digits)
  if (!client) {
    return new Response(JSON.stringify({ detail: 'Клиент не найден' }), { status: 404 })
  }

  return deleteClientOnBackend(client.id)
}
