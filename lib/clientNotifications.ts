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

const BC_NAME = 'kakapo-notifs'

const DEMO_PHONES = new Set(['934567890', '901234567', '887890123'])

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

function sortNotifications(list: ClientNotification[]): ClientNotification[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.sentAt || 0).getTime() || 0
    const tb = new Date(b.sentAt || 0).getTime() || 0
    return tb - ta
  })
}

function loadAccountNotifications(phone?: string): ClientNotification[] {
  const list = loadAccountJson<ClientNotification[]>(ACCOUNT_NS.notifications, [], phone)
  return Array.isArray(list) ? list : []
}

function saveAccountNotifications(list: ClientNotification[], phone?: string) {
  saveAccountJson(ACCOUNT_NS.notifications, list.slice(0, 200), phone)
  emit()
}

function loadMergedNotifications(phone?: string): ClientNotification[] {
  const personal = loadAccountNotifications(phone)
  const broadcast = loadBroadcastNotifications<ClientNotification>()
  return sortNotifications([...personal, ...broadcast])
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
  const merged = loadMergedNotifications(viewerPhone)
  if (merged.length) return merged
  if (useDemo && DEMO_PHONES.has(phoneDigits(viewerPhone))) return DEMO_NOTIFS
  return []
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
      const merged = sortNotifications(mergeNotifications(loadAccountNotifications(viewerPhone), remote))
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
  const target = payload.targetPhone || getCurrentClientPhone()
  const list = loadAccountNotifications(target)
  list.unshift(notif)
  saveAccountNotifications(list, target)
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
  payload: { title: string; body: string; icon: string; action?: 'reviews' | 'orders'; campaignId?: string },
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

export function ingestNotificationFromServer(notification: ClientNotification) {
  if (notification.broadcast) {
    const list = loadBroadcastNotifications<ClientNotification>()
    if (list.some(n => n.id === notification.id)) return
    list.unshift(notification)
    saveBroadcastNotifications(list)
    return
  }
  const target = notification.targetPhone || getCurrentClientPhone()
  const list = loadAccountNotifications(target)
  if (list.some(n => n.id === notification.id)) return
  list.unshift(notification)
  saveAccountNotifications(list, target)
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
    saveSeenReplies(nextSeen, viewerPhone)
  }
  if (changed) {
    saveAccountNotifications(notifs, viewerPhone)
    void postNotificationsToApi(toDeliver)
  }

  return loadMergedNotifications(viewerPhone)
}
