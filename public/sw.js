/* KAKAPO — service worker для офлайн-запуска интерфейса
 * Кэширует оболочку приложения (HTML, JS, CSS), чтобы касса открывалась без интернета.
 * Данные (товары, клиенты, чеки) кэшируются отдельно в IndexedDB — API здесь не кэшируем.
 */
const VERSION = 'kakapo-shell-v1'
const PAGE_CACHE = `pages-${VERSION}`
const STATIC_CACHE = `static-${VERSION}`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)),
    )
    await self.clients.claim()
  })())
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|ico)$/i.test(url.pathname)
  )
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return
  // API никогда не кэшируем — офлайн-данные живут в IndexedDB, чтобы не отдавать устаревшее
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
    return
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req))
  }
})

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.status === 200 && res.type === 'basic') {
      cache.put(req, res.clone())
    }
    return res
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true })
    if (cached) return cached
    const fallback =
      (await cache.match('/trade', { ignoreSearch: true })) ||
      (await cache.match('/pos', { ignoreSearch: true })) ||
      (await cache.match('/', { ignoreSearch: true }))
    if (fallback) return fallback
    return new Response(
      '<h1>Нет соединения</h1><p>Откройте приложение один раз при интернете, чтобы оно работало офлайн.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(req)
  const network = fetch(req)
    .then(res => {
      if (res && res.status === 200) cache.put(req, res.clone())
      return res
    })
    .catch(() => cached)
  return cached || network
}
