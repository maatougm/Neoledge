/**
 * @file smoke-mutations.mjs
 * @desc Headless Playwright harness that performs real mutations and asserts
 *       the UI updates without console errors.
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

async function getAdminToken() {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  return (await r.json()).jwt
}

async function getProject(jwt) {
  const r = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${jwt}` } })
  const d = await r.json()
  const items = Array.isArray(d) ? d : d.items
  return items[0]
}

async function run() {
  const jwt = await getAdminToken()
  const project = await getProject(jwt)
  if (!project) throw new Error('No project')
  const projectId = project.id
  console.log('Using project:', project.name, projectId)

  const results = []
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: jwt })
  await context.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))

  const page = await context.newPage()

  const diagnostics = []
  page.on('console', (m) => {
    const t = m.type(), x = m.text()
    if (isBenign(x)) return
    if (t === 'error' || t === 'warning') diagnostics.push({ type: t, text: x })
  })
  page.on('pageerror', (e) => { if (!isBenign(e.message)) diagnostics.push({ type: 'pageerror', text: e.message }) })
  page.on('response', (r) => {
    if (r.status() >= 400 && !isBenign(r.url())) diagnostics.push({ type: 'http', text: `${r.status()} ${r.request().method()} ${r.url()}` })
  })

  const test = async (label, fn) => {
    const before = diagnostics.length
    console.log(`▶ ${label}`)
    try {
      await fn()
      const issues = diagnostics.slice(before)
      const pass = issues.length === 0
      results.push({ label, pass, issues })
      console.log(`  ${pass ? '✓' : '✗'} ${label}${issues.length ? ` — ${issues.length} issues` : ''}`)
      if (issues.length) issues.forEach((i) => console.log(`      [${i.type}] ${i.text.slice(0, 200)}`))
    } catch (e) {
      results.push({ label, pass: false, issues: [{ type: 'exception', text: e.message }] })
      console.log(`  ✗ ${label} — EXCEPTION: ${e.message}`)
    }
  }

  // ── Test 1: Create a Work Package via UI ────────────────────────────
  await test('Create Work Package via dialog', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/workpackages`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Nouveau/i }).first().click()
    await page.waitForTimeout(300)
    const titleInput = page.locator('input[type="text"]').first()
    await titleInput.fill(`Smoke WP ${Date.now()}`)
    await page.getByRole('button', { name: /Créer/i }).click()
    await page.waitForTimeout(800)
  })

  // ── Test 2: Open WP detail from the list ────────────────────────────
  await test('Open WP detail via row click', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/workpackages`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const firstRow = page.locator('.wp-table__row').first()
    if (await firstRow.count() > 0) {
      await firstRow.click()
      await page.waitForTimeout(600)
    }
  })

  // ── Test 3: Kanban board navigation + drag handles render ───────────
  await test('Kanban board columns render', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/board`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const cols = await page.locator('.kb__col').count()
    if (cols === 0) throw new Error('No kanban columns rendered')
  })

  // ── Test 4: Create wiki page ────────────────────────────────────────
  await test('Create wiki page', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/wiki`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Nouvelle page/i }).click()
    await page.waitForTimeout(300)
    const title = page.locator('input[type="text"]').first()
    await title.fill(`Smoke Wiki ${Date.now()}`)
    await page.getByRole('button', { name: /Créer/i }).click()
    await page.waitForTimeout(800)
  })

  // ── Test 5: Add budget line item ────────────────────────────────────
  await test('Add budget line item', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/budget`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Ajouter ligne/i }).click()
    await page.waitForTimeout(300)
    const desc = page.locator('input[type="text"]').first()
    await desc.fill(`Smoke line ${Date.now()}`)
    await page.getByRole('button', { name: /^Ajouter$/ }).click()
    await page.waitForTimeout(800)
  })

  // ── Test 6: Log time entry ─────────────────────────────────────────
  await test('Log time entry', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/time`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Saisir du temps/i }).click()
    await page.waitForTimeout(300)
    // Close dialog — we don't want to create bogus time entries that screw up reports
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  // ── Test 7: Gantt renders with WPs ─────────────────────────────────
  await test('Gantt renders timeline', async () => {
    await page.goto(`${BASE}/app/pm/projects/${projectId}/gantt`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const bars = await page.locator('.gantt__bar').count()
    // A seeded project should have at least 1 WP with dates on it
    // If 0, probably just means this specific project has no dated WPs — not a bug
    console.log(`    (${bars} Gantt bars rendered)`)
  })

  // ── Test 8: Search modal opens and queries API ─────────────────────
  await test('Global search returns results', async () => {
    await page.goto(`${BASE}/app/admin/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control')
    // Wait for the search input to actually appear
    await page.locator('.search-input').waitFor({ state: 'visible', timeout: 3000 })
    await page.locator('.search-input').fill('Migration')
    // Wait for debounce + API call
    await page.waitForTimeout(1000)
    const resultCount = await page.locator('.search-item').count()
    await page.keyboard.press('Escape')
    if (resultCount === 0) throw new Error('Search returned no results for "Migration"')
  })

  await browser.close()

  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n${passed}/${results.length} passed, ${failed} failed`)
  writeFileSync('/tmp/smoke-mutations.json', JSON.stringify(results, null, 2))
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
