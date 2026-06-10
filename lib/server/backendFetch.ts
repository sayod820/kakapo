import { BACKEND_URL } from '@/lib/config'

const RETRY_STATUS = new Set([500, 502, 503, 504])

export async function wakeBackend() {
  try {
    await fetch(`${BACKEND_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  } catch { /* ignore */ }
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
  attempts = 4,
): Promise<Response> {
  let lastRes: Response | null = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500 * i))
    else await wakeBackend()

    try {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
      })
      if (res.ok || !RETRY_STATUS.has(res.status) || i === attempts - 1) return res
      lastRes = res
    } catch (e) {
      if (i === attempts - 1) throw e
    }
  }
  return lastRes!
}

export async function readBackendError(res: Response): Promise<string> {
  const text = await res.text()
  if (!text) return `Ошибка сервера (${res.status})`
  try {
    const json = JSON.parse(text)
    const detail = json.detail ?? json.message
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(' · ')
    }
  } catch { /* plain text */ }
  if (text === 'Internal Server Error') {
    return 'Сервер Render перегружен. Подождите 10 сек и нажмите «Подтвердить» ещё раз.'
  }
  return text.slice(0, 200)
}
