import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Версия UI после деплоя — Electron опрашивает и обновляет экран без переустановки */
export async function GET() {
  let v = 'dev'
  try {
    v = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || 'dev'
  } catch {
    v = `dev-${Date.now()}`
  }
  return NextResponse.json(
    { v, t: Date.now() },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  )
}
