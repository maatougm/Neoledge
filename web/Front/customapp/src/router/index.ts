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

const PUBLIC_ROUTE_NAMES = new Set(['login', 'unauthorized', 'forgot-password', 'reset-password'])

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
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/ForgotPasswordView.vue'),
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
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
        // Role-aware landing route. Each role has a dedicated dashboard:
        //   Admin               → admin-dashboard (KPI command-center)
        //   ProjectManager      → pm-dashboard (portfolio + tasks)
        //   SpecificationTeam   → spec-dashboard (validation queue)
        //   Member              → team-home (today's tasks + sprints)
        // The route has no component — it pure-redirects in beforeEnter.
        {
          path: '',
          name: 'app-home',
          redirect: () => ({ name: 'app-home-redirect' }),
        },
        {
          // Hidden internal anchor used as a redirect target. The
          // beforeEach guard above sends each role to its real dashboard.
          path: '_home',
          name: 'app-home-redirect',
          redirect: () => {
            const auth = useAuthStore()
            switch (auth.userRole) {
              case 'Admin':             return { name: 'admin-dashboard' }
              case 'ProjectManager':    return { name: 'pm-dashboard' }
              case 'SpecificationTeam': return { name: 'spec-dashboard' }
              case 'Member':            return { name: 'team-home' }
              default:                  return { name: 'login' }
            }
          },
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
              path: 'audit',
              name: 'admin-audit',
              component: () => import('@/views/AuditLogView.vue'),
            },
            {
              // Unified log page: Activité + Audit as tabs. The standalone
              // /activity and /audit routes above are kept for deep links.
              path: 'journal',
              name: 'admin-journal',
              component: () => import('@/views/AdminJournalView.vue'),
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
              redirect: { name: 'pm-dashboard' },
            },
            {
              path: 'dashboard',
              name: 'pm-dashboard',
              component: () => import('@/views/PMDashboardView.vue'),
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
            // Deep-links into the legacy tabbed PMProjectDetail for the
            // questionnaire / cahier / meeting / validation workflow.
            // Each route mounts the same wrapper but passes a
            // different ?tab= via the path so the sidebar nav can highlight
            // the active item.
            {
              path: 'projects/:id/questionnaire',
              name: 'pm-project-questionnaire',
              component: () => import('@/views/PMProjectFullView.vue'),
              props: (route) => ({ id: route.params.id }),
            },
            {
              path: 'projects/:id/meetings',
              name: 'pm-project-meetings',
              component: () => import('@/views/PMProjectFullView.vue'),
              props: (route) => ({ id: route.params.id }),
            },
            {
              path: 'projects/:id/cahier',
              name: 'pm-project-cahier',
              component: () => import('@/views/PMProjectFullView.vue'),
              props: (route) => ({ id: route.params.id }),
            },
            {
              path: 'projects/:id/validations',
              name: 'pm-project-validations',
              component: () => import('@/views/PMProjectFullView.vue'),
              props: (route) => ({ id: route.params.id }),
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
              path: 'projects/:id/members',
              name: 'pm-members',
              component: () => import('@/views/MembersView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/backlog-generator',
              name: 'pm-backlog-generator',
              component: () => import('@/views/BacklogGeneratorView.vue'),
              props: true,
            },
            {
              path: 'projects/:id/assign-tasks',
              name: 'pm-assign-tasks',
              component: () => import('@/views/AssignTasksView.vue'),
              props: true,
            },
            {
              path: 'analytics',
              name: 'pm-analytics',
              component: () => import('@/components/admin/sections/AnalyticsSection.vue'),
            },
            {
              path: 'team-planner',
              name: 'pm-team-planner',
              component: () => import('@/views/TeamPlannerView.vue'),
            },
            {
              path: 'templates',
              name: 'pm-templates',
              component: () =>
                import('@/components/admin/sections/TemplatesSection.vue'),
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
              'Member',
            ] as UserRole[],
          },
          beforeEnter: roleGuard,
          children: [
            {
              path: '',
              name: 'team-home',
              // Member lands on the dedicated MemberDashboardView;
              // SpecificationTeam is redirected to their dedicated dashboard.
              component: () => import('@/views/team/MemberDashboardView.vue'),
              beforeEnter: (_to, _from, next) => {
                const auth = useAuthStore()
                if (auth.userRole === 'SpecificationTeam') {
                  next({ name: 'spec-dashboard' })
                } else {
                  next()
                }
              },
            },
            {
              path: 'dashboard',
              name: 'spec-dashboard',
              component: () => import('@/views/team/SpecTeamDashboardView.vue'),
              meta: { allowedRoles: ['SpecificationTeam', 'Admin'] as UserRole[] },
              beforeEnter: (_to, _from, next) => {
                const auth = useAuthStore()
                if (auth.userRole === 'Member') next({ name: 'team-home' })
                else next()
              },
            },
            {
              path: 'projects',
              name: 'team-projects',
              component: () => import('@/views/TeamMemberView.vue'),
            },
            {
              path: 'projects/:id',
              name: 'team-project-detail',
              component: () => import('@/views/team/MemberProjectRouter.vue'),
              props: (route) => ({ id: route.params.id }),
              meta: { readonly: true },
            },
            {
              path: 'projects/:projectId/sprint/:sprintId',
              name: 'team-sprint-detail',
              component: () => import('@/views/team/MemberSprintView.vue'),
              props: (route) => ({
                projectId: route.params.projectId,
                sprintId: route.params.sprintId,
              }),
            },
            {
              path: 'validations',
              name: 'team-validations',
              component: () => import('@/views/SpecMyValidationsView.vue'),
              meta: { allowedRoles: ['SpecificationTeam', 'Admin'] as UserRole[] },
              beforeEnter: (_to, _from, next) => {
                const auth = useAuthStore()
                if (auth.userRole === 'Member') next({ name: 'team-home' })
                else next()
              },
            },
            {
              path: 'my-tasks',
              name: 'team-my-tasks',
              component: () => import('@/views/team/MemberTasksView.vue'),
            },
            {
              path: 'sprints',
              name: 'team-sprints',
              component: () => import('@/views/team/MemberSprintsListView.vue'),
            },
            {
              path: 'inbox',
              name: 'team-inbox',
              component: () => import('@/views/team/MemberInboxView.vue'),
            },
            {
              path: 'pending-reviews',
              name: 'team-pending-reviews',
              component: () => import('@/views/SpecPendingReviewsView.vue'),
              meta: { allowedRoles: ['SpecificationTeam', 'Admin'] as UserRole[] },
              beforeEnter: (_to, _from, next) => {
                const auth = useAuthStore()
                if (auth.userRole === 'Member') next({ name: 'team-home' })
                else next()
              },
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

// Module-scoped flag — tracks whether /auth/me has been validated once
// since the JWT was loaded into memory. Reset by the logout bus.
let meChecked = false
if (typeof window !== 'undefined') {
  window.addEventListener('auth:logout', () => { meChecked = false })
}

router.beforeEach(async (to: RouteLocationNormalized) => {
  const auth = useAuthStore()
  const config = useConfigStore()

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
      // No silent dev-auto-login — credentials must never be hardcoded in source.
      // Always redirect to /login with a return URL so devs and prod follow the same path.
      const redirect = to.fullPath !== '/' ? to.fullPath : undefined
      return { name: 'login', query: redirect ? { redirect } : undefined }
    }

    // Validate the JWT against /auth/me on first authenticated navigation.
    // fetchMe clears the token if it's been invalidated server-side
    // (password reset, deactivation, …).
    if (auth.isAuthenticated && !meChecked) {
      meChecked = true
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
