import type { Review } from './types'
import { getActiveClientPhone, loadStoreUser, phoneDigits } from './clientSession'
import { USE_API } from './config'
import { api } from './api'
import {
  ACCOUNT_NS,
  loadAccountJson,
  saveAccountJson,
  loadBroadcastNotifications,
  saveBroadcastNotifications,
} from './clientAccountStorage'

export type ClientNotificationKind = 'order' | 'review' | 'bonus' | 'promo' | 'system'

export type ClientNotificationAction =
  | 'orders' | 'order'
  | 'reviews' | 'review'
  | 'promos' | 'bonus' | 'vip'

export type ClientNotification = {
  id: string
  read: boolean
  icon: string
  title: string
  body: string
  time: string
  color: string
  kind?: ClientNotificationKind
  action?: ClientNotificationAction
  reviewId?: number
  orderId?: string
  targetPhone?: string
  sentAt?: string
  broadcast?: boolean
}

export const NOTIFICATION_KIND_LABELS: Record<ClientNotificationKind, string> = {
  order: 'Заказы',
  review: 'Отзывы',
  bonus: 'Бонусы',
  promo: 'Акции',
  system: 'Прочее',
}

export function notificationKind(n: ClientNotification): ClientNotificationKind {
  if (n.kind) return n.kind
  if (n.reviewId != null || n.action === 'reviews' || n.action === 'review') return 'review'
  if (n.action === 'bonus' || (n.icon === '⭐' && /бонус/i.test(n.title))) return 'bonus'
  if (n.action === 'promos' || n.icon === '🎉' || n.icon === '🔥') return 'promo'
  if (n.orderId || n.action === 'orders' || n.action === 'order') return 'order'
  return 'system'
}

export function resolveNotificationTarget(n: ClientNotification): {
  page: string
  params?: Record<string, string>
} {
  const kind = notificationKind(n)
  if (kind === 'review') {
    if (n.reviewId != null) return { page: 'reviews', params: { reviewId: String(n.reviewId) } }
    return { page: 'reviews' }
  }
  if (kind === 'bonus') return { page: 'vip' }
  if (kind === 'promo') return { page: 'promos' }
  if (kind === 'order') {
    return n.orderId ? { page: 'orders', params: { orderId: n.orderId } } : { page: 'orders' }
  }
  return { page: 'notifs' }
}

export function notificationOpenHint(n: ClientNotification): string {
  const { page, params } = resolveNotificationTarget(n)
  if (page === 'orders' && params?.orderId) return `Открыть заказ ${params.orderId} →`
  if (page === 'reviews') return 'Открыть отзывы →'
  if (page === 'vip') return 'Открыть бонусы VIP →'
  if (page === 'promos') return 'Открыть акции →'
  if (page === 'orders') return 'Открыть заказы →'
  return ''
}

const BC_NAME = 'kakapo-notifs'

const DEMO_PHONES = new Set(['934567890', '901234567', '887890123'])

type SeenReplies = Record<string, { admin?: string; rest?: string }>

const DEMO_NOTIFS: ClientNotification[] = [
  { id: 'demo-1', read: false, icon: '🛵', title: 'Курьер выехал', body: 'Фирдавс едет к вам · ~12 мин', time: '14:23', color: 'var(--blue)', kind: 'order', action: 'order', orderId: 'K-4832' },
  { id: 'demo-2', read: false, icon: '⭐', title: 'Начислены бонусы', body: '+49 бонусов за заказ K-4832', time: '14:20', color: 'var(--gd)', kind: 'bonus', action: 'bonus' },
  { id: 'demo-3', read: true, icon: '🎉', title: 'Акция дня!', body: 'Скидка 30% на молочное до 22:00', time: '10:00', color: 'var(--gr)', kind: 'promo', action: 'promos' },
]

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(fn => fn())
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(BC_NAME).postMessage({ type: 'refresh' })
    }
  } catch { /* ignore */ }
}

export function subscribeClientNotifications(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function subscribeNotificationChannel(fn: Listener) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = () => fn()
  window.addEventListener('storage', onStorage)
  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel(BC_NAME)
    bc.onmessage = () => fn()
  } catch { /* ignore */ }
  return () => {
    window.removeEventListener('storage', onStorage)
    try { bc?.close() } catch { /* ignore */ }
  }
}

function loadSeenReplies(phone?: string): SeenReplies {
  return loadAccountJson<SeenReplies>(ACCOUNT_NS.reviewRepliesSeen, {}, phone)
}

function saveSeenReplies(seen: SeenReplies, phone?: string) {
  saveAccountJson(ACCOUNT_NS.reviewRepliesSeen, seen, phone)
}

export function getCurrentClientPhone(): string {
  return getActiveClientPhone(loadStoreUser())
}

