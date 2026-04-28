<!-- @file ProjectBreadcrumbs.vue — Home > Project > Module trail for /app/pm/projects/:id/* pages -->
<template>
  <nav class="breadcrumbs" aria-label="Fil d'Ariane">
    <router-link :to="projectsListPath" class="breadcrumbs__item breadcrumbs__item--link">
      <i class="pi pi-list breadcrumbs__icon" />
      <span>Projets</span>
    </router-link>
    <i class="pi pi-angle-right breadcrumbs__sep" />

    <router-link
      :to="`/app/pm/projects/${projectId}`"
      class="breadcrumbs__item breadcrumbs__item--link"
    >
      {{ projectName || 'Projet' }}
    </router-link>

    <template v-if="moduleLabel">
      <i class="pi pi-angle-right breadcrumbs__sep" />
      <span class="breadcrumbs__item breadcrumbs__item--current">{{ moduleLabel }}</span>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()

// Role-aware "back to list" path: Admin users land on /app/admin/projects,
// everyone else on the PM/team project list. Prevents the breadcrumb sending
// a PM back to the admin home they don't have permission for.
const projectsListPath = computed<string>(() =>
  authStore.userRole === 'Admin' ? '/app/admin/projects' : '/app/pm/projects',
)

const props = defineProps<{ projectId: string }>()
const route = useRoute()
const projectName = ref<string>('')

const MODULE_LABELS: Record<string, string> = {
  'pm-project-detail':    '',
  'pm-workpackages':      'Work Packages',
  'pm-gantt':             'Gantt',
  'pm-board':             'Board',
  'pm-backlogs':          'Backlog',
  'pm-sprint':            'Sprint',
  'pm-wiki':              'Wiki',
  'pm-wiki-page':         'Wiki',
  'pm-budget':            'Budget',
  'pm-time':              'Temps',
  'pm-members':           'Membres',
  'pm-project-activity':  'Activité',
}

const moduleLabel = computed<string>(() => {
  const name = route.name as string | undefined
  return name ? (MODULE_LABELS[name] ?? '') : ''
})

async function loadProject() {
  try {
    const { data } = await api.get<{ name: string }>(`/pm/projects/${props.projectId}`)
    projectName.value = data.name
  } catch {
    projectName.value = ''
  }
}

watch(() => props.projectId, loadProject)
onMounted(loadProject)
</script>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.5rem;
  background: var(--nl-card-bg, #fff);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  font-size: 0.8125rem;
  color: var(--nl-text-muted, #6b7280);
}
.breadcrumbs__item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
.breadcrumbs__item--link {
  color: var(--nl-text-muted, #6b7280);
  text-decoration: none;
  transition: color 0.15s;
}
.breadcrumbs__item--link:hover { color: var(--nl-accent, #1e9e8f); }
.breadcrumbs__item--current { color: var(--nl-text, #111827); font-weight: 500; }
.breadcrumbs__icon { font-size: 0.875rem; }
.breadcrumbs__sep { font-size: 0.6875rem; color: var(--nl-text-muted, #9ca3af); }
</style>
