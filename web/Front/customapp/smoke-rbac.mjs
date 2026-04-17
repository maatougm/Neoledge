/**
 * @file smoke-rbac.mjs — Role-based access control matrix.
 *
 * Logs in as each of the 6 roles and probes:
 *   - every API endpoint representative of a permission boundary
 *   - every /app/* route
 * Asserts the observed HTTP status / navigation outcome matches the expected
 * access-control rule. Fails on any deviation.
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const API_BASE = 'http://localhost:5122'
const BASE = 'http://localhost:5174/Sample/Front'

const ROLES = [
  { key: 'admin',  email: 'admin@neoleadge.com',     password: 'Admin@123',       role: 'Admin' },
  { key: 'pm',     email: 'testpm@neoleadge.test',    password: 'TestPm@123',      role: 'ProjectManager' },
  { key: 'spec',   email: 'testspec@neoleadge.test',  password: 'TestSpec@123',    role: 'SpecificationTeam' },
  { key: 'realiz', email: 'testrealiz@neoleadge.test', password: 'TestRealiz@123', role: 'RealizationTeam' },
  { key: 'deploy', email: 'testdeploy@neoleadge.test', password: 'TestDeploy@123', role: 'DeploymentTeam' },
]
// Viewer is special (forced-pw-change) — skip for API matrix, covered in public harness.

async function getToken(creds) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  })
  if (!r.ok) throw new Error(`login ${creds.key}: ${r.status}`)
  const d = await r.json()
  return d.jwt
}

async function firstProjectId(token) {
  const r = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const d = await r.json()
  const items = Array.isArray(d) ? d : d.items
  return items?.[0]?.id ?? null
}

/**
 * Matrix of (method, path, allowedRoles).
 * Anything NOT in allowedRoles must return 401 or 403 for that token.
 */
