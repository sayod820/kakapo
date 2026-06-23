'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/courier/CourierApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="Курьер временно недоступен">
      <App />
    </ClientErrorBoundary>
  )
}
