import { NextRequest, NextResponse } from 'next/server'
import { sanitizeOrderPayload } from '@/lib/orderPayload'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json()
    const payload = sanitizeOrderPayload(raw)
    const body = JSON.stringify(payload)

    const res = await backendFetch('/orders', { method: 'POST', body })
    const text = await res.text()

    if (!res.ok) {
      let message = text
      try {
        const json = JSON.parse(text)
        message = await readBackendError(new Response(JSON.stringify(json), { status: res.status }))
      } catch {
        message = text === 'Internal Server Error'
          ? 'Сервер Render перегружен. Подождите 10 сек и нажмите «Подтвердить» ещё раз.'
          : text.slice(0, 200)
      }
      return NextResponse.json({ detail: message }, { status: res.status })
    }

    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось оформить заказ'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
