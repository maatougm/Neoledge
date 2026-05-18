import { test, expect } from './fixtures/admin-auth'

/**
 * Admin lifecycle for a project: create → assign PM → soft-delete (corbeille).
 *
 * Uses the API directly for the side effects we don't need a UI to verify
 * (cleanup, list reads) and the UI for the user-visible parts (the project
 * shows up in the admin grid, the corbeille page shows the deleted row).
 *
 * `test.describe.serial` so the create / delete share state without parallel
 * worker collisions.
 */
test.describe.serial('admin project lifecycle', () => {
  const projectName = `E2E-${Date.now().toString().slice(-8)}`
  let projectId = ''

  test('admin creates a project via the API and it appears in the admin grid', async ({ adminPage, adminAuth, baseURL }) => {
    // Resolve a real ProjectManager to assign.
    const usersRes = await adminPage.request.get(`${baseURL}/pm/users`, {
      headers: { Authorization: `Bearer ${adminAuth.jwt}` },
    })
    expect(usersRes.ok()).toBeTruthy()
    const users = (await usersRes.json()) as Array<{ id: string; role: string; isActive: boolean }>
    const pm = users.find((u) => u.role === 'ProjectManager' && u.isActive)
    expect(pm, 'no active ProjectManager available on the test server').toBeTruthy()

    const startDate = new Date()
    const endDate = new Date(Date.now() + 90 * 86_400_000)
    const created = await adminPage.request.post(`${baseURL}/admin/project`, {
      data: {
        name: projectName,
        clientName: 'E2E Client',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        projectManagerId: pm!.id,
      },
      headers: { Authorization: `Bearer ${adminAuth.jwt}` },
    })
    expect(created.ok(), `create returned ${created.status()}`).toBeTruthy()
    const body = await created.json()
    projectId = body.id
    expect(projectId).toBeTruthy()

    // UI: open the admin dashboard and verify the new project is listed.
    await adminPage.goto('/app/admin')
    await expect(adminPage.getByText(projectName)).toBeVisible({ timeout: 15_000 })
  })

  test('admin soft-deletes the project and it shows in the corbeille', async ({ adminPage, adminAuth, baseURL }) => {
    test.skip(!projectId, 'previous test did not create a project')

    const del = await adminPage.request.delete(`${baseURL}/admin/project/${projectId}`, {
      headers: { Authorization: `Bearer ${adminAuth.jwt}` },
    })
    expect(del.ok(), `soft-delete returned ${del.status()}`).toBeTruthy()

    // Verify the corbeille view shows it.
    await adminPage.goto('/app/admin/corbeille')
    await expect(adminPage.getByText(projectName)).toBeVisible({ timeout: 10_000 })
  })

  test.afterAll(async ({ request, baseURL }) => {
    if (!projectId) return
    // Best-effort hard delete so the test server doesn't accumulate fixtures.
    const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@neoleadge.com'
    const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123'
    const loginRes = await request.post(`${baseURL}/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!loginRes.ok()) return
    const { jwt } = await loginRes.json()
    await request.delete(`${baseURL}/admin/project/${projectId}/hard`, {
      headers: { Authorization: `Bearer ${jwt}` },
    }).catch(() => undefined)
  })
})
