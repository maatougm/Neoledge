/**
 * @file     router/index.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Vue Router configuration — auth guard, lazy-loaded views
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useApp } from '@/stores/useApp'

const PUBLIC_ROUTES = ['login', 'unauthorized', 'force-change-password']

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'CustomAction',
      component: () => import('@/views/CustomActionView.vue'),
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
    },
    {
      path: '/pm',
      name: 'pm',
      component: () => import('@/views/ProjectManagerView.vue'),
    },
    {
      path: '/team',
      name: 'team',
      component: () => import('@/views/TeamMemberView.vue'),
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
    },
    {
      path: '/force-change-password',
      name: 'force-change-password',
      component: () => import('@/views/ForceChangePasswordView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  const app = useApp()

  if (!PUBLIC_ROUTES.includes(to.name as string)) {
    app.setLoading(true)
  }

  if (!app.apiUrl) {
    await app.fetchApiUrl()
  }

  if (!app.jwt && !PUBLIC_ROUTES.includes(to.name as string)) {
    // If Elise passes a GUID in the query string, use the GUID auth flow
    const guid = to.query.Guid as string | undefined
    if (guid) {
      try {
        await app.fetchJwt(guid)
      } catch {
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

  app.setLoading(false)
})

export default router
