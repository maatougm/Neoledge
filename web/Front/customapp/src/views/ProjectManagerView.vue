<template>
  <div class="pm-layout">
    <!-- Sidebar -->
    <aside class="sidebar" role="navigation" aria-label="Navigation principale">
      <div class="sidebar-brand">
        <div class="sidebar-logo" aria-hidden="true">NL</div>
        <span class="sidebar-brand-name">NeoLeadge</span>
      </div>

      <nav class="sidebar-nav">
        <span class="nav-section-label">Navigation</span>
        <button
          :class="['nav-item', { 'nav-item--active': !selectedProjectId }]"
          :aria-current="!selectedProjectId ? 'page' : undefined"
          @click="selectedProjectId = null"
        >
          <i class="pi pi-folder-open nav-icon" aria-hidden="true" />
          <span>Mes projets</span>
        </button>
        <button
          v-if="selectedProjectId && store.currentProject"
          class="nav-item nav-item--active nav-item--project"
        >
          <i class="pi pi-file nav-icon" aria-hidden="true" />
          <span class="nav-label--truncate">{{ store.currentProject.name }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button class="user-identity-btn" @click="router.push({ name: 'profile' })" title="Mon profil">
          <div class="sidebar-avatar" aria-hidden="true">{{ userInitials }}</div>
          <div class="sidebar-user-info">
            <span class="sidebar-user-name">{{ userName }}</span>
            <span class="sidebar-user-role">{{ userRoleLabel }}</span>
          </div>
          <i class="pi pi-chevron-right sidebar-chevron" aria-hidden="true" />
        </button>
        <div class="footer-actions-row">
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

    <!-- Main content -->
    <main class="main-content">
      <div class="content-inner">
        <div v-if="store.loading && !store.currentProject" class="loading-state">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
        </div>
        <PMProjectDetail
          v-else-if="selectedProjectId && store.currentProject"
          :project="store.currentProject"
          :validations="store.validations"
          @close="selectedProjectId = null"
        />
        <PMProjectList
          v-else
          @select="openProject"
        />
      </div>
    </main>

    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NeoToast } from '@neolibrary/components'
import { useDarkMode } from '@/composables/useDarkMode'
import PMProjectList   from '@/components/pm/PMProjectList.vue'
import PMProjectDetail from '@/components/pm/PMProjectDetail.vue'
import { usePmStore }  from '@/stores/pmStore'
import { useApp }      from '@/stores/useApp'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

const router   = useRouter()
const store    = usePmStore()
const app      = useApp()
const darkMode = useDarkMode()

const selectedProjectId = ref<string | null>(null)

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

const openProject = async (id: string) => {
  selectedProjectId.value = id
  await store.fetchProject(id)
}

const handleLogout = async () => {
  try { await app.logout() } catch { /* ignore */ }
  router.push({ name: 'login' })
}
</script>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────────────────── */
.pm-layout {
  display: flex;
  min-height: 100vh;
  font-family: var(--nl-font);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────────── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--nl-sidebar-bg);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: sticky;
  top: 0;
  border-right: 1px solid rgba(255,255,255,0.05);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.25rem 1rem 1rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.sidebar-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0.5px;
}

.sidebar-brand-name {
  font-size: 0.875rem;
  font-weight: 700;
  color: #FAFAFA;
  letter-spacing: -0.1px;
}

.sidebar-nav {
  flex: 1;
  padding: 0.75rem 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  overflow-y: auto;
}

.nav-section-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #3F3F46;
  padding: 0.625rem 0.5rem 0.25rem;
  margin-top: 0.5rem;
}

.nav-section-label:first-child { margin-top: 0; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #71717A;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  text-align: left;
  width: 100%;
  font-family: var(--nl-font);
}

.nav-item:hover { background: rgba(255,255,255,0.06); color: #D4D4D8; }

.nav-item--active {
  background: rgba(255,255,255,0.08);
  color: #FAFAFA;
  font-weight: 600;
}

.nav-item--project {
  border-left: 2px solid var(--nl-accent);
  border-radius: 0 6px 6px 0;
}

.nav-label--truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.nav-icon { font-size: 0.875rem; flex-shrink: 0; width: 16px; text-align: center; }

.sidebar-footer {
  padding: 0.625rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.user-identity-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 0.5rem 0.625rem;
  width: 100%;
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
  font-family: var(--nl-font);
}

.user-identity-btn:hover { background: rgba(255,255,255,0.07); }
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
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px;
  color: #52525B;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  font-family: var(--nl-font);
}

.footer-icon-btn:hover { background: rgba(255,255,255,0.06); color: #A1A1AA; }
.footer-icon-btn:focus-visible { outline: 2px solid var(--nl-accent); outline-offset: 2px; }
.footer-icon-btn--logout:hover { color: #EF4444; }

/* ── Main ────────────────────────────────────────────────────────────────────── */
.main-content { flex: 1; min-width: 0; overflow-y: auto; background: var(--nl-bg); }
.content-inner { max-width: 1120px; margin: 0 auto; padding: 2rem 2.5rem; }

.loading-state { display: flex; align-items: center; justify-content: center; padding: 3rem; }

/* ── Mobile ──────────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .pm-layout { flex-direction: column; }
  .sidebar { width: 100%; min-height: auto; position: relative; }
  .sidebar-nav { flex-direction: row; flex-wrap: wrap; }
  .nav-section-label { display: none; }
  .nav-item { padding: 0.375rem 0.5rem; font-size: 0.75rem; }
  .sidebar-footer { flex-direction: row; align-items: center; }
  .content-inner { padding: 1rem; }
}
</style>
