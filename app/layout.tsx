import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KAKAPO — Доставка продуктов · г. Яван',
  description: 'Супермаркет KAKAPO · Быстрая доставка · г. Яван, Таджикистан',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
