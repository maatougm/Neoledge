<!-- @file src/views/MyTasksView.vue — Cross-project "my assigned tasks" list for PM -->
<template>
  <div class="my-tasks">
    <header class="my-tasks__header">
      <h1 class="my-tasks__title">Mes tâches</h1>
      <p class="my-tasks__subtitle">Tous les work packages qui vous sont assignés, tous projets confondus.</p>
    </header>

    <div class="my-tasks__filters">
      <NeoInputText
        id="my-tasks-search"
        v-model="q"
        placeholder="Rechercher…"
        class="my-tasks__search"
      />
      <NeoSelect
        id="my-tasks-status"
        v-model="status"
        :options="statusOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Tous les statuts"
        class="my-tasks__status"
      />
    </div>

    <div v-if="loading" class="my-tasks__loading">Chargement…</div>
    <div v-else-if="!items.length" class="my-tasks__empty">Aucune tâche assignée.</div>

    <table v-else class="my-tasks__table">
      <thead>
        <tr>
          <th>Titre</th>
          <th>Projet</th>
          <th>Statut</th>
          <th>Priorité</th>
          <th>Échéance</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="wp in items"
          :key="wp.id"
          class="my-tasks__row"
          @click="openWp(wp)"
        >
          <td>
            <div class="my-tasks__wp-title">{{ wp.title }}</div>
            <div class="my-tasks__wp-type">{{ wp.type }}</div>
          </td>
          <td>{{ wp.project?.name ?? '—' }}</td>
          <td><WpStatusTag :status="wp.status" /></td>
          <td><PriorityDot :priority="wp.priority" /></td>
          <td>{{ wp.dueDate ? formatDate(wp.dueDate) : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NeoInputText, NeoSelect } from '@neolibrary/components'
import api from '@/lib/api'
import { formatDateShort as formatDate } from '@/lib/formatDate'
import PriorityDot from '@/components/common/PriorityDot.vue'
import WpStatusTag from '@/components/common/WpStatusTag.vue'
import type { WorkPackage } from '@/types/work-package.types'

type MyTask = WorkPackage & { project?: { id: string; name: string } }

const router = useRouter()
const items = ref<MyTask[]>([])
const loading = ref<boolean>(false)
const q = ref<string>('')
const status = ref<string | null>(null)

const statusOptions = [
  { label: 'Tous les statuts', value: null },
  { label: 'Nouveau',          value: 'New' },
  { label: 'En cours',         value: 'InProgress' },
  { label: 'Résolu',           value: 'Resolved' },
  { label: 'Clôturé',          value: 'Closed' },
]

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value) params.append('q', q.value)
    if (status.value) params.append('status', status.value)
    const { data } = await api.get<{ items: MyTask[]; total: number }>(
      `/pm/my-tasks${params.toString() ? `?${params.toString()}` : ''}`,
    )
    items.value = data.items
  } finally {
    loading.value = false
  }
}

function openWp(wp: MyTask) {
  if (!wp.project?.id) return
  void router.push(`/app/pm/projects/${wp.project.id}/workpackages?wpId=${wp.id}`)
}

onMounted(load)
let tid: number | null = null
watch([q, status], () => {
  if (tid) window.clearTimeout(tid)
  tid = window.setTimeout(load, 300)
})
</script>

<style scoped>
.my-tasks { padding: 1.5rem 2rem; max-width: 1200px; }
.my-tasks__header { margin-bottom: 1.5rem; }
.my-tasks__title { font-size: 1.5rem; font-weight: 600; color: var(--nl-text); margin: 0 0 0.25rem; }
.my-tasks__subtitle { color: var(--nl-text-muted); font-size: 0.875rem; margin: 0; }
.my-tasks__filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.my-tasks__search { flex: 1; min-width: 240px; }
.my-tasks__status { width: 220px; }
.my-tasks__loading, .my-tasks__empty {
  padding: 3rem; text-align: center; color: var(--nl-text-muted);
  background: var(--nl-card-bg); border: 1px solid var(--nl-border); border-radius: 8px;
}
.my-tasks__table {
  width: 100%; border-collapse: collapse;
  background: var(--nl-card-bg); border: 1px solid var(--nl-border); border-radius: 8px; overflow: hidden;
}
.my-tasks__table th {
  text-align: left; padding: 0.75rem 1rem; font-weight: 600; font-size: 0.8125rem;
  color: var(--nl-text-muted); background: var(--nl-bg); border-bottom: 1px solid var(--nl-border);
}
.my-tasks__row { cursor: pointer; transition: background 0.1s; }
.my-tasks__row:hover { background: var(--nl-bg); }
.my-tasks__row td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--nl-border); font-size: 0.875rem; }
.my-tasks__row:last-child td { border-bottom: none; }
.my-tasks__wp-title { font-weight: 500; color: var(--nl-text); }
.my-tasks__wp-type { font-size: 0.75rem; color: var(--nl-text-muted); }
</style>
