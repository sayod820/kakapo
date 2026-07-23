/**
 * Демо-клиенты (U-01…U-07) удалены из системы — чистый старт.
 * Детекция демо отключена: список пуст, поэтому реальные клиенты НИКОГДА
 * не помечаются как демо (раньше совпадение по телефону ложно ловило
 * настоящих клиентов и предлагало их удалить кнопкой «Убрать демо-клиентов»).
 */
export const DEMO_SEED_CLIENTS: { id: string; name: string; phone: string; card: string }[] = []

export function demoSeedPhones(): string[] {
  return []
}

export function isDemoSeedClient(_id?: string | null, _phone?: string | null): boolean {
  return false
}
