import { NextRequest, NextResponse } from 'next/server'
import { deleteClientOnBackend } from '@/lib/server/clientDeleteBackend'
import { readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = decodeURIComponent(params.id)
    if (!id) {
      return NextResponse.json({ detail: 'Не указан ID клиента' }, { status: 400 })
    }

    const res = await deleteClientOnBackend(id)
    const text = await res.text()

    if (!res.ok) {
      const message = text ? await readBackendError(new Response(text, { status: res.status })) : 'Не удалось удалить клиента'
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
