/** true = данные с Render API, false = локальные демо */
export const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'

/** Backend на Render (сервер / rewrite) */
export const BACKEND_URL =
  process.env.KAKAPO_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'https://kakapo-api.onrender.com'

/** Базовый URL для fetch: в браузере — same-origin proxy без CORS */
export function getApiUrl(): string {
  if (!USE_API) {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  }
  if (typeof window !== 'undefined') return '/api/kakapo'
  return BACKEND_URL
}
