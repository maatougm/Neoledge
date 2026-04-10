<template>
  <div class="activity-feed">
    <div v-if="activities.length === 0" class="empty-state">
      <i class="pi pi-history empty-icon" />
      <p>Aucune activité enregistrée.</p>
    </div>
    <div v-else class="timeline">
      <div v-for="item in activities" :key="item.id" class="timeline-item">
        <div class="timeline-dot-wrap">
          <div :class="['timeline-dot', dotClass(item.action)]">
            <i :class="actionIcon(item.action)" />
          </div>
          <div class="timeline-line" />
        </div>
        <div class="timeline-body">
          <div class="timeline-action">{{ actionLabel(item.action) }}</div>
          <div v-if="item.detail" class="timeline-detail">{{ item.detail }}</div>
          <div class="timeline-meta">
            <span class="timeline-user">{{ item.userName ?? 'Système' }}</span>
            <span class="timeline-sep">&bull;</span>
            <span class="timeline-date">{{ formatDate(item.createdAt ?? '') }}</span>
            <span class="timeline-time">{{ formatTime(item.createdAt ?? '') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ACTIVITY_ACTION_LABELS } from '@/types/project.types'
import type { ProjectActivity } from '@/types/project.types'

defineProps<{ activities: ProjectActivity[] }>()

function actionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action
}

function dotClass(action: string): string {
  const map: Record<string, string> = {
    ProjectCreated: 'dot--created',
    StatusChanged: 'dot--status',
    ManagerAssigned: 'dot--manager',
    FieldUpdated: 'dot--field',
    ValidationSubmitted: 'dot--validation',
  }
  return map[action] ?? 'dot--default'
}

function actionIcon(action: string): string {
  const map: Record<string, string> = {
    ProjectCreated: 'pi pi-plus',
    StatusChanged: 'pi pi-sync',
    ManagerAssigned: 'pi pi-user',
    FieldUpdated: 'pi pi-pencil',
    ValidationSubmitted: 'pi pi-check-circle',
  }
  return map[action] ?? 'pi pi-circle'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.activity-feed { padding: 0.5rem 0; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2.5rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px dashed var(--nl-border);
}
.empty-icon { font-size: 2rem; color: var(--nl-text-3); }
.empty-state p { margin: 0; }

.timeline { display: flex; flex-direction: column; gap: 0; }

.timeline-item {
  display: flex;
  gap: 1rem;
  min-height: 56px;
}
.timeline-item:last-child .timeline-line { display: none; }

.timeline-dot-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 28px;
}

.timeline-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
}

/* Color variants using --nl-* tokens with fallbacks */
.dot--created    { background: var(--nl-success-bg, #ecfdf5); color: var(--nl-success, #059669); }
.dot--status     { background: var(--nl-info-bg, #eff6ff); color: var(--nl-info, #3b82f6); }
.dot--manager    { background: var(--nl-accent-bg, #f0fdfa); color: var(--nl-accent); }
.dot--field      { background: var(--nl-surface-2, #f1f5f9); color: var(--nl-text-3); }
.dot--validation { background: var(--nl-warning-bg, #fffbeb); color: var(--nl-warning, #f59e0b); }
.dot--default    { background: var(--nl-surface-2, #f1f5f9); color: var(--nl-text-3); }

.timeline-line {
  width: 2px;
  flex: 1;
  background: var(--nl-border);
  margin: 4px 0;
}

.timeline-body {
  flex: 1;
  min-width: 0;
  padding-bottom: 1rem;
}

.timeline-action {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-1);
}

.timeline-detail {
  font-size: 0.82rem;
  color: var(--nl-text-3);
  margin-top: 0.15rem;
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--nl-text-3);
  margin-top: 0.25rem;
}

.timeline-user { font-weight: 600; color: var(--nl-text-2); }
.timeline-sep  { color: var(--nl-border); }
.timeline-date { /* inherits */ }
.timeline-time { /* inherits */ }
</style>
