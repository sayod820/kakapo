'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/store/StoreApp'), {
  ssr: false,
  loading: () => (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#030B05',
      color: '#8FB897',
      fontFamily: 'Nunito, sans-serif',
      fontSize: 14,
    }}>
      Загрузка магазина…
    </div>
  ),
})
export default function Page() {
  return (
    <ClientErrorBoundary title="Магазин временно недоступен">
      <App />
    </ClientErrorBoundary>
  )
}
