<!--
  @file     EmptyState.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Centered empty state with icon, title, description and optional action button
-->
<template>
  <div class="empty-state" role="status">
    <div class="empty-state__icon-wrap" aria-hidden="true">
      <i :class="['pi', icon, 'empty-state__icon']" />
    </div>

    <h3 class="empty-state__title">{{ title }}</h3>

    <p v-if="description" class="empty-state__description">{{ description }}</p>

    <NeoButton
      v-if="actionLabel"
      :label="actionLabel"
      class="empty-state__action"
      @click="emit('action')"
    />
  </div>
</template>

<script setup lang="ts">
import { NeoButton } from '@neolibrary/components'

interface Props {
  icon?:        string
  title:        string
  description?: string
  actionLabel?: string
}

withDefaults(defineProps<Props>(), {
  icon: 'pi-inbox',
})

const emit = defineEmits<{
  action: []
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-height: 200px;
  padding: 2.5rem 1.5rem;
  text-align: center;
  animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.empty-state__icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--nl-accent) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.empty-state__icon {
  font-size: 1.5rem;
  color: var(--nl-accent);
}

.empty-state__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--nl-text-1);
}

.empty-state__description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.6;
  max-width: 360px;
}

.empty-state__action {
  margin-top: 0.25rem;
}
</style>
