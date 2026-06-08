// ════════════════════════════════════════════════
// KAKAPO — WebSocket (real-time заказы)
// ════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { getToken } from './api'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export type WSRole = 'client' | 'courier' | 'assembler' | 'restaurant' | 'admin'

export interface WSMessage {
  event: 'new_order' | 'order_update'
  order: any
}

/**
 * Хук для real-time подключения
 * Использование:
 *   useWebSocket('assembler', (msg) => {
 *     if (msg.event === 'new_order') { ... }
 *   })
 */
export function useWebSocket(role: WSRole, onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const token = getToken() || ''
    const ws = new WebSocket(`${WS_URL}/ws/${role}?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessage(msg)
      } catch {}
    }

    // ping каждые 30 сек чтобы соединение не закрылось
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 30000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [role])

  return { connected }
}
