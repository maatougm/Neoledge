<!-- @file SprintWidget.vue — Member dashboard active-sprint card. -->
<template>
  <RouterLink :to="targetRoute" class="sw" :class="`sw--${statusKey}`">
    <header class="sw__head">
      <span class="sw__pill">{{ projectName }}</span>
      <span class="sw__status">{{ STATUS_LABEL[sprint.sprint.status] ?? sprint.sprint.status }}</span>
    </header>
    <h3 class="sw__name">{{ sprint.sprint.name }}</h3>
    <p v-if="sprint.sprint.goal" class="sw__goal">{{ sprint.sprint.goal }}</p>
    <footer class="sw__foot">
      <span class="sw__chip"><i class="pi pi-list" /> {{ sprint.myTaskCount }} tâche(s)</span>
      <span v-if="daysLeft !== null" class="sw__chip">
        <i class="pi pi-calendar" />
        {{ daysLeft >= 0 ? `J−${daysLeft}` : `J+${-daysLeft} (en retard)` }}
      </span>
    </footer>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { MemberSprintCard } from '@/stores/memberDashboardStore'

const props = defineProps<{ sprint: MemberSprintCard; projectName: string }>()

const STATUS_LABEL: Record<string, string> = {
  Active: 'En cours',
  Planning: 'En préparation',
  Closed: 'Clôturé',
  Cancelled: 'Annulé',
}

const statusKey = computed<string>(() => props.sprint.sprint.status.toLowerCase())

const daysLeft = computed<number | null>(() => {
  const end = props.sprint.sprint.endDate
  if (!end) return null
  try {
    const days = Math.ceil((new Date(end).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    return days
  } catch {
    return null
  }
})

const targetRoute = computed(() => ({
  name: 'team-sprint-detail',
  params: { projectId: props.sprint.projectId, sprintId: props.sprint.sprint.id },
}))
</script>

<style scoped>
.sw {
  display: flex; flex-direction: column; gap: 0.4rem;
  padding: 1rem; border: 1px solid var(--nl-border); border-radius: 8px;
  background: var(--nl-card-bg, #fff);
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
  border-left-width: 3px;
}
.sw:hover { border-color: var(--nl-accent); box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.sw--active   { border-left-color: var(--nl-success, #059669); }
.sw--planning { border-left-color: var(--nl-info, #2563eb); }
.sw__head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
}
.sw__pill {
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-2);
  padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 600;
}
.sw__status { color: var(--nl-text-3); }
.sw__name { margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-1); }
.sw__goal {
  margin: 0;
  font-size: 0.8125rem; color: var(--nl-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sw__foot { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: auto; }
.sw__chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem; color: var(--nl-text-3);
}
</style>
