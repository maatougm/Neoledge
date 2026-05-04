<!--
  @file     PageHeader.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Page-level header with title, subtitle and right-aligned actions slot
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
  padding-bottom: 16px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--nl-border);
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.page-header__icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: var(--nl-radius, 8px);
  background: color-mix(in srgb, var(--nl-accent) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.page-header__icon {
  font-size: 1rem;
  color: var(--nl-accent);
}

.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.page-header__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--nl-text-1);
  line-height: 1.2;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header__description {
  margin: 0;
  font-size: 13px;
  color: var(--nl-text-3);
  line-height: 1.4;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
