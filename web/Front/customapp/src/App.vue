<template>
  <router-view />
</template>

<script setup lang="ts">
// Global error boundary and toast are handled per-layout (AppShell injects NeoToast).
// Dark mode class sync is handled by useDarkMode singleton (applied at module load in main.ts).
</script>

<style>
/* All global styles live in assets/base.css and assets/main.css */
</style>
