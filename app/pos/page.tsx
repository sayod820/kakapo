'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/pos/PosApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="Касса временно недоступна">
      <App />
    </ClientErrorBoundary>
  )
}
