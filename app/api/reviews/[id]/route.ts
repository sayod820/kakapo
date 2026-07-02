import { NextRequest, NextResponse } from 'next/server'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = String(params.id || '').trim()
    if (!id) {
      return NextResponse.json({ detail: 'Укажите id отзыва' }, { status: 400 })
    }
    const body = await req.json()
    const res = await backendFetch(`/reviews/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { detail: await readBackendError(new Response(text, { status: res.status })) },
        { status: res.status },
      )
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось обновить отзыв'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = String(params.id || '').trim()
    if (!id) {
      return NextResponse.json({ detail: 'Укажите id отзыва' }, { status: 400 })
    }
    const res = await backendFetch(`/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { detail: await readBackendError(new Response(text, { status: res.status })) },
        { status: res.status },
      )
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось удалить отзыв'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
