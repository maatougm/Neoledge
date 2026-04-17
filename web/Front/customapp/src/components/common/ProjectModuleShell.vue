<!-- @file ProjectModuleShell.vue — Wraps a project module view with breadcrumbs + ModulePageHeader -->
<template>
  <div class="pms">
    <ProjectBreadcrumbs :project-id="projectId" />
    <ModulePageHeader :title="title" :status="status" :status-severity="statusSeverity">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </ModulePageHeader>
    <div class="pms__body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import ProjectBreadcrumbs from './ProjectBreadcrumbs.vue'
import ModulePageHeader from './ModulePageHeader.vue'

defineProps<{
  projectId: string
  title: string
  status?: string
  statusSeverity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
}>()
</script>

<style scoped>
.pms { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.pms__body { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
</style>
