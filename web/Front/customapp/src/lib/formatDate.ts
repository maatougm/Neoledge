/** @file src/lib/formatDate.ts — Shared date/time formatting helpers (FR locale) */

/**
 * Format an ISO date string as a short French date.
 * Returns the string "—" for null/undefined/invalid input so callers don't
 * have to guard every template expression.
 *
 * @example formatDate('2026-04-14') → '14/04/2026'
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

/** Short month-day format for compact UI (e.g. calendars, kanban cards). */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

/** Full date + time (for activity logs, audit trails). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

/** Relative time ("il y a 2h", "dans 3j") — useful for notifications. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = d.getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  const abs = Math.abs(diffMin)
  const prefix = diffMin < 0 ? 'il y a ' : 'dans '
  if (abs < 1) return "à l'instant"
  if (abs < 60) return `${prefix}${abs} min`
  if (abs < 1440) return `${prefix}${Math.round(abs / 60)} h`
  return `${prefix}${Math.round(abs / 1440)} j`
}
