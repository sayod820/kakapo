'use client'

import { useEffect, useRef, useCallback } from 'react'
import { USE_API } from './config'
import type { StoreUser } from './clientSession'
import { saveStoreUser, loadStoreUser, isClientSessionActive, phoneDigits, getSessionEpoch } from './clientSession'
import {
  CRM_SYNC_BC,
  CRM_SYNC_EVENT,
  crmStoreUsersEqual,
  fetchCrmStoreUser,
} from './clientProfileSync'
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

  const refresh = useCallback(async () => {
    const phone = userRef.current?.phone
    if (!phone || !isClientSessionActive()) return
    const epoch = getSessionEpoch()
    const card = userRef.current?.card
    const next = await fetchCrmStoreUser(phone, card)
    if (getSessionEpoch() !== epoch || !isClientSessionActive()) return
    if (userRef.current?.phone !== phone) return
    const stored = loadStoreUser()
    if (!stored || phoneDigits(stored.phone) !== phoneDigits(phone)) return

    if (!next) {
      onRemovedRef.current?.()
      return
    }

    const cur = userRef.current
    if (cur?.clientId && isClientNamePlaceholder(cur.name) && !isClientNamePlaceholder(next.name)) {
      useClientStore.getState().updateClient(cur.clientId, { name: next.name })
    }
    if (!cur || !crmStoreUsersEqual(cur, next)) {
      const merged: StoreUser = { ...cur, ...next }
      saveStoreUser(merged)
      setUser(merged)
    }
  }, [setUser])

  useEffect(() => {
    if (!user?.phone) return
    let cancelled = false

    const run = () => {
      if (!cancelled) void refresh()
    }

    run()
    const poll = setInterval(run, USE_API ? 8000 : 3000)

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
