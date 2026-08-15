import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
import TradeApp from '@/components/trade/TradeApp'

export default function TradePage() {
  return (
    <ClientErrorBoundary title="Торговля временно недоступна">
      <TradeApp />
    </ClientErrorBoundary>
  )
}
