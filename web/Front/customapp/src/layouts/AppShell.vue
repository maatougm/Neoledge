<!-- @file src/layouts/AppShell.vue — Root authenticated layout: sidebar + topbar + page content -->
<template>
  <div class="shell" :class="{ 'shell--pinned': uiStore.sidebarPinned }">
    <!-- Left: collapsible nav rail -->
    <AppSidebar />

    <!-- Right: main column -->
    <div class="shell__main">
      <AppTopbar />

      <main class="shell__content" id="main-content">
        <router-view />
      </main>
    </div>

    <!-- Global confirm dialog — required for useNeoConfirm() to work anywhere in the app -->
    <NeoConfirmDialog />
    <!-- Global toast — required for useNeoToast() to work anywhere in the app -->
    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { computed, provide, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useDarkMode } from '@/composables/useDarkMode'
import { useNotificationSocket } from '@/composables/useNotificationSocket'
import { NeoConfirmDialog, NeoToast } from '@neolibrary/components'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import type { NavSection } from '@/types/nav.types'

// ─── Stores & composables ─────────────────────────────────────────────────────

const uiStore     = useUiStore()
const authStore   = useAuthStore()
const configStore = useConfigStore()
const notifStore  = useNotificationStore()
const darkMode    = useDarkMode()
const { connect, disconnect } = useNotificationSocket()

// ─── Nav sections — computed from role so AppSidebar can inject them ──────────
// NOTE: provide() must be in AppShell (the ancestor), NOT in the role layout
// components (which are children of AppShell's <router-view> and therefore
// descendants, so inject would never find them from AppSidebar).

const adminNav: NavSection[] = [
  { items: [{ key: 'admin-dashboard', label: 'Tableau de bord', icon: 'pi-home',         to: '/app/admin/dashboard' }] },
  { heading: 'Gestion', items: [
      { key: 'admin-projects',  label: 'Projets',       icon: 'pi-briefcase', to: '/app/admin/projects'  },
      { key: 'admin-users',     label: 'Utilisateurs',  icon: 'pi-users',     to: '/app/admin/users'     },
      { key: 'admin-templates', label: 'Modèles',       icon: 'pi-copy',      to: '/app/admin/templates' },
  ]},
  { heading: 'Rapports', items: [
      { key: 'admin-analytics', label: 'Analytiques',   icon: 'pi-chart-bar', to: '/app/admin/analytics' },
      { key: 'admin-activity',  label: 'Activité',      icon: 'pi-history',   to: '/app/admin/activity'  },
      { key: 'admin-logs',      label: 'Journaux',      icon: 'pi-list',      to: '/app/admin/logs'      },
  ]},
  { heading: 'Système', items: [
      { key: 'admin-system',    label: 'Statut système', icon: 'pi-server',   to: '/app/admin/system'    },
      { key: 'admin-trash',     label: 'Corbeille',     icon: 'pi-trash',     to: '/app/admin/trash'     },
  ]},
]

const pmNav: NavSection[] = [
  { items: [{ key: 'pm-projects', label: 'Mes projets', icon: 'pi-briefcase', to: '/app/pm/projects' }] },
  { heading: 'Mon espace', items: [{ key: 'profile', label: 'Mon profil', icon: 'pi-user', to: '/app/profile' }] },
]

const teamNav: NavSection[] = [
  { items: [
      { key: 'team-projects',    label: 'Projets',     icon: 'pi-briefcase',    to: '/app/team/projects'    },
      { key: 'team-validations', label: 'Validations', icon: 'pi-check-circle', to: '/app/team/validations' },
  ]},
  { heading: 'Mon espace', items: [{ key: 'profile', label: 'Mon profil', icon: 'pi-user', to: '/app/profile' }] },
]

const navSections = computed<NavSection[]>(() => {
  if (authStore.userRole === 'Admin')          return adminNav
  if (authStore.userRole === 'ProjectManager') return pmNav
  return teamNav
})

provide('navItems', navSections)

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  uiStore.init()
  authStore.init()

  if (authStore.jwt && configStore.apiUrl) {
    void darkMode.loadFromBackend(authStore.jwt, configStore.apiUrl)
  }

  notifStore.startPolling()

  if (authStore.jwt && configStore.apiUrl) {
    connect(configStore.apiUrl, authStore.jwt)
  }
})

onUnmounted(() => {
  disconnect()
  notifStore.stopPolling()
})
</script>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--nl-bg);
}

/* Main column: fills everything to the right of the sidebar */
.shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* Leave space for the collapsed rail */
  margin-left: var(--nl-rail-width);
  transition: margin-left 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  background: var(--nl-bg);
}

/* When sidebar is pinned (always expanded), push main further right */
.shell--pinned .shell__main {
  margin-left: var(--nl-rail-expanded-width);
}

/* Page content area */
.shell__content {
  flex: 1;
  padding: 1.5rem 2rem;
  overflow-y: auto;
  min-width: 0;
}

/* Responsive: reduce padding on smaller screens */
@media (max-width: 768px) {
  .shell__content {
    padding: 1rem;
  }
}
</style>
