<!-- @file src/views/PMProjectFullView.vue
     Wrapper for the full tabbed PMProjectDetail view (questionnaire,
     meetings, AI, cahier des charges, validations).
     Used as the single mount point for nav entries that deep-link
     into a specific tab via the ?tab= query param. -->
<template>
  <ProjectModuleShell :project-id="id" :title="project?.name || 'Chargement…'" :status="project?.status" status-severity="info">
    <PMProjectDetail
      v-if="project"
      :project="project"
      :validations="validations"
      :initial-tab="initialTab"
      @close="goBackToProjects"
    />
    <div v-else class="pm-full-loading">Chargement du projet…</div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import PMProjectDetail from '@/components/pm/PMProjectDetail.vue'
import { usePmStore } from '@/stores/pmStore'
import type { ProjectDetail } from '@/types/project.types'
import type { ProjectValidation } from '@/types/pm.types'

const props = defineProps<{ id: string }>()
const route = useRoute()
const router = useRouter()
const store = usePmStore()

const project = ref<ProjectDetail | null>(null)
const validations = ref<ProjectValidation[]>([])

const PATH_TO_TAB: Record<string, string> = {
  'pm-project-questionnaire': 'questionnaire',
  'pm-project-meetings':      'meetings',
  'pm-project-cahier':        'cahier',
  'pm-project-validations':   'validation',
  // Team / spec reviewer enters via the queue — default to the cahier review.
  'team-project-detail':      'cahier',
}
const initialTab = computed<string>(() => {
  const name = (route.name as string | undefined) ?? ''
  if (PATH_TO_TAB[name]) return PATH_TO_TAB[name]
  const t = route.query.tab
  return typeof t === 'string' ? t : 'questionnaire'
})

async function load(projectId: string): Promise<void> {
  await store.fetchProject(projectId)
  project.value = store.currentProject
  validations.value = store.validations ?? []
}

function goBackToProjects(): void {
  void router.push({ name: 'pm-projects' })
}

onMounted(() => { void load(props.id) })
watch(() => props.id, (newId) => { if (newId) void load(newId) })
</script>

<style scoped>
.pm-full-loading {
  padding: 2rem;
  text-align: center;
  color: var(--nl-text-3);
  font-size: 0.9375rem;
}
</style>
