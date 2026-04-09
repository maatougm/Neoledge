<!--
  @file     UserList.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Admin table listing all users with role badges, status toggle, and action menu
-->
<template>
  <div class="user-list">
    <!-- Header -->
    <div class="user-list__header">
      <h2 class="user-list__title">Gestion des utilisateurs</h2>
      <NeoButton
        label="Nouvel utilisateur"
        icon="pi pi-plus"
        @click="emit('create')"
      />
    </div>

    <!-- Error banner -->
    <NeoMessage
      v-if="store.error"
      severity="error"
      :text="store.error"
      :closable="true"
      class="user-list__error"
    />

    <!-- Table -->
    <div class="user-list__table-wrapper">
      <table class="user-list__table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>E-mail</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Créé le</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="6" class="user-list__loading">Chargement…</td>
          </tr>
          <tr v-else-if="displayedUsers.length === 0">
            <td colspan="6" class="user-list__empty">Aucun utilisateur trouvé.</td>
          </tr>
          <tr
            v-for="user in displayedUsers"
            :key="user.id"
            :class="['user-list__row', { 'user-list__row--inactive': !user.isActive }]"
          >
            <td>{{ user.firstName }} {{ user.lastName }}</td>
            <td>{{ user.email }}</td>
            <td>
              <NeoTag :value="roleLabel(user.role)" :severity="roleSeverity(user.role)" />
            </td>
            <td>
              <NeoTag
                :value="user.isActive ? 'Actif' : 'Inactif'"
                :severity="user.isActive ? 'success' : 'secondary'"
              />
            </td>
            <td>{{ formatDate(user.createdAt) }}</td>
            <td class="user-list__actions">
              <NeoButton
                icon="pi pi-pencil"
                severity="secondary"
                text
                size="small"
                @click="emit('edit', user)"
                title="Modifier"
              />
              <NeoButton
                icon="pi pi-key"
                severity="warn"
                text
                size="small"
                @click="emit('reset-password', user.id)"
                title="Réinitialiser le mot de passe"
              />
              <NeoButton
                v-if="user.isActive"
                icon="pi pi-ban"
                severity="danger"
                text
                size="small"
                @click="emit('deactivate', user.id)"
                title="Désactiver"
              />
              <NeoButton
                v-else
                icon="pi pi-check-circle"
                severity="success"
                text
                size="small"
                @click="emit('reactivate', user.id)"
                title="Réactiver"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NeoButton, NeoTag, NeoMessage } from '@neolibrary/components'
import { useUserStore } from '@/stores/userStore'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserResponse, UserRole } from '@/types/user.types'

const props = withDefaults(
  defineProps<{ users?: UserResponse[] }>(),
  { users: undefined },
)

const store = useUserStore()

const emit = defineEmits<{
  create: []
  edit: [user: UserResponse]
  'reset-password': [id: string]
  deactivate: [id: string]
  reactivate: [id: string]
}>()

onMounted(() => store.fetchAll())

const displayedUsers = computed(() => props.users ?? store.users)

const roleLabel = (role: UserRole) => USER_ROLE_LABELS[role] ?? role

const roleSeverity = (role: UserRole): "secondary" | "info" | "success" | "warn" | "danger" | "contrast" | "primary" => {
  const map: Record<UserRole, "secondary" | "info" | "success" | "warn" | "danger" | "contrast" | "primary"> = {
    Admin: 'danger',
    ProjectManager: 'info',
    SpecificationTeam: 'info',
    RealizationTeam: 'info',
    DeploymentTeam: 'info',
    Viewer: 'secondary',
  }
  return map[role] ?? 'secondary'
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' })
</script>

<style scoped>
.user-list {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg);
  border: 1px solid var(--nl-border);
  box-shadow: var(--nl-shadow);
  padding: 1.5rem;
}

.user-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.user-list__title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.user-list__error { margin-bottom: 1rem; }

.user-list__table-wrapper { overflow-x: auto; }

.user-list__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.user-list__table th,
.user-list__table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--nl-border);
}

.user-list__table th {
  font-weight: 600;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.user-list__row:hover td { background: var(--nl-surface-2); }
.user-list__row--inactive td { color: var(--nl-text-3); }

.user-list__actions { display: flex; gap: 0.25rem; }

.user-list__loading,
.user-list__empty {
  text-align: center;
  color: var(--nl-text-3);
  padding: 2rem;
}
</style>
