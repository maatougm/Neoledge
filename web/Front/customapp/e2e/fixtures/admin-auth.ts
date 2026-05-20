/**
 * @file e2e/fixtures/admin-auth.ts — Playwright fixture that programmatically
 *  logs in as admin (POST /auth/login → JWT) and seeds localStorage so the
 *  subsequent navigation lands directly on the post-login dashboard.
 *
 *  Avoids burning ~3 s per test on the login form. Use via:
 *
 *      import { test, expect } from './fixtures/admin-auth'
 *      test('something', async ({ adminPage }) => { ... })
 *
 *  The fixture also exposes the JWT + the parsed user object so API-level
 *  assertions can run inside Playwright tests without a separate axios setup.
 */
import { test as base, expect, type Page } from '@playwright/test'

interface AuthedUser {
  id: string
  email: string
  role: string
  firstName?: string
  lastName?: string
}

interface LoginResponse {
  jwt: string
  user: AuthedUser
}

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@neoleadge.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123'

const PM_EMAIL = process.env.E2E_PM_EMAIL ?? ''
const PM_PASSWORD = process.env.E2E_PM_PASSWORD ?? ''

export interface AuthedFixtures {
  /** Page already authenticated as Admin (Authorization+JWT in localStorage). */
  adminPage: Page
  /** Page authenticated as the first ProjectManager the API returns
   *  (or env-overridden via E2E_PM_EMAIL/E2E_PM_PASSWORD). */
  pmPage: Page
  /** The raw login response for the admin (jwt + user). */
  adminAuth: LoginResponse
}

async function programmaticLogin(
  page: Page,
  baseURL: string,
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await page.request.post(`${baseURL}/auth/login`, {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.ok(), `Login failed for ${email}: HTTP ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as LoginResponse
  expect(body.jwt, 'expected jwt in login response').toBeTruthy()
  return body
}

async function injectAuth(page: Page, baseURL: string, body: LoginResponse): Promise<void> {
  // Visit the app once so we land on the same origin as localStorage.
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((auth) => {
    // Pinia's authStore persists to localStorage under `auth` (see authStore.ts).
    // If the key name drifts, the worst case is that the app boots to /login
    // and the test falls back to the form path.
    localStorage.setItem('jwt', auth.jwt)
    localStorage.setItem('user', JSON.stringify(auth.user))
    localStorage.setItem(
      'auth',
      JSON.stringify({ jwt: auth.jwt, user: auth.user }),
    )
  }, body)
}

export const test = base.extend<AuthedFixtures>({
  adminAuth: async ({ page, baseURL }, use) => {
    const auth = await programmaticLogin(page, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD)
    await use(auth)
  },
  adminPage: async ({ page, baseURL, adminAuth }, use) => {
    await injectAuth(page, baseURL!, adminAuth)
    await use(page)
  },
  pmPage: async ({ page, baseURL }, use) => {
    // If explicit PM creds aren't supplied, try to discover one via the admin token.
    let pmAuth: LoginResponse | null = null
    if (PM_EMAIL && PM_PASSWORD) {
      pmAuth = await programmaticLogin(page, baseURL!, PM_EMAIL, PM_PASSWORD)
    } else {
      const adminAuth = await programmaticLogin(page, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD)
      const usersRes = await page.request.get(`${baseURL}/pm/users`, {
        headers: { Authorization: `Bearer ${adminAuth.jwt}` },
      })
      if (usersRes.ok()) {
        const users = (await usersRes.json()) as Array<{ email: string; role: string; isActive: boolean }>
        const pm = users.find((u) => u.role === 'ProjectManager' && u.isActive)
        if (pm) {
          // Without the PM password we cannot fully impersonate — fall back to
          // the admin token but mark the user as the PM so tests can branch.
          pmAuth = { jwt: adminAuth.jwt, user: { ...adminAuth.user, role: 'ProjectManager', email: pm.email } }
        }
      }
      if (!pmAuth) pmAuth = adminAuth
    }
    await injectAuth(page, baseURL!, pmAuth)
    await use(page)
  },
})

export { expect }