export function setCurrentClientPhone(phone: string) {
  if (typeof window === 'undefined' || !phone?.trim()) return
  try {
    localStorage.setItem('kakapo_client_phone', phone.trim())
  } catch { /* quota */ }
  emit()
}

function resolveViewerPhone(explicit?: string): string {
  return explicit?.trim() || getCurrentClientPhone()
}

function viewerAccountId(explicitPhone?: string): string {
  return phoneDigits(resolveViewerPhone(explicitPhone))
}

/** Личное уведомление — только с targetPhone, совпадающим с аккаунтом */
export function notificationBelongsToAccount(
  n: ClientNotification,
  accountId?: string,
): boolean {
  if (n.broadcast) return false
  const id = accountId || viewerAccountId()
  const target = phoneDigits(n.targetPhone || '')
  return !!id && !!target && target === id
}

function filterPersonalNotifications(list: ClientNotification[], phone?: string): ClientNotification[] {
  const id = viewerAccountId(phone)
  if (!id) return []
  return list.filter(n => notificationBelongsToAccount(n, id))
}

function sortNotifications(list: ClientNotification[]): ClientNotification[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.sentAt || 0).getTime() || 0
    const tb = new Date(b.sentAt || 0).getTime() || 0
    return tb - ta
  })
}

function notificationFingerprint(n: ClientNotification): string {
  return n.id || `${notificationKind(n)}|${n.orderId || ''}|${n.reviewId ?? ''}|${n.title}|${phoneDigits(n.targetPhone || '')}`
}

function dedupeNotifications(list: ClientNotification[]): ClientNotification[] {
  const byKey = new Map<string, ClientNotification>()
  for (const n of list) {
    const key = notificationFingerprint(n)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, n)
      continue
    }
    byKey.set(key, {
      ...prev,
      ...n,
      read: prev.read && n.read,
    })
  }
  return sortNotifications(Array.from(byKey.values()))
}

function loadAccountNotifications(phone?: string): ClientNotification[] {
  const list = loadAccountJson<ClientNotification[]>(ACCOUNT_NS.notifications, [], phone)
  if (!Array.isArray(list)) return []
  const filtered = filterPersonalNotifications(list, phone)
  if (filtered.length !== list.length) {
    saveAccountJson(ACCOUNT_NS.notifications, filtered, phone)
    emit()
  }
  return filtered
}

function saveAccountNotifications(list: ClientNotification[], phone?: string) {
  saveAccountJson(ACCOUNT_NS.notifications, list.slice(0, 200), phone)
  emit()
}

function loadMergedNotifications(phone?: string): ClientNotification[] {
  const personal = loadAccountNotifications(phone)
  const broadcast = loadBroadcastNotifications<ClientNotification>()
  return dedupeNotifications([...personal, ...broadcast])
}

function mergeNotifications(local: ClientNotification[], remote: ClientNotification[]): ClientNotification[] {
  const byId = new Map<string, ClientNotification>()
  for (const n of local) byId.set(n.id, n)
  for (const n of remote) {
    const prev = byId.get(n.id)
    byId.set(n.id, prev ? { ...n, read: prev.read || n.read } : n)
  }
  return Array.from(byId.values())
}

export function loadClientNotifications(useDemo = false, phone?: string): ClientNotification[] {
  const viewerPhone = resolveViewerPhone(phone)
  const accountId = phoneDigits(viewerPhone)
  if (typeof window === 'undefined') return useDemo && DEMO_PHONES.has(accountId) ? DEMO_NOTIFS : []
  if (!accountId) return []
  const merged = loadMergedNotifications(viewerPhone)
  if (merged.length) return merged
  if (useDemo && DEMO_PHONES.has(accountId)) return DEMO_NOTIFS
  return []
}

let syncInFlight: Promise<ClientNotification[]> | null = null
let lastSyncAt = 0

function splitRemoteNotifications(remote: ClientNotification[], accountId: string) {
  const personal: ClientNotification[] = []
  const broadcast: ClientNotification[] = []
  for (const n of remote) {
    if (n.broadcast) broadcast.push(n)
    else if (notificationBelongsToAccount(n, accountId)) personal.push(n)
  }
  return { personal, broadcast }
}

function mergeBroadcastNotifications(remote: ClientNotification[]) {
  if (!remote.length) return
  const local = loadBroadcastNotifications<ClientNotification>()
  const merged = sortNotifications(mergeNotifications(local, remote))
  saveBroadcastNotifications(merged)
}

