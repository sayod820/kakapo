'use client'

import { useEffect } from 'react'
import { USE_API } from './config'
import { getActiveClientPhone } from './clientSession'
import { loadClientReviewMap } from './clientReviews'
import { syncReviewReplyNotifications } from './clientNotifications'
import { useOrders } from './store'

export function useClientReviewNotifSync(user?: { phone?: string; name?: string } | null) {
  const apiOrders = useOrders(s => s.orders)

  useEffect(() => {
    if (!USE_API || !user) return

    const run = () => {
      const ownerPhone = getActiveClientPhone(user)
      loadClientReviewMap(apiOrders, user)
        .then(map => syncReviewReplyNotifications(Object.values(map), ownerPhone))
        .catch(() => {})
    }

    run()
    const id = setInterval(run, 12000)
    return () => clearInterval(id)
  }, [apiOrders, user?.phone, user?.name])
}
