<!-- @file MembersView.vue — Per-project team management with custom labels -->
<template>
  <ProjectModuleShell :project-id="id" title="Membres du projet">
    <template #actions>
      <NeoButton label="Ajouter un membre" icon="pi pi-user-plus" @click="openAddModal" />
    </template>

    <div class="mem">
      <table class="mem-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Rôle système</th>
            <th>Label dans le projet</th>
            <th class="mem-table__actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in store.members" :key="m.id">
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
          <tr v-if="!store.members.length && !store.loading">
            <td colspan="5" class="mem-empty">
              Aucun membre dans ce projet. Cliquez sur « Ajouter un membre » pour commencer.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal v-model:visible="showAddModal" header="Ajouter un membre au projet" width="520px">
      <div class="mem-form">
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
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoTag, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import AppModal from '@/components/common/AppModal.vue'
import { useProjectMembersStore, type ProjectMember } from '@/stores/projectMembersStore'
import api from '@/lib/api'

const props = defineProps<{ id: string }>()
const store = useProjectMembersStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

interface SystemUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
}
type SystemUserOption = SystemUser & { fullName: string }

const allUsers = ref<SystemUserOption[]>([])
const showAddModal = ref(false)
const adding = ref(false)
const newMember = reactive({ userId: '', label: '' })
const editingId = ref<string | null>(null)
const editingValue = ref('')

const availableUsers = computed<SystemUserOption[]>(() => {
  const taken = new Set(store.members.map((m) => m.userId))
  return allUsers.value.filter((u) => !taken.has(u.id))
})

async function loadAllUsers(): Promise<void> {
  try {
    const { data } = await api.get<SystemUser[] | { items: SystemUser[] }>('/pm/users')
    const list = Array.isArray(data) ? data : (data.items ?? [])
    allUsers.value = list.map((u) => ({ ...u, fullName: `${u.firstName} ${u.lastName} (${u.email})` }))
  } catch {
    allUsers.value = []
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
    const msg = err instanceof Error ? err.message : 'Échec de l\'ajout'
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
    const msg = err instanceof Error ? err.message : 'Échec'
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
      void doRemove(m.id)
    },
  })
}

async function doRemove(memberId: string): Promise<void> {
  try {
    await store.remove(props.id, memberId)
    toast.add({ severity: 'success', detail: 'Membre retiré.', life: 2500 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Échec'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  }
}

onMounted(async () => {
  await Promise.all([store.fetchAll(props.id), loadAllUsers()])
})
</script>

<style scoped>
.mem { padding: 1.5rem; overflow-y: auto; }
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
.mem-table__actions { width: 100px; text-align: right; }
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
.mem-field { display: flex; flex-direction: column; gap: 0.375rem; }
.mem-field__label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-muted, #6b7280); }
</style>
