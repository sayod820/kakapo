import { NextRequest, NextResponse } from 'next/server'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await backendFetch('/reviews/bulk-delete', {
      method: 'POST',
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
    const message = e instanceof Error ? e.message : 'Не удалось удалить отзывы'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
