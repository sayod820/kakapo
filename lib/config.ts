/** true = данные с backend API, false = локально в браузере (localStorage) */

export const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'



/** Адрес backend (локально или ваш сервер) */

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


