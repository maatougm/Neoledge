<!-- @file src/views/ProjectActivityView.vue — Project activity timeline -->
<template>
  <ProjectModuleShell :project-id="props.id" title="Activité">
    <div class="pa-content">
      <ul class="pa-list">
        <li v-for="a in activities" :key="a.id" class="pa-item">
          <i class="pi pi-circle-fill pa-item__dot" />
          <div class="pa-item__body">
            <div class="pa-item__action">{{ a.action }}</div>
            <div v-if="a.detail" class="pa-item__detail">{{ a.detail }}</div>
            <div class="pa-item__time">{{ formatDate(a.timestamp) }}</div>
          </div>
        </li>
        <li v-if="!activities.length" class="pa-empty">Aucune activité.</li>
      </ul>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import api from '@/lib/api'
import { formatDateTime as formatDate } from '@/lib/formatDate'

const props = defineProps<{ id: string }>()

interface Activity { id: string; action: string; detail: string | null; createdAt: string }
const activities = ref<Activity[]>([])

onMounted(async () => {
  try {
    const { data } = await api.get<Activity[]>(`/pm/projects/${props.id}/activity`)
    activities.value = Array.isArray(data) ? data : []
  } catch {
    activities.value = []
  }
})
</script>

<style scoped>
.pa-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.pa-content { flex: 1; overflow-y: auto; padding: 1.5rem; }
.pa-list { list-style: none; padding: 0; margin: 0; }
.pa-item { display: flex; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--nl-border, #e5e7eb); }
.pa-item__dot { color: var(--nl-accent, #1e9e8f); font-size: 0.5rem; margin-top: 0.5rem; flex-shrink: 0; }
.pa-item__action { font-weight: 500; }
.pa-item__detail { color: var(--nl-text-muted, #6b7280); font-size: 0.875rem; }
.pa-item__time { color: var(--nl-text-muted, #9ca3af); font-size: 0.75rem; margin-top: 0.25rem; }
.pa-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem; }
</style>