export async function syncClientNotificationsFromApi(phone?: string): Promise<ClientNotification[]> {
  const viewerPhone = resolveViewerPhone(phone)
  const accountId = phoneDigits(viewerPhone)
  if (!accountId) return []
  if (!USE_API) return loadClientNotifications(false, viewerPhone)

  const now = Date.now()
  if (syncInFlight && now - lastSyncAt < 2000) return syncInFlight

  syncInFlight = (async () => {
    try {
      const remote = await api.getNotifications(accountId)
      const { personal, broadcast } = splitRemoteNotifications(remote, accountId)
      mergeBroadcastNotifications(broadcast)
      const local = loadAccountNotifications(viewerPhone)
      const merged = dedupeNotifications(mergeNotifications(local, personal))
      saveAccountNotifications(merged, viewerPhone)
      return loadMergedNotifications(viewerPhone)
    } catch {
      return loadClientNotifications(false, viewerPhone)
    } finally {
      lastSyncAt = Date.now()
      syncInFlight = null
    }
  })()

  return syncInFlight
}

async function postNotificationsToApi(items: ClientNotification[]) {
  if (!USE_API || !items.length) return
  await api.deliverNotifications(items)
}

export function getUnreadNotificationCount(useDemo = false, phone?: string): number {
  return loadClientNotifications(useDemo, phone).filter(n => !n.read).length
}

export function markNotificationRead(id: string, phone?: string) {
  const viewerPhone = resolveViewerPhone(phone)
  const account = loadAccountNotifications(viewerPhone)
  if (account.some(n => n.id === id)) {
    saveAccountNotifications(account.map(n => n.id === id ? { ...n, read: true } : n), viewerPhone)
  } else {
    const bc = loadBroadcastNotifications<ClientNotification>()
    if (bc.some(n => n.id === id)) {
      saveBroadcastNotifications(bc.map(n => n.id === id ? { ...n, read: true } : n))
    }
  }
  if (USE_API) api.markNotificationRead(id).catch(console.error)
}

export async function markAllNotificationsRead(phone?: string) {
  const viewerPhone = resolveViewerPhone(phone)
  saveAccountNotifications(
    loadAccountNotifications(viewerPhone).map(n => ({ ...n, read: true })),
    viewerPhone,
  )
  saveBroadcastNotifications(
    loadBroadcastNotifications<ClientNotification>().map(n => ({ ...n, read: true })),
  )
  emit()
  if (USE_API) {
    const queryPhone = phoneDigits(viewerPhone) || viewerPhone
    try {
      await api.markAllNotificationsRead(queryPhone)
    } catch (e) {
      console.error(e)
    }
  }
}

