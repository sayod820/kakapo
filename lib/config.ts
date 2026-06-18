/** true = данные с backend API, false = локально в браузере (localStorage) */
export const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'

/** Адрес backend (Render / локально) — для SSR и proxy в next.config.js */
export const BACKEND_URL =
  process.env.KAKAPO_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000'

/** Базовый URL для fetch: в браузере — same-origin proxy без CORS */
export function getApiUrl(): string {
  if (!USE_API) {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  }
  if (typeof window !== 'undefined') return '/api/kakapo'
  return BACKEND_URL
}

/** WebSocket: на Vercel — напрямую на Render (wss://) */
export function getWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const api = process.env.NEXT_PUBLIC_API_URL || BACKEND_URL
  if (api.startsWith('https://')) return api.replace(/^https:/, 'wss:')
  if (api.startsWith('http://')) return api.replace(/^http:/, 'ws:')
  return 'ws://localhost:8000'
}
