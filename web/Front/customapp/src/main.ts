/**
 * @file     main.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Application entry point — installs NeoLibrary, Pinia, Router
 */

// Patch global axios defaults before any store / composable imports it.
// We use Bearer JWTs and don't run a CSRF-token-in-cookie scheme; without
// this, axios reads `document.cookie` on every same-origin request which
// Chrome flags as PerformanceIssue:DocumentCookie.
import axios from 'axios'
axios.defaults.withXSRFToken = false
axios.defaults.xsrfCookieName = ''
axios.defaults.xsrfHeaderName = ''

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/authStore'

// ── NeoLibrary design system ─────────────────────────────────────────────────
import PrimeVue from 'primevue/config'
import { NeoLibraryThemePlugin } from '@neolibrary/components'
import '@neolibrary/components/style.css'
import 'primeicons/primeicons.css'

// ── Global styles ─────────────────────────────────────────────────────────────
import './assets/base.css'
import './assets/main.css'

// ── FOUC prevention — apply dark mode tokens before first paint ───────────────
if (localStorage.getItem('darkMode') === 'true') {
  document.documentElement.classList.add('dark', 'p-dark')
}

const app = createApp(App)

// ── Global Vue error handler ──────────────────────────────────────────────────
app.config.errorHandler = (err, _instance, info) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error('[vue:error]', info, err)
  }
}

const pinia = createPinia()
app.use(pinia)
app.use(router)
// PrimeVue must be installed before NeoLibrary because NeoLibrary components
// wrap PrimeVue ones, and App.vue calls usePrimeVue() to override z-index.
app.use(PrimeVue, { ripple: false, unstyled: false })
app.use(NeoLibraryThemePlugin, { theme: 'neoledge' })

// ── Restore persisted JWT once, before any navigation guard runs ──────────────
useAuthStore().init()

app.mount('#app')
