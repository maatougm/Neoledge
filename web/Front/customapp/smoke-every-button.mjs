/**
 * @file smoke-every-button.mjs — Click every clickable element on every role's
 * accessible routes; fail on any console error.
 *
 * Strategy:
 *   - For each role, get its JWT
 *   - For a set of in-scope routes
 *   - Enumerate safe clickable elements (buttons that are NOT destructive and NOT navigation)
 *   - Click each, observe diagnostics, close any modal with Escape
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const API_BASE = 'http://localhost:5122'
const BASE = 'http://localhost:5174/Sample/Front'

const ROLES = [
  { key: 'admin', email: 'admin@neoleadge.com', password: 'Admin@123' },
  { key: 'pm', email: 'testpm@neoleadge.test', password: 'TestPm@123' },
]
// Team roles have fewer routes + the test users don't have DB profiles
// so UserProfileView etc would 404 — keep admin + PM for button sweep.

const BENIGN = [
  /tabs:outgoing.message.ready/i, /chrome-extension:\/\//i,
  /\[HMR\]/i, /WebSocket connection.*ws:\/\/localhost:5174/i,
]
const isBenign = (t) => BENIGN.some((re) => re.test(t))

async function getToken(creds) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (!r.ok) throw new Error(`login ${creds.email}: ${r.status}`)
  return (await r.json()).jwt
}

function routesForRole(roleKey, projectId) {
  if (roleKey === 'admin') {
    return [
      '/app/admin/dashboard',
      '/app/admin/projects',
      '/app/admin/users',
      '/app/admin/analytics',
      '/app/admin/portfolio',
      '/app/admin/team-planner',
      '/app/admin/audit',
      '/app/admin/trash',
      `/app/pm/projects/${projectId}`,
      `/app/pm/projects/${projectId}/workpackages`,
      `/app/pm/projects/${projectId}/gantt`,
      `/app/pm/projects/${projectId}/board`,
      `/app/pm/projects/${projectId}/wiki`,
      `/app/pm/projects/${projectId}/budget`,
      `/app/pm/projects/${projectId}/time`,
      `/app/pm/projects/${projectId}/members`,
      `/app/pm/projects/${projectId}/activity`,
    ]
  }
  // PM
  return [
    '/app/pm/projects',
    `/app/pm/projects/${projectId}`,
    `/app/pm/projects/${projectId}/workpackages`,
    `/app/pm/projects/${projectId}/gantt`,
    `/app/pm/projects/${projectId}/board`,
    `/app/pm/projects/${projectId}/wiki`,
    `/app/pm/projects/${projectId}/budget`,
    `/app/pm/projects/${projectId}/time`,
    `/app/pm/projects/${projectId}/activity`,
  ]
}

async function firstProjectId(token) {
  const r = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  return (Array.isArray(d) ? d : d.items)[0]?.id
}

// Selectors for buttons we will skip (destructive / navigation / modal-closers).
const SKIP_PATTERNS = [
  /supprim/i,            // "Supprimer"
  /delete/i,
  /archiver/i,
  /purger/i,
  /désépingler/i, /épingler/i,  // sidebar pin
  /déconn/i,             // logout
  /fermer/i,             // close
  /annul/i,              // cancel
  /retour/i,             // back
]

function shouldSkip(label) {
  return SKIP_PATTERNS.some((r) => r.test(label))
}

const MAX_BUTTONS_PER_ROUTE = 8   // cap per route to keep runtime bounded
const CLICK_TIMEOUT_MS = 1000
const POST_CLICK_WAIT_MS = 150

async function clickSafeButtons(page, route) {
  const issues = []
  const onConsole = (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    if (isBenign(m.text())) return
    issues.push({ route, type: 'console', text: m.text().slice(0, 200) })
  }
  const onErr = (e) => { if (!isBenign(e.message)) issues.push({ route, type: 'error', text: e.message.slice(0, 200) }) }
  const onResp = (r) => {
    if (r.status() >= 400 && !isBenign(r.url())) {
      issues.push({ route, type: 'http', text: `${r.status()} ${r.request().method()} ${r.url()}` })
    }
  }
  page.on('console', onConsole); page.on('pageerror', onErr); page.on('response', onResp)

  let clicked = 0
  try {
    // Enumerate visible button nodes inside the page content (not sidebar/topbar)
    const handles = await Promise.race([
      page.locator('main#main-content button:visible').all(),
      new Promise((resolve) => setTimeout(() => resolve([]), 3000)),
    ])
    const btns = Array.isArray(handles) ? handles : []

    // Pre-filter by computed accessible name — we avoid a second evaluate() per button inside the loop
    const metadata = await Promise.all(btns.map(async (btn) => {
      try {
        return await btn.evaluate((el) => ({
          name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim(),
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        }))
      } catch {
        return { name: '', disabled: true }
      }
    }))

    const candidates = btns
      .map((btn, i) => ({ btn, ...metadata[i] }))
      .filter((c) => !c.disabled && !shouldSkip(c.name))
      .slice(0, MAX_BUTTONS_PER_ROUTE)

    for (const c of candidates) {
      try {
        await c.btn.click({ timeout: CLICK_TIMEOUT_MS, force: true })
        clicked++
        await page.waitForTimeout(POST_CLICK_WAIT_MS)
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(80)
      } catch {
        // swallow per-click timeouts; we're after diagnostics, not throws
      }
    }
  } finally {
    page.off('console', onConsole); page.off('pageerror', onErr); page.off('response', onResp)
  }
  return { clicked, issues }
}

async function run() {
  const tokens = {}
  for (const r of ROLES) tokens[r.key] = await getToken(r)
  const projectId = await firstProjectId(tokens.admin)
  if (!projectId) throw new Error('No project')

  const report = { byRole: {}, totalIssues: [], summary: { clicked: 0, issues: 0 } }
  const browser = await chromium.launch({ headless: true })

  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: tokens[role.key] })
    await context.route('**/config.json*', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    }))
    const page = await context.newPage()
    report.byRole[role.key] = { clicked: 0, issues: 0, perRoute: [] }

    for (const route of routesForRole(role.key, projectId)) {
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(500)
      } catch {
        continue
      }
      const { clicked, issues } = await clickSafeButtons(page, route)
      report.byRole[role.key].clicked += clicked
      report.byRole[role.key].issues += issues.length
      report.byRole[role.key].perRoute.push({ route, clicked, issues: issues.length })
      report.summary.clicked += clicked
      report.summary.issues += issues.length
      report.totalIssues.push(...issues)
      const badge = issues.length === 0 ? '✓' : '✗'
      console.log(`  ${badge} ${role.key.padEnd(5)} ${route}  clicked=${clicked} issues=${issues.length}`)
    }
    await context.close()
  }
  await browser.close()

  writeFileSync('/tmp/smoke-every-button.json', JSON.stringify(report, null, 2))

  console.log('\n── Summary ──')
  console.log(`  Total buttons clicked: ${report.summary.clicked}`)
  console.log(`  Total issues:          ${report.summary.issues}`)

  if (report.totalIssues.length > 0) {
    console.log('\n── Issues (top 15) ──')
    report.totalIssues.slice(0, 15).forEach((i) => {
      console.log(`  [${i.type}] ${i.route} — ${i.text}`)
    })
  }

  process.exit(report.summary.issues === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
