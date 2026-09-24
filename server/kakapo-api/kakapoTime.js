/**
 * Canonical KAKAPO business time. Storage is UTC ISO.
 * Business calendar = Asia/Dushanbe (Yavan, Tajikistan, UTC+5, no DST).
 */

export const KAKAPO_TZ = 'Asia/Dushanbe'
export const KAKAPO_TZ_OFFSET = '+05:00'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function isDateOnly(value) {
  return DATE_ONLY.test(String(value || '').trim())
}

export function ymdBusiness(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KAKAPO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  if (!y || !m || !day) return ''
  return `${y}-${m}-${day}`
}

export function addCalendarDays(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d + Number(days || 0))
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function businessDayStartMs(ymd) {
  const day = String(ymd || '').slice(0, 10)
  if (!DATE_ONLY.test(day)) return Number.NaN
  return Date.parse(`${day}T00:00:00${KAKAPO_TZ_OFFSET}`)
}

/**
 * Parse API from/to into [fromMs inclusive, toExclusiveMs).
 *
 * Date-only YYYY-MM-DD: business-local calendar day in Asia/Dushanbe.
 * Date-only `to` is always an inclusive end day (toExclusive = start of next day).
 * Same-day from=to: that full day. Multi-day from=A&to=B: both A and B included.
 * Datetime ISO: from inclusive; to exclusive unless it looks like inclusive end-of-day
 * (23:59:59.*) in which case the instant is included (toExclusive = to + 1ms).
 *
 * Always pass both bounds together via parseReportRange(from, to) — never filter
 * from-only then to-only separately (that empties same-day ranges).
 */
export function parseReportRange(fromIso, toIso) {
  let fromMs = null
  let toExclusiveMs = null

  const from = fromIso != null && String(fromIso).trim() ? String(fromIso).trim() : ''
  const to = toIso != null && String(toIso).trim() ? String(toIso).trim() : ''

  if (from) {
    if (isDateOnly(from)) fromMs = businessDayStartMs(from)
    else {
      const t = new Date(from).getTime()
      fromMs = Number.isNaN(t) ? null : t
    }
  }

  if (to) {
    if (isDateOnly(to)) {
      toExclusiveMs = businessDayStartMs(addCalendarDays(to, 1))
    } else {
      const t = new Date(to).getTime()
      if (!Number.isNaN(t)) {
        // Legacy clients send 23:59:59.999 inclusive; treat that instant as included.
        toExclusiveMs = /T23:59:59/.test(to) ? t + 1 : t
      }
    }
  }

  return { fromMs, toExclusiveMs }
}

export function inReportRange(iso, range) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  const fromMs = range?.fromMs
  const toExclusiveMs = range?.toExclusiveMs
  if (fromMs != null && !Number.isNaN(fromMs) && t < fromMs) return false
  if (toExclusiveMs != null && !Number.isNaN(toExclusiveMs) && t >= toExclusiveMs) return false
  return true
}
