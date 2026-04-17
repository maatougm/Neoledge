<!-- @file src/views/PMProjectDetailView.vue — Project landing page with tabs to modules -->
<template>
  <ProjectModuleShell :project-id="id" :title="projectName" :status="projectStatus" status-severity="info">
    <template #actions>
      <NeoButton label="Work Packages" icon="pi pi-list" outlined @click="go('workpackages')" />
      <NeoButton label="Gantt" icon="pi pi-chart-bar" outlined @click="go('gantt')" />
      <NeoButton label="Board" icon="pi pi-th-large" outlined @click="go('board')" />
    </template>

    <div class="pd-content">
      <div class="pd-grid">
        <router-link :to="`/app/pm/projects/${id}/workpackages`" class="pd-tile">
          <i class="pi pi-list pd-tile__icon" />
          <div class="pd-tile__title">Work Packages</div>
          <div class="pd-tile__desc">Tâches, bugs, features</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/gantt`" class="pd-tile">
          <i class="pi pi-chart-bar pd-tile__icon" />
          <div class="pd-tile__title">Gantt</div>
          <div class="pd-tile__desc">Timeline + jalons + baseline</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/board`" class="pd-tile">
          <i class="pi pi-th-large pd-tile__icon" />
          <div class="pd-tile__title">Board</div>
          <div class="pd-tile__desc">Kanban drag-drop</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/backlogs`" class="pd-tile">
          <i class="pi pi-inbox pd-tile__icon" />
          <div class="pd-tile__title">Backlog</div>
          <div class="pd-tile__desc">Sprints + planning</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/wiki`" class="pd-tile">
          <i class="pi pi-book pd-tile__icon" />
          <div class="pd-tile__title">Wiki</div>
          <div class="pd-tile__desc">Documentation</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/budget`" class="pd-tile">
          <i class="pi pi-dollar pd-tile__icon" />
          <div class="pd-tile__title">Budget</div>
          <div class="pd-tile__desc">Main d'œuvre + matériel</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/time`" class="pd-tile">
          <i class="pi pi-clock pd-tile__icon" />
          <div class="pd-tile__title">Temps</div>
          <div class="pd-tile__desc">Saisies + résumé</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/members`" class="pd-tile">
          <i class="pi pi-users pd-tile__icon" />
          <div class="pd-tile__title">Membres</div>
          <div class="pd-tile__desc">Équipe projet</div>
        </router-link>
        <router-link :to="`/app/pm/projects/${id}/activity`" class="pd-tile">
          <i class="pi pi-history pd-tile__icon" />
          <div class="pd-tile__title">Activité</div>
          <div class="pd-tile__desc">Historique</div>
        </router-link>
      </div>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import api from '@/lib/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const projectName = ref('Projet')
const projectStatus = ref('')

function go(m: string) {
  router.push(`/app/pm/projects/${props.id}/${m}`)
}

onMounted(async () => {
  try {
    const { data } = await api.get<{ name: string; status: string }>(`/pm/projects/${props.id}`)
    projectName.value = data.name
    projectStatus.value = data.status
  } catch {
    /* ignore */
  }
})
</script>

<style scoped>
.pd-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.pd-content { flex: 1; overflow-y: auto; padding: 1.5rem; }
.pd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.pd-tile {
  background: var(--nl-card-bg, #fff);
  padding: 1.25rem;
  border-radius: 8px;
  border: 1px solid var(--nl-border, #e5e7eb);
  text-decoration: none;
  color: var(--nl-text, #111827);
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.pd-tile:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-2px); border-color: var(--nl-accent, #1e9e8f); }
.pd-tile__icon { font-size: 1.75rem; color: var(--nl-accent, #1e9e8f); }
.pd-tile__title { font-size: 1rem; font-weight: 600; }
.pd-tile__desc { font-size: 0.8125rem; color: var(--nl-text-muted, #6b7280); }
</style>
