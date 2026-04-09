/**
 * @file     useNotificationSocket.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Singleton WebSocket composable for real-time notifications via Socket.IO
 */

import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type { Notification } from '@/stores/notificationStore'

// ─── Type guard ───────────────────────────────────────────────────────────────

function isNotification(payload: Record<string, unknown>): payload is Notification {
  return (
    typeof payload['id'] === 'string' &&
    typeof payload['type'] === 'string' &&
    typeof payload['title'] === 'string' &&
    typeof payload['message'] === 'string' &&
    typeof payload['isRead'] === 'boolean'
  )
}

// ─── Module-level singleton — shared across all component instances ────────────

let socket: Socket | null = null
const connected = ref(false)

// ─── Composable ───────────────────────────────────────────────────────────────

export function useNotificationSocket() {
  function connect(apiUrl: string, token: string): void {
    if (socket?.connected) return

    // Strip trailing slash, build WS namespace URL
    const base = apiUrl.replace(/\/$/, '')

    socket = io(`${base}/notifications`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30_000,
    })

    socket.on('connect', () => {
      connected.value = true
    })

    socket.on('disconnect', () => {
      connected.value = false
    })

    socket.on('notification', (payload: Record<string, unknown>) => {
      // Lazy import to avoid circular dependency at module init time
      import('@/stores/notificationStore')
        .then(({ useNotificationStore }) => {
          const store = useNotificationStore()
          if (isNotification(payload)) {
            store.addNotification(payload)
          }
        })
        .catch(() => undefined)

      // Show toast popup
      import('@neolibrary/components')
        .then(({ useNeoToast }) => {
          const toast = useNeoToast()
          toast.add({
            severity: 'info',
            summary: String(payload['title'] ?? 'Notification'),
            detail: String(payload['message'] ?? ''),
            life: 5000,
          })
        })
        .catch(() => undefined)
    })
  }

  function disconnect(): void {
    socket?.disconnect()
    socket = null
    connected.value = false
  }

  return { connect, disconnect, connected }
}
