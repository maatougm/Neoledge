<!--
  @file     LoadingOverlay.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Full-screen loading overlay with CSS spinner and optional message
-->
<template>
  <Transition name="overlay">
    <div v-if="visible" class="loading-overlay" role="status" :aria-label="message ?? 'Chargement…'">
      <div class="loading-overlay__content">
        <div class="loading-overlay__spinner" aria-hidden="true">
          <svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray="90 150"
            />
          </svg>
        </div>
        <span v-if="message" class="loading-overlay__message">{{ message }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
interface Props {
  visible:  boolean
  message?: string
}

defineProps<Props>()
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: color-mix(in srgb, var(--nl-bg) 80%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.loading-overlay__spinner {
  width: 44px;
  height: 44px;
  color: var(--nl-accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-overlay__message {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--nl-text-2);
  text-align: center;
}

/* ── Transition ──────────────────────────────────────────────────────────────── */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
</style>
