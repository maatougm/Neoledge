/**
 * @file     notificationStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for notifications — immutable state updates, polling
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  projectId: string | null
  isRead: boolean
  createdAt: string
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useNotificationStore = defineStore('notifications', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const notifications = ref<Notification[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  let pollingTimer: ReturnType<typeof setInterval> | null = null

  // ── Getters ────────────────────────────────────────────────────────────────
  const unreadCount = computed(() => notifications.value.filter((n) => !n.isRead).length)

  // ── Helpers ────────────────────────────────────────────────────────────────
  const apiBase = () => useApp().apiUrl + '/notifications'
  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  const fetchNotifications = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<Notification[]>(apiBase(), { headers: authHeader() })
      notifications.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des notifications.'
    } finally {
      loading.value = false
    }
  }

  const fetchUnreadCount = async (): Promise<void> => {
    try {
      const { data } = await axios.get<{ count: number }>(`${apiBase()}/unread-count`, {
        headers: authHeader(),
      })
      // Sync read status: if server count is lower, refresh the full list
      if (data.count !== unreadCount.value) {
        await fetchNotifications()
      }
    } catch {
      // Silent — polling should not surface errors to the user
    }
  }

  const markAsRead = async (id: string): Promise<void> => {
    try {
      await axios.patch(`${apiBase()}/${id}/read`, null, { headers: authHeader() })
      notifications.value = notifications.value.map((n) =>
        n.id === id ? { ...n, isRead: true } : n,
      )
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
    }
  }

  const markAllAsRead = async (): Promise<void> => {
    try {
      await axios.patch(`${apiBase()}/read-all`, null, { headers: authHeader() })
      notifications.value = notifications.value.map((n) => ({ ...n, isRead: true }))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
    }
  }

  const removeNotification = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${apiBase()}/${id}`, { headers: authHeader() })
      notifications.value = notifications.value.filter((n) => n.id !== id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression.'
    }
  }

  const addNotification = (notification: Notification): void => {
    notifications.value = [notification, ...notifications.value]
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  const POLL_INTERVAL_MS = 30_000

  const startPolling = (): void => {
    if (pollingTimer !== null) return
    fetchNotifications()
    pollingTimer = setInterval(() => {
      fetchUnreadCount()
    }, POLL_INTERVAL_MS)
  }

  const stopPolling = (): void => {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  return {
    notifications,
    loading,
    error,
    unreadCount,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    addNotification,
    startPolling,
    stopPolling,
  }
})
