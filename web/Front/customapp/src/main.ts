/**
 * @file     main.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Application entry point — installs NeoLibrary, PrimeVue, Pinia, Router
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// ── NeoLibrary design system ─────────────────────────────────────────────────
import { NeoLibraryThemePlugin } from '@neolibrary/components'
import '@neolibrary/components/style.css'
import 'primeicons/primeicons.css'

// Restore dark mode preference before first render (both our tokens + PrimeVue)
if (localStorage.getItem('darkMode') === 'true') {
  document.documentElement.classList.add('dark', 'p-dark')
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(NeoLibraryThemePlugin)

app.mount('#app')
