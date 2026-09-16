'use client'

import { useEffect, useState } from 'react'
import { isKakapoDesktop } from '@/lib/desktopBridge'
import { isRecoveryModeActive, ensureRecoveryGateReady } from '@/lib/desktopRecovery'
import { getRecoveryPhase, RECOVERY_PHASE } from '@/lib/desktopRecoveryExecutor'
import {
  getRecoveryOrchestratorUiState,
  subscribeRecoveryOrchestrator,
} from '@/lib/desktopRecoveryOrchestrator'
import { useOfflineSync } from '@/lib/offlineSync'

/**
 * PC-1A/PC-3/PC-5 — Desktop recovery banner with automatic orchestrator progress.
 * Browser never shows this (isKakapoDesktop gate).
 */
export default function RecoveryModeBanner() {
  const [active, setActive] = useState(false)
  const [phase, setPhase] = useState<string>(RECOVERY_PHASE.PREPARE)
  const [orch, setOrch] = useState(() => getRecoveryOrchestratorUiState())
  const pending = useOfflineSync(s => s.pending)
  const failed = useOfflineSync(s => s.failed)
  const items = useOfflineSync(s => s.items)

  useEffect(() => {
    if (!isKakapoDesktop()) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      setActive(isRecoveryModeActive() || getRecoveryOrchestratorUiState().active)
      void getRecoveryPhase().then(p => {
        if (!cancelled) setPhase(p)
      })
    }
    void ensureRecoveryGateReady().then(tick)
    const t = window.setInterval(tick, 1500)
    const unsub = subscribeRecoveryOrchestrator(s => {
      if (!cancelled) setOrch(s)
    })
    return () => {
      cancelled = true
      window.clearInterval(t)
      unsub()
    }
  }, [])

  if (!active && !orch.active) return null

  const oldest = items.length
    ? items.reduce((a, b) => (a.createdAtIso < b.createdAtIso ? a : b)).createdAtIso
    : null
  const oldestLabel = oldest
    ? new Date(oldest).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : '—'

  const isReplay = phase === RECOVERY_PHASE.REPLAY || orch.status === 'REPLAYING'
  const headline = orch.needsOperator
    ? 'Требуется проверка'
    : orch.message
      || (isReplay
        ? 'Восстановление синхронизации — подождите'
        : phase === RECOVERY_PHASE.COMPLETE
          ? 'Синхронизация восстановлена'
          : 'Проверяем синхронизацию…')

  const detail = orch.needsOperator
    ? 'Данные сохранены локально. Обратитесь к администратору — не удаляйте очередь.'
    : isReplay
      ? 'Новые продажи временно недоступны до завершения восстановления.'
      : 'Локальные продажи разрешены, отправка на сервер приостановлена.'

  return (
    <div
      role="status"
      data-recovery-banner="1"
      data-recovery-phase={phase}
      data-recovery-orch={orch.status}
      style={{
        background: orch.needsOperator
          ? 'linear-gradient(90deg, #4a1515, #7a2020)'
          : isReplay
            ? 'linear-gradient(90deg, #4a1515, #7a2020)'
            : 'linear-gradient(90deg, #3d2a12, #5a3a18)',
        color: '#ffe7b8',
        borderBottom: '1px solid #8a6230',
        padding: '10px 16px',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.45,
        zIndex: 50,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
        {headline}
      </div>
      <div>{detail}</div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.92, fontWeight: 500 }}>
        Очередь: {orch.queueLeft || (pending + failed)}
        {orch.queueTotal ? ` / ${orch.queueTotal}` : ''}
        {failed > 0 ? ` · ошибок: ${failed}` : ''}
        {' · '}самая старая: {oldestLabel}
      </div>
    </div>
  )
}
