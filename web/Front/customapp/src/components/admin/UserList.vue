<!--
  @file     UserList.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-04-10
  @desc     Admin table listing all users — Rocketlane + Linear quality
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
            <th class="user-list__th-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="6">
              <div class="user-list__skeleton-wrap">
                <div v-for="n in 5" :key="n" class="user-list__skeleton-row" />
              </div>
            </td>
          </tr>
          <tr v-else-if="displayedUsers.length === 0">
            <td colspan="6">
              <div class="user-list__empty-state">
                <i class="pi pi-users user-list__empty-icon" />
                <span class="user-list__empty-text">Aucun utilisateur trouvé.</span>
              </div>
            </td>
          </tr>
          <tr
            v-for="user in displayedUsers"
            :key="user.id"
            :class="['user-list__row', { 'user-list__row--inactive': !user.isActive }]"
          >
            <td class="user-list__name-cell">
              <div class="user-list__user">
                <span :class="['user-list__avatar', avatarColorClass(user.role)]">
                  {{ userInitials(user.firstName, user.lastName) }}
                </span>
                <span class="user-list__full-name">{{ user.firstName }} {{ user.lastName }}</span>
              </div>
            </td>
            <td class="user-list__email-cell">{{ user.email }}</td>
            <td>
              <span :class="['user-list__role-badge', roleBadgeClass(user.role)]">
                {{ roleLabel(user.role) }}
              </span>
            </td>
            <td>
              <div class="user-list__status">
                <span :class="['user-list__status-dot', user.isActive ? 'user-list__status-dot--active' : 'user-list__status-dot--inactive']" />
                <span class="user-list__status-text">{{ user.isActive ? 'Actif' : 'Inactif' }}</span>
              </div>
            </td>
            <td class="user-list__date-cell">{{ formatDate(user.createdAt) }}</td>
            <td class="user-list__actions-cell">
              <div class="user-list__action-menu">
                <NeoButton
                  icon="pi pi-pencil"
                  severity="secondary"
                  text
                  size="small"
                  title="Modifier"
                  @click="emit('edit', user)"
                />
                <NeoButton
                  icon="pi pi-key"
                  severity="warn"
                  text
                  size="small"
                  title="Réinitialiser le mot de passe"
                  @click="emit('reset-password', user.id)"
                />
                <NeoButton
                  v-if="user.isActive"
                  icon="pi pi-ban"
                  severity="danger"
                  text
                  size="small"
                  title="Désactiver"
                  @click="emit('deactivate', user.id)"
                />
                <NeoButton
                  v-else
                  icon="pi pi-check-circle"
                  severity="secondary"
                  text
                  size="small"
                  title="Réactiver"
                  @click="emit('reactivate', user.id)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NeoButton, NeoMessage } from '@neolibrary/components'
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

/** Returns initials from first and last name */
function userInitials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
}

/** Avatar background class per role */
function avatarColorClass(role: UserRole): string {
  const map: Record<UserRole, string> = {
    Admin: 'user-list__avatar--admin',
    ProjectManager: 'user-list__avatar--pm',
    SpecificationTeam: 'user-list__avatar--team',
    RealizationTeam: 'user-list__avatar--team',
    DeploymentTeam: 'user-list__avatar--team',
    Viewer: 'user-list__avatar--viewer',
  }
  return map[role] ?? ''
}

/** Pill badge CSS class per role */
function roleBadgeClass(role: UserRole): string {
  const map: Record<UserRole, string> = {
    Admin: 'user-list__role-badge--admin',
    ProjectManager: 'user-list__role-badge--pm',
    SpecificationTeam: 'user-list__role-badge--team',
    RealizationTeam: 'user-list__role-badge--team',
    DeploymentTeam: 'user-list__role-badge--team',
    Viewer: 'user-list__role-badge--viewer',
  }
  return map[role] ?? ''
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' })
</script>

<style scoped>
.user-list { background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: var(--nl-radius-lg); box-shadow: var(--nl-shadow-md); padding: 1.5rem; }

.user-list__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }

