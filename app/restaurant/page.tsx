'use client'
import dynamic from 'next/dynamic'
const App = dynamic(() => import('@/components/restaurant/RestaurantApp'), { ssr: false })
export default function Page() { return <App /> }
