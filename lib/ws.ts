// ════════════════════════════════════════════════
// KAKAPO — WebSocket (real-time заказы) с авто-переподключением
// ONLINE-O10: auth via Sec-WebSocket-Protocol (not query string).
// ════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { getToken } from './api'
import { USE_API, getWsUrl } from './config'

export type WSRole = 'client' | 'courier' | 'assembler' | 'restaurant' | 'admin' | 'pos'

export interface WSMessage {
  event: 'new_order' | 'order_update' | 'order_deleted' | 'restaurant_deleted' | 'notification' | 'review_update' | 'loyalty_update' | 'courier_wallet_update' | 'product_update' | 'restaurant_update' | 'pos_update' | 'category_update'
  order?: any
  notification?: any
  review?: any
  loyalty?: { phone?: string; bonus?: number; card?: string }
  product?: any
  restaurant?: any
  category?: any
  payload?: any
}

const PING_MS = 25_000
/** Нет ни одного сообщения (включая pong) дольше — соединение считаем мёртвым */
const DEAD_MS = 60_000

/** Последнее сообщение от сервера по роли; 0 — сокет закрыт */
const lastSeenByRole = new Map<WSRole, number>()

/** WS открыт и сервер отвечал за последние 60 с — опросы можно делать реже */
export function isWsLive(role: WSRole): boolean {
  const at = lastSeenByRole.get(role) || 0
  return at > 0 && Date.now() - at < DEAD_MS
}

export function useWebSocket(
  role: WSRole,
  onMessage: (msg: WSMessage) => void,
  meta?: { phone?: string },
  onReconnect?: () => void,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  const onReconnectRef = useRef(onReconnect)
  const [connected, setConnected] = useState(false)
  const phoneRef = useRef(meta?.phone)
  phoneRef.current = meta?.phone

  useEffect(() => { onMsgRef.current = onMessage }, [onMessage])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  useEffect(() => {
    if (!USE_API) return
    let stopped = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let tokenWatch: ReturnType<typeof setInterval> | null = null
    let attempt = 0
    let lastToken = ''
    let openedBefore = false

    const clearTokenWatch = () => {
      if (tokenWatch) clearInterval(tokenWatch)
      tokenWatch = null
    }

    const connect = () => {
      if (stopped) return
      clearTokenWatch()
      const token = getToken() || ''
      lastToken = token
      const phoneDigits = (phoneRef.current || '').replace(/\D/g, '').slice(-9)
      // phone only — never put Bearer token in the URL (proxy/access logs)
      const phoneQuery = role === 'client' && phoneDigits ? `?phone=${encodeURIComponent(phoneDigits)}` : ''
      const protocols = token ? ['kakapo', token] : ['kakapo']
      let ws: WebSocket
      try {
        ws = new WebSocket(`${getWsUrl()}/ws/${role}${phoneQuery}`, protocols)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws
      let lastSeen = 0

      ws.onopen = () => {
        attempt = 0
        lastSeen = Date.now()
        lastSeenByRole.set(role, lastSeen)
        setConnected(true)
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          // Скрытая вкладка: таймеры браузер душит, pong может «опоздать» без обрыва
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          if (!hidden && Date.now() - lastSeen > DEAD_MS) {
            try { ws.close() } catch {}
            return
          }
          try { ws.send('ping') } catch {}
        }, PING_MS)
        // Пока сокета не было, события могли пройти мимо — догоняем одной дельтой
        if (openedBefore) {
          try { onReconnectRef.current?.() } catch {}
        }
        openedBefore = true
      }

      ws.onmessage = (e) => {
        lastSeen = Date.now()
        lastSeenByRole.set(role, lastSeen)
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(e.data) as WSMessage
          onMsgRef.current(msg)
        } catch {}
      }

      ws.onclose = () => {
        if (wsRef.current === ws) lastSeenByRole.set(role, 0)
        setConnected(false)
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = null
        scheduleReconnect()
      }

      ws.onerror = () => { try { ws.close() } catch {} }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      attempt += 1
      // Первые попытки быстро (обрыв сети), дальше до 2 мин — отказ по авторизации не долбит сервер
      const delay = attempt <= 3
        ? Math.min(2000 * attempt, 15000)
        : Math.min(15000 * 2 ** (attempt - 3), 120000)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, delay)
      // Новый токен (вход сотрудника) — не ждём паузу
      clearTokenWatch()
      tokenWatch = setInterval(() => {
        if ((getToken() || '') === lastToken) return
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = null
        attempt = 0
        connect()
      }, 3000)
    }

    connect()

    return () => {
      stopped = true
      lastSeenByRole.set(role, 0)
      clearTokenWatch()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (wsRef.current) { try { wsRef.current.close() } catch {} }
    }
  }, [role, meta?.phone])

  return { connected }
}
