/**
 * @file smoke-darkmode.mjs — Smoke test in dark mode.
 * Toggles the dark-mode setting via localStorage and replays the core nav.
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:5174/Sample/Front'
const API_BASE = 'http://localhost:5122'
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' }

const BENIGN = [
  /tabs:outgoing.message.ready/i,
  /chrome-extension:\/\//i,
  /\[HMR\]/i,
  /WebSocket connection.*ws:\/\/localhost:5174/i,
]
const isBenign = (t) => BENIGN.some((re) => re.test(t))

async function run() {
  const jwt = await (await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
  })).json().then((r) => r.jwt)
  const { items, data } = await (await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${jwt}` } })).json().then((d) => ({ items: d.items || d, data: d }))
  const projectId = (Array.isArray(items) ? items : [])[0]?.id
  if (!projectId) throw new Error('No project')

  const routes = [
    '/app/admin/dashboard',
    '/app/admin/projects',
    '/app/admin/analytics',
    '/app/admin/portfolio',
    '/app/admin/team-planner',
    `/app/pm/projects/${projectId}`,
    `/app/pm/projects/${projectId}/workpackages`,
    `/app/pm/projects/${projectId}/gantt`,
    `/app/pm/projects/${projectId}/board`,
    `/app/pm/projects/${projectId}/wiki`,
    `/app/pm/projects/${projectId}/budget`,
    `/app/pm/projects/${projectId}/time`,
  ]

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  // Inject JWT + dark mode prefs BEFORE app runs
  await context.addInitScript(({ t }) => {
    try {
      localStorage.setItem('nl_jwt', t)
      localStorage.setItem('nl-dark-mode', 'true')
      localStorage.setItem('ui-dark', 'true')
      document.documentElement.classList.add('dark')
    } catch {}
  }, { t: jwt })
  await context.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))
  const page = await context.newPage()

  const report = { routes: [], summary: { errors: 0, warnings: 0, pageErrors: 0 } }
  for (const route of routes) {
    const entry = { route, console: [], pageErrors: [] }
    const onConsole = (m) => {
      const t = m.type(), x = m.text()
      if (isBenign(x)) return
      if (t === 'error' || t === 'warning') entry.console.push({ type: t, text: x })
    }
    const onErr = (e) => { if (!isBenign(e.message)) entry.pageErrors.push(e.message) }
    page.on('console', onConsole); page.on('pageerror', onErr)
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(500)
    } catch (e) {
      entry.pageErrors.push(`NAV: ${e.message}`)
    }
    page.off('console', onConsole); page.off('pageerror', onErr)
    report.summary.errors += entry.console.filter((c) => c.type === 'error').length
    report.summary.warnings += entry.console.filter((c) => c.type === 'warning').length
    report.summary.pageErrors += entry.pageErrors.length
    const total = entry.console.length + entry.pageErrors.length
    console.log(`  ${total === 0 ? '✓' : '✗'} ${route}  console=${entry.console.length} err=${entry.pageErrors.length}`)
    report.routes.push(entry)
  }
  await browser.close()
  writeFileSync('/tmp/smoke-darkmode.json', JSON.stringify(report, null, 2))
  console.log('\nDark-mode summary:', report.summary)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
