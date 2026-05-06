<!-- @file MembersView.vue — Per-project team management with custom labels -->
<template>
  <ProjectModuleShell :project-id="id" title="Membres du projet">
    <template #actions>
      <NeoButton label="Ajouter un membre" icon="pi pi-user-plus" @click="openAddModal" />
    </template>

    <div class="mem">
      <!-- Search / filter bar -->
      <div class="mem-toolbar">
        <span class="mem-search">
          <i class="pi pi-search mem-search__icon" />
          <NeoInputText
            v-model="filterText"
            placeholder="Rechercher un membre par nom, email ou label…"
          />
        </span>
        <span class="mem-toolbar__count">
          {{ filteredMembers.length }} / {{ store.members.length }}
        </span>
      </div>

      <table class="mem-table">
        <thead>
          <tr>
            <th class="mem-table__avatar"></th>
            <th>Nom</th>
            <th>Email</th>
            <th>Rôle système</th>
            <th>Label dans le projet</th>
            <th class="mem-table__actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <!-- Loading skeleton -->
          <tr v-if="store.loading && !store.members.length" class="mem-skel-row">
            <td colspan="6" class="mem-skel-cell">
              <TableSkeleton :rows="3" :cols="6" />
            </td>
          </tr>

          <!-- Member rows (filtered) -->
          <tr v-for="m in filteredMembers" :key="m.id">
            <td class="mem-table__avatar">
              <img
                v-if="m.user.avatarPath"
                :src="m.user.avatarPath"
                :alt="`${m.user.firstName} ${m.user.lastName}`"
                class="mem-avatar"
              />
              <span v-else class="mem-avatar mem-avatar--initials">
                {{ initials(m.user) }}
              </span>
            </td>
            <td>{{ m.user.firstName }} {{ m.user.lastName }}</td>
            <td>{{ m.user.email }}</td>
            <td><NeoTag :value="m.user.role" severity="info" /></td>
            <td>
              <div v-if="editingId === m.id" class="mem-edit">
                <NeoInputText v-model="editingValue" placeholder="ex: Lead Frontend" />
                <button class="mem-icon-btn mem-icon-btn--ok" @click="saveLabel(m.id)" title="Enregistrer">
                  <i class="pi pi-check" />
                </button>
                <button class="mem-icon-btn" @click="cancelEdit" title="Annuler">
                  <i class="pi pi-times" />
                </button>
              </div>
              <div v-else class="mem-label">
                <span :class="['mem-label__text', { 'mem-label__text--empty': !m.label }]">
                  {{ m.label || '— aucun label —' }}
                </span>
                <button class="mem-icon-btn" @click="startEdit(m)" title="Modifier le label">
                  <i class="pi pi-pencil" />
                </button>
              </div>
            </td>
            <td class="mem-table__actions">
              <NeoButton
                severity="danger"
                text
                icon="pi pi-trash"
                @click="confirmRemove(m)"
                :title="`Retirer ${m.user.firstName} du projet`"
              />
            </td>
          </tr>

          <!-- Empty state (only when not loading) -->
          <tr v-if="!store.members.length && !store.loading">
            <td colspan="6" class="mem-empty">
              Aucun membre dans ce projet. Cliquez sur « Ajouter un membre » pour commencer.
            </td>
          </tr>

          <!-- Filter produced no matches -->
          <tr v-else-if="store.members.length && !filteredMembers.length && !store.loading">
            <td colspan="6" class="mem-empty">
              Aucun membre ne correspond à « {{ filterText }} ».
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add member modal -->
    <AppModal v-model:visible="showAddModal" header="Ajouter un membre au projet" width="520px">
      <div class="mem-form">
        <NeoMessage v-if="usersLoadError" severity="error" :text="usersLoadError" />
        <div class="mem-field">
          <label class="mem-field__label">Utilisateur</label>
          <NeoSelect
            v-model="newMember.userId"
            :options="availableUsers"
            optionLabel="fullName"
            optionValue="id"
            placeholder="Choisir un utilisateur…"
            filter
          />
          <p v-if="!availableUsers.length && !usersLoadError" class="mem-field__hint">
            Aucun utilisateur éligible. Tous les utilisateurs sont déjà ajoutés ou n'ont pas un rôle compatible.
          </p>
        </div>
        <div class="mem-field">
          <label class="mem-field__label">Label dans le projet</label>
          <NeoInputText
            v-model="newMember.label"
            placeholder="ex: Lead Frontend, QA, Spécialiste GED…"
          />
        </div>
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showAddModal = false" />
        <NeoButton
          label="Ajouter"
          icon="pi pi-check"
          :loading="adding"
          :disabled="!newMember.userId"
          @click="onAdd"
        />
      </template>
    </AppModal>

    <!-- 409 conflict resolution modal: member has active references -->
    <AppModal v-model:visible="showBlockersModal" header="Ce membre a des références actives" width="560px">
      <div v-if="pendingRemoval" class="mem-blockers">
        <p class="mem-blockers__intro">
          Impossible de retirer
          <strong>{{ pendingRemoval.user.firstName }} {{ pendingRemoval.user.lastName }}</strong>
          du projet — des éléments lui sont rattachés :
        </p>
        <ul class="mem-blockers__list">
          <li v-if="blockers.workPackages > 0">
            <i class="pi pi-list" /> {{ blockers.workPackages }} tâche(s) assignée(s)
          </li>
          <li v-if="blockers.timeEntries > 0">
            <i class="pi pi-clock" /> {{ blockers.timeEntries }} heure(s) loguée(s)
          </li>
          <li v-if="blockers.watchers > 0">
            <i class="pi pi-eye" /> {{ blockers.watchers }} observation(s)
          </li>
          <li v-if="blockers.attendees > 0">
            <i class="pi pi-microphone" /> {{ blockers.attendees }} participation(s) à des réunions
          </li>
        </ul>

        <div class="mem-blockers__option">
          <label class="mem-field__label">Réassigner les tâches à un autre membre</label>
          <NeoSelect
            v-model="reassignTo"
            :options="reassignCandidates"
            optionLabel="fullName"
            optionValue="userId"
            placeholder="Choisir un membre…"
            filter
            :disabled="!reassignCandidates.length"
          />
          <p v-if="!reassignCandidates.length" class="mem-field__hint">
            Aucun autre membre disponible pour la réassignation.
          </p>
        </div>

        <p class="mem-blockers__warn">
          <i class="pi pi-exclamation-triangle" />
          « Supprimer quand même » dé-assignera toutes les tâches : elles deviendront non-assignées.
        </p>
      </div>

      <template #footer>
        <!-- Layout: danger on the far LEFT, spacer, then Cancel + primary on the RIGHT.
             Stops users from accidentally clicking "Supprimer quand même" while reaching for
             the recommended "Réassigner et retirer" path. -->
        <NeoButton
          label="Supprimer quand même"
          icon="pi pi-trash"
          severity="danger"
          outlined
          :loading="resolvingBlockers"
          @click="forceRemove"
        />
        <span class="mem-blockers__spacer" />
        <NeoButton label="Annuler" severity="secondary" outlined @click="closeBlockersModal" />
        <NeoButton
          label="Réassigner et retirer"
          icon="pi pi-arrows-h"
          :loading="resolvingBlockers"
          :disabled="!reassignTo"
          @click="reassignAndRemove"
        />
      </template>
    </AppModal>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoMessage, NeoSelect, NeoTag, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import AppModal from '@/components/common/AppModal.vue'
