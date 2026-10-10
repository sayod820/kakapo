'use client'
import { useEffect, useRef } from 'react'
import { syncDebtHistoryFromLedger, type DebtLedgerResponse } from './clientVipCredit'

/**
 * Пока открыта карточка клиента, регулярно подтягиваем серверный журнал долга.
 *
 * Зачем: список «Оплаты» собирается из журнала долга (что и когда погашено).
 * Раньше он обновлялся только при смене клиента, поэтому погашение, сделанное
 * на другой кассе/устройстве, появлялось здесь лишь после перезагрузки окна.
 * Небольшой фоновый опрос убирает эту задержку — деньги и разбивка не «теряются».
 */
export const DEBT_LEDGER_REFRESH_MS = 15_000

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

    const tick = () => {
      if (stopped) return
      // Скрытая вкладка — не дёргаем сервер, но при возврате сразу догоняем
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void syncDebtHistoryFromLedger(p).then(ledger => {
        if (stopped) return
        try { cbRef.current?.(ledger) } catch { /* опрос не должен ронять витрину */ }
      })
    }

    const id = window.setInterval(tick, DEBT_LEDGER_REFRESH_MS)
    const onVisible = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phone])
}
