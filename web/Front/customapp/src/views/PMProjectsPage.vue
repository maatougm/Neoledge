<!-- @file src/views/PMProjectsPage.vue — PM project list/detail wrapper with deep-link support -->
<template>
  <div>
    <div v-if="store.loading && !store.currentProject" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>
    <PMProjectDetail
      v-else-if="selectedProjectId && store.currentProject"
      :project="store.currentProject"
      :validations="store.validations"
      @close="closeDetail"
    />
    <PMProjectList
      v-else
      @select="openProject"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePmStore } from '@/stores/pmStore'
import PMProjectList   from '@/components/pm/PMProjectList.vue'
import PMProjectDetail from '@/components/pm/PMProjectDetail.vue'

const route  = useRoute()
const router = useRouter()
const store  = usePmStore()

const selectedProjectId = ref<string | null>(null)

onMounted(async () => {
  if (store.myProjects.length === 0) {
    await store.fetchMyProjects()
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

function closeDetail(): void {
  selectedProjectId.value = null
  store.clearCurrent()
  // Remove projectId query param when navigating back
  router.replace({ name: 'pm-projects' })
}
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
}
</style>
