#!/usr/bin/env node
/**
 * E2E: Member (Réalisation) Dashboard Landing Test
 * Target: https://neoleadge.pythagore-init.com
 * Credentials: realiz@neoleadge.com / Valid@123
 *
 * Validates:
 *  - Login redirects to /app/team
 *  - All 6 dashboard sections render
 *  - Sidebar nav items are correct (no Validations / Pending Reviews)
 *  - Task click navigates to /app/team/my-tasks
 *  - Each sidebar section is reachable without 5xx
 *  - /app/team/dashboard probe (route guard)
 */

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT = 'https://neoleadge.pythagore-init.com';
const REALIZ = { email: 'realiz@neoleadge.com', password: 'Valid@123' };
const SHOTS_DIR = './scripts/e2e-dashboards-shots/member';

await mkdir(SHOTS_DIR, { recursive: true }).catch(() => {});

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

// ── Result tracking ──────────────────────────────────────────────────────────
const findings  = [];  // { severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', stage, msg }
const passed    = [];  // { stage, label }
const PASS  = (stage, label) => { passed.push({ stage, label }); log(`✔ [${stage}] ${label}`); };
const FAIL  = (severity, stage, msg) => { findings.push({ severity, stage, msg }); log(`✘ [${severity}][${stage}] ${msg}`); };

// ── Network / console tracking ───────────────────────────────────────────────
const consoleErrors = [];
const networkErrors = [];
let currentStage = 'init';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  const text = msg.text();
  if (/google|gstatic|googleapis/.test(text)) return;
  consoleErrors.push({ stage: currentStage, type: t, text: text.slice(0, 240) });
});

page.on('pageerror', (err) => {
  const msg = err.message.slice(0, 240);
  networkErrors.push({ stage: currentStage, kind: 'pageerror', msg });
  FAIL('HIGH', currentStage, `Page error: ${msg}`);
});

