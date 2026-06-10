// ════════════════════════════════════════════════
// KAKAPO — WebSocket (real-time заказы) с авто-переподключением
// ════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { getToken } from './api'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export type WSRole = 'client' | 'courier' | 'assembler' | 'restaurant' | 'admin'

export interface WSMessage {
  event: 'new_order' | 'order_update'
  order: any
}

export function useWebSocket(role: WSRole, onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  const [connected, setConnected] = useState(false)

  useEffect(() => { onMsgRef.current = onMessage }, [onMessage])

  useEffect(() => {
    let stopped = false
    let reconnectTimer: any = null
    let pingTimer: any = null
    let attempt = 0

    const connect = () => {
      if (stopped) return
      const token = getToken() || ''
      let ws: WebSocket
      try {
        ws = new WebSocket(`${WS_URL}/ws/${role}?token=${token}`)
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
  }, [role])

  return { connected }
}
