/**
 * @file     useDarkMode.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Composable for toggling dark mode — persists preference in localStorage
 */

import { ref, watch } from 'vue'

const isDark = ref(localStorage.getItem('darkMode') === 'true')

watch(isDark, (val) => {
  document.documentElement.classList.toggle('dark', val)
  localStorage.setItem('darkMode', String(val))
})

export function useDarkMode() {
  const toggle = () => {
    isDark.value = !isDark.value
  }
  return { isDark, toggle }
}
