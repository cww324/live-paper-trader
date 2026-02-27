import { useEffect, useRef, useCallback } from 'react'
import type { WSEvent } from '../types'

type Handler = (event: WSEvent) => void

export function useWebSocket(onMessage: Handler): void {
  const handlerRef = useRef<Handler>(onMessage)
  handlerRef.current = onMessage

  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(1000)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      backoffRef.current = 1000
    }

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data)
        handlerRef.current(event)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setTimeout(connect, backoffRef.current)
      backoffRef.current = Math.min(backoffRef.current * 2, 30000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      wsRef.current?.close()
    }
  }, [connect])
}