page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/.test(u)) return;
  if (/gstatic|googleapis|google/.test(u)) return;
  const severity = s >= 500 ? 'CRITICAL' : 'MEDIUM';
  networkErrors.push({ stage: currentStage, kind: `http${s}`, url: u.slice(0, 160) });
  FAIL(severity, currentStage, `HTTP ${s}: ${u.slice(0, 120)}`);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function shot(name) {
  const path = `${SHOTS_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
  return path;
}

async function login() {
  currentStage = '01-login';
  log('Navigating to root…');
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  // Try quick-login card for "Développeur / Réalisation" label — these cards
  // pre-fill the email field; we still need to click "Se connecter" after.
  const allElements = await page.locator('*').elementHandles();
  let quickFilled = false;
  // Look for any clickable element (button, div, li, etc.) whose text matches realiz/développeur
  const candidates = await page.locator('[class*="quick"], [class*="card"], li, button, div[role="button"]').elementHandles();
  for (const h of candidates) {
    const txt = (await h.innerText().catch(() => '') ?? '').trim();
    if (/r[eé]alisation|realiz|d[eé]veloppeur/i.test(txt) && txt.length < 120) {
      log(`Quick-login card clicked: "${txt.slice(0, 60)}"`);
      await h.click().catch(() => {});
      await page.waitForTimeout(600);
      // Check if email input was populated
      const emailVal = await page.locator('input[type="email"]').first().inputValue().catch(() => '');
      if (emailVal === REALIZ.email) {
        quickFilled = true;
        log(`Email pre-filled to ${emailVal}`);
      }
      break;
    }
  }

  // Always ensure the correct credentials are in the form
  await page.locator('input[type="email"]').first().fill(REALIZ.email).catch(() => {});
  await page.locator('input[type="password"]').first().fill(REALIZ.password).catch(() => {});
  log('Submitting login form…');
  await page
    .locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")')
    .first()
    .click();

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  log(`Post-login URL: ${finalUrl}`);

  if (!/\/app/.test(finalUrl)) {
    FAIL('CRITICAL', '01-login', `Login failed — stayed at ${finalUrl}`);
    await shot('01-login-fail');
    return false;
  }
  PASS('01-login', `Login succeeded → ${finalUrl}`);
  return true;
}

// ── Main test ────────────────────────────────────────────────────────────────
try {
  // STEP 1: Login
  const loginOk = await login();
  if (!loginOk) {
    log('Aborting — login failed');
    await browser.close();
    process.exit(1);
  }

  // STEP 2: Verify landing URL is /app/team
  currentStage = '02-landing-url';
  const landingUrl = page.url();
  const landingPath = new URL(landingUrl).pathname;
  if (landingPath === '/app/team' || landingPath.startsWith('/app/team')) {
    PASS('02-landing-url', `Landed on ${landingPath} — correct`);
  } else {
    FAIL('HIGH', '02-landing-url', `Expected /app/team, got ${landingPath}`);
  }
  const landingShot = await shot('01-landing');
  log(`Landing screenshot: ${landingShot}`);

  // STEP 3: Verify all 6 dashboard sections visible
  currentStage = '03-sections';

  // Greeting
  const greetingEl = page.locator('h1.md__title, .md__title');
  const greetingText = await greetingEl.textContent({ timeout: 8000 }).catch(() => null);
  if (greetingText && /bonjour/i.test(greetingText)) {
    PASS('03-sections', `Greeting visible: "${greetingText.trim()}"`);
  } else {
    FAIL('HIGH', '03-sections', `Greeting "Bonjour {firstName}" not found. Got: "${greetingText}"`);
  }

  // "À faire aujourd'hui" card
  const todayCard = page.locator('text=À faire aujourd\'hui').first();
  if (await todayCard.isVisible({ timeout: 6000 }).catch(() => false)) {
    PASS('03-sections', '"À faire aujourd\'hui" card present');
  } else {
    FAIL('HIGH', '03-sections', '"À faire aujourd\'hui" card NOT found');
  }

  // "Mon temps cette semaine"
  const timeCard = page.locator('text=Mon temps cette semaine').first();
  if (await timeCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    PASS('03-sections', '"Mon temps cette semaine" card present');
  } else {
    FAIL('HIGH', '03-sections', '"Mon temps cette semaine" card NOT found');
  }

  // "Notifications" card
  const notifCard = page.locator('.md__notif, text=Notifications').first();
  if (await notifCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    PASS('03-sections', '"Notifications" card present');
  } else {
    FAIL('HIGH', '03-sections', '"Notifications" card NOT found');
  }

  // "Sprints en cours"
  const sprintsCard = page.locator('text=Sprints en cours').first();
  if (await sprintsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    PASS('03-sections', '"Sprints en cours" section present');
  } else {
    FAIL('HIGH', '03-sections', '"Sprints en cours" section NOT found');
  }

  // "Mes projets"
  const projectsCard = page.locator('text=Mes projets').first();
  if (await projectsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    PASS('03-sections', '"Mes projets" section present');
  } else {
    FAIL('HIGH', '03-sections', '"Mes projets" section NOT found');
  }

  // STEP 4: Task click (if any tasks exist)
  currentStage = '04-task-click';
  const taskCards = page.locator('.md__tasks .task-card, .md__tasks [class*="task"]');
  const taskCount = await taskCards.count().catch(() => 0);
  log(`Today's tasks visible: ${taskCount}`);

  if (taskCount > 0) {
    log('Clicking first task card…');
    await taskCards.first().click({ timeout: 5000 }).catch((e) => log(`click failed: ${e.message}`));
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const afterTaskUrl = page.url();
    log(`After task click URL: ${afterTaskUrl}`);
    if (/\/app\/team\/my-tasks/.test(afterTaskUrl)) {
      PASS('04-task-click', `Task click navigated to ${new URL(afterTaskUrl).pathname}${new URL(afterTaskUrl).search}`);
    } else {
      FAIL('MEDIUM', '04-task-click', `Expected /app/team/my-tasks, got ${afterTaskUrl}`);
    }
    await shot('04-task-my-tasks');
    // Navigate back to dashboard
    await page.goto(`${ROOT}/app/team`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } else {
    PASS('04-task-click', 'No tasks present in "À faire aujourd\'hui" — empty state shown, skipping click test');
  }

  // STEP 5: Sidebar navigation walk
  currentStage = '05-sidebar';

  // Capture sidebar items from the DOM
  const sidebarLinks = await page.locator('nav a, .sidebar a, [class*="sidebar"] a, [class*="rail"] a').allTextContents().catch(() => []);
  log(`Sidebar link texts: ${JSON.stringify(sidebarLinks.map(t => t.trim()).filter(Boolean))}`);

  // Check that expected member nav items are present
  const expectedItems = ['Aperçu', 'Mes tâches', 'Sprints actifs', 'Mes projets', 'Mon temps', 'Notifications'];
  for (const item of expectedItems) {
    const el = page.locator(`nav a:has-text("${item}"), [class*="sidebar"] a:has-text("${item}"), [class*="rail"] a:has-text("${item}")`).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      PASS('05-sidebar', `Nav item "${item}" present`);
    } else {
      FAIL('MEDIUM', '05-sidebar', `Nav item "${item}" NOT found in sidebar`);
    }
  }

  // STEP 6: Check that Validations and Pending Reviews are NOT in sidebar
  currentStage = '06-no-validation-links';
  const forbiddenPatterns = [
    { label: 'Validations', selector: 'nav a:has-text("Validations"), nav a:has-text("Validation")' },
    { label: 'Pending Reviews', selector: 'nav a:has-text("Pending Reviews"), nav a:has-text("En attente de revue"), nav a:has-text("Revues en attente")' },
  ];

  for (const { label, selector } of forbiddenPatterns) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      FAIL('HIGH', '06-no-validation-links', `REGRESSION: "${label}" link visible in Member sidebar — SpecTeam-only link exposed`);
    } else {
      PASS('06-no-validation-links', `"${label}" correctly absent from Member sidebar`);
    }
  }

  // STEP 7: Walk each sidebar section with screenshot
  const sidebarRoutes = [
    { label: 'Aperçu',          path: '/app/team',           shot: '02-apercu'         },
    { label: 'Mes tâches',      path: '/app/team/my-tasks',  shot: '03-mes-taches'     },
    { label: 'Sprints actifs',  path: '/app/team/sprints',   shot: '04-sprints'        },
    { label: 'Mes projets',     path: '/app/team/projects',  shot: '05-mes-projets'    },
    { label: 'Mon temps',       path: '/app/team/time',      shot: '06-mon-temps'      },
    { label: 'Notifications',   path: '/app/team/inbox',     shot: '07-notifications'  },
  ];

  for (const route of sidebarRoutes) {
    currentStage = `07-nav-${route.label.replace(/\s/g, '-').toLowerCase()}`;
    log(`Navigating to ${route.path}…`);
    await page.goto(`${ROOT}${route.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const navUrl = page.url();
    const navPath = new URL(navUrl).pathname;
    await shot(route.shot);
    if (navPath.startsWith(route.path) || navPath === route.path) {
      PASS(currentStage, `${route.label} → ${navPath}`);
    } else {
      FAIL('MEDIUM', currentStage, `${route.label}: expected ${route.path}, got ${navPath}`);
    }
  }

  // STEP 8: Probe /app/team/dashboard — should redirect Member back to /app/team
  currentStage = '08-dashboard-probe';
  log('Probing /app/team/dashboard…');
  await page.goto(`${ROOT}/app/team/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const dashboardProbeUrl = page.url();
  const dashboardProbePath = new URL(dashboardProbeUrl).pathname;
  await shot('08-dashboard-probe');
  log(`/app/team/dashboard probe result: ${dashboardProbePath}`);

  if (dashboardProbePath === '/app/team' || dashboardProbePath === '/app/team/') {
    PASS('08-dashboard-probe', `Route guard redirected Member from /app/team/dashboard → /app/team`);
  } else if (dashboardProbePath.startsWith('/app/team/dashboard')) {
    FAIL('HIGH', '08-dashboard-probe', `REGRESSION: Member can access /app/team/dashboard (SpecTeam-only) — route guard not firing`);
  } else {
    PASS('08-dashboard-probe', `Redirected to ${dashboardProbePath} (acceptable — not /app/team/dashboard)`);
  }

} catch (err) {
  log(`UNEXPECTED ERROR: ${err.message}`);
  findings.push({ severity: 'CRITICAL', stage: currentStage, msg: `Uncaught: ${err.message}` });
  await shot('99-error');
} finally {
  await browser.close();
}

// ── Final report ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('MEMBER DASHBOARD E2E REPORT');
console.log('='.repeat(70));

console.log(`\nPASSED (${passed.length}):`);
for (const p of passed) {
  console.log(`  ✔ [${p.stage}] ${p.label}`);
}

console.log(`\nFINDINGS (${findings.length}):`);
if (findings.length === 0) {
  console.log('  None.');
} else {
  for (const f of findings) {
    console.log(`  ✘ [${f.severity}][${f.stage}] ${f.msg}`);
  }
}

if (consoleErrors.length > 0) {
  console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
  for (const e of consoleErrors) {
    console.log(`  [${e.stage}] ${e.type}: ${e.text}`);
  }
}

const critical = findings.filter(f => f.severity === 'CRITICAL');
const high     = findings.filter(f => f.severity === 'HIGH');
const medium   = findings.filter(f => f.severity === 'MEDIUM');

console.log('\n' + '='.repeat(70));
const verdict = critical.length > 0 ? 'FAIL' : high.length > 0 ? 'FAIL' : 'PASS';
console.log(`VERDICT: ${verdict}`);
console.log(`  CRITICAL: ${critical.length}  HIGH: ${high.length}  MEDIUM: ${medium.length}`);
console.log('='.repeat(70));
