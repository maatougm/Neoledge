/**
 * @file     main.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Application entry point — installs NeoLibrary, Pinia, Router
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

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

app.use(createPinia())
app.use(router)
app.use(NeoLibraryThemePlugin, { theme: 'neoledge' })

app.mount('#app')
