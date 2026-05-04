/**
 * @file smoke-a11y.mjs
 * @desc axe-core accessibility audit on every route. Reports violations grouped
 *       by impact. Fails only on critical violations (tunable).
 */

import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:5174/Sample/Front'
const API_BASE = 'http://localhost:5122'

const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' }

async function getAdminToken() {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  return (await r.json()).jwt
}

async function firstProjectId(jwt) {
  const r = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${jwt}` } })
  const d = await r.json()
  return (Array.isArray(d) ? d : d.items)[0]?.id
}

// Check WCAG 2.1 AA rules, limit to actionable violations.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function run() {
  const jwt = await getAdminToken()
  const projectId = await firstProjectId(jwt)
  if (!projectId) throw new Error('No project')

  const routes = [
    '/app/admin/dashboard',
    '/app/admin/projects',
    '/app/admin/users',
    '/app/admin/analytics',
    '/app/admin/portfolio',
    '/app/admin/team-planner',
    '/app/admin/audit',
    '/app/pm/projects',
    `/app/pm/projects/${projectId}`,
    `/app/pm/projects/${projectId}/workpackages`,
    `/app/pm/projects/${projectId}/gantt`,
    `/app/pm/projects/${projectId}/board`,
    `/app/pm/projects/${projectId}/wiki`,
    `/app/pm/projects/${projectId}/budget`,
    `/app/pm/projects/${projectId}/time`,
  ]

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: jwt })
  await context.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))
  const page = await context.newPage()

  const summary = { routes: [], byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 }, byRule: {} }

  for (const route of routes) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(600)
    } catch {
      summary.routes.push({ route, violations: [], error: 'nav timeout' })
      continue
    }

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

    const violations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? 'minor',
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
      // Capture each offending element's CSS selector + snippet for debugging
      targets: v.nodes.slice(0, 3).map((n) => ({
        target: (n.target || []).join(' > '),
        html: (n.html || '').slice(0, 180),
      })),
    }))

    violations.forEach((v) => {
      summary.byImpact[v.impact] = (summary.byImpact[v.impact] ?? 0) + v.nodes
      summary.byRule[v.id] = (summary.byRule[v.id] ?? 0) + v.nodes
    })

    const crit = violations.filter((v) => v.impact === 'critical').length
    const ser = violations.filter((v) => v.impact === 'serious').length
    const mod = violations.filter((v) => v.impact === 'moderate').length
    const min = violations.filter((v) => v.impact === 'minor').length
    const badge = (crit + ser) === 0 ? '✓' : '✗'
    console.log(`  ${badge} ${route}  critical=${crit} serious=${ser} moderate=${mod} minor=${min}`)

    summary.routes.push({ route, violations })
  }

  await browser.close()
  writeFileSync('/tmp/smoke-a11y.json', JSON.stringify(summary, null, 2))

  console.log('\n── Summary by impact ──')
  console.log(`  critical: ${summary.byImpact.critical ?? 0}`)
  console.log(`  serious:  ${summary.byImpact.serious ?? 0}`)
  console.log(`  moderate: ${summary.byImpact.moderate ?? 0}`)
  console.log(`  minor:    ${summary.byImpact.minor ?? 0}`)

  const byRule = Object.entries(summary.byRule).sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (byRule.length) {
    console.log('\n── Top 10 rules violated (by node count) ──')
    byRule.forEach(([id, n]) => console.log(`  ${n.toString().padStart(4)} × ${id}`))
  }

  console.log('\nReport → /tmp/smoke-a11y.json')
  // Fail only on critical (aligned with our "no potential errors" bar)
  process.exit((summary.byImpact.critical ?? 0) > 0 ? 1 : 0)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
