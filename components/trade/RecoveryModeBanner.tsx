'use client'

import { useEffect, useState } from 'react'
import { isKakapoDesktop } from '@/lib/desktopBridge'
import { isRecoveryModeActive, ensureRecoveryGateReady } from '@/lib/desktopRecovery'
import { useOfflineSync } from '@/lib/offlineSync'

/**
 * PC-1A — Desktop recovery banner.
 * Browser never shows this (isKakapoDesktop gate).
 */
export default function RecoveryModeBanner() {
  const [active, setActive] = useState(false)
  const pending = useOfflineSync(s => s.pending)
  const failed = useOfflineSync(s => s.failed)
  const items = useOfflineSync(s => s.items)

  useEffect(() => {
    if (!isKakapoDesktop()) return
    let cancelled = false
    void ensureRecoveryGateReady().then(() => {
      if (!cancelled) setActive(isRecoveryModeActive())
    })
    const t = window.setInterval(() => {
      if (!cancelled) setActive(isRecoveryModeActive())
    }, 2000)
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

  return (
    <div
      role="status"
      data-recovery-banner="1"
      style={{
        background: 'linear-gradient(90deg, #3d2a12, #5a3a18)',
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
      <div>
        Продажи сохраняются локально. Синхронизация с сервером временно приостановлена.
      </div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.92, fontWeight: 500 }}>
        Очередь: {pending + failed}
        {failed > 0 ? ` · ошибок: ${failed}` : ''}
        {' · '}самая старая: {oldestLabel}
        {' · '}recovery: active
      </div>
    </div>
  )
}
