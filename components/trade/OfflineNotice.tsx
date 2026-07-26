'use client'

import { useCanMutate } from '@/lib/offlineGuard'

/**
 * Плашка для разделов, которые без интернета работают только на просмотр.
 * Их операции меняют остатки и деньги на сервере — локально их не провести.
 */
export default function OfflineNotice({ section }: { section: string }) {
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
      Нет связи — {section} сейчас только для просмотра. Изменения станут доступны после подключения.
    </div>
  )
}
