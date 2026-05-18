/** @file src/types/notification.types.ts — Notification type definitions */

export type NotificationReason =
  | 'Mention'
  | 'Assignee'
  | 'Watcher'
  | 'Deadline'
  | 'StatusChange'
  | 'Comment'
  | 'System'
  // Domain-specific reasons used by cahier/project flows
  | 'cahier_generated'
  | 'cahier_approved'
  | 'cahier_rejected'
  | 'cahier_validated'
  | 'AwaitingReview'

export type NotificationEntityType =
  | 'work_package'
  | 'project'
  | 'meeting'
  | 'comment'
  | 'version'
  | 'Project'

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  projectId?: string | null
  isRead: boolean
  createdAt: string
  /** Internal route to deep-link to (e.g. `/app/team/my-tasks?projectId=...`). */
  link?: string | null
  /** Why the notification was generated (Mention, Assignee, …). */
  reason?: NotificationReason | string | null
  /** Backing entity, when applicable. */
  entityType?: NotificationEntityType | string | null
  entityId?: string | null
  /** User who triggered the notification (null for system events). */
  actorId?: string | null
}

/** Cursor-paginated response shape returned by `GET /notifications`. */
export interface NotificationListResponse {
  items: Notification[]
  nextCursor: string | null
}