import TableSkeleton from '@/components/common/TableSkeleton.vue'
import { useProjectMembersStore, type ProjectMember } from '@/stores/projectMembersStore'
import { useAuthStore } from '@/stores/authStore'
import api from '@/lib/api'

const props = defineProps<{ id: string }>()
const store = useProjectMembersStore()
const auth = useAuthStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

interface SystemUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  isActive?: boolean
}
type SystemUserOption = SystemUser & { fullName: string }

interface Blockers {
  workPackages: number
  timeEntries: number
  watchers: number
  attendees: number
}

// Roles that should never be addable as project members.
const EXCLUDED_ROLES = new Set(['Admin', 'Viewer'])

const allUsers = ref<SystemUserOption[]>([])
const showAddModal = ref(false)
const adding = ref(false)
const newMember = reactive({ userId: '', label: '' })
const editingId = ref<string | null>(null)
const editingValue = ref('')

// Search / filter
const filterText = ref('')

const filteredMembers = computed<ProjectMember[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return store.members
  return store.members.filter((m) => {
    const haystack = [
      `${m.user.firstName} ${m.user.lastName}`,
      m.user.email,
      m.label,
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})

// 409 conflict resolution state
const showBlockersModal = ref(false)
const pendingRemoval = ref<ProjectMember | null>(null)
const blockers = reactive<Blockers>({ workPackages: 0, timeEntries: 0, watchers: 0, attendees: 0 })
const reassignTo = ref<string>('')
const resolvingBlockers = ref(false)

const reassignCandidates = computed<Array<{ userId: string; fullName: string }>>(() => {
  if (!pendingRemoval.value) return []
  const exclude = pendingRemoval.value.userId
  return store.members
    .filter((m) => m.userId !== exclude)
    .map((m) => ({
      userId: m.userId,
      fullName: `${m.user.firstName} ${m.user.lastName}${m.label ? ` — ${m.label}` : ''}`,
    }))
})

const availableUsers = computed<SystemUserOption[]>(() => {
  const taken = new Set(store.members.map((m) => m.userId))
  const meId = auth.userId ?? ''
  const pmId = store.projectManagerId
  return allUsers.value.filter((u) => {
    if (taken.has(u.id)) return false
    if (meId && u.id === meId) return false                  // PM can't add themselves
    if (pmId && u.id === pmId) return false                  // project's PM is implicit
    if (u.isActive === false) return false                   // skip inactive (defensive)
    if (EXCLUDED_ROLES.has(u.role)) return false             // Admin / Viewer not addable
    return true
  })
})

function initials(u: ProjectMember['user']): string {
  return ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || '?'
}

const usersLoadError = ref<string | null>(null)
async function loadAllUsers(): Promise<void> {
  usersLoadError.value = null
  try {
    // forMembers=true lets the backend filter out inactive + Admin/Viewer.
    // Without that flag the endpoint returns every user (used elsewhere for
    // assignee dropdowns), so we'd have to do the same filtering on the
    // client and pull more data than needed.
    const { data } = await api.get<SystemUser[] | { items: SystemUser[] }>('/pm/users?forMembers=true')
    const list = Array.isArray(data) ? data : (data.items ?? [])
    allUsers.value = list.map((u) => ({ ...u, fullName: `${u.firstName} ${u.lastName} (${u.email})` }))
  } catch (err: unknown) {
    allUsers.value = []
    usersLoadError.value = errMessage(err) ?? 'Impossible de charger la liste des utilisateurs.'
  }
}

function openAddModal(): void {
  newMember.userId = ''
  newMember.label = ''
  showAddModal.value = true
}

async function onAdd(): Promise<void> {
  if (!newMember.userId) return
  adding.value = true
  try {
    await store.add(props.id, newMember.userId, newMember.label.trim())
    toast.add({ severity: 'success', detail: 'Membre ajouté.', life: 3000 })
    showAddModal.value = false
  } catch (err: unknown) {
    const msg = errMessage(err) ?? 'Échec de l\'ajout'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    adding.value = false
  }
}

function startEdit(m: ProjectMember): void {
  editingId.value = m.id
  editingValue.value = m.label
}

function cancelEdit(): void {
  editingId.value = null
  editingValue.value = ''
}

async function saveLabel(memberId: string): Promise<void> {
  try {
    await store.updateLabel(props.id, memberId, editingValue.value.trim())
    toast.add({ severity: 'success', detail: 'Label mis à jour.', life: 2500 })
    cancelEdit()
  } catch (err: unknown) {
    const msg = errMessage(err) ?? 'Échec'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  }
}

function confirmRemove(m: ProjectMember): void {
  confirm.require({
    message: `Retirer ${m.user.firstName} ${m.user.lastName} du projet ?`,
    header: 'Confirmer le retrait',
    acceptLabel: 'Retirer',
    rejectLabel: 'Annuler',
    acceptClass: 'p-button-danger',
    accept: () => {
      void doRemove(m)
    },
  })
}

/** Initial delete attempt — no force, no reassign. May get a 409 with blockers. */
async function doRemove(m: ProjectMember): Promise<void> {
  try {
    await api.delete(`/pm/projects/${props.id}/members/${m.id}`)
    await store.fetchAll(props.id)
    toast.add({ severity: 'success', detail: 'Membre retiré.', life: 2500 })
  } catch (err: unknown) {
    if (handleBlockersError(err, m)) return
    toast.add({ severity: 'error', detail: errMessage(err) ?? 'Échec', life: 5000 })
  }
}

/** Returns true if the error was a 409 with blockers and the modal was opened. */
function handleBlockersError(err: unknown, m: ProjectMember): boolean {
  const resp = (err as { response?: { status?: number; data?: { code?: string; blockers?: Partial<Blockers> } } })?.response
  if (resp?.status !== 409) return false
  const body = resp.data
  if (body?.code !== 'MEMBER_HAS_BLOCKERS') return false

  pendingRemoval.value = m
  blockers.workPackages = body.blockers?.workPackages ?? 0
  blockers.timeEntries = body.blockers?.timeEntries ?? 0
  blockers.watchers = body.blockers?.watchers ?? 0
  blockers.attendees = body.blockers?.attendees ?? 0
  reassignTo.value = ''
  showBlockersModal.value = true
  return true
}

function closeBlockersModal(): void {
  showBlockersModal.value = false
  pendingRemoval.value = null
  reassignTo.value = ''
}

async function forceRemove(): Promise<void> {
  if (!pendingRemoval.value) return
  resolvingBlockers.value = true
  try {
    await api.delete(`/pm/projects/${props.id}/members/${pendingRemoval.value.id}?force=true`)
    await store.fetchAll(props.id)
    toast.add({
      severity: 'success',
      detail: 'Membre retiré. Les tâches concernées sont désormais non-assignées.',
      life: 4000,
    })
    closeBlockersModal()
  } catch (err: unknown) {
    toast.add({ severity: 'error', detail: errMessage(err) ?? 'Échec', life: 5000 })
  } finally {
    resolvingBlockers.value = false
  }
}

async function reassignAndRemove(): Promise<void> {
  if (!pendingRemoval.value || !reassignTo.value) return
  resolvingBlockers.value = true
  try {
    await api.delete(
      `/pm/projects/${props.id}/members/${pendingRemoval.value.id}?reassignTo=${encodeURIComponent(reassignTo.value)}`,
    )
    await store.fetchAll(props.id)
    toast.add({
      severity: 'success',
      detail: 'Membre retiré et tâches réassignées.',
      life: 4000,
    })
    closeBlockersModal()
  } catch (err: unknown) {
    toast.add({ severity: 'error', detail: errMessage(err) ?? 'Échec', life: 5000 })
  } finally {
    resolvingBlockers.value = false
  }
}

function errMessage(err: unknown): string | null {
  const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
  if (resp?.message) return resp.message
  return err instanceof Error ? err.message : null
}

onMounted(async () => {
  // Clear stale state from a previously-visited project before fetching this one.
  store.reset()
  await Promise.all([store.fetchAll(props.id), loadAllUsers()])
})
</script>

<style scoped>
.mem { padding: 1.5rem; overflow-y: auto; }

.mem-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.mem-search {
  position: relative;
  flex: 1;
  max-width: 480px;
  display: inline-block;
}
.mem-search :deep(input) { padding-left: 2.25rem; width: 100%; }
.mem-search__icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--nl-text-muted, #9ca3af);
  pointer-events: none;
  z-index: 1;
}
.mem-toolbar__count { font-size: 0.8125rem; color: var(--nl-text-muted, #6b7280); }

.mem-table {
  width: 100%;
  background: var(--nl-card-bg, #fff);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-collapse: collapse;
}
.mem-table th, .mem-table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.mem-table th {
  background: var(--nl-table-header-bg, #f3f4f6);
  font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--nl-text-muted, #6b7280);
}
.mem-table__avatar { width: 56px; padding-right: 0 !important; }
.mem-table__actions { width: 100px; text-align: right; }

.mem-skel-row td { padding: 0 !important; }
.mem-skel-cell { padding: 0 !important; }

.mem-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--nl-accent, #1e9e8f);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid var(--nl-border, #e5e7eb);
}
.mem-avatar--initials { letter-spacing: 0.025em; }

.mem-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem !important; font-style: italic; }
.mem-label { display: inline-flex; align-items: center; gap: 0.5rem; }
.mem-label__text { font-size: 0.875rem; }
.mem-label__text--empty { color: var(--nl-text-muted, #9ca3af); font-style: italic; }
.mem-edit { display: inline-flex; align-items: center; gap: 0.375rem; }
.mem-icon-btn {
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  color: var(--nl-text-muted, #6b7280);
}
.mem-icon-btn:hover { background: var(--nl-surface-2, #f3f4f6); color: var(--nl-text, #111827); }
.mem-icon-btn--ok:hover { color: var(--nl-accent, #1e9e8f); }

.mem-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.mem-blockers__spacer { flex: 1; }
.mem-field { display: flex; flex-direction: column; gap: 0.375rem; }
.mem-field__label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-muted, #6b7280); }
.mem-field__hint { font-size: 0.75rem; color: var(--nl-text-muted, #9ca3af); margin: 0.25rem 0 0; }

.mem-blockers { display: flex; flex-direction: column; gap: 0.875rem; padding: 0.25rem 0; }
.mem-blockers__intro { margin: 0; font-size: 0.875rem; color: var(--nl-text, #111827); }
.mem-blockers__list {
  list-style: none;
  margin: 0;
  padding: 0.625rem 0.875rem;
  background: var(--nl-surface-2, #f3f4f6);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.mem-blockers__list li { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--nl-text-2, #374151); }
.mem-blockers__list i { color: var(--nl-accent, #1e9e8f); width: 18px; text-align: center; }
.mem-blockers__option { display: flex; flex-direction: column; gap: 0.375rem; }
.mem-blockers__warn {
  margin: 0;
  font-size: 0.8125rem;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
