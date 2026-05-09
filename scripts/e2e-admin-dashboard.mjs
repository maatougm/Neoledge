#!/usr/bin/env node
// Admin dashboard landing E2E test.
// Tests Admin login → auto-redirect to /app/admin/dashboard → KPI presence →
// sidebar nav sections → cross-role route access probes.

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT  = 'https://neoleadge.pythagore-init.com';
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' };
const SHOTS = './scripts/e2e-dashboards-shots/admin';

await mkdir(SHOTS, { recursive: true }).catch(() => {});

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

const findings  = [];  // { severity, stage, kind, msg }
const passed    = [];  // { stage, label }
const state     = { stage: 'init' };
const setStage  = (s) => { state.stage = s; log(`──── ${s} ────`); };
const PASS      = (label, detail = '') => { passed.push({ stage: state.stage, label }); log(`PASS  ${label}${detail ? ' — ' + detail : ''}`); };
const FAIL      = (sev, msg) => { findings.push({ severity: sev, stage: state.stage, msg }); log(`FAIL  [${sev}] ${msg}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

// ── Listeners ─────────────────────────────────────────────────────────────────
const consoleErrors = [];
page.on('console', (msg) => {
  if (['log','debug','info'].includes(msg.type())) return;
  const text = msg.text();
  if (/google|gstatic|googleapis|favicon/.test(text)) return;
  consoleErrors.push({ stage: state.stage, type: msg.type(), text: text.slice(0, 220) });
});
page.on('pageerror', (err) => {
  findings.push({ severity: 'HIGH', stage: state.stage, kind: 'pageerror', msg: err.message.slice(0, 220) });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/.test(u)) return;
  if (/google|gstatic/.test(u)) return;
  findings.push({
    severity: s >= 500 ? 'CRITICAL' : 'MEDIUM',
    stage: state.stage,
    kind: 'http' + s,
    msg: u.slice(0, 180),
  });
});

async function shot(name, label) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch((e) => log(`screenshot error: ${e.message}`));
  log(`  screenshot → ${p}  (${label || name})`);
  return p;
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password }) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Try a quick-login button labelled "Admin" (not "Se connecter / Connect")
  let used = false;
  const handles = await page.locator('button').elementHandles();
  for (const h of handles) {
    const txt = (await h.innerText().catch(() => '')).trim();
    if (/^admin$/i.test(txt) && !/connect/i.test(txt)) {
      log(`  using quick-login button: "${txt}"`);
      await h.click();
      used = true;
      break;
    }
  }

  if (!used) {
    log('  using email/password form');
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  if (!/\/app/.test(page.url())) {
    throw new Error(`Login failed — landed on: ${page.url()}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
try {

  // ─── Step 1: Login ─────────────────────────────────────────────────────────
  setStage('1.admin-login');
  await login(ADMIN);
  PASS('admin login', `url=${page.url()}`);

  // ─── Step 2: Landing redirect check ────────────────────────────────────────
  setStage('2.landing-redirect');
  const landingUrl = page.url();
  log(`  landed on: ${landingUrl}`);

  // Wait a beat for any client-side redirect to settle
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const finalUrl = page.url();
  log(`  final url after redirect settle: ${finalUrl}`);

  await shot('01-landing', 'Admin landing page');

  const urlEndsInDashboard = /\/app\/admin\/dashboard/.test(finalUrl);
  if (urlEndsInDashboard) {
    PASS('URL redirected to /app/admin/dashboard', finalUrl);
  } else if (/\/app\/admin/.test(finalUrl)) {
    FAIL('MEDIUM', `URL is /app/admin but not /app/admin/dashboard — possible missing child redirect. Actual: ${finalUrl}`);
  } else if (/\/app$|\/app\//.test(finalUrl) && !/admin/.test(finalUrl)) {
    FAIL('HIGH', `Admin not redirected to admin area — landed on: ${finalUrl}`);
  } else {
    FAIL('HIGH', `Unexpected landing URL: ${finalUrl}`);
  }

  // ─── Step 3: Dashboard KPI content check ───────────────────────────────────
  setStage('3.dashboard-kpis');
  // Navigate explicitly to dashboard in case redirect didn't happen
  if (!/\/app\/admin\/dashboard/.test(page.url())) {
    log('  navigating explicitly to /app/admin/dashboard');
    await page.goto(ROOT + '/app/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('02-dashboard-direct', 'Dashboard via direct nav');
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const kpiKeywords = ['Tableau de bord', 'Projets', 'Utilisateurs', 'tableau', 'projets', 'utilisateurs'];
  const foundKpis = kpiKeywords.filter(k => bodyText.toLowerCase().includes(k.toLowerCase()));
  if (foundKpis.length >= 2) {
    PASS('Dashboard KPI headings present', foundKpis.join(', '));
  } else {
    FAIL('HIGH', `Dashboard KPI headings not found. Body snippet: ${bodyText.slice(0, 300)}`);
  }

  // Check for error states
  if (/erreur|error|500|not found|404/i.test(bodyText.slice(0, 500))) {
    FAIL('HIGH', 'Possible error state on dashboard page');
  } else {
    PASS('No error state on dashboard');
  }

  // ─── Step 4: Sidebar navigation ────────────────────────────────────────────
  setStage('4.sidebar-nav');

  // Sidebar items: label → path slug for navigation
  const sidebarItems = [
    { label: 'Projets',       slug: 'projects',  shotName: '03-admin-projets'    },
    { label: 'Utilisateurs',  slug: 'users',     shotName: '04-admin-utilisateurs'},
    { label: 'Activité',      slug: 'activity',  shotName: '05-admin-activite'   },
    { label: 'Système',       slug: 'system',    shotName: '06-admin-systeme'    },
    { label: 'Audit',         slug: 'audit',     shotName: '07-admin-audit'      },
    { label: 'Corbeille',     slug: 'trash',     shotName: '08-admin-corbeille'  },
  ];

  for (const item of sidebarItems) {
    setStage(`4.sidebar-${item.slug}`);
    // Try clicking the sidebar link by text first
    const link = page.locator(`a, button, li`).filter({ hasText: new RegExp(`^${item.label}$`, 'i') }).first();
    const linkExists = await link.count() > 0;

    if (linkExists) {
      await link.click().catch(() => {});
    } else {
      // Fallback: navigate directly to a guessed path
      const guessPath = `/app/admin/${item.slug}`;
      log(`  sidebar link "${item.label}" not found, navigating to ${guessPath}`);
      await page.goto(ROOT + guessPath, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);

    const currentUrl = page.url();
    const currentBody = await page.locator('body').innerText().catch(() => '');
    const has5xx = /500|internal server error/i.test(currentBody.slice(0, 300));
    const hasFullPageError = /une erreur est survenue|something went wrong|page not found/i.test(currentBody.slice(0, 300));

    await shot(item.shotName, `Admin ${item.label}`);

    if (has5xx || hasFullPageError) {
      FAIL('HIGH', `${item.label} page has error state. URL: ${currentUrl}`);
    } else {
      PASS(`${item.label} page loads without error`, currentUrl);
    }
  }

  // Return to dashboard for cross-role probe
  await page.goto(ROOT + '/app/admin/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // ─── Step 5: Cross-role route probes ───────────────────────────────────────
  setStage('5.cross-role-pm-dashboard');
  await page.goto(ROOT + '/app/pm/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(800);
  const pmDashUrl = page.url();
  const pmDashBody = await page.locator('body').innerText().catch(() => '');
  await shot('09-pm-dashboard-probe', 'PM dashboard as Admin');
  const pmAccessible = !/login|connexion/i.test(pmDashUrl) && !/404|not found/i.test(pmDashBody.slice(0, 200));
  if (pmAccessible) {
    PASS('/app/pm/dashboard accessible as Admin', pmDashUrl);
  } else {
    FAIL('LOW', `/app/pm/dashboard not accessible as Admin — url: ${pmDashUrl} (may be expected if route not yet deployed)`);
  }

  setStage('5.cross-role-team-dashboard');
  await page.goto(ROOT + '/app/team/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(800);
  const teamDashUrl = page.url();
  const teamDashBody = await page.locator('body').innerText().catch(() => '');
  await shot('10-team-dashboard-probe', 'Team dashboard as Admin');
  const teamAccessible = !/login|connexion/i.test(teamDashUrl) && !/404|not found/i.test(teamDashBody.slice(0, 200));
  if (teamAccessible) {
    PASS('/app/team/dashboard accessible as Admin', teamDashUrl);
  } else {
    FAIL('LOW', `/app/team/dashboard not accessible as Admin — url: ${teamDashUrl} (may be expected if route not yet deployed)`);
  }

} catch (err) {
  FAIL('CRITICAL', `Unhandled exception: ${err.message}`);
  await shot('XX-crash', 'crash state').catch(() => {});
} finally {
  await browser.close();
}

// ─── Report ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('ADMIN DASHBOARD E2E RESULTS');
console.log('══════════════════════════════════════════');
console.log(`PASSED:  ${passed.length}`);
console.log(`ISSUES:  ${findings.length}`);
console.log(`CONSOLE ERRORS: ${consoleErrors.length}`);

if (passed.length) {
  console.log('\n-- PASSED --');
  for (const p of passed) console.log(`  [${p.stage}] ${p.label}`);
}

if (findings.length) {
  console.log('\n-- ISSUES --');
  for (const f of findings) console.log(`  [${f.severity}] [${f.stage}] ${f.msg}`);
}

if (consoleErrors.length) {
  console.log('\n-- CONSOLE ERRORS --');
  for (const e of consoleErrors) console.log(`  [${e.stage}] ${e.type}: ${e.text}`);
}

const criticalIssues = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
const landingPass = passed.some(p => p.stage === '2.landing-redirect' && p.label.includes('URL redirected'));
console.log('\n══════ SUMMARY ══════');
console.log(`Admin landing: ${landingPass ? 'PASS' : 'FAIL'}`);
console.log(`Critical/High issues: ${criticalIssues.length}`);
console.log('════════════════════');
