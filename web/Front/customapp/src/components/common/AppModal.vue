<!-- @file src/components/common/AppModal.vue — Teleport-based modal replacement for NeoDialog -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-scrim" @mousedown.self="close">
        <div class="modal-box" :style="{ width: width || '480px' }" role="dialog" aria-modal="true">
          <div class="modal-header">
            <span class="modal-title">{{ header }}</span>
            <button class="modal-close" @click="close" aria-label="Fermer">
              <i class="pi pi-times" />
            </button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div class="modal-footer" v-if="$slots.footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, onUnmounted } from 'vue'

const props = defineProps<{ visible: boolean; header: string; width?: string }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close() {
  emit('update:visible', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// Attach a keyboard listener only while the modal is visible, so Escape closes it.
watch(() => props.visible, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Keep below PrimeVue overlays (Select/Datepicker use 1100+) so their
     teleported panels float above the modal instead of being clipped. */
  z-index: 900;
  padding: 1rem;
}
.modal-box {
  background: var(--nl-card-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.modal-title { font-weight: 600; font-size: 1rem; color: var(--nl-text, #111827); }
.modal-close {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--nl-text-muted, #6b7280);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.modal-close:hover { background: var(--nl-bg, #f3f4f6); }
.modal-body { padding: 1rem 1.25rem; overflow-y: auto; flex: 1; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--nl-border, #e5e7eb);
}
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
