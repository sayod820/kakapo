/** Часовой пояс КАКАПО — г. Яван, Таджикистан (UTC+5) */
export const KAKAPO_TZ = 'Asia/Dushanbe'

export function kakapoNowTime(date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: KAKAPO_TZ,
  })
}

function kakapoDateLabel(date: Date): string {
  const now = new Date()
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: KAKAPO_TZ })
  return fmt(date) === fmt(now) ? 'Сегодня' : fmt(date)
}

/** Время заказа для UI (по createdAtIso или HH:MM) */
export function formatKakapoOrderTime(
  order: { createdAt?: string; createdAtIso?: string },
): string {
  if (order.createdAtIso) {
    const d = new Date(order.createdAtIso)
    if (!Number.isNaN(d.getTime())) return kakapoNowTime(d)
  }
  const raw = String(order.createdAt || '').trim()
  const hm = raw.match(/(\d{1,2}:\d{2})/)
  if (hm) return hm[1]
  return raw
}

/** Дата заказа для UI */
export function formatKakapoOrderDate(
  order: { createdAt?: string; createdAtIso?: string },
): string {
  if (order.createdAtIso) {
    const d = new Date(order.createdAtIso)
    if (!Number.isNaN(d.getTime())) return kakapoDateLabel(d)
  }
  const raw = String(order.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return kakapoDateLabel(d)
  }
  return 'Сегодня'
}
