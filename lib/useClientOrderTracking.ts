'use client'

import { useEffect } from 'react'
import { USE_API } from './config'
import { useOrders } from './store'

/**
 * Обновляет статусы заказов гостя через публичный трекинг (POST /orders/track).
 *
 * Магазин не может читать GET /orders (там нужен вход сотрудника), поэтому
 * покупатель без входа получает свежий статус только так: по своим id + телефону.
 * Опрашиваем нечасто (раз в 45 сек, только на видимой вкладке) — с учётом лимитов сервера.
 */
export function useClientOrderTracking(phone: string | null | undefined, enabled = true) {
  const trackClientOrders = useOrders(s => s.trackClientOrders)

  useEffect(() => {
    if (!USE_API || !enabled || !phone) return
    let cancelled = false

    const run = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void trackClientOrders(phone).catch(() => {})
    }

    run()
    const interval = setInterval(run, 45_000)
    const onFocus = () => run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phone, enabled, trackClientOrders])
}
