import { NextRequest, NextResponse } from 'next/server'
import { deleteClientByPhoneOnBackend } from '@/lib/server/clientDeleteBackend'
import { readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const res = await deleteClientByPhoneOnBackend(body.phone || '')
    const text = await res.text()

    if (!res.ok) {
      const message = text ? await readBackendError(new Response(text, { status: res.status })) : 'Не удалось удалить'
      return NextResponse.json({ detail: message }, { status: res.status })
    }

    return new NextResponse(text || JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось удалить клиента'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
