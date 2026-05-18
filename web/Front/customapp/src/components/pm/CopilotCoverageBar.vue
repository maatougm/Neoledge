<!-- @file CopilotCoverageBar.vue — passive coverage gauge above the live
     meeting view. Pure-frontend; no LLM tokens. -->
<template>
  <div class="ccb">
    <div class="ccb__cell">
      <span class="ccb__label">Cahier des charges</span>
      <div class="ccb__bar">
        <div class="ccb__bar-fill" :style="{ width: `${coveragePct}%`, background: barColor }" />
      </div>
      <span class="ccb__value">{{ coveragePct }} %</span>
    </div>
    <div class="ccb__sep" />
    <div class="ccb__cell">
      <span class="ccb__label">Drivers backlog</span>
      <span class="ccb__pill">{{ driversAnswered }} / {{ driversTotal }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  coveragePct: number
  driversAnswered: number
  driversTotal: number
}>()

const barColor = computed<string>(() => {
  if (props.coveragePct >= 70) return 'var(--nl-success, #059669)'
  if (props.coveragePct >= 40) return 'var(--nl-warn, #d97706)'
  return 'var(--nl-danger, #dc2626)'
})
</script>

<style scoped>
.ccb {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  font-size: 0.8125rem;
}
.ccb__cell { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 auto; min-width: 0; }
.ccb__label { color: var(--nl-text-3); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
.ccb__bar {
  flex: 1 1 auto;
  height: 6px;
  background: var(--nl-surface-2, #f3f4f6);
  border-radius: 3px;
  overflow: hidden;
}
.ccb__bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease, background 0.3s ease;
}
.ccb__value {
  font-weight: 600;
  color: var(--nl-text-1);
  font-size: 0.8125rem;
  min-width: 3.5em;
  text-align: right;
}
.ccb__sep {
  width: 1px;
  height: 1.5rem;
  background: var(--nl-border);
}
.ccb__pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--nl-surface-2, #f3f4f6);
  font-weight: 600;
  color: var(--nl-text-1);
  font-size: 0.75rem;
}
</style>
