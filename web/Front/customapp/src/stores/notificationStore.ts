/**
 * @file src/stores/notificationStore.ts — Pinia store for notifications — immutable state updates, polling
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { Notification, NotificationListResponse } from '@/types/notification.types'

// Re-export for consumers that import from this module directly
export type { Notification }

// ─── Store ────────────────────────────────────────────────────────────────────

export const useNotificationStore = defineStore('notifications', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const notifications = ref<Notification[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let pollingTimer: ReturnType<typeof setInterval> | null = null

  // ── Getters ────────────────────────────────────────────────────────────────
  const unreadCount = computed(() => notifications.value.filter((n) => !n.isRead).length)

  // ── Actions ────────────────────────────────────────────────────────────────

  const fetchNotifications = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<NotificationListResponse>('/notifications')
      // Defensive: API contract is { items, nextCursor } but never crash the
      // bell on a malformed response (network blip, proxy weirdness, etc).
      notifications.value = Array.isArray(data?.items) ? [...data.items] : []
      nextCursor.value = data?.nextCursor ?? null
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du chargement des notifications.'
    } finally {
      loading.value = false
    }
  }

  const fetchUnreadCount = async (): Promise<void> => {
    try {
      const { data } = await api.get<{ count: number }>('/notifications/unread-count')
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
      await api.patch(`/notifications/${id}/read`, null)
      notifications.value = notifications.value.map((n) =>
        n.id === id ? { ...n, isRead: true } : n,
      )
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
    }
  }

  const markAllAsRead = async (): Promise<void> => {
    try {
      await api.patch('/notifications/read-all', null)
      notifications.value = notifications.value.map((n) => ({ ...n, isRead: true }))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
    }
  }

  const removeNotification = async (id: string): Promise<void> => {
    try {
      await api.delete(`/notifications/${id}`)
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

  // ── Logout reset ───────────────────────────────────────────────────────────

  /** Tear down polling + wipe per-user state. Called on logout. */
  const reset = (): void => {
    stopPolling()
    notifications.value = []
    nextCursor.value = null
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    notifications,
    nextCursor,
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
    reset,
  }
})
