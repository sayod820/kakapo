/* KAKAPO — service worker для офлайн-запуска интерфейса
 * Кэширует оболочку приложения (HTML, JS, CSS), чтобы касса открывалась без интернета.
 * Данные (товары, клиенты, чеки) кэшируются отдельно в IndexedDB — API здесь не кэшируем.
 *
 * Важно: при ошибке сети НЕ подставляем главную (/) на чужой URL (например /admin),
 * иначе кажется, что «админка не открывается», а показывается портал.
 */
const VERSION = 'kakapo-shell-v2'
const PAGE_CACHE = `pages-${VERSION}`
const STATIC_CACHE = `static-${VERSION}`

/** Офлайн-fallback только для кассы/торговли — там это осознанно нужно */
const OFFLINE_SHELLS = ['/trade', '/pos']

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
    event.respondWith(networkFirst(req, url.pathname))
    return
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req))
  }
})

async function networkFirst(req, pathname) {
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

    // Только для кассы: запасной офлайн-шелл. Для /admin и др. — не подменяем порталом.
    if (OFFLINE_SHELLS.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
      for (const shell of OFFLINE_SHELLS) {
        const fallback = await cache.match(shell, { ignoreSearch: true })
        if (fallback) return fallback
      }
    }

    return new Response(
      `<!doctype html><html lang="ru"><meta charset="utf-8"/>
<title>Нет связи</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#030B05;color:#EBF5ED;text-align:center;padding:24px">
<div>
  <div style="font-size:28px;margin-bottom:12px">⚠️</div>
  <h1 style="font-size:18px;margin:0 0 8px">Нет соединения с сервером</h1>
  <p style="font-size:13px;color:#8FB897;max-width:360px;line-height:1.5;margin:0 0 16px">
    Страница «${pathname}» недоступна офлайн. Проверьте интернет или что контейнеры на сервере запущены, затем обновите страницу.
  </p>
  <button onclick="location.reload()" style="padding:10px 16px;border:0;border-radius:10px;
  background:#1FD760;color:#030B05;font-weight:700;cursor:pointer">Обновить</button>
</div>
</body></html>`,
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
