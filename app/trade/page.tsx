'use client'

import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'

const App = dynamic(() => import('@/components/trade/TradeApp'), { ssr: false })

export default function TradePage() {
  return (
    <ClientErrorBoundary title="Торговля временно недоступна">
      <App />
    </ClientErrorBoundary>
  )
}
