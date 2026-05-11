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
// Remember which token the live socket authenticated with so a re-login as a
// different user forces a fresh handshake (otherwise the previous user's
// room subscription leaks notifications into the new session — CRITICAL).
let connectedToken: string | null = null
const connected = ref(false)
let everConnected = false

// ─── Composable ───────────────────────────────────────────────────────────────

export function useNotificationSocket() {
  function connect(apiUrl: string, token: string): void {
    if (socket?.connected && connectedToken === token) return

    // If a previous socket is still alive but authenticated with a different
    // token (user switched in the same tab), tear it down before opening a
    // fresh one. Otherwise we'd keep delivering the old user's events.
    if (socket && connectedToken !== token) {
      try { socket.disconnect() } catch { /* ignore */ }
      socket = null
      connected.value = false
      everConnected = false
    }

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
    connectedToken = token

    socket.on('connect', () => {
      connected.value = true
      // On every reconnect after the first, backfill anything we missed
      // while disconnected (laptop sleep, transient network) by re-fetching.
      if (everConnected) {
        import('@/stores/notificationStore')
          .then(({ useNotificationStore }) => useNotificationStore().fetchNotifications())
          .catch(() => undefined)
      }
      everConnected = true
    })

    // On reconnect, refresh the auth token from the store before re-handshaking (#27)
    socket.io.on('reconnect_attempt', () => {
      import('@/stores/authStore').then(({ useAuthStore }) => {
        const authStore = useAuthStore()
        if (socket && authStore.jwt) {
          socket.auth = { token: authStore.jwt }
        }
      }).catch(() => undefined)
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
    connectedToken = null
    connected.value = false
    everConnected = false
  }

  /** Update the auth token on the live socket — useful after token refresh (#27) */
  function updateAuth(newToken: string): void {
    if (socket) {
      socket.auth = { token: newToken }
    }
  }

  return { connect, disconnect, connected, updateAuth }
}
