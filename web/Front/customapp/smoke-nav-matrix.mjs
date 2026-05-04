/**
 * @file smoke-nav-matrix.mjs — Verify sidebar nav per role matches the
 *   expected items (AppShell adminNav / pmNav / teamNav + contextual project
 *   module nav when inside /app/pm/projects/:id/*).
 */

import { chromium } from 'playwright'

const API_BASE = 'http://localhost:5122'
const BASE = 'http://localhost:5173/Sample/Front'

const ACCOUNTS = [
  { role: 'Admin',     email: 'admin@neoleadge.com',          password: 'Admin@123',     home: '/app/admin/dashboard' },
  { role: 'PM',        email: 'testpm@neoleadge.test',        password: 'TestPm@123',    home: '/app/pm/projects'     },
  { role: 'Spec',      email: 'testspec@neoleadge.test',      password: 'TestSpec@123',  home: '/app/team/projects'   },
  { role: 'Realiz',    email: 'testrealiz@neoleadge.test',    password: 'TestRealiz@123',home: '/app/team/projects'   },
  { role: 'Deploy',    email: 'testdeploy@neoleadge.test',    password: 'TestDeploy@123',home: '/app/team/projects'   },
]

const EXPECTED = {
  Admin: [
    'Tableau de bord', 'Projets', 'Utilisateurs', 'Modèles',
    'Analytiques', 'Activité', 'Journaux', 'Portefeuille', 'Planif. équipe',
    'Statut système', 'Audit', 'Corbeille',
  ],
  PM: [
    'Mes projets', 'Mes tâches', 'Planif. équipe', 'Mon profil',
  ],
  Spec:    ['Projets', 'Validations', 'Mon profil'],
  Realiz:  ['Projets', 'Validations', 'Mon profil'],
  Deploy:  ['Projets', 'Validations', 'Mon profil'],
}

// Contextual nav shown when navigating into a specific project (PM/Admin).
const EXPECTED_PROJECT_NAV = [
  'Mes projets',
  'Aperçu', 'Work Packages', 'Gantt', 'Board', 'Backlog', 'Sprint', 'Wiki',
  'Budget', 'Temps', 'Membres', 'Activité',
  'Mon profil',
]

async function getJwt(email, password) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await r.json()).jwt
}

async function getNavLabels(page, targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(500)
  // The rail auto-collapses; hover to expand then read labels.
  await page.hover('aside.rail, .sidebar, nav[aria-label], .app-sidebar').catch(() => {})
  await page.waitForTimeout(300)
  return await page.$$eval(
    'aside a, nav a, .sidebar a, .rail a',
    (els) => Array.from(new Set(els.map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 40))),
  )
}

function evaluate(actual, expected) {
  const missing = expected.filter((label) => !actual.some((a) => a.includes(label)))
  return { pass: missing.length === 0, missing }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const results = []

  // Fetch an admin token once so we can pick a real project id for the contextual nav test.
  const adminJwt = await getJwt(ACCOUNTS[0].email, ACCOUNTS[0].password)
  const projectsRes = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${adminJwt}` } })
  const projects = await projectsRes.json()
  const sampleProjectId = (Array.isArray(projects) ? projects : projects.items)[0]?.id
  if (!sampleProjectId) throw new Error('No seeded project for contextual nav test')

  for (const acc of ACCOUNTS) {
    const jwt = await getJwt(acc.email, acc.password)
    const ctx = await browser.newContext()
    await ctx.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: jwt })
    await ctx.route('**/config.json*', (req) => req.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    }))
    const page = await ctx.newPage()

    // 1. Top-level / role nav
    const topLabels = await getNavLabels(page, `${BASE}${acc.home}`)
    const topCheck = evaluate(topLabels, EXPECTED[acc.role])
    results.push({ role: acc.role, scope: 'role-nav', pass: topCheck.pass, missing: topCheck.missing })

    // 2. Contextual project nav — only PM/Admin can access /app/pm/projects/:id
    if (acc.role === 'Admin' || acc.role === 'PM') {
      const projLabels = await getNavLabels(page, `${BASE}/app/pm/projects/${sampleProjectId}`)
      const projCheck = evaluate(projLabels, EXPECTED_PROJECT_NAV)
      results.push({ role: acc.role, scope: 'project-nav', pass: projCheck.pass, missing: projCheck.missing })
    }

    await ctx.close()
  }

  await browser.close()

  let pass = 0, fail = 0
  for (const r of results) {
    console.log(`${r.pass ? '✓' : '✗'} ${r.role.padEnd(8)}  ${r.scope.padEnd(12)}${r.pass ? '' : `  missing=${r.missing.join(', ')}`}`)
    r.pass ? pass++ : fail++
  }
  console.log(`\n${pass}/${results.length} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
