// ════════════════════════════════════════════════
// KAKAPO — запрет изменений без связи
// Без Offline V2: разделы без очереди — только просмотр офлайн.
// С kakapo-offline-v2=on: UI само пропускает через *Safe (см. isOfflineV2Full).
// Касса и склад работают локально + синхронизация всегда.
// ════════════════════════════════════════════════
import { isOnline } from './offline'
import { useOfflineSync } from './offlineSync'

export const OFFLINE_BLOCK_MESSAGE = 'Нет связи — операция станет доступна после подключения'

/** true — есть связь и изменения разрешены */
export function canMutate(): boolean {
  return isOnline() && useOfflineSync.getState().online
}

/** Реактивный флаг для блокировки кнопок */
export function useCanMutate(): boolean {
  return useOfflineSync(s => s.online)
}

/**
 * Проверка перед изменением. Возвращает false и показывает сообщение,
 * если связи нет.
 * Для склада/кассы/V2 используйте *Safe и `if (!isOfflineV2Full() && !guardMutation(...))`.
 */
export function guardMutation(notify?: (message: string) => void): boolean {
  if (canMutate()) return true
  if (notify) notify(OFFLINE_BLOCK_MESSAGE)
  else if (typeof window !== 'undefined') window.alert(OFFLINE_BLOCK_MESSAGE)
  return false
}
