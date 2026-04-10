/**
 * @file     useCollaborationSocket.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Singleton WebSocket composable for real-time collaboration via Socket.IO
 */

import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresenceUser {
  userId: string
  name: string
  color: string
  editingFieldId: string | null
}

export interface RemoteFieldChange {
  projectFieldId: string
  value: string
  updatedBy: string
  updatedByName: string
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isPresenceUser(v: unknown): v is PresenceUser {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p['userId'] === 'string' &&
    typeof p['name'] === 'string' &&
    typeof p['color'] === 'string'
  )
}

function isRemoteFieldChange(v: unknown): v is RemoteFieldChange {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p['projectFieldId'] === 'string' &&
    typeof p['value'] === 'string' &&
    typeof p['updatedBy'] === 'string' &&
    typeof p['updatedByName'] === 'string'
  )
}

// ─── Module-level singleton — shared across all component instances ────────────

let socket: Socket | null = null
const connected = ref(false)
const presenceList = ref<PresenceUser[]>([])
const remoteFieldChange = ref<RemoteFieldChange | null>(null)

// ─── Composable ───────────────────────────────────────────────────────────────

export function useCollaborationSocket() {
  function connect(apiUrl: string, token: string): void {
    if (socket?.connected) return

    const base = apiUrl.replace(/\/$/, '')

    try {
      socket = io(`${base}/collaboration`, {
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
        presenceList.value = []
      })

      socket.on('connect_error', (err: Error) => {
        console.warn('[CollaborationSocket] Connection error:', err.message)
      })

      socket.on('presence-update', (payload: unknown) => {
        if (Array.isArray(payload) && payload.every(isPresenceUser)) {
          presenceList.value = [...payload]
        }
      })

      socket.on('field-changed', (payload: unknown) => {
        if (isRemoteFieldChange(payload)) {
          remoteFieldChange.value = { ...payload }
        }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[CollaborationSocket] Failed to initialize socket:', msg)
    }
  }

  function disconnect(): void {
    socket?.disconnect()
    socket = null
    connected.value = false
    presenceList.value = []
    remoteFieldChange.value = null
  }

  function joinProject(projectId: string): void {
    if (!socket?.connected) return
    socket.emit('join-project', projectId)
  }

  function leaveProject(projectId: string): void {
    if (!socket?.connected) return
    socket.emit('leave-project', projectId)
  }

  function sendFieldUpdate(projectId: string, projectFieldId: string, value: string): void {
    if (!socket?.connected) return
    socket.emit('field-update', { projectId, projectFieldId, value })
  }

  function sendFieldFocus(projectId: string, projectFieldId: string): void {
    if (!socket?.connected) return
    socket.emit('field-focus', { projectId, projectFieldId })
  }

  function sendFieldBlur(projectId: string): void {
    if (!socket?.connected) return
    socket.emit('field-blur', { projectId })
  }

  return {
    connect,
    disconnect,
    connected,
    joinProject,
    leaveProject,
    sendFieldUpdate,
    sendFieldFocus,
    sendFieldBlur,
    presenceList,
    remoteFieldChange,
  }
}
