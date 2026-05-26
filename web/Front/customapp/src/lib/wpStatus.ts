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
