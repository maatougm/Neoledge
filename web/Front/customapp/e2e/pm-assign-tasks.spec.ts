import { test, expect } from './fixtures/admin-auth'

/**
 * Regression test for the recent assignment-eligibility fix: the
 * /pm/projects/:id/assignable-users endpoint and the AssignTasksView
 * dropdown must only list Member / SpecificationTeam roles plus the
 * project's own PM. Admins and PMs from OTHER projects must NOT appear.
 */
test.describe('PM assignment dropdown — role-based eligibility', () => {
  let projectId = ''
  let projectPmId = ''

  test.beforeAll(async ({ request, baseURL }) => {
    const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@neoleadge.com'
    const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123'
    const loginRes = await request.post(`${baseURL}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!loginRes.ok()) test.skip(true, 'admin login failed')
    const { jwt } = await loginRes.json()
    const projectsRes = await request.get(`${baseURL}/admin/projects?status=Active&take=10`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const list = await projectsRes.json()
    const items = Array.isArray(list) ? list : (list.items ?? [])
    const target = items.find((p: { id?: string }) => p.id)
    projectId = target?.id ?? ''
    projectPmId = target?.projectManagerId ?? ''
    if (!projectId) test.skip(true, 'no project on the test server')
  })

  test('API: assignable-users only returns Member + SpecTeam + this PM', async ({ pmPage, baseURL }) => {
    const jwt = await pmPage.evaluate(() => localStorage.getItem('jwt'))
    expect(jwt).toBeTruthy()
    const res = await pmPage.request.get(`${baseURL}/pm/projects/${projectId}/assignable-users`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(res.ok()).toBeTruthy()
    const users = (await res.json()) as Array<{ id: string; role: string }>

    const allowedRoles = new Set(['Member', 'SpecificationTeam', 'ProjectManager'])
    for (const u of users) {
      expect(allowedRoles.has(u.role), `role ${u.role} should not be in the dropdown`).toBeTruthy()
      if (u.role === 'ProjectManager') {
        expect(u.id, 'only THIS project\'s PM may appear, not other PMs').toBe(projectPmId)
      }
      expect(u.role).not.toBe('Admin')
    }
  })

  test('UI: dropdown shows only the same set of users', async ({ pmPage }) => {
    test.skip(!projectId, 'no project')
    await pmPage.goto(`/app/pm/projects/${projectId}/assign-tasks`)

    // The dropdown is a NeoLibrary select; clicking the trigger opens the
    // overlay with one <li> per option. We assert the rendered role labels.
    const trigger = pmPage.locator('.p-select, [role="combobox"]').first()
    await expect(trigger).toBeVisible({ timeout: 15_000 })
    await trigger.click()

    const options = pmPage.locator('.p-select-option, [role="option"]')
    await expect(options.first()).toBeVisible({ timeout: 5_000 })
    const labels = await options.allTextContents()

    // The dropdown shape from AssignTasksView is "First Last — <RoleLabel>".
    // Forbid the admin role label entirely.
    for (const label of labels) {
      expect(label, `option "${label}" should not list Admin role`).not.toMatch(/—\s*Admin\b/i)
    }
  })
})
