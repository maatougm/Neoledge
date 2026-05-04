<!--
  @file     RolesView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Rôles & permissions — liste des rôles, édition matrice de permissions,
            clonage de presets. Admin uniquement (permission `role.manage`).
-->
<template>
  <div class="roles-page">
    <header class="page-header">
      <div>
        <h2>Rôles &amp; permissions</h2>
        <p class="muted">
          {{ store.roles.length }} rôle(s) · {{ store.catalog.length }} permission(s) disponibles
        </p>
      </div>
      <NeoButton
        label="Nouveau rôle"
        icon="pi pi-plus"
        :disabled="!canManage"
        @click="openCreate()"
      />
    </header>

    <div v-if="store.loading" class="muted">Chargement…</div>
    <div v-else-if="store.error" class="error">{{ store.error }}</div>

    <table v-else class="roles-table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Description</th>
          <th>Permissions</th>
          <th>Utilisateurs</th>
          <th>Type</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in store.roles" :key="role.id">
          <td class="name">{{ role.name }}</td>
          <td class="muted">{{ role.description || '—' }}</td>
          <td>{{ role.permissionKeys.length }}</td>
          <td>{{ role.assignmentCount }}</td>
          <td>
            <NeoTag v-if="role.isPreset" severity="info" value="Preset" />
            <NeoTag v-else severity="secondary" value="Custom" />
          </td>
          <td class="actions">
            <NeoButton
              icon="pi pi-pencil"
              text
              size="small"
              :label="role.isPreset ? 'Voir' : 'Modifier'"
              @click="openEdit(role)"
            />
            <NeoButton
              v-if="role.isPreset"
              icon="pi pi-copy"
              text
              size="small"
              label="Cloner"
              :disabled="!canManage"
              @click="clonePreset(role)"
            />
            <NeoButton
              v-if="!role.isPreset"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              label="Supprimer"
              :disabled="!canManage || role.assignmentCount > 0"
              @click="removeRole(role)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Role editor modal -->
    <AppModal
      v-model:visible="editorVisible"
      :header="editorHeader"
      size="large"
    >
      <div v-if="draft" class="editor">
        <div class="field">
          <label>Nom</label>
          <NeoInputText v-model="draft.name" :disabled="draft.isPreset" />
        </div>
        <div class="field">
          <label>Description</label>
          <NeoInputText v-model="draft.description" />
        </div>

        <h3>Permissions</h3>
        <div
          v-for="group in groupedCatalog"
          :key="group.resource"
          class="perm-group"
        >
          <div class="perm-group-header">
            <strong>{{ group.resource }}</strong>
            <span class="muted">
              {{ selectedCount(group) }} / {{ group.items.length }}
            </span>
            <button
              class="link"
              type="button"
              @click="toggleGroup(group, true)"
            >
              tout
            </button>
            <button
              class="link"
              type="button"
              @click="toggleGroup(group, false)"
            >
              rien
            </button>
          </div>
          <label
            v-for="p in group.items"
            :key="p.key"
            class="perm-row"
          >
            <input
              type="checkbox"
              :checked="draft.permissionKeys.has(p.key)"
              :disabled="draft.isPreset && draft.name === 'Admin'"
              @change="togglePerm(p.key, ($event.target as HTMLInputElement).checked)"
            />
            <code>{{ p.key }}</code>
            <span class="muted">{{ p.description }}</span>
          </label>
        </div>
      </div>

      <template #footer>
        <NeoButton label="Annuler" severity="secondary" @click="editorVisible = false" />
        <NeoButton
          label="Enregistrer"
          icon="pi pi-check"
          :disabled="!draft || !canManage || (draft.isPreset && draft.name === 'Admin')"
          @click="save()"
        />
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppModal from '@/components/common/AppModal.vue'
import { useRoleStore, type RoleSummary, type PermissionDef } from '@/stores/roleStore'
import {
  NeoButton,
  NeoInputText,
  NeoTag,
  useNeoToast,
  useNeoConfirm,
} from '@neolibrary/components'
import { usePermission } from '@/composables/usePermission'

const store = useRoleStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()
const canManage = usePermission('role.manage')

interface Draft {
  id: string | null
  name: string
  description: string
  isPreset: boolean
  permissionKeys: Set<string>
}

const editorVisible = ref(false)
const draft = ref<Draft | null>(null)

const editorHeader = computed(() => {
  if (!draft.value) return ''
  if (!draft.value.id) return 'Nouveau rôle'
  if (draft.value.isPreset) return `Préréglage — ${draft.value.name}`
  return `Rôle — ${draft.value.name}`
})

