<!--
  @file     ProjectTableRow.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Single project table row — used inside ProjectList.vue
-->
<template>
  <tr
    class="ptr"
    :class="{ 'ptr--selected': selected }"
  >
    <!-- Checkbox -->
    <td class="ptr__td-check">
      <input
        type="checkbox"
        :checked="selected"
        @change="emit('toggle-select')"
        class="ptr__checkbox"
        :aria-label="`Sélectionner ${project.name}`"
      />
    </td>

    <!-- Name -->
    <td class="ptr__name" @click="emit('view')">{{ project.name }}</td>

    <!-- Client -->
    <td class="ptr__muted">{{ project.clientName }}</td>

    <!-- PM -->
    <td>
      <div v-if="project.projectManagerName" class="ptr__pm">
        <span class="ptr__avatar">{{ initials(project.projectManagerName) }}</span>
        <span class="ptr__pm-name">{{ project.projectManagerName }}</span>
      </div>
      <NeoButton
        v-else
        label="Assigner"
        severity="secondary"
        text
        size="small"
        @click="emit('assign-manager')"
      />
    </td>

    <!-- Status -->
    <td>
      <span :class="['ptr__badge', statusBadgeClass(project.status)]">
        {{ statusLabel(project.status) }}
      </span>
    </td>

    <!-- Progress -->
    <td class="ptr__progress-cell">
      <span v-if="!progress" class="ptr__muted">—</span>
      <template v-else>
        <div class="ptr__progress-track">
          <div class="ptr__progress-fill" :style="progressFillStyle" />
        </div>
        <span class="ptr__progress-label">{{ progress }}%</span>
      </template>
    </td>

    <!-- Start / End -->
    <td class="ptr__muted">{{ formatDate(project.startDate) }}</td>
    <td class="ptr__muted">{{ formatDate(project.endDate) }}</td>

    <!-- Actions: primary "Ouvrir" + overflow ⋯ menu -->
    <td class="ptr__actions-cell">
      <div class="ptr__action-menu">
        <NeoButton
          icon="pi pi-external-link" severity="secondary" text size="small"
          title="Ouvrir (modules)" aria-label="Ouvrir le projet avec tous les modules"
          @click="emit('open')"
        />
        <div class="ptr__overflow" @click.stop>
          <NeoButton
            ref="triggerBtn"
            icon="pi pi-ellipsis-h" severity="secondary" text size="small"
            title="Plus d'actions" aria-label="Menu des actions"
            @click="openMenu"
          />
          <Teleport to="body">
            <div
              v-if="menuOpen"
              class="ptr__overflow-menu"
              role="menu"
              :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
              @click="menuOpen = false"
            >
              <button role="menuitem" @click="emit('view')"><i class="pi pi-eye" /> Voir (panneau)</button>
              <button role="menuitem" @click="emit('edit')"><i class="pi pi-pencil" /> Modifier</button>
              <button role="menuitem" @click="emit('assign-manager')"><i class="pi pi-user-plus" /> Assigner un chef</button>
              <div class="ptr__overflow-sep" />
              <button role="menuitem" class="ptr__overflow-danger" @click="emit('delete')"><i class="pi pi-trash" /> Supprimer</button>
            </div>
          </Teleport>
        </div>
      </div>
    </td>
  </tr>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NeoButton } from '@neolibrary/components'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'

const menuOpen = ref<boolean>(false)
const menuPos   = ref<{ top: number; left: number }>({ top: 0, left: 0 })
const triggerBtn = ref<unknown>(null)

function openMenu(event: MouseEvent): void {
  const btn = (event.currentTarget as HTMLElement | null) ?? (event.target as HTMLElement | null)
  if (btn) {
    const rect = btn.getBoundingClientRect()
    const MENU_WIDTH = 200
    menuPos.value = {
      top: rect.bottom + 4,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    }
  }
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void { menuOpen.value = false }
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))

const props = defineProps<{
  project: ProjectSummary
  selected: boolean
  progress: number
}>()

const emit = defineEmits<{
  'toggle-select': []
  view: []
  open: []
  edit: []
  delete: []
  'assign-manager': []
}>()

