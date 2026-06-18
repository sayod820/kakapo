import { NextRequest, NextResponse } from 'next/server'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'

function phoneDigits(phone: string) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

async function moveToRecoveryOnBackend(id: string): Promise<Response> {
  const enc = encodeURIComponent(id)
  const res = await backendFetch(`/clients/${enc}/recovery`, { method: 'POST' })
  if (res.ok) return res
  const err = await res.text()
  if (!/Cannot POST|Not Found|<!DOCTYPE/i.test(err)) return res

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

  return backendFetch(`/clients/${enc}`, {
    method: 'PATCH',
    body: JSON.stringify({
      accountStatus: 'recovery',
      deletedAt: new Date().toISOString().slice(0, 10),
      card: '',
    }),
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = decodeURIComponent(params.id)
    const res = await moveToRecoveryOnBackend(id)
    const text = await res.text()
    if (!res.ok) {
      const message = text ? await readBackendError(new Response(text, { status: res.status })) : 'Не удалось переместить в восстановление'
      return NextResponse.json({ detail: message }, { status: res.status })
    }
    return new NextResponse(text || JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ошибка'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
