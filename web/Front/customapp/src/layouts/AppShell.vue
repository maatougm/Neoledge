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

    <!-- Keyboard shortcut help (?) + global search (Ctrl+K) -->
    <KeyboardHelpDialog v-model:visible="kb.helpVisible.value" />
    <AppSearchModal v-model:visible="kb.searchVisible.value" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, provide, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useDarkMode } from '@/composables/useDarkMode'
import { useNotificationSocket } from '@/composables/useNotificationSocket'
import { useCollaborationSocket } from '@/composables/useCollaborationSocket'
import { NeoConfirmDialog, NeoToast } from '@neolibrary/components'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import KeyboardHelpDialog from '@/components/common/KeyboardHelpDialog.vue'
import AppSearchModal from '@/components/common/AppSearchModal.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import type { NavSection } from '@/types/nav.types'

const kb = useKeyboardShortcuts()

const route = useRoute()
const router = useRouter()

// ─── Stores & composables ─────────────────────────────────────────────────────

const uiStore     = useUiStore()
const authStore   = useAuthStore()
const configStore = useConfigStore()
const notifStore  = useNotificationStore()
const darkMode    = useDarkMode()
const { connect, disconnect } = useNotificationSocket()
const collab      = useCollaborationSocket()

// ─── Nav sections — computed from role so AppSidebar can inject them ──────────
// NOTE: provide() must be in AppShell (the ancestor), NOT in the role layout
// components (which are children of AppShell's <router-view> and therefore
// descendants, so inject would never find them from AppSidebar).

const adminNav: NavSection[] = [
  { items: [
      { key: 'app-home',          label: 'Accueil',         icon: 'pi-inbox',        to: '/app' },
      { key: 'admin-dashboard',   label: 'Tableau de bord', icon: 'pi-chart-line',   to: '/app/admin/dashboard' },
  ]},
  { heading: 'Gestion', items: [
      { key: 'admin-projects',  label: 'Projets',       icon: 'pi-briefcase', to: '/app/admin/projects'  },
      { key: 'admin-users',     label: 'Utilisateurs',  icon: 'pi-users',     to: '/app/admin/users'     },
      { key: 'admin-templates', label: 'Modèles',       icon: 'pi-copy',      to: '/app/admin/templates' },
  ]},
  { heading: 'Rapports', items: [
      { key: 'admin-analytics',     label: 'Analytiques',  icon: 'pi-chart-bar',  to: '/app/admin/analytics' },
      { key: 'admin-activity',      label: 'Activité',     icon: 'pi-history',    to: '/app/admin/activity'  },
      { key: 'admin-logs',          label: 'Journaux',     icon: 'pi-list',       to: '/app/admin/logs'      },
      { key: 'admin-portfolio',     label: 'Portefeuille', icon: 'pi-chart-pie',  to: '/app/admin/portfolio' },
      { key: 'admin-team-planner',  label: 'Planif. équipe', icon: 'pi-calendar', to: '/app/admin/team-planner' },
  ]},
  { heading: 'Système', items: [
      { key: 'admin-system',    label: 'Statut système', icon: 'pi-server',   to: '/app/admin/system'    },
      { key: 'admin-audit',     label: 'Audit',          icon: 'pi-shield',   to: '/app/admin/audit'     },
      { key: 'admin-trash',     label: 'Corbeille',      icon: 'pi-trash',    to: '/app/admin/trash'     },
  ]},
]

const pmNav: NavSection[] = [
  { items: [
      { key: 'app-home',        label: 'Accueil',        icon: 'pi-inbox',     to: '/app' },
      { key: 'pm-projects',     label: 'Mes projets',    icon: 'pi-briefcase', to: '/app/pm/projects' },
  ]},
  { heading: 'Travail', items: [
      { key: 'pm-my-tasks',     label: 'Mes tâches',    icon: 'pi-list',     to: '/app/pm/my-tasks' },
      { key: 'pm-team-planner', label: 'Planif. équipe', icon: 'pi-calendar', to: '/app/pm/team-planner' },
  ]},
  { heading: 'Mon espace', items: [
      { key: 'profile',         label: 'Mon profil',    icon: 'pi-user',     to: '/app/profile' },
  ]},
]

