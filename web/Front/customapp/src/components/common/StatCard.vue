<!-- @file src/components/common/StatCard.vue — Compact stat widget for Home / dashboards. -->
<template>
  <div class="stat" :class="`stat--${tone}`">
    <div class="stat__icon"><i class="pi" :class="icon" /></div>
    <div class="stat__body">
      <div class="stat__value">{{ value }}</div>
      <div class="stat__label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
type Tone = 'normal' | 'danger' | 'warning' | 'success'

defineProps<{
  icon: string
  label: string
  value: number | string
  tone?: Tone
}>()
</script>

<style scoped>
.stat {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-4); background: var(--nl-surface);
  border: 1px solid var(--nl-border); border-radius: var(--nl-radius-lg);
}
.stat__icon {
  width: 36px; height: 36px; border-radius: var(--nl-radius);
  display: flex; align-items: center; justify-content: center;
  background: var(--nl-surface-2); color: var(--nl-text-3);
  font-size: 16px; flex-shrink: 0;
}
.stat__value {
  font-size: var(--nl-fs-xl); font-weight: 700; line-height: 1.1;
  color: var(--nl-text-1);
}
.stat__label {
  font-size: var(--nl-fs-sm); color: var(--nl-text-3);
  margin-top: 2px;
}

.stat--danger  .stat__icon { background: var(--nl-danger-light);  color: var(--nl-danger); }
.stat--warning .stat__icon { background: var(--nl-warning-light); color: var(--nl-warning); }
.stat--success .stat__icon { background: var(--nl-success-light); color: var(--nl-success); }
</style>
