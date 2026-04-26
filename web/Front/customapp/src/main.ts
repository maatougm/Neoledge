/**
 * @file     main.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Application entry point — installs NeoLibrary, Pinia, Router
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/authStore'

// ── NeoLibrary design system ─────────────────────────────────────────────────
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
app.use(NeoLibraryThemePlugin, { theme: 'neoledge' })

// ── Restore persisted JWT once, before any navigation guard runs ──────────────
useAuthStore().init()

app.mount('#app')
