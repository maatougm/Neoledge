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

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const url: string = error.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/hook/auth')

    if (error.response?.status === 401 && !isAuthEndpoint) {
      // Import router lazily to break any potential circular dep with router/index.ts
      // which itself imports authStore and configStore.
      import('@/router').then(({ default: router }) => {
        router.push({ name: 'login' })
      })
    }

    return Promise.reject(error)
  },
)

export default api
