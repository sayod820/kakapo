'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'

const App = dynamic(() => import('@/components/admin/AdminApp'), { ssr: false })

export default function Page() {
  // Сброс старого SW/кэша, который подменял /admin главной страницей
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys()
          await Promise.all(keys.map(k => caches.delete(k)))
        }
      } catch { /* ignore */ }
    })()
  }, [])

  return (
    <ClientErrorBoundary title="Админка временно недоступна">
      <App />
    </ClientErrorBoundary>
  )
}
