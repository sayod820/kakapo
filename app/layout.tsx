import type { Metadata } from 'next'
import './globals.css'
import ApiSyncProvider from '@/components/shared/ApiSyncProvider'

export const metadata: Metadata = {
  title: 'KAKAPO — Доставка продуктов · г. Яван',
  description: 'Супермаркет KAKAPO · Быстрая доставка · г. Яван, Таджикистан',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <ApiSyncProvider>{children}</ApiSyncProvider>
      </body>
    </html>
  )
}
