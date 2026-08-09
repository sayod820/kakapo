'use client'

import { useCanMutate } from '@/lib/offlineGuard'
import { isOfflineV2Full } from '@/lib/offlineV2'

/**
 * Плашка офлайн-режима для разделов торговли.
 * mode="queue" — операции сохраняются локально и уйдут при связи (склад / V2).
 * mode="view" (по умолчанию) — только просмотр; при Offline V2=on автоматически queue.
 */
export default function OfflineNotice({
  section,
  mode = 'view',
}: {
  section: string
  mode?: 'view' | 'queue'
}) {
  const online = useCanMutate()
  if (online) return null
  const effective = mode === 'queue' || isOfflineV2Full() ? 'queue' : 'view'
  return (
    <div
      className="k-offline-notice"
      style={{
        marginBottom: 16,
        padding: '10px 14px',
        borderRadius: 10,
        fontSize: 13,
        background: 'var(--alert-warn-bg, #2a2414)',
        color: 'var(--gold)',
        border: '1px solid var(--alert-warn-border, #5a4020)',
      }}
    >
      {effective === 'queue'
        ? `Нет связи — ${section}: изменения сохраняются локально и отправятся при подключении.`
        : `Нет связи — ${section} сейчас только для просмотра. Изменения станут доступны после подключения.`}
    </div>
  )
}
