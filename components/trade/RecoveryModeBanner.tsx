'use client'

import { useEffect, useState } from 'react'
import { isKakapoDesktop } from '@/lib/desktopBridge'
import { isRecoveryModeActive, ensureRecoveryGateReady } from '@/lib/desktopRecovery'
import { getRecoveryPhase, RECOVERY_PHASE } from '@/lib/desktopRecoveryExecutor'
import { useOfflineSync } from '@/lib/offlineSync'

/**
 * PC-1A/PC-3 — Desktop recovery banner with phase.
 * Browser never shows this (isKakapoDesktop gate).
 */
export default function RecoveryModeBanner() {
  const [active, setActive] = useState(false)
  const [phase, setPhase] = useState<string>(RECOVERY_PHASE.PREPARE)
  const pending = useOfflineSync(s => s.pending)
  const failed = useOfflineSync(s => s.failed)
  const items = useOfflineSync(s => s.items)

  useEffect(() => {
    if (!isKakapoDesktop()) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      setActive(isRecoveryModeActive())
      void getRecoveryPhase().then(p => {
        if (!cancelled) setPhase(p)
      })
    }
    void ensureRecoveryGateReady().then(tick)
    const t = window.setInterval(tick, 2000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  if (!active) return null

  const oldest = items.length
    ? items.reduce((a, b) => (a.createdAtIso < b.createdAtIso ? a : b)).createdAtIso
    : null
  const oldestLabel = oldest
    ? new Date(oldest).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : '—'

  const phaseLabel =
    phase === RECOVERY_PHASE.REPLAY
      ? 'ФИНАЛЬНЫЙ REPLAY — новые продажи временно заблокированы'
      : phase === RECOVERY_PHASE.COMPLETE
        ? 'Восстановление завершено — ожидает снятие режима'
        : 'Подготовка — локальные продажи разрешены, синхронизация остановлена'

  return (
    <div
      role="status"
      data-recovery-banner="1"
      data-recovery-phase={phase}
      style={{
        background: phase === RECOVERY_PHASE.REPLAY
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
        Режим восстановления.
      </div>
      <div>{phaseLabel}</div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.92, fontWeight: 500 }}>
        Очередь: {pending + failed}
        {failed > 0 ? ` · ошибок: ${failed}` : ''}
        {' · '}самая старая: {oldestLabel}
        {' · '}phase: {phase}
      </div>
    </div>
  )
}
