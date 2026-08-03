// ════════════════════════════════════════════════
// KAKAPO — запрет изменений без связи
// Товары/поставщики/финансы без локальной очереди — только просмотр офлайн.
// Касса и склад (приход/списание) работают локально + синхронизация.
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
 * Для склада/кассы используйте *Safe хелперы — они работают офлайн.
 */
export function guardMutation(notify?: (message: string) => void): boolean {
  if (canMutate()) return true
  if (notify) notify(OFFLINE_BLOCK_MESSAGE)
  else if (typeof window !== 'undefined') window.alert(OFFLINE_BLOCK_MESSAGE)
  return false
}
