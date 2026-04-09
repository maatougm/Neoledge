<template>
  <div v-if="error" class="error-boundary">
    <div class="error-card">
      <i class="pi pi-exclamation-triangle error-icon" />
      <h2 class="error-title">Une erreur est survenue</h2>
      <p class="error-detail">{{ errorMessage }}</p>
      <button class="error-retry" @click="handleRetry">
        <i class="pi pi-refresh" />
        R&eacute;essayer
      </button>
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

const error = ref<Error | null>(null)

const errorMessage = ref('')

onErrorCaptured((err: Error) => {
  error.value = err
  errorMessage.value = err.message || 'Une erreur inattendue est survenue.'
  return false
})

const handleRetry = () => {
  window.location.reload()
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background: var(--nl-bg);
}

.error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  max-width: 480px;
  width: 100%;
  padding: 2.5rem 2rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  text-align: center;
}

.error-icon {
  font-size: 2.5rem;
  color: var(--nl-danger);
}

.error-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.error-detail {
  margin: 0;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
  word-break: break-word;
}

.error-retry {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-surface);
  background: var(--nl-accent);
  border: none;
  border-radius: var(--nl-radius);
  cursor: pointer;
  transition: var(--nl-transition);
  font-family: var(--nl-font);
}

.error-retry:hover {
  background: var(--nl-accent-hover);
}

.error-retry:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 3px;
}
</style>