// Project-module nav — OpenProject-style contextual menu when viewing a project.
// Cache per projectId so the array reference stays stable across sub-route changes
// (prevents sidebar re-render + RouterView reconciliation crash mid-navigation).
const projectNavCache = new Map<string, NavSection[]>()
function buildProjectModuleNav(projectId: string): NavSection[] {
  const cached = projectNavCache.get(projectId)
  if (cached) return cached
  const base = `/app/pm/projects/${projectId}`
  const sections: NavSection[] = [
    { items: [{ key: 'pm-projects', label: 'Mes projets', icon: 'pi-briefcase', to: '/app/pm/projects' }] },
    { heading: 'Projet', items: [
        { key: 'proj-overview',     label: 'Aperçu',         icon: 'pi-home',        to: base },
        { key: 'proj-workpackages', label: 'Work Packages',  icon: 'pi-list',        to: `${base}/workpackages` },
        { key: 'proj-gantt',        label: 'Gantt',          icon: 'pi-chart-bar',   to: `${base}/gantt` },
        { key: 'proj-board',        label: 'Board',          icon: 'pi-th-large',    to: `${base}/board` },
        { key: 'proj-backlogs',     label: 'Backlog',        icon: 'pi-inbox',       to: `${base}/backlogs` },
        { key: 'proj-sprint',       label: 'Sprint',         icon: 'pi-forward',     to: `${base}/sprint` },
        { key: 'proj-wiki',         label: 'Wiki',           icon: 'pi-book',        to: `${base}/wiki` },
    ]},
    { heading: 'Suivi', items: [
        { key: 'proj-budget',       label: 'Budget',         icon: 'pi-dollar',      to: `${base}/budget` },
        { key: 'proj-time',         label: 'Temps',          icon: 'pi-clock',       to: `${base}/time` },
        { key: 'proj-members',      label: 'Membres',        icon: 'pi-users',       to: `${base}/members` },
        { key: 'proj-activity',     label: 'Activité',       icon: 'pi-history',     to: `${base}/activity` },
    ]},
    { heading: 'Mon espace', items: [{ key: 'profile', label: 'Mon profil', icon: 'pi-user', to: '/app/profile' }] },
  ]
  projectNavCache.set(projectId, sections)
  return sections
}

const teamNav: NavSection[] = [
  { items: [
      { key: 'app-home',         label: 'Accueil',     icon: 'pi-inbox',        to: '/app' },
      { key: 'team-projects',    label: 'Projets',     icon: 'pi-briefcase',    to: '/app/team/projects'    },
      { key: 'team-validations', label: 'Validations', icon: 'pi-check-circle', to: '/app/team/validations' },
  ]},
  { heading: 'Mon espace', items: [{ key: 'profile', label: 'Mon profil', icon: 'pi-user', to: '/app/profile' }] },
]

// Compute the nav for a given path — imperative helper, not a computed.
function computeNavForRoute(path: string, params: Record<string, string | string[]>): NavSection[] {
  const isProjectRoute = path.startsWith('/app/pm/projects/')
  const projectId = isProjectRoute && typeof params.id === 'string' && params.id ? params.id : null
  if (projectId) return buildProjectModuleNav(projectId)
  if (authStore.userRole === 'Admin')          return adminNav
  if (authStore.userRole === 'ProjectManager') return pmNav
  return teamNav
}

// Use a ref (not a computed) updated via router.afterEach — nav changes AFTER
// navigation completes, avoiding mid-transition RouterView reconciliation crashes.
const navSections = ref<NavSection[]>(
  computeNavForRoute(route.path, route.params as Record<string, string | string[]>),
)

const stopAfterEach = router.afterEach(async (to) => {
  navSections.value = computeNavForRoute(to.path, to.params as Record<string, string | string[]>)

  // Track project visits for the sidebar "Recents" section.
  const m = to.path.match(/^\/app\/pm\/projects\/([^/]+)/)
  if (m && m[1]) {
    const projectId = m[1]
    try {
      const { default: api } = await import('@/lib/api')
      const { data } = await api.get<{ id: string; name: string; clientName?: string | null }>(
        `/pm/projects/${projectId}`,
      )
      uiStore.trackProjectVisit({ id: data.id, name: data.name, clientName: data.clientName ?? null })
    } catch {
      // Silent — visit tracking is best-effort.
    }
  }
})

// Also react to role changes (e.g. on login/logout) outside navigation.
watch(
  () => authStore.userRole,
  () => {
    navSections.value = computeNavForRoute(route.path, route.params as Record<string, string | string[]>)
  },
)

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
    // Collaboration socket — also globally connected so any view (Kanban, Gantt,
    // Questionnaire, etc.) can `joinProject` without having to manage its own connection.
    collab.connect(configStore.apiUrl, authStore.jwt)
  }
})

onUnmounted(() => {
  disconnect()
  collab.disconnect()
  notifStore.stopPolling()
  stopAfterEach()
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
  .shell__main { margin-left: 0; }
  .shell--pinned .shell__main { margin-left: 0; }
}
</style>
