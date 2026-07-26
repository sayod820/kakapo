/** true = данные с backend API, false = локально в браузере (localStorage) */
export const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'

/** Адрес backend — для SSR и proxy в next.config.js */
export const BACKEND_URL =
  process.env.KAKAPO_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000'

/**
 * PUBLIC_URL сайта (https://kakappo.shop) ≠ API.
 * API живёт на /api/kakapo (или localhost:8000 без префикса).
 */
function normalizeApiBase(raw: string): string {
  const u = String(raw || '').trim().replace(/\/$/, '')
  if (!u) return u
  if (/\/api\/kakapo$/i.test(u)) return u
  // Локальный Express / docker api — корень без /api/kakapo
  if (/^https?:\/\/(127\.0\.0\.1|localhost|api)(:\d+)?$/i.test(u)) return u
  if (/:(8000|8080)$/i.test(u)) return u
  // Публичный origin сайта → дописываем mount API
  if (/^https?:\/\//i.test(u)) return `${u}/api/kakapo`
  return u
}

/**
 * Базовый URL для fetch.
 * В обычном браузере — same-origin `/api/kakapo` (nginx/Next proxy).
 * В десктоп-кассе интерфейс на 127.0.0.1, а API должен идти напрямую
 * на сервер — иначе каждый запрос проходит через локальный Next и касса тормозит.
 */
export function getApiUrl(): string {
  const explicitRaw = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/$/, '')
  const explicit = normalizeApiBase(explicitRaw)
  if (!USE_API) {
    return explicit || 'http://localhost:8000'
  }
  if (typeof window !== 'undefined') {
    // Десктоп-сборка: явный URL API (без локального прокси)
    if (explicit && /^https?:\/\//i.test(explicit)) return explicit
    // На локальном origin без явного URL — тоже не ходим в /api/kakapo
    // (иначе снова попадём в медленный rewrite Next)
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(window.location.origin)) {
      return normalizeApiBase(BACKEND_URL)
    }
    return '/api/kakapo'
  }
  return normalizeApiBase(BACKEND_URL)
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