function nowLabel() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function makeNotification(payload: {
  id?: string
  title: string
  body: string
  icon: string
  color?: string
  kind?: ClientNotificationKind
  action?: ClientNotificationAction
  orderId?: string
  reviewId?: number
  targetPhone?: string
  broadcast?: boolean
}): ClientNotification {
  const kind = payload.kind
    || (payload.reviewId != null ? 'review' as const
      : payload.action === 'bonus' ? 'bonus' as const
      : payload.action === 'promos' ? 'promo' as const
      : payload.orderId || payload.action === 'order' || payload.action === 'orders' ? 'order' as const
      : undefined)
  const target = payload.broadcast ? undefined : (payload.targetPhone ? phoneDigits(payload.targetPhone) : undefined)
  const stableId = payload.id
    || (target && payload.orderId && kind === 'order'
      ? `ord-${payload.orderId}-${payload.title.replace(/\s+/g, '-').slice(0, 24).toLowerCase()}`
      : undefined)
  return {
    id: stableId || `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
    icon: payload.icon,
    title: payload.title,
    body: payload.body,
    time: nowLabel(),
    color: payload.color || 'var(--gr)',
    kind,
    action: payload.action,
    orderId: payload.orderId,
    reviewId: payload.reviewId,
    targetPhone: payload.broadcast ? undefined : (payload.targetPhone ? phoneDigits(payload.targetPhone) : undefined),
    sentAt: new Date().toISOString(),
    broadcast: payload.broadcast,
  }
}

export async function deliverClientPush(payload: {
  id?: string
  title: string
  body: string
  icon: string
  color?: string
  kind?: ClientNotificationKind
  action?: ClientNotificationAction
  orderId?: string
  targetPhone?: string
}) {
  const target = phoneDigits(payload.targetPhone || '')
  if (!target) return
  const notif = makeNotification({ ...payload, targetPhone: target })
  const viewerId = viewerAccountId()
  if (USE_API) {
    await postNotificationsToApi([notif])
    if (viewerId !== target) return
  }
  const list = loadAccountJson<ClientNotification[]>(ACCOUNT_NS.notifications, [], target)
  const next = dedupeNotifications(filterPersonalNotifications(Array.isArray(list) ? list : [], target))
  if (next.some(n => n.id === notif.id)) return
  next.unshift(notif)
  saveAccountNotifications(next, target)
}

export async function deliverClientPushBatch(
  phones: string[],
  payload: { title: string; body: string; icon: string; kind?: ClientNotificationKind; action?: ClientNotificationAction; campaignId?: string },
) {
  const unique = [...new Set(phones.map(p => phoneDigits(p)).filter(Boolean))]
  if (!unique.length) return
  const batch = unique.map((phone, i) => makeNotification({
    ...payload,
    id: payload.campaignId ? `${payload.campaignId}-${i}-${phone}` : undefined,
    targetPhone: phone,
  }))
  if (USE_API) {
    await postNotificationsToApi(batch)
  }
  for (let i = 0; i < unique.length; i++) {
    const phone = unique[i]
    const notif = batch[i]
    const list = loadAccountNotifications(phone)
    list.unshift(notif)
    saveAccountNotifications(list, phone)
  }
}

/** Общая рассылка — видят все клиенты */
export async function deliverClientPushBroadcast(
  payload: { title: string; body: string; icon: string; kind?: ClientNotificationKind; action?: ClientNotificationAction; campaignId?: string },
) {
  const notif = makeNotification({ ...payload, broadcast: true, id: payload.campaignId ? `bc-${payload.campaignId}` : undefined })
  if (USE_API) {
    await postNotificationsToApi([notif])
  }
  const list = loadBroadcastNotifications<ClientNotification>()
  const withoutDup = list.filter(n => n.id !== notif.id)
  withoutDup.unshift(notif)
  saveBroadcastNotifications(withoutDup)
}

export function ingestNotificationFromServer(
  notification: ClientNotification,
  viewerPhone?: string,
) {
  const viewerId = viewerAccountId(viewerPhone)
  if (!viewerId) return

  if (notification.broadcast) {
    const list = loadBroadcastNotifications<ClientNotification>()
    if (list.some(n => n.id === notification.id)) return
    list.unshift(notification)
    saveBroadcastNotifications(list)
    emit()
    return
  }

  if (!notificationBelongsToAccount(notification, viewerId)) return

  const list = loadAccountNotifications(viewerPhone)
  if (list.some(n => n.id === notification.id)) return
  if (list.some(n => notificationFingerprint(n) === notificationFingerprint(notification))) return
  list.unshift(notification)
  saveAccountNotifications(list, viewerPhone)
}

/** Создаёт уведомления при новых ответах на отзывы клиента */
export function syncReviewReplyNotifications(reviews: Review[], ownerPhone?: string) {
  const viewerPhone = ownerPhone || getCurrentClientPhone()
  const seen = loadSeenReplies(viewerPhone)
  const notifs = loadAccountNotifications(viewerPhone)
  let changed = false
  const nextSeen = { ...seen }
  const toDeliver: ClientNotification[] = []
  const targetPhone = ownerPhone ? phoneDigits(ownerPhone) : undefined

  for (const r of reviews) {
    const key = String(r.id)
    const prev = nextSeen[key] || {}

    if (r.adminReply && r.adminReply !== prev.admin) {
      const n = makeNotification({
        icon: '💬',
        title: 'Ответ КАКАПО на ваш отзыв',
        body: r.orderId
          ? `${r.restName || 'Ресторан'} · заказ ${r.orderId}: ${r.adminReply.slice(0, 100)}`
          : r.adminReply.slice(0, 120),
        color: 'var(--blue)',
        kind: 'review',
        action: 'review',
        reviewId: r.id,
        orderId: r.orderId,
        targetPhone,
      })
      notifs.unshift(n)
      toDeliver.push(n)
      changed = true
    }

    if (r.restReply && r.restReply !== prev.rest) {
      const n = makeNotification({
        icon: '🍽',
        title: 'Ответ ресторана на ваш отзыв',
        body: r.orderId
          ? `${r.restName || 'Ресторан'} · заказ ${r.orderId}: ${r.restReply.slice(0, 100)}`
          : r.restReply.slice(0, 120),
        color: 'var(--gr)',
        kind: 'review',
        action: 'review',
        reviewId: r.id,
        orderId: r.orderId,
        targetPhone,
      })
      notifs.unshift(n)
      toDeliver.push(n)
      changed = true
    }

    nextSeen[key] = {
      admin: r.adminReply,
      rest: r.restReply,
    }
  }

  if (JSON.stringify(nextSeen) !== JSON.stringify(seen)) {
    saveSeenReplies(nextSeen, viewerPhone)
  }
  if (changed) {
    saveAccountNotifications(notifs, viewerPhone)
    void postNotificationsToApi(toDeliver)
  }

  return loadMergedNotifications(viewerPhone)
}
