'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/retail/RetailApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="KAKAPO Ритейл временно недоступен">
      <App />
    </ClientErrorBoundary>
  )
}
