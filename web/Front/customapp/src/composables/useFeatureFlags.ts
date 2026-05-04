/** @file src/composables/useFeatureFlags.ts — Per-user feature toggle read from AppUser.preferences JSON */

import { ref, computed, onUnmounted } from 'vue'

export interface FeatureFlags {
  showGantt: boolean
  showBudget: boolean
  showTeamPlanner: boolean
  showAudit: boolean
}

const DEFAULTS: FeatureFlags = {
  showGantt: true,
  showBudget: true,
  showTeamPlanner: true,
  showAudit: true,
}

/**
 * Read feature flags from the current user's preferences stored in localStorage.
 * The preferences JSON is populated by the profile page / admin settings.
 */
function readPrefs(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem('user_preferences')
    if (!raw) return {}
    return JSON.parse(raw) as Partial<FeatureFlags>
  } catch {
    return {}
  }
}

// Module-level reactive source so the flags update when another tab writes
// to localStorage via the `storage` event (#32)
const _prefsVersion = ref(0)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'user_preferences') _prefsVersion.value++
  })
}

export function useFeatureFlags() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const flags = computed<FeatureFlags>(() => {
    void _prefsVersion.value // subscribe to reactive source
    return { ...DEFAULTS, ...readPrefs() }
  })

  function isEnabled(key: keyof FeatureFlags): boolean {
    return flags.value[key]
  }

  return { flags, isEnabled }
}
