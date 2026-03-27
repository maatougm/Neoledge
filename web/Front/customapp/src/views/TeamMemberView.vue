<template>
  <div class="team-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-logo">NL</div>
        <span class="sidebar-brand-name">NeoLeadge</span>
      </div>

      <nav class="sidebar-nav">
        <button
          :class="['nav-item', { 'nav-item--active': activeSection === 'projects' }]"
          @click="selectSection('projects')"
        >
          <i class="pi pi-briefcase nav-icon" />
          <span class="nav-label">Mes projets</span>
        </button>
        <button
          v-if="selectedProjectId && store.currentProject"
          class="nav-item nav-item--active nav-item--project"
        >
          <i class="pi pi-file nav-icon" />
          <span class="nav-label nav-label--truncate">{{ store.currentProject.name }}</span>
        </button>
        <button
          :class="['nav-item', { 'nav-item--active': activeSection === 'validations' && !selectedProjectId }]"
          @click="selectSection('validations')"
        >
          <i class="pi pi-check-square nav-icon" />
          <span class="nav-label">Mes validations</span>
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
          <button class="footer-icon-btn" :title="darkMode.isDark.value ? 'Mode clair' : 'Mode sombre'" @click="darkMode.toggle()" :aria-label="darkMode.isDark.value ? 'Passer en mode clair' : 'Passer en mode sombre'">
            <i :class="['pi', darkMode.isDark.value ? 'pi-sun' : 'pi-moon']" />
          </button>
          <button class="footer-icon-btn footer-icon-btn--logout" title="Déconnexion" aria-label="Se déconnecter" @click="handleLogout">
            <i class="pi pi-sign-out" />
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
          :readonly="true"
          @close="selectedProjectId = null"
        />
        <PMProjectList
          v-else-if="activeSection === 'projects'"
          @select="openProject"
        />
        <div v-else-if="activeSection === 'validations'" class="validations-section">
          <h2 class="section-title">Mes validations soumises</h2>
          <div v-if="store.validations.length === 0" class="empty-state">
            <i class="pi pi-check-square" style="font-size:2rem;color:#94a3b8" />
            <p>Aucune validation soumise pour l'instant.</p>
          </div>
          <div v-else class="validation-list">
            <div v-for="v in store.validations" :key="v.id" class="validation-card">
              <div class="v-header">
                <NeoTag
                  :value="v.isApproved ? 'Approuvé' : 'Refusé'"
                  :severity="v.isApproved ? 'success' : 'danger'"
                />
                <span class="v-date">{{ formatDate(v.validatedAt) }}</span>
              </div>
              <div class="v-detail">Phase : <strong>{{ v.phase }}</strong></div>
              <div v-if="v.comment" class="v-comment">{{ v.comment }}</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NeoToast, NeoTag } from '@neolibrary/components'
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

type Section = 'projects' | 'validations'
const activeSection     = ref<Section>('projects')
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

function selectSection(s: Section) {
  activeSection.value = s
  selectedProjectId.value = null
}

const openProject = async (id: string) => {
  selectedProjectId.value = id
  activeSection.value = 'projects'
  await store.fetchProject(id)
}

const handleLogout = async () => {
  try { await app.logout() } catch { /* ignore */ }
  router.push({ name: 'login' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR')
}
</script>

<style scoped>
.team-layout { display: flex; min-height: 100vh; background: #f8fafc; }

.sidebar {
  width: 240px; flex-shrink: 0; background: #0f172a;
  display: flex; flex-direction: column; min-height: 100vh;
  position: sticky; top: 0;
}
.sidebar-brand {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 1.5rem 1.25rem 1.25rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sidebar-logo {
  width: 36px; height: 36px; border-radius: 8px; background: #0d9488;
  color: #fff; font-size: 0.85rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sidebar-brand-name { font-size: 1rem; font-weight: 700; color: #f1f5f9; }

.sidebar-nav { flex: 1; padding: 1rem 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }

.nav-item {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.65rem 0.875rem; border-radius: 8px; border: none;
  background: transparent; color: #94a3b8;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
  transition: background 0.15s, color 0.15s; text-align: left; width: 100%;
}
.nav-item:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
.nav-item--active { background: rgba(13,148,136,0.15); color: #2dd4bf; }
.nav-item--project { border-left: 2px solid #0d9488; border-radius: 0 8px 8px 0; }
.nav-label--truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-icon { font-size: 1rem; flex-shrink: 0; }

.sidebar-footer { padding: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; gap: 0.5rem; }
.user-identity-btn { display: flex; align-items: center; gap: 0.625rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 0.625rem 0.75rem; width: 100%; cursor: pointer; transition: background 0.15s; text-align: left; }
.user-identity-btn:hover { background: rgba(255,255,255,0.08); }
.user-identity-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.sidebar-avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #0d9488, #0891b2); color: #fff; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sidebar-user-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sidebar-user-name { font-size: 0.8125rem; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-user-role { font-size: 0.7rem; color: #64748b; }
.sidebar-chevron { font-size: 0.65rem; color: #475569; flex-shrink: 0; }
.footer-actions-row { display: flex; gap: 0.375rem; }
.footer-icon-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: none; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; color: #64748b; font-size: 0.9rem; cursor: pointer; transition: background 0.15s, color 0.15s; }
.footer-icon-btn:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
.footer-icon-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.footer-icon-btn--logout:hover { color: #f87171; }

.main-content { flex: 1; min-width: 0; overflow-y: auto; }
.content-inner { max-width: 1100px; margin: 0 auto; padding: 2rem; }

.loading-state { display: flex; align-items: center; justify-content: center; padding: 3rem; }

.validations-section { display: flex; flex-direction: column; gap: 1.25rem; }
.section-title { font-size: 1.25rem; font-weight: 800; color: #111827; margin: 0; }

.empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 3rem; color: #94a3b8; font-size: 0.875rem; }

.validation-list { display: flex; flex-direction: column; gap: 0.75rem; }
.validation-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.4rem;
}
.v-header { display: flex; align-items: center; justify-content: space-between; }
.v-date { font-size: 0.78rem; color: #9ca3af; }
.v-detail { font-size: 0.875rem; color: #374151; }
.v-comment { font-size: 0.82rem; color: #6b7280; font-style: italic; }

/* ── Mobile responsive ───────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .team-layout { flex-direction: column; }
  .sidebar {
    width: 100%;
    min-height: auto;
    position: relative;
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0.75rem;
  }
  .sidebar-brand { padding: 0.5rem; border-bottom: none; }
  .sidebar-nav { flex-direction: row; flex-wrap: wrap; padding: 0; gap: 0.25rem; flex: 1; }
  .nav-item { padding: 0.4rem 0.6rem; font-size: 0.78rem; }
  .nav-label { display: none; }
  .sidebar-footer { display: none; }
  .content-inner { padding: 1rem; }
}
</style>
