/**
 * @file     lib/wpStatusMap.ts
 * @desc     Single source of truth for work-package status → display label, chip colors, and NeoTag severity.
 *           Consumed by both StatusChip.vue and WpStatusTag.vue (#25).
 */

export interface WpStatusEntry {
  label:      string
  color:      string
  background: string
  severity:   'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
}

const FALLBACK: WpStatusEntry = {
  label:      '',       // caller should use raw status as fallback
  color:      '#6B7280',
  background: '#F4F4F5',
  severity:   'secondary',
}

export const WP_STATUS_MAP: Record<string, WpStatusEntry> = {
  New:            { label: 'Nouveau',                   color: '#6B7280', background: '#F4F4F5', severity: 'secondary' },
  InProgress:     { label: 'En cours',                  color: '#0F62FE', background: '#EFF4FF', severity: 'info'      },
  AwaitingReview: { label: 'En attente de validation',  color: '#D97706', background: '#FFFBEB', severity: 'warn'      },
  Resolved:       { label: 'Résolu',                    color: '#10B981', background: '#ECFDF5', severity: 'success'   },
  Closed:         { label: 'Clôturé',                   color: '#71717A', background: '#F4F4F5', severity: 'success'   },
  OnHold:         { label: 'En pause',                  color: '#F59E0B', background: '#FFFBEB', severity: 'warn'      },
  Blocked:        { label: 'Bloqué',                    color: '#DC2626', background: '#FEF2F2', severity: 'danger'    },
  Rejected:       { label: 'Rejeté',                    color: '#DC2626', background: '#FEF2F2', severity: 'danger'    },
}

export function getWpStatus(status: string): WpStatusEntry {
  return WP_STATUS_MAP[status] ?? { ...FALLBACK, label: status }
}
