import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Anonymous proxy disabled: deleting a client by phone needs staff auth (admin calls the API directly). */
export async function POST() {
  return NextResponse.json({ detail: 'Удаление клиента доступно только в админке' }, { status: 403 })
}
