/** @file src/types/notification.types.ts — Notification type definitions */

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  projectId?: string
  isRead: boolean
  createdAt: string
}
