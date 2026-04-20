<!-- @file src/components/common/AppModal.vue — Teleport-based modal replacement for NeoDialog -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" ref="scrimRef" class="modal-scrim" @mousedown.self="close">
        <div
          ref="boxRef"
          class="modal-box"
          :style="{ width: width || '480px' }"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
        >
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
import { ref, watch, onUnmounted, nextTick } from 'vue'

const props = defineProps<{ visible: boolean; header: string; width?: string }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

// ── Module-level stack of open modal ids for stacked-Escape handling (#18) ──
const _openStack: symbol[] = []
const _id = Symbol('AppModal')

const scrimRef = ref<HTMLElement | null>(null)
const boxRef   = ref<HTMLElement | null>(null)

// Track the element that opened this modal so we can restore focus on close (#17)
let _openerEl: Element | null = null

function close() {
  emit('update:visible', false)
}

// FOCUSABLE_SELECTOR — standard set of keyboard-reachable elements
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ')

function trapFocus(e: KeyboardEvent): void {
  const box = boxRef.value
  if (!box) return
  const focusable = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (!focusable.length) return
  const first = focusable[0]
  const last  = focusable[focusable.length - 1]
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus() }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus() }
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Tab') { trapFocus(e); return }
  // Only the top-most modal handles Escape (#18)
  if (e.key === 'Escape' && _openStack[_openStack.length - 1] === _id) close()
}

watch(() => props.visible, async (v) => {
  if (v) {
    _openerEl = document.activeElement
    _openStack.push(_id)
    // Scroll-lock (#16)
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    // Focus the modal box after transition (#17)
    await nextTick()
    boxRef.value?.focus()
  } else {
    const idx = _openStack.lastIndexOf(_id)
    if (idx !== -1) _openStack.splice(idx, 1)
    window.removeEventListener('keydown', onKeydown)
    // Restore scroll-lock only when no more modals are open (#16)
    if (_openStack.length === 0) document.body.style.overflow = ''
    // Restore focus to opener (#17)
    if (_openerEl instanceof HTMLElement) { _openerEl.focus(); _openerEl = null }
  }
}, { immediate: true })

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  const idx = _openStack.lastIndexOf(_id)
  if (idx !== -1) _openStack.splice(idx, 1)
  if (_openStack.length === 0) document.body.style.overflow = ''
})
</script>

<style scoped>
.modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Stack order:
       Sidebar/Topbar: 100 · Row menus, UserMenu, NotificationPanel: 9500
       AppModal (us): 9600 · Cmd-K: 9800 · PrimeVue overlays: 10000
     A modal must cover dropdowns but still allow its own inner Selects/Datepickers
     to teleport above it. */
  z-index: 9600;
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