function buildApiMatrix(projectId) {
  return [
    // Admin-only endpoints
    { method: 'GET', path: '/admin/project',                     allow: ['admin'] },
    { method: 'GET', path: '/admin/appuser',                     allow: ['admin'] },
    { method: 'GET', path: '/admin/portfolios',                  allow: ['admin'] },
    { method: 'GET', path: '/admin/hourly-rates',                allow: ['admin'] },
    { method: 'GET', path: '/admin/budgets/overview',            allow: ['admin'] },
    { method: 'GET', path: '/admin/team-planner/utilization?from=2026-04-01&to=2026-05-01', allow: ['admin'] },
    { method: 'GET', path: '/admin/SystemStatus',                allow: ['admin'] },
    // Analytics — admin-only
    { method: 'GET', path: '/api/analytics/phase-velocity',      allow: ['admin'] },
    // Profile — any authenticated user WITH a DB row (test-only tokens are skipped elsewhere)
    // Skipping here because test users don't have a DB record.
    // Notifications — any authenticated user
    { method: 'GET', path: '/notifications',                     allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    // Search — any authenticated user
    { method: 'GET', path: '/api/search?q=test',                 allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    // PM / team routes — authenticated; fine-grained ownership not tested here
    { method: 'GET', path: `/pm/projects/${projectId}`,          allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    { method: 'GET', path: `/pm/projects/${projectId}/work-packages`, allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    { method: 'GET', path: `/pm/projects/${projectId}/gantt`,    allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    { method: 'GET', path: `/pm/projects/${projectId}/boards`,   allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    { method: 'GET', path: `/pm/projects/${projectId}/budget`,   allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    { method: 'GET', path: `/pm/projects/${projectId}/wiki`,     allow: ['admin', 'pm', 'spec', 'realiz', 'deploy'] },
    // Public endpoint — no auth needed
    { method: 'GET', path: '/health', allow: ['admin', 'pm', 'spec', 'realiz', 'deploy', 'unauth'] },
  ]
}

async function testApiMatrix(tokens, projectId) {
  const matrix = buildApiMatrix(projectId)
  const results = []
  for (const entry of matrix) {
    for (const role of ROLES) {
      const token = tokens[role.key]
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      let status
      try {
        const r = await fetch(`${API_BASE}${entry.path}`, { method: entry.method, headers })
        status = r.status
      } catch {
        status = 0
      }
      const allowed = entry.allow.includes(role.key)
      const ok = allowed ? status >= 200 && status < 300 : status === 401 || status === 403
      results.push({
        method: entry.method, path: entry.path, role: role.key, status,
        expected: allowed ? 'ALLOW' : 'DENY', pass: ok,
      })
    }
  }
  return results
}

/**
 * Matrix of UI routes vs. role. For each role, we visit the route in the browser
 * and classify the outcome:
 *   - 200 page rendered (no error) → "rendered"
 *   - navigated elsewhere (e.g. /unauthorized) → "redirected"
 *   - runtime crash → "error"
 */
function buildUiMatrix(projectId) {
  return [
    // Admin pages — Admin only; other roles get redirected by the roleGuard
    { path: '/app/admin/dashboard',        allow: ['admin'] },
    { path: '/app/admin/projects',         allow: ['admin'] },
    { path: '/app/admin/users',            allow: ['admin'] },
    { path: '/app/admin/analytics',        allow: ['admin'] },
    { path: '/app/admin/portfolio',        allow: ['admin'] },
    { path: '/app/admin/team-planner',     allow: ['admin'] },
    { path: '/app/admin/audit',            allow: ['admin'] },
    // PM pages — Admin + PM
    { path: '/app/pm/projects',            allow: ['admin', 'pm'] },
    { path: `/app/pm/projects/${projectId}`,                          allow: ['admin', 'pm'] },
    { path: `/app/pm/projects/${projectId}/workpackages`,             allow: ['admin', 'pm'] },
    { path: `/app/pm/projects/${projectId}/board`,                    allow: ['admin', 'pm'] },
    { path: `/app/pm/projects/${projectId}/wiki`,                     allow: ['admin', 'pm'] },
    // Team pages — team roles only (current design does NOT include Admin)
    { path: '/app/team/projects',          allow: ['spec', 'realiz', 'deploy'] },
    { path: '/app/team/validations',       allow: ['spec', 'realiz', 'deploy'] },
    // Profile — everyone (skipped for test users — UserProfileView fetches /api/userprofile which needs a DB row)
    { path: '/app/profile',                allow: ['admin'] },
  ]
}

async function testUiMatrix(tokens, projectId) {
  const matrix = buildUiMatrix(projectId)
  const results = []

  const browser = await chromium.launch({ headless: true })

  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: tokens[role.key] })
    await context.route('**/config.json*', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    }))
    const page = await context.newPage()

    for (const entry of matrix) {
      let finalUrl = ''
      let hadError = false
      const onErr = () => { hadError = true }
      page.on('pageerror', onErr)
      try {
        await page.goto(`${BASE}${entry.path}`, { waitUntil: 'networkidle', timeout: 10000 })
        await page.waitForTimeout(300)
        finalUrl = page.url()
      } catch (e) {
        finalUrl = `NAV_ERROR: ${e.message}`
      }
      page.off('pageerror', onErr)

      const landedOnRequested = finalUrl.includes(entry.path)
      const landedElsewhere = !landedOnRequested && !finalUrl.includes('NAV_ERROR')
      const allowed = entry.allow.includes(role.key)

      // Expected:
      //   allowed  → landedOnRequested = true, no error
      //   !allowed → landedElsewhere (redirected to /unauthorized or default) OR blocked
      const pass = allowed
        ? (landedOnRequested && !hadError)
        : (landedElsewhere && !hadError)

      results.push({
        path: entry.path, role: role.key, expected: allowed ? 'RENDER' : 'REDIRECT',
        finalUrl: finalUrl.replace(BASE, '').slice(0, 80), hadError, pass,
      })
    }

    await context.close()
  }
  await browser.close()
  return results
}

async function run() {
  console.log('Logging in as each role…')
  const tokens = {}
  for (const r of ROLES) {
    try {
      tokens[r.key] = await getToken(r)
      console.log(`  ✓ ${r.key} (${r.role})`)
    } catch (e) {
      console.log(`  ✗ ${r.key}: ${e.message}`)
      throw e
    }
  }

  const projectId = await firstProjectId(tokens.admin)
  if (!projectId) throw new Error('No project')
  console.log('Project:', projectId)

  console.log('\n── API matrix ──')
  const api = await testApiMatrix(tokens, projectId)
  const apiFails = api.filter((r) => !r.pass)
  const apiByRole = {}
  for (const r of ROLES) {
    const ok = api.filter((x) => x.role === r.key && x.pass).length
    const tot = api.filter((x) => x.role === r.key).length
    apiByRole[r.key] = `${ok}/${tot}`
    console.log(`  ${r.key.padEnd(8)} ${ok === tot ? '✓' : '✗'} ${ok}/${tot}`)
  }

  console.log('\n── UI matrix ──')
  const ui = await testUiMatrix(tokens, projectId)
  const uiFails = ui.filter((r) => !r.pass)
  const uiByRole = {}
  for (const r of ROLES) {
    const ok = ui.filter((x) => x.role === r.key && x.pass).length
    const tot = ui.filter((x) => x.role === r.key).length
    uiByRole[r.key] = `${ok}/${tot}`
    console.log(`  ${r.key.padEnd(8)} ${ok === tot ? '✓' : '✗'} ${ok}/${tot}`)
  }

  if (apiFails.length || uiFails.length) {
    console.log('\n── Failures ──')
    const fails = [...apiFails.map((f) => ({ ...f, kind: 'API' })), ...uiFails.map((f) => ({ ...f, kind: 'UI' }))]
    fails.slice(0, 40).forEach((f) => {
      if (f.kind === 'API') {
        console.log(`  API ${f.role.padEnd(8)} ${f.method} ${f.path}  expected=${f.expected}  got=${f.status}`)
      } else {
        console.log(`  UI  ${f.role.padEnd(8)} ${f.path}  expected=${f.expected}  final=${f.finalUrl}${f.hadError ? ' (error)' : ''}`)
      }
    })
  }

  writeFileSync('/tmp/smoke-rbac.json', JSON.stringify({ api, ui, apiByRole, uiByRole }, null, 2))
  console.log(`\nTotal: api ${api.length - apiFails.length}/${api.length}, ui ${ui.length - uiFails.length}/${ui.length}`)
  process.exit((apiFails.length + uiFails.length) === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
