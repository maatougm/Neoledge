<!--
  @file     EmptyState.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Centered empty state with icon, title, description and optional CTA button
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
  gap: 12px;
  min-height: 200px;
  padding: 48px 24px;
  text-align: center;
  animation: fadeInUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.empty-state__icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--nl-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.empty-state__icon {
  font-size: 20px;
  color: var(--nl-text-3);
}

.empty-state__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--nl-text-2);
  line-height: 1.3;
}

.empty-state__description {
  margin: 0;
  font-size: 13px;
  color: var(--nl-text-3);
  line-height: 1.6;
  max-width: 320px;
}

.empty-state__action {
  margin-top: 4px;
}
</style>
