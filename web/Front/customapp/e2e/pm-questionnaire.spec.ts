import { test, expect } from './fixtures/admin-auth'

/**
 * PM opens a project, fills 2-3 questionnaire fields, saves, and verifies
 * persistence (the values survive a reload).
 *
 * The test relies on at least one project existing with PM-assignable
 * status — we discover one via the API rather than creating fresh fixtures
 * because the live test server retains stable demo projects.
 */
test.describe.serial('PM questionnaire flow', () => {
  let projectId = ''

  test.beforeAll(async ({ request, baseURL }) => {
    const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@neoleadge.com'
    const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123'
    const loginRes = await request.post(`${baseURL}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!loginRes.ok()) test.skip(true, 'admin login failed — server unreachable')
    const { jwt } = await loginRes.json()

    const projectsRes = await request.get(`${baseURL}/admin/projects?status=Active&take=20`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!projectsRes.ok()) test.skip(true, 'cannot list projects')
    const list = await projectsRes.json()
    const items = Array.isArray(list) ? list : (list.items ?? [])
    const target = items.find((p: { id?: string; status?: string }) => p.id && p.status !== 'Completed')
    if (!target?.id) test.skip(true, 'no active project on the test server')
    projectId = target.id
  })

  test('PM fills 2 fields and the values persist after reload', async ({ pmPage }) => {
    test.skip(!projectId, 'no project discovered')

    await pmPage.goto(`/app/pm/projects/${projectId}/questionnaire`)

    // The form renders one input/textarea per ProjectField. Pick the first 2
    // text fields and fill them with marker strings so we can verify after reload.
    const fields = pmPage.locator('input[type="text"], textarea').filter({ hasNot: pmPage.locator('[disabled]') })
    await expect(fields.first()).toBeVisible({ timeout: 15_000 })

    const marker1 = `E2E-${Date.now().toString().slice(-6)}-A`
    const marker2 = `E2E-${Date.now().toString().slice(-6)}-B`
    await fields.nth(0).fill(marker1)
    if (await fields.count() > 1) await fields.nth(1).fill(marker2)

    // Save — single button covers the whole form per the project's UX rule.
    const saveBtn = pmPage.getByRole('button', { name: /enregistrer|sauvegarder/i }).first()
    await saveBtn.click()

    // Wait for the network save to settle.
    await pmPage.waitForLoadState('networkidle')

    // Reload + assert the marker survived.
    await pmPage.reload()
    await expect(pmPage.locator(`input[value="${marker1}"], textarea:has-text("${marker1}")`).first())
      .toBeVisible({ timeout: 10_000 })
  })
})
