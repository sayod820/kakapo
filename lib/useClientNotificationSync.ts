'use client'

import { useEffect } from 'react'
import { USE_API } from './config'
import {
  setCurrentClientPhone,
  syncClientNotificationsFromApi,
  ingestNotificationFromServer,
} from './clientNotifications'
import { useWebSocket } from './ws'

/** Фоновая синхронизация уведомлений — без подписки на emit (иначе бесконечный цикл API) */
export function useClientNotificationSync(user?: { phone?: string; name?: string } | null) {
  useEffect(() => {
    if (user?.phone) setCurrentClientPhone(user.phone)
  }, [user?.phone])

  useWebSocket('client', (msg: any) => {
    if (msg?.event === 'notification' && msg.notification) {
      ingestNotificationFromServer(msg.notification)
    }
  })

  useEffect(() => {
    let cancelled = false

    const refresh = () => {
      if (cancelled) return
      void syncClientNotificationsFromApi(user?.phone)
    }

    refresh()
    // WebSocket уже шлёт push — polling реже, чтобы не перегружать браузер
    const poll = setInterval(refresh, USE_API ? 30000 : 5000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [user?.phone])
}
