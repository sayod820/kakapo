/** true = данные с backend API, false = локально в браузере (localStorage) */
export const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'

/** Адрес backend — для SSR и proxy в next.config.js */
export const BACKEND_URL =
  process.env.KAKAPO_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000'

/**
 * Базовый URL для fetch.
 * В обычном браузере — same-origin `/api/kakapo` (nginx/Next proxy).
 * В десктоп-кассе интерфейс на 127.0.0.1, а API должен идти напрямую
 * на сервер — иначе каждый запрос проходит через локальный Next и касса тормозит.
 */
export function getApiUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/$/, '')
  if (!USE_API) {
    return explicit || 'http://localhost:8000'
  }
  if (typeof window !== 'undefined') {
    // Десктоп-сборка: явный URL API (без локального прокси)
    if (explicit && /^https?:\/\//i.test(explicit)) return explicit
    // На локальном origin без явного URL — тоже не ходим в /api/kakapo
    // (иначе снова попадём в медленный rewrite Next)
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(window.location.origin)) {
      return BACKEND_URL.replace(/\/$/, '')
    }
    return '/api/kakapo'
  }
  return BACKEND_URL.replace(/\/$/, '')
}

/**
 * WebSocket: в браузере — same-origin (nginx /ws/).
 * В десктоп-кассе интерфейс поднимается локально на 127.0.0.1, там same-origin
 * не подходит — используем явный адрес из сборки.
 */
export function getWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL
  if (typeof window !== 'undefined') {
    if (explicit) return explicit.replace(/\/$/, '')
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}`
  }
  if (explicit) return explicit.replace(/\/$/, '')

  const api = process.env.NEXT_PUBLIC_API_URL || BACKEND_URL
  if (api.startsWith('https://')) return api.replace(/^https:/, 'wss:')
  if (api.startsWith('http://')) return api.replace(/^http:/, 'ws:')
  return 'ws://localhost:8000'
}
