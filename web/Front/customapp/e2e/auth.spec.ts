import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@neoleadge.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123'

test.describe.serial('auth flow', () => {
  test('admin logs in via the form and lands on an authenticated route', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.fillCredentials(ADMIN_EMAIL, ADMIN_PASSWORD)
    await login.submitAndExpectDashboard()

    // Sanity: JWT made it into localStorage (the app's persistence target).
    const jwt = await page.evaluate(() => localStorage.getItem('jwt'))
    expect(jwt, 'expected a JWT in localStorage after successful login').toBeTruthy()
  })

  test('invalid credentials surface an error and keep the user on /login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.fillCredentials(ADMIN_EMAIL, 'definitely-not-the-password')
    await login.submitAndExpectError()
    expect(page.url()).toContain('/login')
  })

  test('logout clears the session and returns to /login', async ({ page }) => {
    // Use the programmatic shortcut so we're not retesting the form here.
    await page.goto('/login')
    const res = await page.request.post(`${process.env.E2E_BASE_URL ?? 'https://neoleadge.pythagore-init.com'}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    const body = await res.json()
    await page.evaluate((b) => {
      localStorage.setItem('jwt', b.jwt)
      localStorage.setItem('user', JSON.stringify(b.user))
      localStorage.setItem('auth', JSON.stringify({ jwt: b.jwt, user: b.user }))
    }, body)
    await page.goto('/app')

    // Click the logout control. Different layouts surface it in different
    // places, so we try the obvious candidates in order.
    const logoutCandidates = [
      page.getByRole('button', { name: /se déconnecter|déconnexion|logout/i }),
      page.locator('[data-test="logout-btn"]'),
      page.locator('button[aria-label*="déconnec" i]'),
    ]
    for (const loc of logoutCandidates) {
      if (await loc.count()) {
        await loc.first().click()
        break
      }
    }

    await page.waitForURL(/\/login/, { timeout: 10_000 })
    const jwtAfter = await page.evaluate(() => localStorage.getItem('jwt'))
    expect(jwtAfter, 'expected jwt cleared after logout').toBeFalsy()
  })
})
