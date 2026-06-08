'use client'
import dynamic from 'next/dynamic'
const App = dynamic(() => import('@/components/assembler/AssemblerApp'), { ssr: false })
export default function Page() { return <App /> }
