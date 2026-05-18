<!-- @file MemberProjectCard.vue — Member dashboard "Mes projets" tile. -->
<template>
  <RouterLink :to="targetRoute" class="mpc">
    <header class="mpc__head">
      <h3 class="mpc__name">{{ project.name }}</h3>
      <span class="mpc__client">{{ project.clientName }}</span>
    </header>
    <div class="mpc__chips">
      <span v-if="project.activeSprint" class="mpc__chip mpc__chip--sprint">
        <i class="pi pi-forward" /> {{ project.activeSprint.name }}
      </span>
      <span v-if="project.myInProgressCount > 0" class="mpc__chip mpc__chip--wip">
        <i class="pi pi-spinner" /> {{ project.myInProgressCount }} en cours
      </span>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { MemberProjectCard } from '@/stores/memberDashboardStore'

const props = defineProps<{ project: MemberProjectCard }>()

const targetRoute = computed(() => ({
  name: 'team-project-detail',
  params: { id: props.project.id },
}))
</script>

<style scoped>
.mpc {
  display: flex; flex-direction: column; gap: 0.6rem;
  padding: 1rem;
  border: 1px solid var(--nl-border); border-radius: 8px;
  background: var(--nl-card-bg, #fff);
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.mpc:hover { border-color: var(--nl-accent); box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.mpc__head { display: flex; flex-direction: column; gap: 0.2rem; }
.mpc__name { margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--nl-text-1); }
.mpc__client { font-size: 0.75rem; color: var(--nl-text-3); text-transform: uppercase; letter-spacing: 0.05em; }
.mpc__chips { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: auto; }
.mpc__chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem; padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-2);
}
.mpc__chip--wip { background: var(--nl-warn-bg, #fef3c7); color: var(--nl-warn-fg, #92400e); }
</style>
