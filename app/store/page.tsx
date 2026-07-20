'use client'

import { useEffect } from 'react'

/** Старый путь /store — редирект на главную (магазин клиента) */
export default function StoreRedirectPage() {
  useEffect(() => {
    window.location.replace('/')
  }, [])

  return (
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
      Переход в магазин…
    </div>
  )
}
