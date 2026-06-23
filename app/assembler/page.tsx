'use client'
import dynamic from 'next/dynamic'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
const App = dynamic(() => import('@/components/assembler/AssemblerApp'), { ssr: false })
export default function Page() {
  return (
    <ClientErrorBoundary title="Сборщик временно недоступен">
      <App />
    </ClientErrorBoundary>
  )
}
