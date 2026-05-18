#!/usr/bin/env node
// Drive Chrome through the admin dashboard, verify the new "Tableau de bord
// des projets" widget renders + filter buttons work + clicking a row navigates.
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs'

const ROOT = 'https://neoleadge.pythagore-init.com'
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push({ t: m.type(), text: m.text() }) })
page.on('pageerror', (e) => errors.push({ t: 'pageerror', text: e.message }))

// Login
const r = await page.request.post(`${ROOT}/auth/login`, {
  data: { email: 'admin@neoleadge.com', password: 'Admin@123' }, failOnStatusCode: false,
})
const { jwt } = await r.json()
if (!jwt) { console.error('login failed'); process.exit(1) }
await page.goto(`${ROOT}/`, { waitUntil: 'load' })
await page.evaluate((t) => localStorage.setItem('nl_jwt', t), jwt)
await page.goto(`${ROOT}/app/admin/dashboard`, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(2000)

const out = { errors, checks: {} }

// 1. The new title is shown
out.checks.title = await page.locator('h2:has-text("Tableau de bord des projets")').count() > 0

// 2. Old pipeline title is gone
out.checks.oldTitleGone = await page.locator('h2:has-text("Pipeline des projets")').count() === 0

// 3. Filter chips render
out.checks.filterCount = await page.locator('.pd-filter').count()

// 4. Default filter is "Tous" (active)
const activeBtn = page.locator('.pd-filter--active').first()
out.checks.activeFilterLabel = (await activeBtn.textContent())?.replace(/\s+/g, ' ').trim() ?? null

// 5. Project rows render
out.checks.rowCount = await page.locator('.pd-row').count()

// 6. Each row has the expected sub-elements
const firstRow = page.locator('.pd-row').first()
out.checks.firstRowName = (await firstRow.locator('.pd-name').textContent())?.trim() ?? null
out.checks.firstRowStatus = await firstRow.locator('[data-pc-name="tag"]').count() > 0
out.checks.firstRowProgress = await firstRow.locator('.pd-progress-bar').count() > 0
out.checks.firstRowDue = await firstRow.locator('.pd-due, .pd-due--none').count() > 0

// 7. Click a filter (En retard) and verify count changes
const overdueBtn = page.locator('.pd-filter:has-text("En retard")').first()
const before = await page.locator('.pd-row').count()
await overdueBtn.click()
await page.waitForTimeout(500)
const after = await page.locator('.pd-row').count()
out.checks.filterChangedRows = before !== after || (after === before && before === 0)
out.checks.overdueIsActive = await overdueBtn.evaluate((el) => el.classList.contains('pd-filter--active'))

// 8. Reset filter then click a row → should navigate to the project detail.
// Use { force: true } so PrimeVue's nested NeoTag doesn't absorb the click.
await page.locator('.pd-filter:has-text("Tous")').first().click()
await page.waitForTimeout(400)
const beforeUrl = page.url()
await page.locator('.pd-row').first().click({ force: true })
// Vue Router's programmatic push can take a beat — wait up to 8 s for the URL.
await page.waitForURL(/\/app\/(admin|pm)\/projects\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {})
out.checks.navigatedAway = page.url() !== beforeUrl
out.checks.landedOnProject = /\/app\/(admin|pm)\/projects\/[0-9a-f-]{36}/.test(page.url())
out.checks.urlAfterClick = page.url()

console.log(JSON.stringify(out, null, 2))
await browser.close()
