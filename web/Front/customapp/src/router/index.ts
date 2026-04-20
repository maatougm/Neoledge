/** @file src/router/index.ts — Vue Router configuration with nested layout routes and role-based guards */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { roleGuard } from './guards'
import type { UserRole } from '@/types/user.types'
import axios from 'axios'

// ─── Route meta augmentation ──────────────────────────────────────────────────

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    allowedRoles?: string[]
    readonly?: boolean
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PUBLIC_ROUTE_NAMES = new Set(['login', 'unauthorized', 'force-change-password'])

// ─── Router ───────────────────────────────────────────────────────────────────

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // ── Root redirect ────────────────────────────────────────────────────────
    {
      path: '/',
      redirect: '/app',
    },

    // ── Public routes ────────────────────────────────────────────────────────
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/force-change-password',
      name: 'force-change-password',
      component: () => import('@/views/ForceChangePasswordView.vue'),
    },
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('@/views/UnauthorizedView.vue'),
    },

    // ── Authenticated shell ───────────────────────────────────────────────────
    {
      path: '/app',
      name: 'app',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { requiresAuth: true },
      children: [
        // Unified Home (same for every role — an inbox/today view)
        {
          path: '',
          name: 'app-home',
          component: () => import('@/views/HomeView.vue'),
        },
        {
          path: 'home',
          redirect: { name: 'app-home' },
        },
        // ── Admin layout ───────────────────────────────────────────────────
        {
          path: 'admin',
          component: () => import('@/layouts/AdminLayout.vue'),
          meta: { requiresAuth: true, allowedRoles: ['Admin'] as UserRole[] },
          beforeEnter: roleGuard,
          children: [
            {
              path: '',
              redirect: { name: 'admin-dashboard' },
            },
            {
              path: 'dashboard',
              name: 'admin-dashboard',
              component: () =>
                import('@/components/admin/sections/DashboardSection.vue'),
            },
            {
              path: 'projects',
              name: 'admin-projects',
              component: () =>
                import('@/components/admin/sections/ProjectManagementSection.vue'),
            },
            {
              path: 'projects/:id',
              name: 'admin-project-detail',
              component: () => import('@/components/admin/ProjectDetailPanel.vue'),
              props: (route) => ({ projectId: route.params.id }),
            },
            {
              path: 'users',
              name: 'admin-users',
              component: () =>
                import('@/components/admin/sections/UserManagementSection.vue'),
            },
            {
              path: 'activity',
              name: 'admin-activity',
              component: () =>
                import('@/components/admin/sections/ActivitySection.vue'),
            },
            {
              path: 'analytics',
              name: 'admin-analytics',
              component: () =>
                import('@/components/admin/sections/AnalyticsSection.vue'),
            },
            {
              path: 'templates',
              name: 'admin-templates',
              component: () =>
                import('@/components/admin/sections/TemplatesSection.vue'),
            },
            {
              path: 'logs',
              name: 'admin-logs',
              component: () =>
                import('@/components/admin/sections/LogsSection.vue'),
            },
            {
              path: 'system',
              name: 'admin-system',
              component: () =>
                import('@/components/admin/sections/SystemStatusSection.vue'),
            },
            {
              path: 'trash',
              name: 'admin-trash',
              component: () => import('@/components/admin/TrashSection.vue'),
            },
            {
              path: 'portfolio',
              name: 'admin-portfolio',
              component: () => import('@/views/PortfolioView.vue'),
            },
            {
              path: 'team-planner',
              name: 'admin-team-planner',
              component: () => import('@/views/TeamPlannerView.vue'),
            },
            {
              path: 'audit',
              name: 'admin-audit',
              component: () => import('@/views/AuditLogView.vue'),
            },
            {
              path: 'roles',
              name: 'admin-roles',
              component: () => import('@/views/admin/RolesView.vue'),
            },
          ],
        },

        // ── Project Manager layout ─────────────────────────────────────────
        {
          path: 'pm',
          component: () => import('@/layouts/PmLayout.vue'),
          meta: { requiresAuth: true, allowedRoles: ['ProjectManager', 'Admin'] as UserRole[] },
          beforeEnter: roleGuard,
          children: [
            {
              path: '',
              redirect: { name: 'pm-projects' },
            },
            {
              path: 'projects',
              name: 'pm-projects',
              component: () => import('@/views/PMProjectsPage.vue'),
            },
            // ── OpenProject parity module routes ─────────────────────────
            {
              path: 'projects/:id',
              name: 'pm-project-detail',
              component: () => import('@/views/PMProjectDetailView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/workpackages',
              name: 'pm-workpackages',
              component: () => import('@/views/WorkPackagesView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/gantt',
              name: 'pm-gantt',
              component: () => import('@/views/GanttView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/board',
              name: 'pm-board',
              component: () => import('@/views/KanbanBoardView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/backlogs',
              name: 'pm-backlogs',
              component: () => import('@/views/BacklogView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/sprint',
              name: 'pm-sprint',
              component: () => import('@/views/SprintBoardView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/wiki',
              name: 'pm-wiki',
              component: () => import('@/views/WikiView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/wiki/:slug',
              name: 'pm-wiki-page',
              component: () => import('@/views/WikiView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/budget',
              name: 'pm-budget',
              component: () => import('@/views/BudgetView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/time',
              name: 'pm-time',
              component: () => import('@/views/TimeTrackingView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/members',
              name: 'pm-members',
              component: () => import('@/views/MembersView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/activity',
              name: 'pm-project-activity',
              component: () => import('@/views/ProjectActivityView.vue'),
              props: true,
            },
            {
              path: 'team-planner',
              name: 'pm-team-planner',
              component: () => import('@/views/TeamPlannerView.vue'),
            },
            {
              path: 'my-tasks',
              name: 'pm-my-tasks',
              component: () => import('@/views/MyTasksView.vue'),
            },
          ],
        },

        // ── Team layout ────────────────────────────────────────────────────
        {
          path: 'team',
          component: () => import('@/layouts/TeamLayout.vue'),
          meta: {
            requiresAuth: true,
            allowedRoles: [
              'SpecificationTeam',
              'RealizationTeam',
              'DeploymentTeam',
              'Viewer',
            ] as UserRole[],
          },
          beforeEnter: roleGuard,
          children: [
            {
              path: '',
              redirect: { name: 'team-projects' },
            },
            {
              path: 'projects',
              name: 'team-projects',
              component: () => import('@/views/TeamMemberView.vue'),
            },
            {
              path: 'projects/:id',
              name: 'team-project-detail',
              component: () => import('@/components/pm/PMProjectDetail.vue'),
              props: true,
              meta: { readonly: true },
            },
            {
              path: 'validations',
              name: 'team-validations',
              component: () => import('@/views/TeamMemberView.vue'),
            },
          ],
        },

        // ── Profile (all authenticated roles) ─────────────────────────────
        {
          path: 'profile',
          name: 'profile',
          component: () => import('@/views/UserProfileView.vue'),
          meta: { requiresAuth: true },
        },
      ],
    },

    // ── Legacy / Elise CustomAction root path ─────────────────────────────────
    // Kept for backwards compatibility with existing Elise iframe URLs
    {
      path: '/custom-action',
      name: 'CustomAction',
      component: () => import('@/views/CustomActionView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// ─── Global before-each guard ─────────────────────────────────────────────────

router.beforeEach(async (to: RouteLocationNormalized) => {
  const auth = useAuthStore()
  const config = useConfigStore()

  // CRITICAL: restore persisted JWT from localStorage BEFORE any auth checks.
  // Without this, a page refresh sees `auth.isAuthenticated === false` and
  // would incorrectly fall into the dev auto-login-as-admin branch below.
  auth.init()

  const isPublic = PUBLIC_ROUTE_NAMES.has(to.name as string)

  // Ensure config is loaded before any auth work
  if (!config.apiUrl) {
    try {
      await config.fetchConfig()
    } catch {
      // Config failed — allow public routes through, redirect to login for protected ones
      if (!isPublic) return { name: 'login' }
      return true
    }
  }

  // ── Elise GUID flow ────────────────────────────────────────────────────────
  // Elise passes ?Guid=<token> when loading the CustomAction in an iframe.
  // Skip entirely when the user already has a valid session.
  const guid = to.query.Guid as string | undefined
  if (guid && !auth.isAuthenticated) {
    try {
      const response = await axios.get<{ jwt: string }>(
        config.apiUrl + '/hook/auth',
        { params: { guid } },
      )
      // Only accept the JWT when the response came from the configured API host.
      const responseOrigin = new URL(config.apiUrl).origin
      const responseUrl = (response.config?.url) ?? ''
      const isFromExpectedHost = responseUrl.startsWith(responseOrigin) || responseUrl.startsWith('/')
      if (!isFromExpectedHost) {
        console.warn('[router] Elise JWT response from unexpected origin, ignoring.')
        return { name: 'unauthorized' }
      }
      auth.setJwt(response.data.jwt)
    } catch {
      return { name: 'unauthorized' }
    }
  }

  // ── Protected route checks ─────────────────────────────────────────────────
  if (!isPublic && to.meta.requiresAuth) {
    if (!auth.isAuthenticated) {
      // In development, auto-login for convenience. In production, redirect to login.
      if (import.meta.env.DEV) {
        try {
          await auth.login('admin@neoleadge.com', 'Admin@123')
        } catch {
          // fall through to redirect below
        }
      }
      // Still not authenticated → redirect to login with return URL
      if (!auth.isAuthenticated) {
        const redirect = to.fullPath !== '/' ? to.fullPath : undefined
        return { name: 'login', query: redirect ? { redirect } : undefined }
      }
    }

    // Force password change
    if (auth.mustChangePassword && to.name !== 'force-change-password') {
      return { name: 'force-change-password' }
    }

    // Hydrate permission set on first authenticated navigation (or after login).
    // fetchMe clears the token if it's been invalidated server-side.
    if (auth.isAuthenticated && auth.globalPermissions.size === 0) {
      await auth.fetchMe()
      if (!auth.isAuthenticated) {
        return { name: 'login' }
      }
    }
  }

  // Route-level roleGuard is applied via beforeEnter on protected layout routes.
  // No extra check needed here.

  return true
})

export default router
