<template>
  <div class="team-view">
    <div v-if="store.loading && !store.currentProject" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>

    <PMProjectDetail
      v-else-if="selectedProjectId && store.currentProject"
      :project="store.currentProject"
      :validations="store.validations"
      :readonly="true"
      @close="closeProject"
    />

    <PMProjectList
      v-else-if="activeSection === 'projects'"
      @select="openProject"
    />

    <div v-else-if="activeSection === 'validations'" class="validations-section">
      <h2 class="section-title">Mes validations soumises</h2>
      <div v-if="store.validations.length === 0" class="empty-state">
        <i class="pi pi-check-square" style="font-size:2rem;color:#94a3b8" />
        <p>Aucune validation soumise pour l'instant.</p>
      </div>
      <div v-else class="validation-list">
        <div v-for="v in store.validations" :key="v.id" class="validation-card">
          <div class="v-header">
            <NeoTag
              :value="v.isApproved ? 'Approuvé' : 'Refusé'"
              :severity="v.isApproved ? 'success' : 'danger'"
            />
            <span class="v-date">{{ formatDate(v.validatedAt) }}</span>
          </div>
          <div class="v-detail">Phase : <strong>{{ v.phase }}</strong></div>
          <div v-if="v.comment" class="v-comment">{{ v.comment }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { NeoTag } from '@neolibrary/components'
import PMProjectList   from '@/components/pm/PMProjectList.vue'
import PMProjectDetail from '@/components/pm/PMProjectDetail.vue'
import { usePmStore }  from '@/stores/pmStore'

const route = useRoute()
const store = usePmStore()

// Derive section from route instead of internal state —
// prevents 'validations' route defaulting to 'projects' content
type Section = 'projects' | 'validations'
const activeSection = computed<Section>(() =>
  route.name === 'team-validations' ? 'validations' : 'projects'
)

const selectedProjectId = ref<string | null>(null)

onMounted(async () => {
  if (store.projects.length === 0) {
    await store.fetchTeamProjects()
  }

  const queryId = route.query.projectId as string | undefined
  if (queryId) {
    await openProject(queryId)
  }
})

async function openProject(id: string): Promise<void> {
  selectedProjectId.value = id
  await store.fetchProject(id)
}

function closeProject(): void {
  selectedProjectId.value = null
  store.currentProject = null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR')
}
</script>

<style scoped>
.team-view {
  max-width: 1100px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
}

.validations-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--nl-text-1);
  margin: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #94a3b8;
  font-size: 0.875rem;
}

.validation-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.validation-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.v-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.v-date  { font-size: 0.78rem; color: var(--nl-text-3); }
.v-detail { font-size: 0.875rem; color: var(--nl-text-2); }
.v-comment { font-size: 0.82rem; color: var(--nl-text-3); font-style: italic; }
</style>
