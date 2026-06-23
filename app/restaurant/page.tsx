'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/restaurant/RestaurantApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="Кабинет ресторана временно недоступен">
      <App />
    </ClientErrorBoundary>
  )
}
