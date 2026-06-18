import { NextRequest, NextResponse } from 'next/server'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = decodeURIComponent(params.id)
    const enc = encodeURIComponent(id)
    let res = await backendFetch(`/clients/${enc}/restore`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.text()
      if (/Cannot POST|Not Found|<!DOCTYPE/i.test(err)) {
        res = await backendFetch(`/clients/${enc}`, {
          method: 'PATCH',
          body: JSON.stringify({ accountStatus: 'active', deletedAt: null, blocked: false }),
        })
      }
    }
    const text = await res.text()
    if (!res.ok) {
      const message = text ? await readBackendError(new Response(text, { status: res.status })) : 'Не удалось восстановить'
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
