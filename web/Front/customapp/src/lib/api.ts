/** @file src/lib/api.ts — Shared axios instance with auth + base-URL interceptors */

import axios from 'axios'
import type { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'

// The stores and router are imported at the TOP level. This is safe because:
//   1. Circular-dep is only a problem when a value is consumed at module
//      evaluation time. Here they are only called inside interceptor callbacks,
//      which run long after all modules have finished evaluating.
//   2. Vite + ESM resolves circular deps correctly — the exported bindings are
//      live references, so by the time any HTTP call triggers an interceptor,
//      all modules are fully initialised.
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'

// ─── Axios instance ───────────────────────────────────────────────────────────

const api = axios.create()

// ─── Request interceptor ──────────────────────────────────────────────────────

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const authStore = useAuthStore()
    const configStore = useConfigStore()

    // Attach Authorization header when a JWT is present
    if (authStore.jwt && config.headers) {
      config.headers['Authorization'] = `Bearer ${authStore.jwt}`
    }

    // Prefix relative URLs with the configured API base URL
    if (config.url && !config.url.startsWith('http')) {
      config.url = configStore.apiUrl + config.url
    }

    return config
  },
  (error: unknown) => Promise.reject(error),
)

// ─── Response interceptor ─────────────────────────────────────────────────────

/**
 * Attach `{ suppressErrorToast: true }` to the axios request config to opt out of
 * the global error toast (e.g. for polling loops, silent fallback probes).
 */
function shouldToast(config: AxiosError['config']): boolean {
  const meta = (config as (AxiosError['config'] & { suppressErrorToast?: boolean }) | undefined)
  return !meta?.suppressErrorToast
}

export function extractErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const e = error as AxiosError
  const data = e.response?.data as { message?: string | string[]; error?: string } | undefined
  if (data?.message) return Array.isArray(data.message) ? data.message.join(', ') : data.message
  if (data?.error) return data.error
  if (e.message) return e.message
  return null
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const url: string = error.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/hook/auth')
    const status = error.response?.status

    if (status === 401 && !isAuthEndpoint) {
      // Clear stale JWT so the next page load doesn't restore it → avoids a 401 loop.
      const authStore = useAuthStore()
      authStore.clear()
      // Import router lazily to break any potential circular dep with router/index.ts
      // which itself imports authStore and configStore.
      import('@/router').then(({ default: router }) => {
        router.push({ name: 'login' })
      })
    }

    // Auto-toast ONLY for 5xx (unexpected server errors). 4xx are expected business
    // responses (validation errors, conflicts, not-found) and the calling component
    // is responsible for displaying them — this prevents the long-standing
    // double-toast bug where both the interceptor and the component fired their own.
    // Components that DO want a generic toast on 4xx can call extractErrorMessage()
    // and toast it themselves; the helper is exported for that purpose.
    if (status && status >= 500 && shouldToast(error.config)) {
      const message = extractErrorMessage(error) ?? `Erreur ${status}`
      try {
        const { useNeoToast } = await import('@neolibrary/components')
        useNeoToast().add({ severity: 'error', detail: message, life: 5000 })
      } catch {
        // Toast provider may not be mounted yet (e.g. during login bootstrap) — swallow.
      }
    }

    return Promise.reject(error)
  },
)

export default api
