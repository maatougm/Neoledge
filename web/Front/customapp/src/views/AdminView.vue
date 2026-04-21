<!--
  @file     AdminView.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Admin shell — sidebar layout with navigation sections
-->
<template>
  <div class="admin-layout">
    <aside :class="['sidebar', `sidebar--${sidebarStyle}`]" role="navigation" aria-label="Navigation principale">
      <div class="sidebar-brand">
        <div class="sidebar-logo" aria-hidden="true">NL</div>
        <span class="sidebar-brand-name">NeoLeadge</span>
      </div>

      <nav class="sidebar-nav">
        <span class="nav-section-label">Navigation</span>
        <button
          v-for="item in primaryNav"
          :key="item.id"
          :class="['nav-item', { 'nav-item--active': activeSection === item.id }]"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="activeSection = item.id"
        >
          <i :class="['pi', item.icon, 'nav-icon']" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>

        <span class="nav-section-label">Outils</span>
        <button
          v-for="item in toolsNav"
          :key="item.id"
          :class="['nav-item', { 'nav-item--active': activeSection === item.id }]"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="activeSection = item.id"
        >
          <i :class="['pi', item.icon, 'nav-icon']" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
        <button
          :class="['nav-item', { 'nav-item--active': activeSection === 'trash' }]"
          :aria-current="activeSection === 'trash' ? 'page' : undefined"
          @click="activeSection = 'trash'"
        >
          <i class="pi pi-trash nav-icon" aria-hidden="true" />
          <span>Corbeille</span>
          <span v-if="trashCount > 0" class="nav-trash-badge" aria-label="`${trashCount} projet(s) dans la corbeille`">
            {{ trashCount }}
          </span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button class="user-identity-btn" title="Mon profil" @click="router.push({ name: 'profile' })">
          <img
            v-if="sidebarAvatarUrl"
            :src="sidebarAvatarUrl"
            class="sidebar-avatar sidebar-avatar--img"
            alt="Avatar"
            aria-hidden="true"
            @error="(e) => { (e.target as HTMLImageElement).style.display = 'none' }"
          />
          <div v-else class="sidebar-avatar" aria-hidden="true">{{ userInitials }}</div>
          <div class="sidebar-user-info">
            <span class="sidebar-user-name">{{ userName }}</span>
            <span class="sidebar-user-role">{{ userRoleLabel }}</span>
          </div>
          <i class="pi pi-chevron-right sidebar-chevron" aria-hidden="true" />
        </button>
        <div class="footer-actions-row">
          <NotificationBell />
          <button
            class="footer-icon-btn"
            :title="sidebarStyle === 'float' ? 'Ancrer la barre' : 'Détacher la barre'"
            :aria-label="sidebarStyle === 'float' ? 'Ancrer la barre latérale' : 'Détacher la barre latérale'"
            @click="toggleSidebarStyle()"
          >
            <i :class="['pi', sidebarStyle === 'float' ? 'pi-window-minimize' : 'pi-window-maximize']" aria-hidden="true" />
          </button>
          <button
            class="footer-icon-btn"
            :title="darkMode.isDark.value ? 'Mode clair' : 'Mode sombre'"
            :aria-label="darkMode.isDark.value ? 'Passer en mode clair' : 'Passer en mode sombre'"
            @click="darkMode.toggle()"
          >
            <i :class="['pi', darkMode.isDark.value ? 'pi-sun' : 'pi-moon']" aria-hidden="true" />
          </button>
          <button
            class="footer-icon-btn footer-icon-btn--logout"
            title="Déconnexion"
            aria-label="Se déconnecter"
            @click="handleLogout"
          >
            <i class="pi pi-sign-out" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <div class="content-inner">
        <PersonalDashboard
          v-if="activeSection === 'personal'"
          :user-id="currentUserId"
        />
        <component :is="activeComponent" v-else />
      </div>
    </main>

    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoToast } from '@neolibrary/components'
import { useDarkMode } from '@/composables/useDarkMode'
import { useNotificationSocket } from '@/composables/useNotificationSocket'
import NotificationBell from '@/components/NotificationBell.vue'
import { useNotificationStore } from '@/stores/notificationStore'

