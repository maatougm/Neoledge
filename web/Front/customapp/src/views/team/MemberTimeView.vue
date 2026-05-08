<!-- @file MemberTimeView.vue — cross-project weekly time summary. -->
<template>
  <div class="mtv">
    <header class="mtv__head">
      <h1 class="mtv__title">Mon temps</h1>
      <p class="mtv__subtitle">{{ subtitle }}</p>
    </header>

    <NeoMessage v-if="error" severity="error" :text="error" class="mb-3" />

    <section class="mtv__week-card">
      <div class="mtv__week-head">
        <h2><i class="pi pi-calendar" /> Semaine du {{ weekStartLabel }}</h2>
        <span class="mtv__week-total">{{ totalHoursLabel }}</span>
      </div>
      <div class="mtv__days">
        <div
          v-for="day in days"
          :key="day.date"
          class="mtv__day"
          :class="{ 'mtv__day--today': day.isToday, 'mtv__day--empty': day.hours === 0 }"
        >
          <span class="mtv__day-name">{{ day.label }}</span>
          <span class="mtv__day-date">{{ day.dateLabel }}</span>
          <span class="mtv__day-hours">{{ day.hours.toFixed(1) }} h</span>
        </div>
      </div>
    </section>

    <section class="mtv__entries-card">
      <div class="mtv__entries-head">
        <h2><i class="pi pi-list" /> Dernières saisies</h2>
        <span class="mtv__entries-count">{{ entries.length }} saisie(s)</span>
      </div>
      <div v-if="loading" class="mtv__loading"><i class="pi pi-spin pi-spinner" /> Chargement…</div>
      <div v-else-if="entries.length === 0" class="mtv__empty">
        <i class="pi pi-clock" />
        <p>Aucune saisie de temps cette semaine. Commence à logger depuis l'écran d'un projet.</p>
      </div>
      <ul v-else class="mtv__entries">
        <li v-for="e in entries" :key="e.id" class="mtv__entry">
          <span class="mtv__entry-date">{{ formatDate(e.date) }}</span>
          <span class="mtv__entry-project">{{ e.projectName ?? '—' }}</span>
          <span class="mtv__entry-desc">{{ e.description ?? '—' }}</span>
          <span class="mtv__entry-hours">{{ e.hours.toFixed(1) }} h</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NeoMessage } from '@neolibrary/components'
import api from '@/lib/api'

interface DayBucket {
  date: string
  label: string
  dateLabel: string
  hours: number
  isToday: boolean
}

interface TimeEntry {
  id: string
  date: string
  hours: number
  description: string | null
  projectName?: string | null
}

interface WeeklyResponse {
  weekStart?: string
  totalHours?: number
  byDay?: Array<{ date: string; hours: number }>
}

const error = ref<string | null>(null)
const loading = ref(false)
const weekStart = ref<string | null>(null)
const totalHours = ref(0)
const days = ref<DayBucket[]>([])
const entries = ref<TimeEntry[]>([])

const subtitle = computed<string>(() => {
  if (totalHours.value === 0) return 'Aucune heure loguée cette semaine.'
  return `${totalHours.value.toFixed(1)} h enregistrée(s) cette semaine.`
})

const weekStartLabel = computed<string>(() => {
  if (!weekStart.value) return '—'
  try { return new Date(weekStart.value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
  catch { return weekStart.value }
})

const totalHoursLabel = computed<string>(() => `${totalHours.value.toFixed(1)} h`)

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function buildEmptyWeek(): DayBucket[] {
  const today = new Date()
  const dayIdx = (today.getDay() + 6) % 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayIdx)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const isoDate = d.toISOString().slice(0, 10)
    const todayIso = today.toISOString().slice(0, 10)
    return {
      date: isoDate,
      label: DAY_LABELS[i],
      dateLabel: d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      hours: 0,
      isToday: isoDate === todayIso,
    }
  })
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) }
  catch { return iso }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const week = buildEmptyWeek()

    const weekRes = await api.get<WeeklyResponse>('/api/time-entries/week').catch(() => null)
    if (weekRes?.data) {
      weekStart.value = weekRes.data.weekStart ?? week[0].date
      totalHours.value = weekRes.data.totalHours ?? 0
      const byDay = weekRes.data.byDay ?? []
      const map = new Map(byDay.map((d) => [d.date, d.hours]))
      for (const d of week) d.hours = map.get(d.date) ?? 0
    } else {
      weekStart.value = week[0].date
    }
    days.value = week

    const entriesRes = await api.get<{ items?: TimeEntry[] }>('/api/time-entries').catch(() => null)
    const items = entriesRes?.data?.items ?? (Array.isArray(entriesRes?.data) ? (entriesRes.data as unknown as TimeEntry[]) : [])
    entries.value = items.slice(0, 25)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Erreur de chargement.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.mtv { padding: 1.75rem; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.mtv__head { margin-bottom: 0.25rem; }
.mtv__title { margin: 0 0 0.25rem 0; font-size: 1.5rem; color: var(--nl-text-1); }
.mtv__subtitle { margin: 0; color: var(--nl-text-3); font-size: 0.8125rem; }

.mtv__week-card,
.mtv__entries-card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.mtv__week-head,
.mtv__entries-head {
  display: flex; align-items: center; justify-content: space-between;
}
.mtv__week-head h2,
.mtv__entries-head h2 {
  margin: 0; font-size: 1rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.5rem; color: var(--nl-text-1);
}
.mtv__week-head h2 i,
.mtv__entries-head h2 i { color: var(--nl-accent); }
.mtv__week-total {
  font-weight: 700; font-size: 1.25rem; color: var(--nl-text-1);
}
.mtv__entries-count { font-size: 0.8125rem; color: var(--nl-text-3); }

.mtv__days {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
}
.mtv__day {
  display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
  padding: 0.75rem 0.5rem;
  background: var(--nl-surface-2, #fafafa);
  border: 1px solid var(--nl-border);
  border-radius: 6px;
}
.mtv__day--today { border-color: var(--nl-accent); background: var(--nl-accent-light, #ecfdf5); }
.mtv__day--empty { color: var(--nl-text-3); }
.mtv__day-name { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--nl-text-3); }
.mtv__day-date { font-size: 0.8125rem; color: var(--nl-text-2); }
.mtv__day-hours { font-weight: 700; font-size: 0.9375rem; color: var(--nl-text-1); }

.mtv__loading,
.mtv__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 2rem; color: var(--nl-text-3); text-align: center;
}
.mtv__empty i { font-size: 1.5rem; }

.mtv__entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.mtv__entry {
  display: grid; grid-template-columns: 140px 1fr 2fr auto;
  align-items: center; gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  background: var(--nl-card-bg, #fff);
  font-size: 0.8125rem;
}
.mtv__entry-date { color: var(--nl-text-3); font-size: 0.75rem; }
.mtv__entry-project { color: var(--nl-text-1); font-weight: 600; }
.mtv__entry-desc { color: var(--nl-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtv__entry-hours { font-weight: 700; color: var(--nl-text-1); }
@media (max-width: 700px) {
  .mtv__entry { grid-template-columns: 1fr 1fr; }
  .mtv__entry-desc { grid-column: 1 / -1; }
}
</style>
