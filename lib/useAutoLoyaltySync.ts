'use client'

import { useEffect, useRef } from 'react'
import type { Order } from './types'
import type { StoreUser } from './clientSession'
import { saveStoreUser } from './clientSession'
import {
  loyaltyStatsFromOrders,
  resolveEffectiveClientLevel,
  shouldAutoUpgradeLevel,
} from './clientCrm'
import { syncAutoLevelToCrm } from './clientCardSync'

/** При выполнении условий (заказы, траты) — автоматически повысить статус в CRM и сессии */
export function useAutoLoyaltySync(
  user: StoreUser | null,
  setUser: (u: StoreUser | null) => void,
  orders: Order[],
) {
  const userRef = useRef(user)
  userRef.current = user

  useEffect(() => {
    const cur = userRef.current
    if (!cur?.phone) return

    const { orderCount, spent } = loyaltyStatsFromOrders(orders, cur.phone)
    const effective = resolveEffectiveClientLevel(spent, orderCount, cur.level)
    if (!shouldAutoUpgradeLevel(cur.level, effective)) return

    syncAutoLevelToCrm(cur.phone, effective, cur.card)
    const next: StoreUser = { ...cur, level: effective }
    saveStoreUser(next)
    setUser(next)
  }, [user?.phone, user?.level, user?.card, orders, setUser])
}
