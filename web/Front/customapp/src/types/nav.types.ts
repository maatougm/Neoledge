/** @file src/types/nav.types.ts — Navigation type definitions for the layout system */

import type { ComputedRef } from 'vue'

// ─── NavItem ──────────────────────────────────────────────────────────────────

export interface NavItem {
  /** Unique key for keyed rendering */
  key: string
  /** Display label shown in expanded state */
  label: string
  /** PrimeIcon class name, e.g. 'pi-home' */
  icon: string
  /** Router path the item links to */
  to: string
  /** Optional numeric badge (unread count, totals, etc.) — reactive ComputedRef supported */
  badge?: number | ComputedRef<number>
  /** When present, only users with a matching role will see this item */
  roles?: string[]
}

// ─── NavSection ───────────────────────────────────────────────────────────────

export interface NavSection {
  /** Optional uppercase section heading shown in expanded mode */
  heading?: string
  /** The nav items in this section */
  items: NavItem[]
}
