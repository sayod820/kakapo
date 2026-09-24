/** Часовой пояс КАКАПО — г. Яван, Таджикистан (UTC+5, без DST) */
export const KAKAPO_TZ = 'Asia/Dushanbe'
export const KAKAPO_TZ_OFFSET = '+05:00'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function ymdBusiness(date: Date | string = new Date()): string {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KAKAPO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function businessDayStartMs(ymd: string): number {
  const day = String(ymd || '').slice(0, 10)
  if (!DATE_ONLY.test(day)) return Number.NaN
  return Date.parse(`${day}T00:00:00${KAKAPO_TZ_OFFSET}`)
}

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
