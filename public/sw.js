/* KAKAPO — kill-switch service worker.
 * Старый SW кэшировал портал и подменял страницы (магазин/админку).
 * Эта версия НИЧЕГО не кэширует: она удаляет все кэши, снимает саму себя
 * с регистрации и перезагружает открытые вкладки на свежую версию с сервера.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    } catch { /* ignore */ }

    try {
      await self.registration.unregister()
    } catch { /* ignore */ }

    try {
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.navigate(client.url)
      }
    } catch { /* ignore */ }
  })())
})

// Всё грузим только из сети, ничего не подменяем
self.addEventListener('fetch', () => {})
