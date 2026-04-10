<!-- @file src/layouts/AppTopbar.vue — Fixed topbar with breadcrumb, search, notifications, user menu -->
<template>
  <header class="topbar">
    <!-- Left: breadcrumb -->
    <div class="topbar__left">
      <nav class="topbar__breadcrumb" aria-label="Fil d'Ariane">
        <span class="topbar__breadcrumb-home">NeoLeadge</span>
        <i v-if="breadcrumbLabel" class="pi pi-chevron-right topbar__breadcrumb-sep" aria-hidden="true" />
        <span v-if="breadcrumbLabel" class="topbar__breadcrumb-current">{{ breadcrumbLabel }}</span>
      </nav>
    </div>

    <!-- Right: search + actions -->
    <div class="topbar__right">
      <!-- Search -->
      <div class="topbar__search">
        <i class="pi pi-search topbar__search-icon" aria-hidden="true" />
        <input
          v-model="searchQuery"
          class="topbar__search-input"
          type="search"
          placeholder="Rechercher…"
          aria-label="Rechercher"
        />
      </div>

      <!-- Notification panel -->
      <NotificationPanel />

      <!-- Dark mode toggle -->
      <button
        class="topbar-icon-btn"
        :title="darkMode.isDark.value ? 'Passer en mode clair' : 'Passer en mode sombre'"
        :aria-label="darkMode.isDark.value ? 'Activer le mode clair' : 'Activer le mode sombre'"
        @click="darkMode.toggle()"
      >
        <i :class="`pi ${darkMode.isDark.value ? 'pi-sun' : 'pi-moon'}`" />
      </button>

      <!-- User menu -->
      <UserMenu />
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useDarkMode } from '@/composables/useDarkMode'
import NotificationPanel from './NotificationPanel.vue'
import UserMenu from './UserMenu.vue'

// ─── Composables ─────────────────────────────────────────────────────────────

const route = useRoute()
const darkMode = useDarkMode()

// ─── State ────────────────────────────────────────────────────────────────────

const searchQuery = ref('')

// ─── Breadcrumb label mapping ─────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  'admin-dashboard':     'Tableau de bord',
  'admin-projects':      'Projets',
  'admin-project-detail':'Détail du projet',
  'admin-users':         'Utilisateurs',
  'admin-activity':      'Activité',
  'admin-analytics':     'Analytiques',
  'admin-templates':     'Modèles',
  'admin-logs':          'Journaux',
  'admin-system':        'Système',
  'admin-trash':         'Corbeille',
  'pm-projects':         'Mes projets',
  'team-projects':       'Projets',
  'team-project-detail': 'Détail du projet',
  'team-validations':    'Mes validations',
  'profile':             'Profil',
}

const breadcrumbLabel = computed<string>(() => {
  const name = route.name as string | undefined
  if (!name) return ''
  return ROUTE_LABELS[name] ?? ''
})
</script>

<style scoped>
/* ── Topbar shell ──────────────────────────────────────────────────────────── */
.topbar {
  position: sticky;
  top: 0;
  height: var(--nl-topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  background: var(--nl-topbar-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--nl-topbar-border);
  z-index: 50;
  flex-shrink: 0;
}

/* ── Left — breadcrumb ─────────────────────────────────────────────────────── */
.topbar__left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.topbar__breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
}

.topbar__breadcrumb-home {
  font-weight: 600;
  color: var(--nl-text-2);
}

.topbar__breadcrumb-sep {
  font-size: 0.5625rem;
  color: var(--nl-text-3);
}

.topbar__breadcrumb-current {
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

/* ── Right — actions row ───────────────────────────────────────────────────── */
.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Search ────────────────────────────────────────────────────────────────── */
.topbar__search {
  position: relative;
  display: flex;
  align-items: center;
}

.topbar__search-icon {
  position: absolute;
  left: 10px;
  font-size: 0.75rem;
  color: var(--nl-text-3);
  pointer-events: none;
}

.topbar__search-input {
  height: 34px;
  width: 200px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
  color: var(--nl-text-1);
  font-family: var(--nl-font);
  font-size: 0.8125rem;
  transition: border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.topbar__search-input::placeholder {
  color: var(--nl-text-3);
}

.topbar__search-input:focus {
  border-color: var(--nl-accent);
  box-shadow: 0 0 0 3px var(--nl-accent-light);
}

/* Cancel button from browser (search type) */
.topbar__search-input::-webkit-search-cancel-button {
  cursor: pointer;
}

/* ── Shared icon button style (dark-mode toggle & any other icon btn) ───────── */
.topbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: transparent;
  color: var(--nl-text-2);
  cursor: pointer;
  font-size: 0.9375rem;
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
}

.topbar-icon-btn:hover {
  background: var(--nl-surface-2);
  color: var(--nl-text-1);
  border-color: var(--nl-border-strong);
}

.topbar-icon-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}
</style>
