import type { Review } from './types'
import { getActiveClientPhone, loadStoreUser, phoneDigits } from './clientSession'
import { USE_API } from './config'
import { api } from './api'

export type ClientNotification = {
  id: string
  read: boolean
  icon: string
  title: string
  body: string
  time: string
  color: string
  action?: 'reviews' | 'orders'
  reviewId?: number
  orderId?: string
  targetPhone?: string
  sentAt?: string
  broadcast?: boolean
}

const NOTIFS_KEY = 'kakapo_client_notifs'
const REPLIES_SEEN_KEY = 'kakapo_review_replies_seen'
const BC_NAME = 'kakapo-notifs'

type SeenReplies = Record<string, { admin?: string; rest?: string }>

const DEMO_NOTIFS: ClientNotification[] = [
  { id: 'demo-1', read: false, icon: '🛵', title: 'Курьер выехал', body: 'Фирдавс едет к вам · ~12 мин', time: '14:23', color: 'var(--blue)' },
  { id: 'demo-2', read: false, icon: '⭐', title: 'Начислены бонусы', body: '+49 бонусов за заказ K-4832', time: '14:20', color: 'var(--gd)' },
  { id: 'demo-3', read: true, icon: '🎉', title: 'Акция дня!', body: 'Скидка 30% на молочное до 22:00', time: '10:00', color: 'var(--gr)' },
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
  const onStorage = (e: StorageEvent) => {
    if (e.key === NOTIFS_KEY) fn()
  }
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

function loadSeenReplies(): SeenReplies {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(REPLIES_SEEN_KEY)
    return raw ? JSON.parse(raw) as SeenReplies : {}
  } catch {
    return {}
  }
}

function saveSeenReplies(seen: SeenReplies) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(REPLIES_SEEN_KEY, JSON.stringify(seen)) } catch { /* quota */ }
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

function sortNotifications(list: ClientNotification[]): ClientNotification[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.sentAt || 0).getTime() || 0
    const tb = new Date(b.sentAt || 0).getTime() || 0
    return tb - ta
  })
}

function notificationVisible(n: ClientNotification, viewerPhone: string): boolean {
  if (n.broadcast || !n.targetPhone) return true
  const viewer = phoneDigits(viewerPhone)
  if (!viewer) return false
  return phoneDigits(n.targetPhone) === viewer
}

function filterForViewer(list: ClientNotification[], viewerPhone: string): ClientNotification[] {
  return list.filter(n => notificationVisible(n, viewerPhone))
}

function loadAllNotifications(): ClientNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(NOTIFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ClientNotification[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return []
}

function saveClientNotifications(list: ClientNotification[]) {
  if (typeof window === 'undefined') return
  const trimmed = list.slice(0, 200)
  try {
    const prev = loadAllNotifications()
    if (JSON.stringify(prev) === JSON.stringify(trimmed)) return
    localStorage.setItem(NOTIFS_KEY, JSON.stringify(trimmed))
  } catch { /* quota */ }
  emit()
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
  if (typeof window === 'undefined') return useDemo ? DEMO_NOTIFS : []
  const all = loadAllNotifications()
  if (all.length) return filterForViewer(all, viewerPhone)
  return useDemo ? filterForViewer(DEMO_NOTIFS, viewerPhone) : []
}

let syncInFlight: Promise<ClientNotification[]> | null = null
let lastSyncAt = 0

export async function syncClientNotificationsFromApi(phone?: string): Promise<ClientNotification[]> {
  const viewerPhone = resolveViewerPhone(phone)
  const queryPhone = phoneDigits(viewerPhone) || viewerPhone
  if (!USE_API) return loadClientNotifications(false, viewerPhone)

  const now = Date.now()
  if (syncInFlight && now - lastSyncAt < 2000) return syncInFlight

  syncInFlight = (async () => {
    try {
      const remote = await api.getNotifications(queryPhone || viewerPhone)
      const merged = sortNotifications(mergeNotifications(loadAllNotifications(), remote))
      saveClientNotifications(merged)
      return filterForViewer(merged, viewerPhone)
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

export function markNotificationRead(id: string) {
  const list = loadAllNotifications().map(n => n.id === id ? { ...n, read: true } : n)
  saveClientNotifications(list)
  if (USE_API) api.markNotificationRead(id).catch(console.error)
}

export async function markAllNotificationsRead(phone?: string) {
  const viewerPhone = resolveViewerPhone(phone)
  const list = loadAllNotifications().map(n => {
    if (!viewerPhone || notificationVisible(n, viewerPhone)) return { ...n, read: true }
    return n
  })
  saveClientNotifications(list)
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
  action?: 'reviews' | 'orders'
  orderId?: string
  reviewId?: number
  targetPhone?: string
  broadcast?: boolean
}): ClientNotification {
  return {
    id: payload.id || `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
    icon: payload.icon,
    title: payload.title,
    body: payload.body,
    time: nowLabel(),
    color: payload.color || 'var(--gr)',
    action: payload.action,
    orderId: payload.orderId,
    reviewId: payload.reviewId,
    targetPhone: payload.broadcast ? undefined : (payload.targetPhone ? phoneDigits(payload.targetPhone) : undefined),
    sentAt: new Date().toISOString(),
    broadcast: payload.broadcast,
  }
}

export async function deliverClientPush(payload: {
  title: string
  body: string
  icon: string
  color?: string
  action?: 'reviews' | 'orders'
  orderId?: string
  targetPhone?: string
}) {
  const notif = makeNotification(payload)
  if (USE_API) {
    await postNotificationsToApi([notif])
  }
  const list = loadAllNotifications()
  list.unshift(notif)
  saveClientNotifications(list)
}

export async function deliverClientPushBatch(
  phones: string[],
  payload: { title: string; body: string; icon: string; action?: 'reviews' | 'orders'; campaignId?: string },
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
  const list = loadAllNotifications()
  list.unshift(...batch)
  saveClientNotifications(list)
}

/** Общая рассылка — видят все, кто открыл приложение (без привязки к телефону) */
export async function deliverClientPushBroadcast(
  payload: { title: string; body: string; icon: string; action?: 'reviews' | 'orders'; campaignId?: string },
) {
  const notif = makeNotification({ ...payload, broadcast: true, id: payload.campaignId ? `bc-${payload.campaignId}` : undefined })
  if (USE_API) {
    await postNotificationsToApi([notif])
  }
  const list = loadAllNotifications()
  const withoutDup = list.filter(n => n.id !== notif.id)
  withoutDup.unshift(notif)
  saveClientNotifications(withoutDup)
}

export function ingestNotificationFromServer(notification: ClientNotification) {
  const list = loadAllNotifications()
  if (list.some(n => n.id === notification.id)) return
  list.unshift(notification)
  saveClientNotifications(list)
}

/** Создаёт уведомления при новых ответах на отзывы клиента */
export function syncReviewReplyNotifications(reviews: Review[], ownerPhone?: string) {
  const seen = loadSeenReplies()
  const notifs = loadAllNotifications()
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
        title: 'Ответ KAKAPO на ваш отзыв',
        body: r.orderId
          ? `${r.restName || 'Ресторан'} · заказ ${r.orderId}: ${r.adminReply.slice(0, 100)}`
          : r.adminReply.slice(0, 120),
        color: 'var(--blue)',
        action: 'reviews',
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
        action: 'reviews',
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
    saveSeenReplies(nextSeen)
  }
  if (changed) {
    saveClientNotifications(notifs)
    void postNotificationsToApi(toDeliver)
  }

  return notifs
}
