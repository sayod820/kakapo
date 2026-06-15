'use client'

import { useEffect } from 'react'
import { USE_API } from './config'
import {
  setCurrentClientPhone,
  subscribeClientNotifications,
  subscribeNotificationChannel,
  syncClientNotificationsFromApi,
  ingestNotificationFromServer,
} from './clientNotifications'
import { useWebSocket } from './ws'

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
    const phone = user?.phone
    const refresh = () => {
      void syncClientNotificationsFromApi(phone)
    }
    refresh()
    const poll = setInterval(refresh, USE_API ? 3000 : 2000)
    const unsubLocal = subscribeClientNotifications(refresh)
    const unsubChannel = subscribeNotificationChannel(refresh)
    return () => {
      clearInterval(poll)
      unsubLocal()
      unsubChannel()
    }
  }, [user?.phone])
}
