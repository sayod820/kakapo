'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/admin/AdminApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="Админка временно недоступна">
      <App />
    </ClientErrorBoundary>
  )
}
