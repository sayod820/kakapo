import { NextRequest, NextResponse } from 'next/server'
import { backendFetch, readBackendError } from '@/lib/server/backendFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function reviewsPath(req: NextRequest): string {
  const restId = req.nextUrl.searchParams.get('restId')
  const productId = req.nextUrl.searchParams.get('productId')
  const q = new URLSearchParams()
  if (restId) q.set('restId', restId)
  if (productId) q.set('productId', productId)
  const qs = q.toString()
  return qs ? `/reviews?${qs}` : '/reviews'
}

export async function GET(req: NextRequest) {
  try {
    const res = await backendFetch(reviewsPath(req))
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
    const message = e instanceof Error ? e.message : 'Не удалось загрузить отзывы'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const productKey = String(body.productKey || '').trim()
    const productName = String(body.productName || '').trim()
    const orderId = String(body.orderId || '').trim()
    const rating = Math.min(5, Math.max(1, Math.round(Number(body.rating) || 0)))
    const text = String(body.text || '').trim()
    const client = String(body.client || 'Клиент').trim()

    if (!productKey) {
      return NextResponse.json({ detail: 'Укажите товар для отзыва' }, { status: 400 })
    }
    if (!orderId) {
      return NextResponse.json({ detail: 'Укажите номер заказа' }, { status: 400 })
    }
    if (!rating) {
      return NextResponse.json({ detail: 'Поставьте оценку от 1 до 5' }, { status: 400 })
    }

    const payload = {
      productKey,
      productName: productName || undefined,
      productId: body.productId != null ? body.productId : undefined,
      orderId,
      rating,
      text: text || '★'.repeat(rating),
      client,
      restId: 'STORE',
    }

    const res = await backendFetch('/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const responseText = await res.text()
    if (!res.ok) {
      return NextResponse.json(
        { detail: await readBackendError(new Response(responseText, { status: res.status })) },
        { status: res.status },
      )
    }
    return new NextResponse(responseText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось отправить отзыв'
    return NextResponse.json({ detail: message }, { status: 500 })
  }
}
