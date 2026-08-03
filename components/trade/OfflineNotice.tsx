'use client'

import { useCanMutate } from '@/lib/offlineGuard'

/**
 * Плашка офлайн-режима для разделов торговли.
 * mode="queue" — операции сохраняются локально и уйдут при связи (склад).
 * mode="view" (по умолчанию) — только просмотр.
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
  return (
    <div
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
      {mode === 'queue'
        ? `Нет связи — ${section}: приход и списание сохраняются локально и отправятся при подключении.`
        : `Нет связи — ${section} сейчас только для просмотра. Изменения станут доступны после подключения.`}
    </div>
  )
}
