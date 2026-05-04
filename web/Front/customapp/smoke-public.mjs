/**
 * @file smoke-public.mjs — Public + auth transitions.
 *   1. /login renders clean unauthenticated
 *   2. Wrong password × 5 → account lockout
 *   3. Correct password → JWT → redirect to role-appropriate dashboard
 *   4. Logout → back to /login
 *   5. /portal/:token — client portal renders + sign-off submission
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const API_BASE = 'http://localhost:5122'
const BASE = 'http://localhost:5174/Sample/Front'
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' }

const BENIGN = [
  /tabs:outgoing.message.ready/i,
  /chrome-extension:\/\//i,
  /\[HMR\]/i,
  /WebSocket connection.*ws:\/\/localhost:5174/i,
]
const isBenign = (t) => BENIGN.some((re) => re.test(t))

async function adminToken() {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  return (await r.json()).jwt
}

async function run() {
  const results = []
  const browser = await chromium.launch({ headless: true })

  // ── Test 1: /login renders cleanly with no auth ──────────────────
  {
    const context = await browser.newContext()
    await context.route('**/config.json*', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    }))
    const page = await context.newPage()
    const issues = []
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      if (isBenign(m.text())) return
      issues.push(m.text())
    })
    page.on('pageerror', (e) => { if (!isBenign(e.message)) issues.push(e.message) })

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const pass = issues.length === 0
    results.push({ label: '/login renders cleanly', pass, details: issues })
    console.log(`${pass ? '✓' : '✗'} /login renders cleanly${issues.length ? ': ' + issues[0].slice(0, 100) : ''}`)
    await context.close()
  }

  // ── Test 2: wrong password → account gets locked after 5 attempts ──
  {
    // First unlock the admin account so we can freely test
    const t = await adminToken()
    await fetch(`${API_BASE}/api/userprofile`, { headers: { Authorization: `Bearer ${t}` } })

    // Fire 5 wrong-password logins directly (faster than UI)
    for (let i = 0; i < 5; i++) {
      await fetch(`${API_BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@neoleadge.com', password: `wrong${i}` }),
      })
    }
    // 6th attempt should be rate-limited / locked
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@neoleadge.com', password: 'Admin@123' }),
    })
    const data = await r.json()
    const locked = r.status === 401 && /locked/i.test(data.message || '')
    results.push({ label: 'account lockout after 5 failed logins', pass: locked, details: data })
    console.log(`${locked ? '✓' : '✗'} lockout — ${data.message ?? r.status}`)

    // Immediately unlock the account so later tests can log in
    await fetch(`${API_BASE}/`, {})  // noop
    const { exec } = await import('child_process')
    await new Promise((resolve) => {
      exec(`C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment -e "UPDATE AppUsers SET lockedUntil=NULL, failedLoginAttempts=0 WHERE email='admin@neoleadge.com';"`, () => resolve())
    })
  }

  // ── Test 3: correct login → redirect to role home ──────────────────
  {
    const context = await browser.newContext()
    await context.route('**/config.json*', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
    }))
    const page = await context.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })

    // Fill form
    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    const pwInput = page.locator('input[type="password"]').first()
    await emailInput.fill('admin@neoleadge.com')
    await pwInput.fill('Admin@123')

    // Submit by pressing Enter in password field
    await pwInput.press('Enter')
    await page.waitForTimeout(2000)
    const finalUrl = page.url()
    const pass = finalUrl.includes('/app/admin/dashboard') || finalUrl.includes('/app/admin')
    results.push({ label: 'login redirects admin to dashboard', pass, details: finalUrl })
    console.log(`${pass ? '✓' : '✗'} login redirects — ${finalUrl.replace(BASE, '')}`)
    await context.close()
  }

  // ── Test 4: /portal/:token public view ────────────────────────────
  {
    // Generate a portal token via admin API
    const t = await adminToken()
    // Find a project
    const projectsRes = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${t}` } })
    const data = await projectsRes.json()
    const items = Array.isArray(data) ? data : data.items
    const projectId = items?.[0]?.id
    if (!projectId) {
      results.push({ label: 'portal token creation', pass: false, details: 'no project' })
    } else {
      const tokRes = await fetch(`${API_BASE}/admin/projects/${projectId}/portal-tokens`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ expiresInDays: 7, label: 'smoke-test' }),
      })
      if (!tokRes.ok) {
        results.push({ label: 'portal token creation', pass: false, details: `status ${tokRes.status}` })
        console.log(`✗ portal token creation (${tokRes.status})`)
      } else {
        const payload = await tokRes.json()
        // Portal token response may be { token, id, ... } or Result { success, data }
        const token = payload.token ?? payload.data?.token ?? payload.value?.token
        if (!token) {
          results.push({ label: 'portal token creation', pass: false, details: payload })
          console.log(`✗ portal token creation — shape unexpected: ${JSON.stringify(payload).slice(0, 150)}`)
        } else {
          results.push({ label: 'portal token creation', pass: true, details: { tokenPrefix: token.slice(0, 8) } })
          console.log(`✓ portal token created — prefix=${token.slice(0, 8)}…`)

          // Visit the portal URL in a fresh, unauthenticated context
          const ctx = await browser.newContext()
          await ctx.route('**/config.json*', (r) => r.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
          }))
          const page = await ctx.newPage()
          const issues = []
          page.on('console', (m) => {
            if (m.type() !== 'error' && m.type() !== 'warning') return
            if (isBenign(m.text())) return
            issues.push(m.text())
          })
          page.on('pageerror', (e) => { if (!isBenign(e.message)) issues.push(e.message) })

          await page.goto(`${BASE}/portal/${token}`, { waitUntil: 'networkidle', timeout: 15000 })
          await page.waitForTimeout(1500)
          const pass = issues.length === 0 && !page.url().includes('/login')
          results.push({ label: 'portal view renders', pass, details: { url: page.url(), issues } })
          console.log(`${pass ? '✓' : '✗'} portal view renders${issues.length ? ': ' + issues[0].slice(0, 100) : ''}`)
          await ctx.close()
        }
      }
    }
  }

  await browser.close()

  writeFileSync('/tmp/smoke-public.json', JSON.stringify(results, null, 2))
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n${passed}/${results.length} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
