import type { Promo } from './types'

export type PromoScheduleMode = 'always' | 'daily' | 'flash'

function parseHm(hm?: string): number | null {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null
  const [h, m] = hm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

export function inferScheduleMode(p: Promo): PromoScheduleMode {
  if (p.scheduleMode) return p.scheduleMode
  if (p.endsAt) return 'flash'
  if (p.from && p.to && (p.from !== '00:00' || p.to !== '23:59')) return 'daily'
  return 'always'
}

export function isDailyTimeActive(from?: string, to?: string, now = new Date()): boolean {
  const start = parseHm(from || '00:00')
  const end = parseHm(to || '23:59')
  if (start == null || end == null) return true
  const cur = minutesNow(now)
  if (start <= end) return cur >= start && cur <= end
  return cur >= start || cur <= end
}

export function isPromoScheduleActive(p: Promo, now = new Date()): boolean {
  if (!p.on) return false
  const mode = inferScheduleMode(p)

  if (p.startsAt) {
    const start = new Date(p.startsAt)
    if (!Number.isNaN(start.getTime()) && now < start) return false
  }

  if (p.endsAt) {
    const end = new Date(p.endsAt)
    if (!Number.isNaN(end.getTime()) && now >= end) return false
  }

  if (mode === 'daily' || mode === 'flash') {
    return isDailyTimeActive(p.from, p.to, now)
  }

  return true
}

export function promoCountdownSeconds(p: Promo, now = new Date()): number | null {
  if (!p.on) return null
  if (p.endsAt) {
    const end = new Date(p.endsAt)
    if (Number.isNaN(end.getTime())) return null
    const sec = Math.floor((end.getTime() - now.getTime()) / 1000)
    return sec > 0 ? sec : null
  }
  const to = parseHm(p.to)
  if (to == null) return null
  const cur = minutesNow(now)
  let diffMin = to - cur
  if (diffMin < 0) diffMin += 24 * 60
  if (diffMin <= 0) return null
  return diffMin * 60
}

export function nextFlashCountdownSeconds(promos: Promo[], now = new Date()): number | null {
  let best: number | null = null
  for (const p of promos) {
    if (!p.on) continue
    const mode = inferScheduleMode(p)
    if (mode !== 'flash' && !p.endsAt) continue
    if (!isPromoScheduleActive(p, now) && !p.endsAt) continue
    const sec = promoCountdownSeconds(p, now)
    if (sec == null) continue
    if (best == null || sec < best) best = sec
  }
  return best
}

export function formatCountdownParts(totalSec: number): { h: number; m: number; s: number } {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return { h, m, s: sec }
}

export function formatPromoScheduleLabel(p: Promo): string {
  const mode = inferScheduleMode(p)
  if (mode === 'flash') {
    if (p.endsAt) {
      try {
        return `⚡ до ${new Date(p.endsAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      } catch {
        return '⚡ флэш'
      }
    }
    return `⚡ ${p.from || '00:00'}–${p.to || '23:59'}`
  }
  if (mode === 'daily') {
    const till = p.till && p.till !== 'Всегда' ? ` · ${p.till}` : ''
    return `🕐 ${p.from || '08:00'}–${p.to || '22:00'}${till}`
  }
  if (p.endsAt) {
    try {
      return `до ${new Date(p.endsAt).toLocaleDateString('ru-RU')}`
    } catch {
      return 'Всегда'
    }
  }
  return p.till && p.till !== 'Всегда' ? p.till : 'Всегда'
}

export function isoToDatetimeLocal(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function splitDatetimeLocal(v: string, defaultTime = '20:00'): { date: string; time: string } {
  if (!v?.trim()) return { date: '', time: defaultTime }
  const [date, time = ''] = v.split('T')
  return { date: date || '', time: time.slice(0, 5) || defaultTime }
}

export function joinDatetimeLocal(date: string, time: string, defaultTime = '20:00'): string {
  if (!date?.trim()) return ''
  const hm = (time || defaultTime).slice(0, 5)
  return `${date}T${hm}`
}

export function datetimeLocalToIso(v: string, defaultTime = '20:00'): string | undefined {
  const raw = v.trim()
  if (!raw) return undefined
  const normalized = raw.includes('T') ? raw : joinDatetimeLocal(raw, defaultTime, defaultTime)
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

export function hasFlashEnd(form: { endsAt: string; to?: string }): boolean {
  const { date } = splitDatetimeLocal(form.endsAt, form.to || '20:00')
  return !!date
}
