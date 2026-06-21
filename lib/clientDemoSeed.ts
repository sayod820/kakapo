/** Тестовые клиенты U-01…U-07 — отдельный модуль без циклических import */
export const DEMO_SEED_CLIENTS = [
  { id: 'U-01', name: 'Диловар Рахимов', phone: '+992 93 456 78 90', card: 'KAKAPO-0001' },
  { id: 'U-02', name: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', card: 'KAKAPO-0042' },
  { id: 'U-03', name: 'Бахром Каримов', phone: '+992 88 789 01 23', card: 'KAKAPO-0118' },
  { id: 'U-04', name: 'Зафар Мирзоев', phone: '+992 91 654 32 10', card: 'KAKAPO-0234' },
  { id: 'U-05', name: 'Мадина Оразова', phone: '+992 93 321 65 43', card: '' },
  { id: 'U-06', name: 'Рустам Давлатов', phone: '+992 90 445 23 11', card: 'KAKAPO-0055' },
  { id: 'U-07', name: 'Сайёд Гафуров', phone: '+992 50 190 31 41', card: 'KAKAPO-0236' },
] as const

const DEMO_SEED_IDS = new Set(DEMO_SEED_CLIENTS.map(c => c.id))
const DEMO_SEED_PHONES = new Set(
  DEMO_SEED_CLIENTS.map(c => c.phone.replace(/\D/g, '').slice(-9)).filter(Boolean),
)

export function demoSeedPhones(): string[] {
  return DEMO_SEED_CLIENTS.map(c => c.phone)
}

export function isDemoSeedClient(id?: string | null, phone?: string | null): boolean {
  if (id && DEMO_SEED_IDS.has(id as typeof DEMO_SEED_CLIENTS[number]['id'])) return true
  const key = (phone || '').replace(/\D/g, '').slice(-9)
  return !!key && DEMO_SEED_PHONES.has(key)
}
