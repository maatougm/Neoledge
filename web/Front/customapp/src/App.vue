<template>
  <router-view />
</template>

<script setup lang="ts">
import { usePrimeVue } from 'primevue/config'

// Raise PrimeVue's dynamic z-index base so teleported overlays (Select dropdowns,
// DatePicker panels, etc.) always render above AppModal (9600) and the sidebar (100).
const pv = usePrimeVue()
pv.config.zIndex = {
  modal:   9600,
  overlay: 10000,
  menu:    10000,
  tooltip: 10010,
}
</script>

<style>
/* All global styles live in assets/base.css and assets/main.css */
</style>
