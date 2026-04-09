<!--
  @file     UserManagementSection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Gestion des utilisateurs — search, role filter, user list, dialogs
-->
<template>
  <div class="section">
    <!-- Header -->
    <div class="section-header">
      <div>
        <h2 class="section-title">Gestion des utilisateurs</h2>
        <p class="section-sub">
          {{ userStore.users.length }} utilisateur(s) ·
          {{ filteredUsers.length }} affiché(s)
        </p>
      </div>
      <NeoButton
        label="Nouvel utilisateur"
        icon="pi pi-user-plus"
        @click="um.openCreate()"
      />
    </div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <NeoInputIcon
        v-model="searchText"
        icon="pi pi-search"
        placeholder="Rechercher par nom ou e-mail…"
        class="filter-search"
      />
      <NeoSelect
        v-model="roleFilter"
        :options="roleFilterOptions"
        option-label="label"
        option-value="value"
        placeholder="Tous les rôles"
        class="filter-role"
      />
      <button
        v-if="searchText || roleFilter"
        class="clear-btn"
        @click="searchText = ''; roleFilter = ''"
        title="Effacer les filtres"
        aria-label="Effacer les filtres"
      >
        <i class="pi pi-times" />
        Effacer
      </button>
    </div>

    <!-- Results count when filtering -->
    <div v-if="searchText || roleFilter" class="filter-results">
      <i class="pi pi-filter" />
      {{ filteredUsers.length }} résultat(s) pour
      <strong v-if="searchText">« {{ searchText }} »</strong>
      <span v-if="searchText && roleFilter"> et </span>
      <strong v-if="roleFilter">{{ USER_ROLE_LABELS[roleFilter as UserRole] }}</strong>
    </div>

    <!-- Empty state when no users at all -->
    <div v-if="userStore.users.length === 0 && !userStore.loading" class="empty-state">
      <div class="empty-icon"><i class="pi pi-users" /></div>
      <p class="empty-title">Aucun utilisateur</p>
      <p class="empty-sub">Créez le premier compte pour commencer.</p>
      <NeoButton label="Créer un utilisateur" icon="pi pi-user-plus" @click="um.openCreate()" />
    </div>

    <!-- User list -->
    <UserList
      v-else
      :users="filteredUsers"
      @create="um.openCreate"
      @edit="um.openEdit"
      @reset-password="um.handleResetPassword"
      @deactivate="um.handleDeactivate"
      @reactivate="um.handleReactivate"
    />

    <!-- Create dialog -->
    <UserFormDialog
      :visible="um.showCreateDialog.value"
      :loading="userStore.loading"
      @close="um.showCreateDialog.value = false"
      @create="um.handleCreate"
    />

    <!-- Edit dialog -->
    <UserFormDialog
      :visible="um.showEditDialog.value"
      :user="um.editingUser.value"
      :loading="userStore.loading"
      @close="um.showEditDialog.value = false; um.editingUser.value = null"
      @update="um.handleUpdate"
    />

    <!-- Temp password dialog -->
    <Dialog
      :visible="um.showTempPasswordDialog.value"
      @update:visible="!$event && (um.showTempPasswordDialog.value = false)"
      header="Mot de passe temporaire"
      :modal="true"
      style="width: min(420px, 96vw)"
    >
      <div class="temp-body">
        <div class="temp-icon-wrap">
          <i class="pi pi-key" />
        </div>
        <p class="temp-instruction">
          Communiquez ce mot de passe à l'utilisateur de manière sécurisée.<br />
          Il devra le changer lors de sa prochaine connexion.
        </p>
        <div class="temp-password-box">
          <code class="temp-value">{{ um.tempPassword.value }}</code>
          <button
            class="copy-btn"
            title="Copier"
            aria-label="Copier le mot de passe"
            @click="copyTempPassword"
          >
            <i :class="['pi', copied ? 'pi-check' : 'pi-copy']" />
          </button>
        </div>
        <NeoMessage v-if="copied" severity="success" text="Copié dans le presse-papiers !" />
      </div>

      <template #footer>
        <NeoButton
          label="Fermer"
          severity="secondary"
          @click="um.showTempPasswordDialog.value = false; copied = false"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import { NeoButton, NeoInputIcon, NeoSelect, NeoMessage } from '@neolibrary/components'
import UserList       from '@/components/admin/UserList.vue'
import UserFormDialog from '@/components/admin/UserFormDialog.vue'
import { useUserManagement } from '@/composables/useUserManagement'
import { useUserStore } from '@/stores/userStore'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

const um        = useUserManagement()
const userStore = useUserStore()
const copied    = ref(false)

// ── Filters ────────────────────────────────────────────────────────────────────
const searchText = ref('')
const roleFilter = ref<UserRole | ''>('')

const roleFilterOptions = [
  { label: 'Tous les rôles', value: '' },
  ...Object.entries(USER_ROLE_LABELS).map(([value, label]) => ({ label, value })),
]

const filteredUsers = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const r = roleFilter.value
  return userStore.users.filter((u) => {
    const matchText = !q ||
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    const matchRole = !r || u.role === r
    return matchText && matchRole
  })
})

async function copyTempPassword(): Promise<void> {
  const pw = um.tempPassword.value
  if (!pw) return
  try {
    await navigator.clipboard.writeText(pw)
    copied.value = true
    setTimeout(() => { copied.value = false }, 3000)
  } catch { /* clipboard API may be unavailable */ }
}
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 1.25rem; }

/* ── Header ───────────────────────────────────────────────────────────────────── */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-title { font-size: 1.25rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.section-sub   { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

/* ── Filter bar ───────────────────────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.filter-search { flex: 1; min-width: 200px; }
.filter-role   { min-width: 200px; }

.clear-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  color: var(--nl-text-3);
  font-size: 0.8125rem;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.clear-btn:hover { background: var(--nl-surface-2); color: var(--nl-text-2); border-color: var(--nl-border-strong); }

.filter-results {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
}

.filter-results .pi { color: var(--nl-accent); }

/* ── Empty state ──────────────────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #f0fdfa;
  color: var(--nl-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.empty-title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-2); }
.empty-sub   { margin: 0; font-size: 0.875rem; color: var(--nl-text-3); }

/* ── Temp password dialog ─────────────────────────────────────────────────────── */
.temp-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0;
  text-align: center;
}

.temp-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--nl-accent), #0891b2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
}

.temp-instruction {
  margin: 0;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

.temp-password-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: var(--nl-radius);
  padding: 0.75rem 1rem;
  width: 100%;
}

.temp-value {
  flex: 1;
  font-size: 1.1rem;
  font-family: 'Courier New', monospace;
  letter-spacing: 0.1em;
  color: var(--nl-accent);
  word-break: break-all;
  text-align: left;
}

.copy-btn {
  background: none;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  color: var(--nl-text-3);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.copy-btn:hover { background: var(--nl-surface-2); color: var(--nl-accent); }
.copy-btn .pi-check { color: #10b981; }
</style>