import DashboardSection         from '@/components/admin/sections/DashboardSection.vue'
import ProjectManagementSection from '@/components/admin/sections/ProjectManagementSection.vue'
import UserManagementSection    from '@/components/admin/sections/UserManagementSection.vue'
import LogsSection              from '@/components/admin/sections/LogsSection.vue'
import SystemStatusSection      from '@/components/admin/sections/SystemStatusSection.vue'
import TemplatesSection         from '@/components/admin/sections/TemplatesSection.vue'
import AnalyticsSection         from '@/components/admin/sections/AnalyticsSection.vue'
import ActivitySection          from '@/components/admin/sections/ActivitySection.vue'
import TrashSection             from '@/components/admin/TrashSection.vue'
import PersonalDashboard        from '@/components/admin/PersonalDashboard.vue'

import { useApp } from '@/stores/useApp'
import { useProjectStore } from '@/stores/projectStore'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

type SectionId = 'dashboard' | 'projects' | 'users' | 'logs' | 'status' | 'templates' | 'analytics' | 'activity' | 'trash' | 'personal'

const router            = useRouter()
const app               = useApp()
const darkMode          = useDarkMode()
const notificationStore = useNotificationStore()
const projectStore      = useProjectStore()
const notifSocket       = useNotificationSocket()

onMounted(() => {
  notificationStore.startPolling()
  if (app.jwt && app.apiUrl) void darkMode.loadFromBackend(app.jwt, app.apiUrl)
  void projectStore.fetchDeletedProjects()
  if (app.apiUrl && app.jwt) notifSocket.connect(app.apiUrl, app.jwt)
})
onUnmounted(() => {
  notificationStore.stopPolling()
  notifSocket.disconnect()
})

const sidebarStyle = ref<'soften' | 'float'>(
  (localStorage.getItem('nl-sidebar-style') as 'soften' | 'float') ?? 'soften'
)
const toggleSidebarStyle = () => {
  sidebarStyle.value = sidebarStyle.value === 'soften' ? 'float' : 'soften'
  localStorage.setItem('nl-sidebar-style', sidebarStyle.value)
}

const activeSection = ref<SectionId>('dashboard')

// Decode sidebar user identity from JWT
const userInitials = computed<string>(() => {
  if (!app.jwt) return '?'
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    const f = (p.given_name ?? '').charAt(0).toUpperCase()
    const l = (p.family_name ?? '').charAt(0).toUpperCase()
    return f || l ? `${f}${l}` : '?'
  } catch { return '?' }
})

const userName = computed<string>(() => {
  if (!app.jwt) return 'Utilisateur'
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    return [p.given_name, p.family_name].filter(Boolean).join(' ') || 'Utilisateur'
  } catch { return 'Utilisateur' }
})

const userRoleLabel = computed<string>(() =>
  app.userRole ? (USER_ROLE_LABELS[app.userRole as UserRole] ?? app.userRole) : ''
)

const trashCount = computed<number>(() => projectStore.deletedProjects.length)

const sidebarAvatarUrl = computed<string | null>(() => {
  if (!app.jwt) return null
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    const sub: string = p.sub ?? ''
    if (!sub) return null
    return `${app.apiUrl}/api/userprofile/avatar/${sub}`
  } catch { return null }
})

const primaryNav: { id: SectionId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Tableau de bord',  icon: 'pi-home' },
  { id: 'personal',  label: 'Mon espace',       icon: 'pi-user' },
  { id: 'projects',  label: 'Projets',          icon: 'pi-folder-open' },
  { id: 'users',     label: 'Utilisateurs',     icon: 'pi-users' },
  { id: 'activity',  label: 'Activité',         icon: 'pi-history' },
]

const toolsNav: { id: SectionId; label: string; icon: string }[] = [
  { id: 'analytics', label: 'Analytiques', icon: 'pi-chart-bar' },
  { id: 'templates', label: 'Modèles',     icon: 'pi-copy' },
  { id: 'logs',      label: 'Logs',        icon: 'pi-file-edit' },
  { id: 'status',    label: 'Système',     icon: 'pi-server' },
]

const sectionMap: Record<Exclude<SectionId, 'personal'>, object> = {
  dashboard: DashboardSection,
  projects:  ProjectManagementSection,
  users:     UserManagementSection,
  analytics: AnalyticsSection,
  activity:  ActivitySection,
  templates: TemplatesSection,
  logs:      LogsSection,
  status:    SystemStatusSection,
  trash:     TrashSection,
}

const activeComponent = computed(() =>
  activeSection.value !== 'personal' ? sectionMap[activeSection.value as Exclude<SectionId, 'personal'>] : null,
)

// Decode current user ID from JWT for PersonalDashboard
const currentUserId = computed<string>(() => {
  if (!app.jwt) return ''
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    return p.sub ?? ''
  } catch { return '' }
})

