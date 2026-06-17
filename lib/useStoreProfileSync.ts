'use client'

import { useEffect, useRef, useCallback } from 'react'
import { USE_API } from './config'
import type { StoreUser } from './clientSession'
import { saveStoreUser } from './clientSession'
import {
  CRM_SYNC_BC,
  CRM_SYNC_EVENT,
  crmStoreUsersEqual,
  fetchCrmStoreUser,
} from './clientProfileSync'

/** Синхронизация профиля клиента с CRM (карта + клиент из админки) */
export function useStoreProfileSync(
  user: StoreUser | null,
  setUser: (u: StoreUser | null) => void,
) {
  const userRef = useRef(user)
  userRef.current = user

  const refresh = useCallback(async () => {
    const phone = userRef.current?.phone
    if (!phone) return
    const next = await fetchCrmStoreUser(phone)
    if (!next) return
    const cur = userRef.current
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
    const poll = setInterval(run, USE_API ? 15000 : 3000)

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'kakapo-cards' || e.key === 'kakapo-clients') run()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(CRM_SYNC_EVENT, run)

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
      bc?.close()
    }
  }, [user?.phone, refresh])
}
