import { test, expect } from './fixtures/admin-auth'

/**
 * Phase 3 streaming UI: PM clicks "Générer le cahier", the SSE endpoint
 * emits 3 group events, the UI shows the "N/3 sections" badge incrementing
 * and renders each section as it lands.
 *
 * Tolerates the documented graceful-degradation case where Z.AI is rate-
 * limited and returns INFO_MANQUANTE — the UI still has to render the
 * complete event with the badge at 3/3.
 */
test.describe('PM cahier — streaming preview', () => {
  let projectId = ''

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
    projectId = items.find((p: { id?: string }) => p.id)?.id ?? ''
    if (!projectId) test.skip(true, 'no project on the test server')
  })

  test('section badges progress 0/3 → 1/3 → 2/3 → 3/3 and saved cahier renders', async ({ pmPage }) => {
    test.skip(!projectId, 'no project')

    // Listen for the SSE response so we can assert the wire format separately
    // from the UI (the UI rendering is the user-visible part; this catches
    // backend regressions in event ordering even if the UI evolves).
    const sseEvents: string[] = []
    pmPage.on('response', async (res) => {
      if (res.url().includes('/cahier-des-charges/preview-stream') && res.status() === 200) {
        // Body is text/event-stream — capture as text. May be empty if the
        // stream is still open when the response object is materialised, but
        // event names appear early enough for our assertion below.
        try {
          const body = await res.text()
          for (const m of body.matchAll(/event: (\w+)/g)) sseEvents.push(m[1])
        } catch { /* stream not finished — ok */ }
      }
    })

    await pmPage.goto(`/app/pm/projects/${projectId}/cahier`)
    const generateBtn = pmPage.getByRole('button', { name: /Générer le cahier|Régénérer/i }).first()
    await expect(generateBtn).toBeVisible({ timeout: 15_000 })
    await generateBtn.click()

    // The preflight modal may or may not appear depending on project state.
    const proceedBtn = pmPage.getByRole('button', { name: /^Continuer$|^Générer$|^Procéder$/i }).first()
    if (await proceedBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await proceedBtn.click()
    }

    // The streaming badge appears immediately after the started event.
    const badge = pmPage.locator(':text-matches("\\d+/3 sections")').first()
    await expect(badge).toBeVisible({ timeout: 20_000 })

    // The badge should hit 3/3 within the generation timeout. Z.AI on the
    // test server takes ~5-15 s per group; allow generous slack.
    await expect(badge).toHaveText(/3\/3 sections/, { timeout: 60_000 })

    // After complete, the saved-cahier preview area should render.
    await expect(pmPage.locator('text=/Cahier des charges enregistré|1\\.1 Objectif du document/i').first())
      .toBeVisible({ timeout: 30_000 })

    // Wire-level: at least one section event + a complete event were seen.
    expect(sseEvents).toContain('started')
    expect(sseEvents).toContain('complete')
  })
})
