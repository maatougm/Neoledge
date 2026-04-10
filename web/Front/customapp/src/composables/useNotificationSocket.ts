/**
 * @file     useNotificationSocket.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Singleton WebSocket composable for real-time notifications via Socket.IO
 */

import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type { Notification } from '@/stores/notificationStore'

// ─── Type guard ───────────────────────────────────────────────────────────────

function isNotification(payload: unknown): payload is Notification {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return (
    typeof p['id'] === 'string' &&
    typeof p['type'] === 'string' &&
    typeof p['title'] === 'string' &&
    typeof p['message'] === 'string' &&
    typeof p['isRead'] === 'boolean'
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

    socket.on('notification', (payload: unknown) => {
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
            summary: String((payload as Record<string, unknown>)['title'] ?? 'Notification'),
            detail: String((payload as Record<string, unknown>)['message'] ?? ''),
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
