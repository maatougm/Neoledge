<template>
  <div class="activity-feed">
    <div v-if="activities.length === 0" class="empty-state">
      <i class="pi pi-history" style="font-size: 2rem; color: #334155" />
      <p>Aucune activité enregistrée.</p>
    </div>
    <div v-else class="timeline">
      <div v-for="item in activities" :key="item.id" class="timeline-item">
        <div class="timeline-dot" :style="{ background: dotColor(item.action) }" />
        <div class="timeline-body">
          <div class="timeline-action">{{ actionLabel(item.action) }}</div>
          <div v-if="item.detail" class="timeline-detail">{{ item.detail }}</div>
          <div class="timeline-meta">
            par <strong>{{ item.userName ?? 'Système' }}</strong>
            &bull; {{ relativeTime(item.createdAt) }}
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

function dotColor(action: string): string {
  const map: Record<string, string> = {
    ProjectCreated: '#0d9488',
    StatusChanged: '#3b82f6',
    ManagerAssigned: '#f59e0b',
    ValidationSubmitted: '#8b5cf6',
  }
  return map[action] ?? '#475569'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `il y a ${hrs}h`
  return `il y a ${Math.floor(hrs / 24)}j`
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
  color: #94a3b8;
  font-size: 0.875rem;
}

.timeline { display: flex; flex-direction: column; gap: 0; }

.timeline-item {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f1f5f9;
  position: relative;
}
.timeline-item:last-child { border-bottom: none; }

.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}

.timeline-body { flex: 1; min-width: 0; }

.timeline-action {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
}

.timeline-detail {
  font-size: 0.82rem;
  color: #6b7280;
  margin-top: 0.15rem;
}

.timeline-meta {
  font-size: 0.78rem;
  color: #9ca3af;
  margin-top: 0.25rem;
}
</style>
