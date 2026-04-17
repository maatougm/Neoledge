/**
 * @file smoke-mobile.mjs — Smoke test at iPhone SE viewport (375×812).
 * Checks for console errors + also detects **horizontal overflow** (layout breakage).
 */

import { chromium, devices } from 'playwright'
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
  const projectId = await (await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${jwt}` } })).json().then((d) => (d.items || d)[0]?.id)
  if (!projectId) throw new Error('No project')

  const routes = [
    '/app/admin/dashboard',
    '/app/admin/projects',
    '/app/admin/analytics',
    `/app/pm/projects/${projectId}`,
    `/app/pm/projects/${projectId}/workpackages`,
    `/app/pm/projects/${projectId}/board`,
    `/app/pm/projects/${projectId}/wiki`,
    `/app/pm/projects/${projectId}/budget`,
    `/app/pm/projects/${projectId}/time`,
  ]

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    ...devices['iPhone SE'],
  })
  await context.addInitScript(({ t }) => {
    try { localStorage.setItem('nl_jwt', t) } catch {}
  }, { t: jwt })
  await context.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))
  const page = await context.newPage()

  const report = { routes: [], summary: { errors: 0, overflow: 0, pageErrors: 0 } }
  for (const route of routes) {
    const entry = { route, console: [], pageErrors: [], overflow: false, overflowAmount: 0 }
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
      // Detect horizontal overflow: any element wider than the viewport is a layout bug.
      const overflow = await page.evaluate(() => {
        const vw = window.innerWidth
        const body = document.body
        const overflowing = Array.from(document.querySelectorAll('*')).some((el) => {
          const r = el.getBoundingClientRect()
          return r.right - r.left > vw + 1 && r.width > 50
        })
        return { vw, bodyScrollWidth: body.scrollWidth, overflowing }
      })
      if (overflow.bodyScrollWidth > overflow.vw + 1) {
        entry.overflow = true
        entry.overflowAmount = overflow.bodyScrollWidth - overflow.vw
      }
    } catch (e) {
      entry.pageErrors.push(`NAV: ${e.message}`)
    }
    page.off('console', onConsole); page.off('pageerror', onErr)
    report.summary.errors += entry.console.filter((c) => c.type === 'error').length
    report.summary.pageErrors += entry.pageErrors.length
    if (entry.overflow) report.summary.overflow++
    const total = entry.console.length + entry.pageErrors.length + (entry.overflow ? 1 : 0)
    const parts = []
    if (entry.console.length) parts.push(`console=${entry.console.length}`)
    if (entry.pageErrors.length) parts.push(`err=${entry.pageErrors.length}`)
    if (entry.overflow) parts.push(`overflow=+${entry.overflowAmount}px`)
    console.log(`  ${total === 0 ? '✓' : '✗'} ${route}${parts.length ? '  ' + parts.join(' ') : ''}`)
    report.routes.push(entry)
  }
  await browser.close()
  writeFileSync('/tmp/smoke-mobile.json', JSON.stringify(report, null, 2))
  console.log('\nMobile summary:', report.summary)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
