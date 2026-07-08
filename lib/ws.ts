// ════════════════════════════════════════════════
// KAKAPO — WebSocket (real-time заказы) с авто-переподключением
// ════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { getToken } from './api'
import { USE_API, getWsUrl } from './config'

export type WSRole = 'client' | 'courier' | 'assembler' | 'restaurant' | 'admin' | 'pos'

export interface WSMessage {
  event: 'new_order' | 'order_update' | 'order_deleted' | 'notification' | 'review_update' | 'loyalty_update' | 'courier_wallet_update' | 'product_update' | 'pos_update'
  order?: any
  notification?: any
  review?: any
  loyalty?: { phone?: string; bonus?: number; card?: string }
  product?: any
  payload?: any
}

export function useWebSocket(
  role: WSRole,
  onMessage: (msg: WSMessage) => void,
  meta?: { phone?: string },
) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  const [connected, setConnected] = useState(false)
  const phoneRef = useRef(meta?.phone)
  phoneRef.current = meta?.phone

  useEffect(() => { onMsgRef.current = onMessage }, [onMessage])

  useEffect(() => {
    if (!USE_API) return
    let stopped = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let attempt = 0

    const connect = () => {
      if (stopped) return
      const token = getToken() || ''
      const phoneDigits = (phoneRef.current || '').replace(/\D/g, '').slice(-9)
      const phoneQuery = role === 'client' && phoneDigits ? `&phone=${encodeURIComponent(phoneDigits)}` : ''
      let ws: WebSocket
      try {
        ws = new WebSocket(`${getWsUrl()}/ws/${role}?token=${token}${phoneQuery}`)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        setConnected(true)
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send('ping') } catch {}
          }
        }, 25000)
      }

      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(e.data) as WSMessage
          onMsgRef.current(msg)
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        if (pingTimer) clearInterval(pingTimer)
        scheduleReconnect()
      }

      ws.onerror = () => { try { ws.close() } catch {} }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      attempt += 1
      const delay = Math.min(2000 * attempt, 15000)
      reconnectTimer = setTimeout(connect, delay)
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (wsRef.current) { try { wsRef.current.close() } catch {} }
    }
  }, [role, meta?.phone])

  return { connected }
}
