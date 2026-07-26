// ════════════════════════════════════════════════
// KAKAPO — запрет изменений без связи
// Склад, Поставщики, Финансы и Товары офлайн доступны
// только на просмотр: их операции нельзя провести локально
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
 */
export function guardMutation(notify?: (message: string) => void): boolean {
  if (canMutate()) return true
  if (notify) notify(OFFLINE_BLOCK_MESSAGE)
  else if (typeof window !== 'undefined') window.alert(OFFLINE_BLOCK_MESSAGE)
  return false
}