const statusLabel = (s: ProjectStatus) => PROJECT_STATUS_LABELS[s] ?? s

function statusBadgeClass(s: ProjectStatus): string {
  const map: Record<string, string> = {
    Draft: 'ptr__badge--draft',
    InProgress: 'ptr__badge--inprogress',
    SpecificationValidation: 'ptr__badge--spec',
    Realization: 'ptr__badge--realization',
    DeploymentValidation: 'ptr__badge--deploy',
    Completed: 'ptr__badge--completed',
  }
  return map[s] ?? ''
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

const progressFillStyle = computed(() => {
  const pct = props.progress
  const color = pct >= 80 ? 'var(--nl-success)' : pct >= 50 ? 'var(--nl-warning)' : 'var(--nl-danger)'
  return { width: `${pct}%`, background: color }
})

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' }) : '—'
</script>

<style scoped>
/* ── Row base ─────────────────────────────────────────────────────────────── */
.ptr {
  position: relative;
  transition: background 0.12s;
}

.ptr::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--nl-accent);
  opacity: 0;
  transition: opacity 0.12s;
}

.ptr td {
  padding: 0 1rem;
  height: 48px;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
  color: var(--nl-text-2);
}

.ptr:hover td { background: var(--nl-surface-2); }
.ptr:hover::before { opacity: 1; }
.ptr--selected td { background: var(--nl-accent-light); }

/* ── Checkbox ─────────────────────────────────────────────────────────────── */
.ptr__td-check { width: 2.5rem; padding: 0 0.5rem 0 1rem; }

.ptr__checkbox {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--nl-accent);
}

/* ── Name cell ─────────────────────────────────────────────────────────────── */
.ptr__name {
  font-weight: 600;
  color: var(--nl-accent);
  cursor: pointer;
  white-space: nowrap;
}
.ptr__name:hover { text-decoration: underline; }

/* ── Muted cells ───────────────────────────────────────────────────────────── */
.ptr__muted { color: var(--nl-text-3); font-size: 0.8125rem; white-space: nowrap; }

/* ── PM ────────────────────────────────────────────────────────────────────── */
.ptr__pm { display: flex; align-items: center; gap: 0.5rem; }

.ptr__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--nl-accent-light);
  color: var(--nl-accent);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.ptr__pm-name { font-size: 0.8125rem; color: var(--nl-text-2); white-space: nowrap; }

/* ── Status pill ───────────────────────────────────────────────────────────── */
.ptr__badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--nl-radius-pill);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.ptr__badge--draft       { background: var(--nl-surface-2);    color: var(--nl-text-3); }
.ptr__badge--inprogress  { background: var(--nl-accent-light);  color: var(--nl-accent); }
.ptr__badge--spec        { background: #F5F3FF;                 color: #7C3AED; }
.ptr__badge--realization { background: #FFF7ED;                 color: var(--nl-warning); }
.ptr__badge--deploy      { background: #EFF6FF;                 color: #2563EB; }
.ptr__badge--completed   { background: var(--nl-success-light); color: var(--nl-success); }

/* ── Progress ─────────────────────────────────────────────────────────────── */
.ptr__progress-cell { display: flex; align-items: center; gap: 0.5rem; min-width: 110px; }

.ptr__progress-track {
  flex: 1;
  height: 4px;
  background: var(--nl-border);
  border-radius: var(--nl-radius-pill);
  overflow: hidden;
}

.ptr__progress-fill {
  height: 100%;
  border-radius: var(--nl-radius-pill);
  transition: width 0.3s ease;
}

.ptr__progress-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-2);
  white-space: nowrap;
  min-width: 30px;
  text-align: right;
}

/* ── Action menu ───────────────────────────────────────────────────────────── */
.ptr__actions-cell { text-align: right; }

.ptr__action-menu {
  display: flex;
  gap: 0.125rem;
  justify-content: flex-end;
  opacity: 1;
}

.ptr__overflow { position: relative; }
/* .ptr__overflow-menu styles are in main.css (teleported — not scoped) */
</style>
