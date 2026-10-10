'use client'
import { useEffect, useRef } from 'react'
import { syncDebtHistoryFromLedger, type DebtLedgerResponse } from './clientVipCredit'
import { isWsLive } from './ws'

/**
 * Обновление журнала долга открытой карточки клиента.
 *
 * Принцип: синхронизируемся ПО СОБЫТИЮ, а не постоянным опросом.
 *   • сервер при погашении/изменении долга шлёт WS-сигнал (pos_update debt-repay/crm/cashier…),
 *     useApiSync на него дёргает requestDebtLedgerRefresh() — карточка обновляется сразу;
 *   • локальные изменения истории (kakapo_debt_history) уже перерисовывают витрину сами;
 *   • при возврате в окно — догоняем изменения, сделанные в фоне;
 *   • страховочный медленный опрос идёт ТОЛЬКО когда живого WebSocket нет
 *     (пропал интернет/WS). Когда WS жив — опроса нет, касса не «долбит» сервер впустую.
 */
/** Легаси-константа (совместимость). Постоянного 15-сек опроса больше нет. */
export const DEBT_LEDGER_REFRESH_MS = 15_000
/** Медленный страховочный опрос без живого WS. */
export const DEBT_LEDGER_FALLBACK_MS = 90_000
/** Склеиваем частые события, чтобы не слать запрос на каждое. */
const EVENT_THROTTLE_MS = 4_000

/** Имя глобального события: «подтяни журнал долга сейчас» (шлёт WS-слой). */
export const DEBT_LEDGER_REFRESH_EVT = 'kakapo:debt-ledger-refresh'

/** Попросить открытую карточку клиента немедленно обновить журнал долга. */
export function requestDebtLedgerRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DEBT_LEDGER_REFRESH_EVT))
}

export function useDebtLedgerRefresh(
  phone: string | null | undefined,
  onRefresh?: (ledger: DebtLedgerResponse | null) => void,
): void {
  const cbRef = useRef(onRefresh)
  cbRef.current = onRefresh

  useEffect(() => {
    const p = String(phone || '').trim()
    if (!p) return
    let stopped = false
    let inflight = false
    let pending = false
    let lastAt = 0

    const run = () => {
      if (stopped) return
      if (inflight) { pending = true; return }
      const now = Date.now()
      if (now - lastAt < EVENT_THROTTLE_MS) {
        pending = true
        window.setTimeout(() => {
          if (stopped || !pending) return
          pending = false
          run()
        }, EVENT_THROTTLE_MS - (now - lastAt))
        return
      }
      lastAt = now
      inflight = true
      void syncDebtHistoryFromLedger(p)
        .then(ledger => {
          inflight = false
          if (stopped) return
          try { cbRef.current?.(ledger) } catch { /* витрина не должна падать */ }
          if (pending) { pending = false; run() }
        })
        .catch(() => { inflight = false })
    }

    // Событие от WS-слоя: изменение долга произошло (возможно, на другом устройстве)
    const onEvent = () => run()
    // Возврат в окно — догоняем то, что прошло в фоне
    const onVisible = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener(DEBT_LEDGER_REFRESH_EVT, onEvent)
    document.addEventListener('visibilitychange', onVisible)

    // Страховка. С живым WS опрос не нужен — события приходят сами.
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (isWsLive('pos')) return
      run()
    }, DEBT_LEDGER_FALLBACK_MS)

    // Первичная подгрузка при открытии карточки
    run()

    return () => {
      stopped = true
      window.clearInterval(id)
      window.removeEventListener(DEBT_LEDGER_REFRESH_EVT, onEvent)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phone])
}
