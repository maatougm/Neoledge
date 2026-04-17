<!-- @file src/components/common/ModulePageHeader.vue — Page title + status + action bar -->
<template>
  <div class="module-header">
    <div class="module-header__left">
      <h1 class="module-header__title">{{ title }}</h1>
      <NeoTag v-if="status" :value="status" :severity="statusSeverity" />
    </div>
    <div class="module-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { NeoTag } from '@neolibrary/components'

defineProps<{
  title: string
  status?: string
  statusSeverity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
}>()
</script>

<style scoped>
.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: var(--nl-card-bg, #ffffff);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.module-header__title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--nl-text, #111827);
  margin: 0;
}
.module-header__left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.module-header__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
