import type { Order } from './types'
import {
  PUSH_SEGMENT_LABELS,
  simulateOpenCount,
  type PushAutoEventId,
  type PushCampaign,
  type PushClient,
  type PushSegmentId,
} from './pushCrm'
import { deliverClientPush, deliverClientPushBatch, deliverClientPushBroadcast } from './clientNotifications'
import { usePushStore } from './pushStore'

function campaignId() {
  return `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function autoEnabled(id: PushAutoEventId): boolean {
  if (typeof window === 'undefined') return true
  return usePushStore.getState().isAutoEnabled(id)
}

function pushToPhone(
  phone: string,
  payload: {
    title: string
    body: string
    icon: string
    kind?: import('./clientNotifications').ClientNotificationKind
    action?: import('./clientNotifications').ClientNotificationAction
    orderId?: string
  },
) {
  if (!phone?.trim()) return
  void deliverClientPush({
    ...payload,
    targetPhone: phone,
    color: payload.icon === '🛵' ? 'var(--blue)' : payload.icon === '⭐' ? 'var(--gd)' : 'var(--gr)',
  })
}

export async function sendPushCampaign(params: {
  title: string
  body: string
  segment: PushSegmentId
  recipients: PushClient[]
  icon?: string
}): Promise<PushCampaign> {
  const { title, body, segment, recipients, icon = '🔔' } = params
  const phones = recipients.map(c => c.phone).filter(Boolean)
  const id = campaignId()

  if (segment === 'all') {
    await deliverClientPushBroadcast({ title, body, icon, kind: 'promo', action: 'promos', campaignId: id })
  } else {
    await deliverClientPushBatch(phones, { title, body, icon, kind: 'promo', action: 'promos', campaignId: id })
  }

  const delivered = segment === 'all' ? recipients.length : phones.length
  const opened = simulateOpenCount(delivered)
  const campaign: PushCampaign = {
    id,
    title,
    body,
    segment,
    segmentLabel: PUSH_SEGMENT_LABELS[segment],
    icon,
    recipients: delivered,
    delivered,
    opened,
    sentAt: new Date().toISOString(),
  }
  usePushStore.getState().addCampaign(campaign)
  return campaign
}

export function onOrderStatusChange(prev: Order, next: Order) {
  if (typeof window === 'undefined') return
  const phone = next.client?.phone || ''
  if (!phone) return
  const orderId = String(next.id)
  const courierName = next.courier?.name || 'Курьер'

  const prevStatus = prev.status
  const nextStatus = next.status

  if (autoEnabled('order_accepted')) {
    const wasPending = ['new', 'pending'].includes(prevStatus)
    const isAccepted = !['new', 'pending', 'cancelled'].includes(nextStatus)
    if (wasPending && isAccepted && next.type !== 'restaurant') {
      pushToPhone(phone, {
        title: 'Заказ принят',
        body: `${orderId} принят в работу · КАКАПО ${next.type === 'mixed' ? 'Market' : 'Market'}`,
        icon: '✅',
        kind: 'order',
        action: 'order',
        orderId,
      })
    }
  }

  if (autoEnabled('restaurant_accepted')) {
    const isRest = next.type === 'restaurant' || next.type === 'mixed'
    if (isRest) {
      const prevCooking = prevStatus === 'cooking' || prevStatus === 'ready'
      const nextCooking = nextStatus === 'cooking' || nextStatus === 'ready'
      const prevRestParts = prev.restParts || {}
      const nextRestParts = next.restParts || {}
      const restAccepted = Object.keys(nextRestParts).some(
        rid => nextRestParts[rid] === 'cooking' && prevRestParts[rid] !== 'cooking',
      )
      if ((!prevCooking && nextCooking) || restAccepted || (prevStatus === 'new' && nextStatus === 'cooking')) {
        const restName = next.restName || 'Ресторан'
        pushToPhone(phone, {
          title: 'Ресторан принял заказ',
          body: `${restName} готовит ваш заказ ${orderId}`,
          icon: '🍽',
          kind: 'order',
          action: 'order',
          orderId,
        })
      }
    }
  }

  if (autoEnabled('courier_departed')) {
    const wasNotEnRoute = !['courier_picked', 'delivering'].includes(prevStatus)
    const isEnRoute = ['courier_picked', 'delivering'].includes(nextStatus)
    if (wasNotEnRoute && isEnRoute) {
      pushToPhone(phone, {
        title: 'Курьер выехал',
        body: `${courierName} едет к вам · заказ ${orderId}`,
        icon: '🛵',
        kind: 'order',
        action: 'order',
        orderId,
      })
    }
  }

  if (autoEnabled('order_delivered')) {
    if (prevStatus !== 'delivered' && nextStatus === 'delivered') {
      pushToPhone(phone, {
        title: 'Заказ доставлен',
        body: `${orderId} доставлен. Приятного аппетита!`,
        icon: '📦',
        kind: 'order',
        action: 'order',
        orderId,
      })
    }
  }
}

export function onBonusCredited(phone: string, delta: number, cardNum?: string) {
  if (!autoEnabled('bonus_credited') || delta <= 0 || !phone) return
  pushToPhone(phone, {
    title: 'Начислены бонусы',
    body: `+${delta.toLocaleString()} ⭐${cardNum ? ` · карта ${cardNum}` : ''}`,
    icon: '⭐',
    kind: 'bonus',
    action: 'bonus',
  })
}

export function onRestPartAccepted(order: Order, restName: string) {
  if (!autoEnabled('restaurant_accepted')) return
  const phone = order.client?.phone
  if (!phone) return
  pushToPhone(phone, {
    title: 'Ресторан принял заказ',
    body: `${restName} готовит заказ ${order.id}`,
    icon: '🍽',
    kind: 'order',
    action: 'order',
    orderId: String(order.id),
  })
}
