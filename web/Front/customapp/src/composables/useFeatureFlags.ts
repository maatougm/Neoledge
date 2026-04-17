/** @file src/composables/useFeatureFlags.ts — Per-user feature toggle read from AppUser.preferences JSON */

import { computed } from 'vue'

export interface FeatureFlags {
  showGantt: boolean
  showBudget: boolean
  showWiki: boolean
  showPortfolio: boolean
  showTeamPlanner: boolean
  showAudit: boolean
}

const DEFAULTS: FeatureFlags = {
  showGantt: true,
  showBudget: true,
  showWiki: true,
  showPortfolio: true,
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

export function useFeatureFlags() {
  const flags = computed<FeatureFlags>(() => ({ ...DEFAULTS, ...readPrefs() }))

  function isEnabled(key: keyof FeatureFlags): boolean {
    return flags.value[key]
  }

  return { flags, isEnabled }
}