.user-list__title { font-size: 1.125rem; font-weight: 700; color: var(--nl-text-1); margin: 0; letter-spacing: -0.01em; }

.user-list__error { margin-bottom: 1rem; }
.user-list__table-wrapper { overflow-x: auto; }

.user-list__table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }

.user-list__table th {
  padding: 0 1rem; height: 36px; text-align: left; font-size: 11px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--nl-text-3);
  background: var(--nl-surface-2); border-bottom: 1px solid var(--nl-border); white-space: nowrap;
}

.user-list__th-actions { text-align: right; }

.user-list__table td { padding: 0 1rem; height: 48px; border-bottom: 1px solid var(--nl-border); vertical-align: middle; color: var(--nl-text-2); }

/* ── Row hover with accent border ─────────────────────────────────────────── */
.user-list__row { position: relative; transition: background 0.12s; }

.user-list__row::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--nl-accent); opacity: 0; transition: opacity 0.12s;
}

.user-list__row:hover td { background: var(--nl-surface-2); }
.user-list__row:hover::before { opacity: 1; }
.user-list__row--inactive td { color: var(--nl-text-3); opacity: 0.65; }

/* ── Name + avatar ────────────────────────────────────────────────────────── */
.user-list__name-cell { white-space: nowrap; }
.user-list__user { display: flex; align-items: center; gap: 0.625rem; }

.user-list__avatar {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%; font-size: 10px; font-weight: 700; flex-shrink: 0;
}

.user-list__avatar--admin  { background: #DBEAFE; color: var(--nl-accent); }
.user-list__avatar--pm     { background: #EDE9FE; color: #7C3AED; }
.user-list__avatar--team   { background: var(--nl-success-light); color: var(--nl-success); }
.user-list__avatar--viewer { background: var(--nl-surface-2); color: var(--nl-text-3); }

.user-list__full-name  { font-weight: 600; color: var(--nl-text-1); }
.user-list__email-cell { color: var(--nl-text-3); font-size: 0.8125rem; }
.user-list__date-cell  { color: var(--nl-text-3); font-size: 0.8125rem; white-space: nowrap; }

/* ── Role pill ────────────────────────────────────────────────────────────── */
.user-list__role-badge {
  display: inline-block; padding: 3px 10px; border-radius: var(--nl-radius-pill);
  font-size: 0.75rem; font-weight: 600; white-space: nowrap;
}

.user-list__role-badge--admin  { background: #DBEAFE; color: var(--nl-accent); }
.user-list__role-badge--pm     { background: #EDE9FE; color: #7C3AED; }
.user-list__role-badge--team   { background: var(--nl-success-light); color: var(--nl-success); }
.user-list__role-badge--viewer { background: var(--nl-surface-2); color: var(--nl-text-3); }

/* ── Status dot ──────────────────────────────────────────────────────────── */
.user-list__status { display: flex; align-items: center; gap: 0.375rem; }
.user-list__status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.user-list__status-dot--active   { background: var(--nl-success); }
.user-list__status-dot--inactive { background: var(--nl-text-3); }
.user-list__status-text { font-size: 0.8125rem; color: var(--nl-text-2); }

/* ── Action menu (hover reveal) ──────────────────────────────────────────── */
.user-list__actions-cell { text-align: right; }

.user-list__action-menu { display: flex; gap: 0.125rem; justify-content: flex-end; opacity: 0; transition: opacity 0.15s; }
.user-list__row:hover .user-list__action-menu { opacity: 1; }

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
.user-list__skeleton-wrap { display: flex; flex-direction: column; gap: 8px; padding: 1rem 0; }

.user-list__skeleton-row {
  height: 40px; border-radius: var(--nl-radius);
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%; animation: ul-shimmer 1.4s infinite;
}

@keyframes ul-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
.user-list__empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 2.5rem; }
.user-list__empty-icon { font-size: 1.75rem; color: var(--nl-border-strong); }
.user-list__empty-text { font-size: 0.875rem; color: var(--nl-text-3); }
</style>
