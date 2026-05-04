<!-- @file src/views/PMProjectsPage.vue — PM project list page.
     Selecting a project navigates to /app/pm/projects/:id so the v2.0 overview
     (with WP / Gantt / Board / Backlog / Sprint tiles) and the
     project-module sidebar both render. -->
<template>
  <div>
    <div v-if="store.loading && store.myProjects.length === 0" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>
    <PMProjectList v-else @select="openProject" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePmStore } from '@/stores/pmStore'
import PMProjectList from '@/components/pm/PMProjectList.vue'

const route  = useRoute()
const router = useRouter()
const store  = usePmStore()

onMounted(async () => {
  if (store.myProjects.length === 0) {
    await store.fetchMyProjects()
  }

  // Backwards-compat: legacy `?projectId=...` deep-link → forward to the v2.0 overview route.
  const queryId = route.query.projectId as string | undefined
  if (queryId) {
    await router.replace({ name: 'pm-project-detail', params: { id: queryId } })
  }
})

async function openProject(id: string): Promise<void> {
  await router.push({ name: 'pm-project-detail', params: { id } })
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
