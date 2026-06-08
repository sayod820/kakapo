'use client'
import dynamic from 'next/dynamic'
const App = dynamic(() => import('@/components/admin/AdminApp'), { ssr: false })
export default function Page() { return <App /> }