const handleLogout = async () => {
  try { await app.logout() } catch { /* ignore */ }
  router.push({ name: 'login' })
}
</script>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────────────────── */
.admin-layout {
  display: flex;
  min-height: 100vh;
  font-family: var(--nl-font);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────────── */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--nl-sidebar-bg);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: sticky;
  top: 0;
  border-right: 1px solid var(--nl-sidebar-border);
  box-shadow: 4px 0 24px rgba(0,0,0,0.15);
  transition: margin 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              height 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Soften: flush top/bottom, right edge rounded */
.sidebar--soften {
  border-radius: 0 var(--nl-radius-lg) var(--nl-radius-lg) 0;
}

/* Float: fully detached island */
.sidebar--float {
  margin: 0.875rem 0 0.875rem 0.875rem;
  min-height: unset;
  height: calc(100vh - 1.75rem);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg), 6px 0 32px rgba(0,0,0,0.25);
  top: 0.875rem;
  overflow: hidden;
}

.admin-layout:has(.sidebar--float) {
  align-items: flex-start;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem 1.25rem;
  border-bottom: 1px solid var(--nl-sidebar-border);
}

.sidebar-logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0.5px;
  box-shadow: var(--nl-shadow-glow);
}

.sidebar-brand-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #F8FAFC;
  letter-spacing: -0.1px;
}

/* Nav */
.sidebar-nav {
  flex: 1;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
}

.nav-section-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #64748B;
  padding: 0.75rem 0.5rem 0.25rem;
  margin-top: 0.5rem;
}

.nav-section-label:first-child { margin-top: 0; }

.nav-trash-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.3rem;
  border-radius: 9999px;
  background: #ef4444;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #94A3B8;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: left;
  width: 100%;
  font-family: var(--nl-font);
  position: relative;
  overflow: hidden;
}

.nav-item:hover {
  background: var(--nl-hover-bg);
  color: #F8FAFC; 
  transform: translateX(4px);
}

.nav-item--active {
  background: var(--nl-hover-bg-2);
  color: var(--nl-accent-light);
  font-weight: 600;
}

.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10%;
  bottom: 10%;
  width: 3px;
  border-radius: 0 4px 4px 0;
  background: var(--nl-accent);
  box-shadow: 0 0 8px var(--nl-accent);
}

.nav-icon { font-size: 1rem; flex-shrink: 0; width: 18px; text-align: center; }

/* Footer */
.sidebar-footer {
  padding: 0.625rem;
  border-top: 1px solid var(--nl-sidebar-border);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.user-identity-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--nl-hover-bg);
  border: 1px solid var(--nl-sidebar-border-2);
  border-radius: 8px;
  padding: 0.5rem 0.625rem;
  width: 100%;
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
  font-family: var(--nl-font);
}

.user-identity-btn:hover { background: var(--nl-hover-bg-2); }
.user-identity-btn:focus-visible { outline: 2px solid var(--nl-accent); outline-offset: 2px; }

.sidebar-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar-avatar--img { object-fit: cover; }
.sidebar-user-info { flex: 1; min-width: 0; }

.sidebar-user-name {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #D4D4D8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-user-role {
  display: block;
  font-size: 0.65rem;
  color: #52525B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-chevron { font-size: 0.55rem; color: #3F3F46; flex-shrink: 0; }

.footer-actions-row { display: flex; gap: 0.25rem; }

.footer-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: none;
  border: 1px solid var(--nl-sidebar-border-2);
  border-radius: 6px;
  color: #52525B;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  font-family: var(--nl-font);
}

.footer-icon-btn:hover { background: var(--nl-sidebar-border-2); color: #A1A1AA; }
.footer-icon-btn:focus-visible { outline: 2px solid var(--nl-accent); outline-offset: 2px; }
.footer-icon-btn--logout:hover { color: #EF4444; }

/* ── Main ────────────────────────────────────────────────────────────────────── */
.main-content { flex: 1; min-width: 0; overflow-y: auto; background: var(--nl-bg); }
.content-inner { max-width: 1120px; margin: 0 auto; padding: 2rem 2.5rem; }

/* ── Mobile ──────────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .admin-layout { flex-direction: column; }
  .sidebar { width: 100%; min-height: auto; position: relative; }
  .sidebar-nav { flex-direction: row; flex-wrap: wrap; }
  .nav-section-label { display: none; }
  .nav-item { padding: 0.375rem 0.5rem; font-size: 0.75rem; }
  .sidebar-footer { flex-direction: row; align-items: center; }
  .content-inner { padding: 1rem; }
}
</style>
