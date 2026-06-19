'use client'

import { useEffect, useRef } from 'react'
import type { Order } from './types'
import type { StoreUser } from './clientSession'
import { saveStoreUser, isClientSessionActive, getSessionEpoch } from './clientSession'
import {
  loyaltyStatsFromOrders,
  resolveEffectiveClientLevel,
  shouldAutoUpgradeLevel,
  loyaltyTierIndex,
  type ClientLevel,
} from './clientCrm'
import { syncAutoLevelToCrm, syncMonthlyLoyaltyReset } from './clientCardSync'
import { currentLoyaltyPeriod } from './loyaltyPeriod'
import { USE_API } from './config'
import { useClientStore } from './clientStore'

/** Ежемесячный сброс + автоповышение по заказам текущего месяца */
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
    if (USE_API && !useClientStore.getState().apiReady) return

    const epoch = getSessionEpoch()
    const reset = syncMonthlyLoyaltyReset(cur.phone, cur.card)
    const base = reset
      ? { ...cur, level: 'basic' as const, vip: false, loyaltyPeriod: currentLoyaltyPeriod() }
      : cur

    if (base.vip && !reset) return

    const { orderCount, spent } = loyaltyStatsFromOrders(orders, base.phone)
    const effective = resolveEffectiveClientLevel(spent, orderCount, base.level, base.loyaltyPeriod)

    if (reset || shouldAutoUpgradeLevel(base.level, effective, base.loyaltyPeriod)) {
      if (!reset && loyaltyTierIndex(effective) <= loyaltyTierIndex((base.level || 'basic') as ClientLevel)) {
        return
      }
      syncAutoLevelToCrm(base.phone, effective, base.card)
      const next: StoreUser = {
        ...base,
        level: effective,
        loyaltyPeriod: currentLoyaltyPeriod(),
        vip: reset ? false : !!base.vip,
      }
      if (getSessionEpoch() !== epoch || !isClientSessionActive() || userRef.current?.phone !== base.phone) return
      saveStoreUser(next)
      setUser(next)
      return
    }

    if (reset) {
      const next: StoreUser = { ...base, level: 'basic', vip: false, loyaltyPeriod: currentLoyaltyPeriod() }
      if (getSessionEpoch() !== epoch || !isClientSessionActive() || userRef.current?.phone !== base.phone) return
      saveStoreUser(next)
      setUser(next)
    }
  }, [user?.phone, user?.level, user?.card, user?.loyaltyPeriod, user?.vip, orders, setUser])
}
