/** @file src/stores/configStore.ts — Pinia store for runtime configuration (API URL, Elise URL) */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

// ─── Store ────────────────────────────────────────────────────────────────────

export const useConfigStore = defineStore('config', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const apiUrl = ref<string>('')
  const eliseUrl = ref<string>('')

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Loads config.json from the public folder and populates apiUrl / eliseUrl.
   * Returns early (no-op) if apiUrl has already been populated.
   */
  const fetchConfig = async (): Promise<void> => {
    if (apiUrl.value) return

    const { data } = await axios.get<{ GLB_API_URL: string; GLB_ELISE_URL: string }>(
      import.meta.env.BASE_URL + 'config.json?_=' + Date.now(),
    )

    // Fall back to the current origin when GLB_API_URL is empty — prod
    // serves backend + frontend behind the same domain (Caddy + nginx),
    // so window.location.origin is the correct base for both axios calls
    // and Socket.IO. Without this fallback, useNotificationSocket() never
    // calls connect() because configStore.apiUrl stays falsy.
    const raw = (data.GLB_API_URL as string) || ''
    apiUrl.value = (raw || window.location.origin).replace(/\/+$/, '')
    eliseUrl.value = data.GLB_ELISE_URL ?? ''
  }

  return {
    apiUrl,
    eliseUrl,
    fetchConfig,
  }
})
