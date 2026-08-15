import type { Metadata } from 'next'
import './globals.css'
import ApiSyncProvider from '@/components/shared/ApiSyncProvider'

export const metadata: Metadata = {
  title: 'КАКАПО — Доставка продуктов · г. Яван',
  description: 'Супермаркет КАКАПО · Быстрая доставка · г. Яван, Таджикистан',
}

const tradeAndroidBundle = process.env.NEXT_PUBLIC_TRADE_ANDROID === 'true'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        {tradeAndroidBundle ? (
          <script dangerouslySetInnerHTML={{ __html: 'window.kakapoAndroid=true' }} />
        ) : null}
        <ApiSyncProvider>{children}</ApiSyncProvider>
      </body>
    </html>
  )
}
