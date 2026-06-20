import { NextRequest, NextResponse } from 'next/server'
import { moveToRecoveryOnBackend } from '@/lib/server/clientRecoveryBackend'
import { readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = decodeURIComponent(params.id)
    const body = await req.json().catch(() => ({}))
    const phone = typeof body.phone === 'string' ? body.phone : ''
    const res = await moveToRecoveryOnBackend(id, phone)
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
