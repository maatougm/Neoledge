/**
 * @file smoke-test.mjs
 * @desc Headless Playwright harness that navigates every view and captures
 *       console messages, page errors, failed requests, and Vue warnings.
 *       Produces /tmp/smoke-report.json.
 *
 * Run: node smoke-test.mjs
 */

import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'

const BASE = 'http://localhost:5174/Sample/Front'
const API_BASE = 'http://localhost:5122'

const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' }

// Known benign patterns we explicitly tolerate.
const BENIGN = [
  /\[Vue warn\].*Extraneous non-props attributes.*transition/i,  // primevue internals
  /tabs:outgoing.message.ready/i,                                 // browser extension
  /chrome-extension:\/\//i,                                       // any extension
  /\[HMR\]/i,                                                     // vite HMR
  /WebSocket connection.*ws:\/\/localhost:5174/i,                 // vite HMR socket
  /sourcemap/i,
]

function isBenign(text) {
  return BENIGN.some((re) => re.test(text))
}

async function getAdminToken() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const { jwt } = await res.json()
  return jwt
}

async function firstProjectId(jwt) {
  const res = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${jwt}` } })
  const data = await res.json()
  const items = Array.isArray(data) ? data : data.items ?? []
  return items[0]?.id ?? null
}

function buildRoutes(projectId) {
  return [
    '/app/admin/dashboard',
    '/app/admin/projects',
    '/app/admin/users',
    '/app/admin/templates',
    '/app/admin/analytics',
    '/app/admin/activity',
    '/app/admin/logs',
    '/app/admin/system',
    '/app/admin/portfolio',
    '/app/admin/team-planner',
    '/app/admin/audit',
    '/app/admin/trash',
    '/app/pm/projects',
    `/app/pm/projects/${projectId}`,
    `/app/pm/projects/${projectId}/workpackages`,
    `/app/pm/projects/${projectId}/gantt`,
    `/app/pm/projects/${projectId}/board`,
    `/app/pm/projects/${projectId}/backlogs`,
    `/app/pm/projects/${projectId}/sprint`,
    `/app/pm/projects/${projectId}/wiki`,
    `/app/pm/projects/${projectId}/budget`,
    `/app/pm/projects/${projectId}/time`,
    `/app/pm/projects/${projectId}/members`,
    `/app/pm/projects/${projectId}/activity`,
    '/app/profile',
  ]
}

async function run() {
  console.log('Getting admin token…')
  const jwt = await getAdminToken()
  const projectId = await firstProjectId(jwt)
  if (!projectId) throw new Error('No project found — seed the DB first.')
  console.log('Using project:', projectId)

  const routes = buildRoutes(projectId)
  const report = {
    startedAt: new Date().toISOString(),
    base: BASE,
    routes: [],
    summary: { errors: 0, warnings: 0, failedRequests: 0, pageErrors: 0 },
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  // Inject the JWT BEFORE any app code runs — authStore reads from localStorage on init.
  await context.addInitScript(({ token }) => {
    try { localStorage.setItem('nl_jwt', token) } catch {}
  }, { token: jwt })
  // Also set runtime API URL config override for the frontend's configStore.
  await context.route('**/config.json*', (route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    })
  })

  for (const route of routes) {
    const entry = {
      route,
      console: [],      // {type, text}
      pageErrors: [],   // JS errors
      failedRequests: [], // {url, status, method}
    }

    const onConsole = (msg) => {
      const type = msg.type()
      const text = msg.text()
      if (isBenign(text)) return
      if (type === 'error' || type === 'warning') {
        entry.console.push({ type, text })
      }
    }
    const onPageError = (err) => {
      if (isBenign(err.message)) return
      entry.pageErrors.push({ message: err.message, stack: err.stack })
    }
    const onResponse = (res) => {
      const status = res.status()
      if (status >= 400) {
        const url = res.url()
        if (isBenign(url)) return
        // Ignore expected 401 on /hook/logout (if called)
        if (url.includes('/hook/logout')) return
        entry.failedRequests.push({ url, status, method: res.request().method() })
      }
    }

    page.on('console', onConsole)
    page.on('pageerror', onPageError)
    page.on('response', onResponse)

    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(800) // let lazy components render
    } catch (e) {
      entry.pageErrors.push({ message: `NAV_TIMEOUT: ${e.message}` })
    }

    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)

    report.summary.errors += entry.console.filter((c) => c.type === 'error').length
    report.summary.warnings += entry.console.filter((c) => c.type === 'warning').length
    report.summary.pageErrors += entry.pageErrors.length
    report.summary.failedRequests += entry.failedRequests.length

    const badge = (entry.console.length + entry.pageErrors.length + entry.failedRequests.length === 0) ? '✓' : '✗'
    console.log(`  ${badge} ${route}  console=${entry.console.length} err=${entry.pageErrors.length} 4xx/5xx=${entry.failedRequests.length}`)

    report.routes.push(entry)
  }

  // ── Interactive flows ────────────────────────────────────────────────
  const flows = [
    {
      label: 'Ctrl+K global search',
      route: '/app/admin/dashboard',
      action: async () => {
        await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control')
        await page.waitForTimeout(300)
        await page.keyboard.type('Migration')
        await page.waitForTimeout(500)
        await page.keyboard.press('Escape')
      },
    },
    {
      label: 'Help dialog (?)',
      route: '/app/admin/dashboard',
      action: async () => {
        await page.keyboard.press('Shift+/')
        await page.waitForTimeout(200)
        await page.keyboard.press('Escape')
      },
    },
    {
      label: 'Create WP dialog (c shortcut)',
      route: `/app/pm/projects/${projectId}/workpackages`,
      action: async () => {
        await page.keyboard.press('KeyC')
        await page.waitForTimeout(400)
        await page.keyboard.press('Escape')
      },
    },
  ]

  for (const flow of flows) {
    const entry = { route: `[interactive] ${flow.label}`, console: [], pageErrors: [], failedRequests: [] }
    const onConsole = (msg) => {
      const type = msg.type(); const text = msg.text()
      if (isBenign(text)) return
      if (type === 'error' || type === 'warning') entry.console.push({ type, text })
    }
    const onPageError = (err) => { if (!isBenign(err.message)) entry.pageErrors.push({ message: err.message }) }
    const onResponse = (res) => {
      if (res.status() >= 400 && !isBenign(res.url())) entry.failedRequests.push({ url: res.url(), status: res.status() })
    }
    page.on('console', onConsole); page.on('pageerror', onPageError); page.on('response', onResponse)
    try {
      await page.goto(`${BASE}${flow.route}`, { waitUntil: 'networkidle', timeout: 15000 })
      await flow.action()
    } catch (e) {
      entry.pageErrors.push({ message: `FLOW_ERROR: ${e.message}` })
    }
    page.off('console', onConsole); page.off('pageerror', onPageError); page.off('response', onResponse)
    report.summary.errors += entry.console.filter((c) => c.type === 'error').length
    report.summary.warnings += entry.console.filter((c) => c.type === 'warning').length
    report.summary.pageErrors += entry.pageErrors.length
    report.summary.failedRequests += entry.failedRequests.length
    const total = entry.console.length + entry.pageErrors.length + entry.failedRequests.length
    const badge = total === 0 ? '✓' : '✗'
    console.log(`  ${badge} ${entry.route}  console=${entry.console.length} err=${entry.pageErrors.length} 4xx/5xx=${entry.failedRequests.length}`)
    report.routes.push(entry)
  }

  await browser.close()
  report.finishedAt = new Date().toISOString()

  try { mkdirSync('/tmp', { recursive: true }) } catch {}
  writeFileSync('/tmp/smoke-report.json', JSON.stringify(report, null, 2))
  console.log('\nReport → /tmp/smoke-report.json')
  console.log('Summary:', report.summary)
}

run().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
