'use client'
import dynamic from 'next/dynamic'
const App = dynamic(() => import('@/components/courier/CourierApp'), { ssr: false })
export default function Page() { return <App /> }
