'use client'

import { useEffect, useRef } from 'react'
import type { Order } from './types'
import type { StoreUser } from './clientSession'
import { saveStoreUser, isClientSessionActive, getSessionEpoch } from './clientSession'
import { loyaltyStatsFromOrders, resolveEffectiveClientLevel } from './clientCrm'
import { syncAutoLevelToCrm, syncExpiredManualLoyaltyLock } from './clientCardSync'
import { currentLoyaltyPeriod } from './loyaltyPeriod'
import { isForcedVipActive, inferLevelAssignMode } from './loyaltyAdminLock'
import { USE_API } from './config'
import { useClientStore } from './clientStore'
import { filterOrdersForStoreUser } from './clientAccountLifecycle'

/**
 * Авто-статус — живой пересчёт по тратам за скользящие 30 дней (см. resolveEffectiveClientLevel),
 * без привязки к календарному месяцу. Плюс снятие истёкшей ручной блокировки статуса.
 */
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
    const unlocked = syncExpiredManualLoyaltyLock(cur.phone, cur.card, orders)
    const base = unlocked
      ? {
          ...cur,
          level: 'basic' as const,
          levelAssignMode: 'auto' as const,
          levelValidUntil: undefined,
          levelLockedPeriod: undefined,
        }
      : cur

    const assignMode = inferLevelAssignMode(
      { levelAssignMode: base.levelAssignMode, levelLockedPeriod: base.levelLockedPeriod },
      undefined,
    )
    if (assignMode === 'manual') return
    if (isForcedVipActive({ vip: base.vip, vipUntil: base.vipUntil })) return

    const lockRecord = {
      levelAssignMode: assignMode,
      levelValidUntil: base.levelValidUntil,
      levelLockedPeriod: base.levelLockedPeriod,
      level: base.level,
      vip: base.vip,
      vipUntil: base.vipUntil,
    }

    const scoped = filterOrdersForStoreUser(orders, base)
    const { orderCount, spent } = loyaltyStatsFromOrders(scoped, base.phone)
    const effective = resolveEffectiveClientLevel(spent, orderCount, base.level, lockRecord)

    if (effective === base.level && !unlocked) return

    if (!USE_API) syncAutoLevelToCrm(base.phone, effective, base.card)
    const next: StoreUser = {
      ...base,
      level: effective,
      loyaltyPeriod: currentLoyaltyPeriod(),
    }
    if (getSessionEpoch() !== epoch || !isClientSessionActive() || userRef.current?.phone !== base.phone) return
    saveStoreUser(next)
    setUser(next)
  }, [user?.phone, user?.level, user?.card, user?.loyaltyPeriod, user?.vip, user?.levelLockedPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.vipUntil, orders, setUser])
}
