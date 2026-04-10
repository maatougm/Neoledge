<!--
  @file     PageHeader.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Page-level header with title, description, icon and an actions slot
-->
<template>
  <header class="page-header">
    <div class="page-header__left">
      <div v-if="icon" class="page-header__icon-wrap" aria-hidden="true">
        <i :class="['pi', icon, 'page-header__icon']" />
      </div>
      <div class="page-header__text">
        <h1 class="page-header__title">{{ title }}</h1>
        <p v-if="description" class="page-header__description">{{ description }}</p>
      </div>
    </div>

    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
interface Props {
  title:        string
  description?: string
  icon?:        string
}

defineProps<Props>()
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--nl-border);
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

.page-header__icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: var(--nl-radius);
  background: color-mix(in srgb, var(--nl-accent) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.page-header__icon {
  font-size: 1.125rem;
  color: var(--nl-accent);
}

.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.page-header__title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--nl-text-1);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header__description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.4;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}
</style>
