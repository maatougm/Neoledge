<!--
  @file     StatCard.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Premium metric card with icon, value, label and optional trend indicator
-->
<template>
  <div :class="['stat-card', `stat-card--${color}`]" role="figure" :aria-label="label">
    <div class="stat-card__header">
      <span class="stat-card__label">{{ label }}</span>
      <div class="stat-card__icon-wrap" aria-hidden="true">
        <i :class="['pi', icon, 'stat-card__icon']" />
      </div>
    </div>

    <div class="stat-card__body">
      <span class="stat-card__value">{{ value }}</span>
      <span
        v-if="trend !== undefined"
        :class="['stat-card__trend', trend >= 0 ? 'stat-card__trend--up' : 'stat-card__trend--down']"
        :aria-label="`${trend >= 0 ? 'Hausse' : 'Baisse'} de ${Math.abs(trend)}%`"
      >
        <i :class="['pi', trend >= 0 ? 'pi-arrow-up' : 'pi-arrow-down']" aria-hidden="true" />
        {{ Math.abs(trend) }}%
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  label:  string
  value:  string | number
  icon:   string
  color?: 'accent' | 'success' | 'warning' | 'danger'
  trend?: number
}

withDefaults(defineProps<Props>(), {
  color: 'accent',
})
</script>

<style scoped>
.stat-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--nl-shadow);
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--nl-shadow-md);
}

/* ── Header row: label + icon ───────────────────────────────────────────────── */
.stat-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ── Icon circle ─────────────────────────────────────────────────────────────── */
.stat-card__icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--nl-accent-light);
}

.stat-card__icon {
  font-size: 0.9rem;
}

/* ── Color variants ───────────────────────────────────────────────────────────── */
.stat-card--accent .stat-card__icon-wrap {
  background: var(--nl-accent-light, color-mix(in srgb, var(--nl-accent) 10%, transparent));
}
.stat-card--accent .stat-card__icon { color: var(--nl-accent); }

.stat-card--success .stat-card__icon-wrap {
  background: color-mix(in srgb, var(--nl-success) 12%, transparent);
}
.stat-card--success .stat-card__icon { color: var(--nl-success); }

.stat-card--warning .stat-card__icon-wrap {
  background: color-mix(in srgb, var(--nl-warning) 12%, transparent);
}
.stat-card--warning .stat-card__icon { color: var(--nl-warning); }

.stat-card--danger .stat-card__icon-wrap {
  background: color-mix(in srgb, var(--nl-danger) 12%, transparent);
}
.stat-card--danger .stat-card__icon { color: var(--nl-danger); }

/* ── Body ─────────────────────────────────────────────────────────────────────── */
.stat-card__body {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.stat-card__value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--nl-text-1);
  letter-spacing: -0.02em;
}

.stat-card__label {
  font-size: 12px;
  color: var(--nl-text-3);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.stat-card__trend {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
}

.stat-card__trend .pi {
  font-size: 10px;
}

.stat-card__trend--up {
  color: #16A34A;
  background: #F0FDF4;
}

.stat-card__trend--down {
  color: var(--nl-danger);
  background: color-mix(in srgb, var(--nl-danger) 10%, transparent);
}
</style>
