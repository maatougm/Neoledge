<!-- @file StatusTransitionMenu.vue — inline status picker on a task row. -->
<template>
  <div class="stm">
    <button
      class="stm__btn"
      type="button"
      :class="`stm__btn--${currentSeverity}`"
      @click.stop="open = !open"
    >
      <i :class="`pi ${ICON[currentStatus] ?? 'pi-circle'}`" />
      <span>{{ STATUS_LABEL[currentStatus] ?? currentStatus }}</span>
      <i class="pi pi-chevron-down stm__caret" />
    </button>
    <ul v-if="open" class="stm__menu" @click.stop>
      <li
        v-for="opt in options"
        :key="opt.value"
        class="stm__item"
        :class="{ 'stm__item--active': opt.value === currentStatus }"
        @click="onPick(opt.value)"
      >
        <i :class="`pi ${ICON[opt.value] ?? 'pi-circle'}`" />
        <span>{{ opt.label }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{ currentStatus: string }>()
const emit = defineEmits<{ select: [newStatus: string] }>()

const open = ref(false)

const STATUS_LABEL: Record<string, string> = {
  New: 'À faire',
  InProgress: 'En cours',
  AwaitingReview: 'En revue',
  Resolved: 'Résolu',
  Closed: 'Fermé',
}
const ICON: Record<string, string> = {
  New: 'pi-circle',
  InProgress: 'pi-spinner',
  AwaitingReview: 'pi-flag',
  Resolved: 'pi-check-circle',
  Closed: 'pi-lock',
}

const options = [
  { value: 'New',            label: 'À faire' },
  { value: 'InProgress',     label: 'En cours' },
  { value: 'AwaitingReview', label: 'En revue' },
  { value: 'Resolved',       label: 'Résolu' },
] as const

const currentSeverity = computed<'info' | 'warn' | 'success' | 'secondary'>(() => {
  if (props.currentStatus === 'New') return 'info'
  if (props.currentStatus === 'InProgress' || props.currentStatus === 'AwaitingReview') return 'warn'
  if (props.currentStatus === 'Resolved' || props.currentStatus === 'Closed') return 'success'
  return 'secondary'
})

function onPick(value: string): void {
  open.value = false
  if (value !== props.currentStatus) emit('select', value)
}

function onDocClick(): void { open.value = false }
onMounted(() => { window.addEventListener('click', onDocClick) })
onUnmounted(() => { window.removeEventListener('click', onDocClick) })
</script>

<style scoped>
.stm { position: relative; display: inline-block; }
.stm__btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  background: var(--nl-card-bg, #fff);
  font-size: 0.8125rem; font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.stm__btn:hover { border-color: var(--nl-accent); }
.stm__btn--info    { color: var(--nl-info, #2563eb); }
.stm__btn--warn    { color: var(--nl-warn, #d97706); }
.stm__btn--success { color: var(--nl-success, #059669); }
.stm__caret { font-size: 0.625rem; opacity: 0.65; }

.stm__menu {
  position: absolute; top: calc(100% + 4px); left: 0;
  z-index: 100;
  list-style: none; margin: 0; padding: 0.25rem;
  min-width: 160px;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.stm__item {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border-radius: 4px;
  font-size: 0.8125rem;
  cursor: pointer;
}
.stm__item:hover { background: var(--nl-surface-2, #fafafa); }
.stm__item--active { background: var(--nl-accent-light, #ecfdf5); font-weight: 600; }
</style>
