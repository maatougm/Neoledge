/**
 * @file     useDarkMode.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Composable for toggling dark mode — localStorage is source of truth on init
 *           (prevents FOUC), backend is async sync for cross-device persistence.
 */

import { ref } from 'vue'
import axios from 'axios'

// Module-level singleton so all consumers share the same reactive state
const isDark = ref(localStorage.getItem('darkMode') === 'true')

// Apply class immediately on module load — before any Vue component mounts
document.documentElement.classList.toggle('dark', isDark.value)

// Internal references set once loadFromBackend is called
let _token = ''
let _apiBase = ''

function applyDark(value: boolean): void {
  isDark.value = value
  localStorage.setItem('darkMode', String(value))
  // .dark    → our CSS custom-property tokens (base.css)
  // .p-dark  → NeoLibrary/PrimeVue dark-mode selector
  document.documentElement.classList.toggle('dark', value)
  document.documentElement.classList.toggle('p-dark', value)
}

async function savePreference(): Promise<void> {
  if (!_token || !_apiBase) return
  try {
    await axios.put(
      `${_apiBase}/api/userprofile/preferences`,
      { darkMode: isDark.value },
      { headers: { Authorization: `Bearer ${_token}` } },
    )
  } catch {
    // Fire-and-forget — silently ignore network errors
  }
}

export function useDarkMode() {
  function toggle(): void {
    applyDark(!isDark.value)
    // Intentionally not awaited — fire and forget
    void savePreference()
  }

  async function loadFromBackend(token: string, apiBase: string): Promise<void> {
    _token   = token
    _apiBase = apiBase
    try {
      const { data } = await axios.get<{ darkMode?: boolean }>(
        `${apiBase}/api/userprofile/preferences`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (typeof data.darkMode === 'boolean') {
        applyDark(data.darkMode)
      }
    } catch {
      // Backend unavailable — localStorage value already applied, no-op
    }
  }

  return { isDark, toggle, loadFromBackend }
}
