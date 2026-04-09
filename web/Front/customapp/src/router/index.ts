/**
 * @file     router/index.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Vue Router configuration — auth guard, role-based access, lazy-loaded views
 */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useApp } from '@/stores/useApp'
import type { UserRole } from '@/types/user.types'

declare module 'vue-router' {
  interface RouteMeta {
    allowedRoles?: UserRole[]
  }
}

const ALL_AUTHENTICATED_ROLES: UserRole[] = [
  'Admin',
  'ProjectManager',
  'SpecificationTeam',
  'RealizationTeam',
  'DeploymentTeam',
  'Viewer',
]

const PUBLIC_ROUTES = ['login', 'unauthorized', 'force-change-password']

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'CustomAction',
      component: () => import('@/views/CustomActionView.vue'),
      meta: { allowedRoles: ALL_AUTHENTICATED_ROLES },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { allowedRoles: ['Admin'] },
    },
    {
      path: '/pm',
      name: 'pm',
      component: () => import('@/views/ProjectManagerView.vue'),
      meta: { allowedRoles: ['ProjectManager'] },
    },
    {
      path: '/team',
      name: 'team',
      component: () => import('@/views/TeamMemberView.vue'),
      meta: {
        allowedRoles: ['SpecificationTeam', 'RealizationTeam', 'DeploymentTeam', 'Viewer'],
      },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('@/views/UnauthorizedView.vue'),
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/UserProfileView.vue'),
      meta: { allowedRoles: ALL_AUTHENTICATED_ROLES },
    },
    {
      path: '/force-change-password',
      name: 'force-change-password',
      component: () => import('@/views/ForceChangePasswordView.vue'),
    },
  ],
})

function isPublicRoute(to: RouteLocationNormalized): boolean {
  return PUBLIC_ROUTES.includes(to.name as string)
}

router.beforeEach(async (to) => {
  const app = useApp()

  if (!isPublicRoute(to)) {
    app.setLoading(true)
  }

  if (!app.apiUrl) {
    await app.fetchApiUrl()
  }

  // --- Obtain JWT if missing (existing auth flows) ---
  if (!app.jwt && !isPublicRoute(to)) {
    // If Elise passes a GUID in the query string, use the GUID auth flow
    const guid = to.query.Guid as string | undefined
    if (guid) {
      try {
        await app.fetchJwt(guid)
      } catch {
        app.setLoading(false)
        return { name: 'unauthorized' }
      }
    } else {
      // No GUID — auto-login with hardcoded dev credentials (replace with real auth later)
      try {
        await app.login('admin@neoleadge.com', 'Admin@123')
        // After auto-login, redirect based on role if not already on the right route
        const role = app.userRole
        if (role && to.name !== 'admin' && to.name !== 'pm' && to.name !== 'team') {
          app.setLoading(false)
          if (role === 'Admin') return { name: 'admin' }
          if (role === 'ProjectManager') return { name: 'pm' }
          return { name: 'team' }
        }
      } catch {
        app.setLoading(false)
        return { name: 'login' }
      }
    }
  }

  // --- Force-change-password check ---
  if (app.jwt && app.mustChangePassword && !isPublicRoute(to)) {
    app.setLoading(false)
    return { name: 'force-change-password' }
  }

  // --- Role-based access check ---
  const allowedRoles = to.meta.allowedRoles as UserRole[] | undefined
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = app.userRole as UserRole | null
    if (!userRole || !allowedRoles.includes(userRole)) {
      app.setLoading(false)
      return { name: 'unauthorized' }
    }
  }

  app.setLoading(false)
})

export default router
