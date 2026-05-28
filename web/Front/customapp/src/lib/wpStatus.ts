/**
 * @file src/lib/wpStatus.ts
 * @desc Single source of truth for WP terminal-status checks on the
 *       frontend. Mirrors `web/back-nest/src/work-packages/wp-status.constants.ts`.
 *       Use this everywhere instead of inline `status === 'Closed' || 'Resolved'`
 *       checks so adding a new terminal status (e.g. 'Cancelled') only
 *       requires one edit.
 */

export const TERMINAL_WP_STATUSES = ['Resolved', 'Closed'] as const

export function isTerminal(status: string | null | undefined): boolean {
  if (!status) return false
  return (TERMINAL_WP_STATUSES as readonly string[]).includes(status)
}

/**
 * Statuses a Member (assignee) is allowed to move their own task between:
 * New → InProgress (start) → AwaitingReview (submit for the PM to validate),
 * plus AwaitingReview → InProgress (withdraw). A Member can NOT reach
 * Resolved/Closed — only the project's PM validates/closes. Mirrors the backend
 * `MEMBER_SUBMITTABLE_STATUSES` in
 * `web/back-nest/src/work-packages/wp-status.constants.ts`. Used to keep the
 * Member-facing status pickers from offering "Résolu".
 */
export const MEMBER_SUBMITTABLE_STATUSES = ['New', 'InProgress', 'AwaitingReview'] as const

export function isMemberSubmittable(status: string | null | undefined): boolean {
  if (!status) return false
  return (MEMBER_SUBMITTABLE_STATUSES as readonly string[]).includes(status)
}
