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

// We authenticate with Bearer JWTs (not session cookies) and don't run any
// CSRF-token-in-cookie scheme. Disable every code path in axios that pokes
// at `document.cookie` to silence Chrome's PerformanceIssue:DocumentCookie
// (47 events per page load otherwise) and shave a small amount off each
// request.
//
// We patch BOTH the global axios defaults (so bare `axios.post(...)` calls
// in authStore / useApp also benefit) AND our wrapped instance.
axios.defaults.withXSRFToken = false
axios.defaults.xsrfCookieName = ''
axios.defaults.xsrfHeaderName = ''

const api = axios.create({ withXSRFToken: false })
api.defaults.withXSRFToken = false
api.defaults.xsrfCookieName = ''
api.defaults.xsrfHeaderName = ''
// Default request timeout. Without one, a stuck backend hangs the UI forever.
// AI endpoints (cahier/backlog/assignment) legitimately take 20-90s, so they
// get a longer cap below — but never unbounded.
api.defaults.timeout = 30_000

// Long-running AI generation endpoints — allow up to 3 min before aborting.
const AI_SLOW_ENDPOINT_RE =
  /(cahier-des-charges\/(preview|generate)|ai\/(generate|accept)-backlog|suggest-assignments|\/ai-analyze)/

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

    // Slow AI generation endpoints get a longer timeout than the default.
    if (config.url && AI_SLOW_ENDPOINT_RE.test(config.url)) {
      config.timeout = 180_000
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

// Matches a GET on the canonical project-detail endpoint and nothing deeper:
//   /pm/projects/<uuid>            ← target
//   /pm/projects/<uuid>?foo=bar    ← also target
//   /pm/projects/<uuid>/anything   ← NOT a target (those have their own handlers)
const PROJECT_DETAIL_RE = /\/pm\/projects\/[0-9a-fA-F-]{8,}(?:\/?)(?:\?.*)?$/

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const url: string = error.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/hook/auth')
    const status = error.response?.status
    const method = (error.config?.method ?? '').toLowerCase()

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

    // 404 on `GET /pm/projects/:id` means the project was deleted, archived, or
    // the current user lost access. The browser is sitting on a stale URL
    // (history, bookmark, notification deep-link) and every sub-route call
    // (`/validations`, `/cahier-des-charges/status`, …) is firing concurrently
    // and 404-ing too, spamming the console. Redirect once to the project list
    // and tell the user why — subsequent sub-route requests are aborted by the
    // unmount cascade.
    if (
      status === 404 &&
      method === 'get' &&
      PROJECT_DETAIL_RE.test(url) &&
      shouldToast(error.config)
    ) {
      try {
        const { useNeoToast } = await import('@neolibrary/components')
        useNeoToast().add({
          severity: 'warn',
          detail: 'Projet introuvable ou supprimé — vous avez été redirigé.',
          life: 5000,
        })
      } catch { /* toast provider not mounted */ }
      void import('@/router').then(({ default: router }) => {
        // Don't double-redirect if the user is already off the project route.
        const path = router.currentRoute.value.path
        if (path.startsWith('/app/pm/projects/')) {
          router.replace('/app/pm/projects')
        }
      })
      return Promise.reject(error)
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