interface PermGroup {
  resource: string
  items: PermissionDef[]
}

const groupedCatalog = computed<PermGroup[]>(() => {
  const by = new Map<string, PermissionDef[]>()
  for (const p of store.catalog) {
    if (!by.has(p.resource)) by.set(p.resource, [])
    by.get(p.resource)!.push(p)
  }
  return Array.from(by.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, items]) => ({ resource, items }))
})

function selectedCount(group: PermGroup): number {
  if (!draft.value) return 0
  let n = 0
  for (const p of group.items) {
    if (draft.value.permissionKeys.has(p.key)) n += 1
  }
  return n
}

function openCreate(): void {
  draft.value = {
    id: null,
    name: '',
    description: '',
    isPreset: false,
    permissionKeys: new Set(),
  }
  editorVisible.value = true
}

function openEdit(role: RoleSummary): void {
  draft.value = {
    id: role.id,
    name: role.name,
    description: role.description ?? '',
    isPreset: role.isPreset,
    permissionKeys: new Set(role.permissionKeys),
  }
  editorVisible.value = true
}

function togglePerm(key: string, checked: boolean): void {
  if (!draft.value) return
  const next = new Set(draft.value.permissionKeys)
  if (checked) next.add(key)
  else next.delete(key)
  draft.value.permissionKeys = next
}

function toggleGroup(group: PermGroup, add: boolean): void {
  if (!draft.value) return
  const next = new Set(draft.value.permissionKeys)
  for (const p of group.items) {
    if (add) next.add(p.key)
    else next.delete(p.key)
  }
  draft.value.permissionKeys = next
}

async function save(): Promise<void> {
  if (!draft.value) return
  const payload = {
    name: draft.value.name.trim(),
    description: draft.value.description.trim() || undefined,
    permissionKeys: Array.from(draft.value.permissionKeys),
  }
  try {
    if (draft.value.id) {
      await store.updateRole(draft.value.id, payload)
      toast.add({ severity: 'success', detail: 'Rôle mis à jour', life: 2500 })
    } else {
      await store.createRole(payload)
      toast.add({ severity: 'success', detail: 'Rôle créé', life: 2500 })
    }
    editorVisible.value = false
  } catch (err) {
    toast.add({
      severity: 'error',
      detail: err instanceof Error ? err.message : 'Échec de la sauvegarde',
      life: 4000,
    })
  }
}

function clonePreset(role: RoleSummary): void {
  const newName = prompt(`Nom du clone de "${role.name}" :`, `${role.name} (copie)`)
  if (!newName) return
  store
    .cloneRole(role.id, newName)
    .then(() => toast.add({ severity: 'success', detail: 'Rôle cloné', life: 2500 }))
    .catch((err) =>
      toast.add({
        severity: 'error',
        detail: err instanceof Error ? err.message : 'Clone échoué',
        life: 4000,
      }),
    )
}

function removeRole(role: RoleSummary): void {
  confirm.require({
    message: `Supprimer le rôle "${role.name}" ? Cette action est irréversible.`,
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await store.deleteRole(role.id)
        toast.add({ severity: 'success', detail: 'Rôle supprimé', life: 2500 })
      } catch (err) {
        toast.add({
          severity: 'error',
          detail: err instanceof Error ? err.message : 'Suppression échouée',
          life: 4000,
        })
      }
    },
  })
}

onMounted(() => {
  void store.loadAll()
})
</script>

<style scoped>
.roles-page { padding: 24px; }
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px;
}
.muted { color: var(--neo-text-muted, #64748b); font-size: 0.9em; }
.error { color: var(--neo-color-danger, #ef4444); }
.roles-table {
  width: 100%; border-collapse: collapse;
}
.roles-table th, .roles-table td {
  border-bottom: 1px solid var(--neo-border, #e2e8f0);
  padding: 10px 8px; text-align: left;
}
.roles-table .name { font-weight: 600; }
.roles-table .actions { display: flex; gap: 8px; }
.editor .field { margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px; }
.editor h3 { margin-top: 16px; }
.perm-group { margin-bottom: 12px; border: 1px solid var(--neo-border, #e2e8f0); border-radius: 6px; padding: 10px; }
.perm-group-header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; text-transform: capitalize; }
.perm-group-header strong { font-size: 1em; }
.perm-row {
  display: grid; grid-template-columns: 20px 240px 1fr; gap: 8px;
  align-items: center; padding: 4px 0;
}
.perm-row code { font-size: 0.85em; }
.link { background: none; border: 0; color: var(--neo-color-primary, #0d9488); cursor: pointer; font-size: 0.85em; }
</style>
