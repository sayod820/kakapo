'use client'

import { useEffect, useRef, useCallback } from 'react'
import { USE_API } from './config'
import type { StoreUser } from './clientSession'
import { saveStoreUser, loadStoreUser, isClientSessionActive, phoneDigits, getSessionEpoch } from './clientSession'
import { CRM_SYNC_BC, CRM_SYNC_EVENT, crmStoreUsersEqual, fetchCrmStoreUser, isStoreAccountActiveOnServer, mergeCrmIntoStoreUser } from './clientProfileSync'
import { isManualLoyaltyActive } from './loyaltyAdminLock'
import { ensureClientDefaultAddress } from './clientAddresses'
import { isClientNamePlaceholder } from './clientCrm'
import { useClientStore } from './clientStore'

/** Синхронизация профиля клиента с CRM (карта + клиент из админки) */
export function useStoreProfileSync(
  user: StoreUser | null,
  setUser: (u: StoreUser | null) => void,
  onAccountRemoved?: () => void,
) {
  const userRef = useRef(user)
  userRef.current = user
  const onRemovedRef = useRef(onAccountRemoved)
  onRemovedRef.current = onAccountRemoved
  const loyaltySyncedRef = useRef(false)

  const refresh = useCallback(async () => {
    const phone = userRef.current?.phone
    if (!phone || !isClientSessionActive()) return
    const epoch = getSessionEpoch()
    const card = userRef.current?.card

    if (USE_API) {
      const { syncLoyaltyStatusConfigFromApi, isLoyaltyConfigReady } = await import('./loyaltyStatusConfig')
      if (!isLoyaltyConfigReady()) {
        await syncLoyaltyStatusConfigFromApi()
      }
    }

    if (USE_API && !loyaltySyncedRef.current) {
      loyaltySyncedRef.current = true
      const stored = loadStoreUser()
      const skipLoyaltyRecalc = stored && isManualLoyaltyActive(stored, stored.level)
      if (!skipLoyaltyRecalc) {
        const { syncLoyaltyBonuses } = await import('./loyaltyBonus')
        const { useOrders } = await import('./store')
        void syncLoyaltyBonuses(phone, useOrders.getState().orders)
      }
    }

    const active = await isStoreAccountActiveOnServer(phone)
    if (getSessionEpoch() !== epoch || !isClientSessionActive()) return
    if (userRef.current?.phone !== phone) return
    const stored = loadStoreUser()
    if (!stored || phoneDigits(stored.phone) !== phoneDigits(phone)) return

    if (!active) {
      onRemovedRef.current?.()
      return
    }

    const next = await fetchCrmStoreUser(phone, card)
    if (getSessionEpoch() !== epoch || !isClientSessionActive()) return
    if (userRef.current?.phone !== phone) return

    // Профиль исчез с сервера (удалили в админке) — выходим, даже если session-check
    // на старом backend ещё не сработал.
    if (!next) {
      const stillActive = await isStoreAccountActiveOnServer(phone)
      if (getSessionEpoch() !== epoch || !isClientSessionActive()) return
      if (!stillActive) {
        onRemovedRef.current?.()
        return
      }
      return
    }

    const cur = userRef.current
    if (cur?.clientId && isClientNamePlaceholder(cur.name) && !isClientNamePlaceholder(next.name)) {
      useClientStore.getState().updateClient(cur.clientId, { name: next.name })
    }
    if (!cur || !crmStoreUsersEqual(cur, next) || !!cur.vip !== !!next.vip) {
      const merged = mergeCrmIntoStoreUser(cur || next, next)
      saveStoreUser(merged)
      setUser(merged)
      if (next.addr?.trim()) {
        void ensureClientDefaultAddress(phone, next.addr)
      }
    }
  }, [setUser])

  useEffect(() => {
    if (!user?.phone) return
    loyaltySyncedRef.current = false
    let cancelled = false

    const run = () => {
      if (!cancelled) void refresh()
    }

    run()
    const poll = setInterval(run, USE_API ? 3000 : 2000)

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === 'kakapo-cards'
        || e.key === 'kakapo-clients'
        || e.key === 'kakapo_store_user'
        || e.key === 'kakapo-deleted-phones'
      ) run()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(CRM_SYNC_EVENT, run)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(CRM_SYNC_BC)
      bc.onmessage = run
    } catch { /* unsupported */ }

    return () => {
      cancelled = true
      clearInterval(poll)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(CRM_SYNC_EVENT, run)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
      bc?.close()
    }
  }, [user?.phone, refresh])
}
