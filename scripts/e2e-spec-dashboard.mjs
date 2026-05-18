#!/usr/bin/env node
// SpecificationTeam dashboard E2E probe.
// Tests the current LIVE experience (HomeView + pending-reviews) and probes
// the new /app/team/dashboard route to confirm deploy gap.

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT  = 'https://neoleadge.pythagore-init.com';
const SPEC  = { email: 'spec@neoleadge.com', password: 'Valid@123' };
const SHOTS = './scripts/e2e-dashboards-shots/spec';

await mkdir(SHOTS, { recursive: true }).catch(() => {});

const ts   = () => new Date().toISOString().slice(11, 19);
const log  = (...a) => console.log(`[${ts()}]`, ...a);

const findings   = [];
const passed     = [];
let   stageLabel = 'init';

const setStage = (s) => { stageLabel = s; log(`──── ${s} ────`); };
const PASS = (label, detail = '') => {
  passed.push({ stage: stageLabel, label });
  log(`PASS  ${label}${detail ? ' — ' + detail : ''}`);
};
const NOTE = (label, detail = '') => {
  log(`NOTE  ${label}${detail ? ' — ' + detail : ''}`);
};
const FAIL = (severity, msg) => {
  findings.push({ severity, stage: stageLabel, msg });
  log(`FAIL  [${severity}] ${msg}`);
};

// ─── Browser + page setup ────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

const consoleErrors = [];
const networkErrors = [];

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  const text = msg.text();
  if (/google|gstatic|googleapis/.test(text)) return;
  consoleErrors.push({ type: t, text: text.slice(0, 220) });
  findings.push({ severity: 'WARN', stage: stageLabel, msg: `[console.${t}] ${text.slice(0, 140)}` });
});
page.on('pageerror', (err) => {
  const msg = err.message.slice(0, 220);
  consoleErrors.push({ type: 'pageerror', text: msg });
  findings.push({ severity: 'HIGH', stage: stageLabel, msg: `[pageerror] ${msg}` });
});
page.on('requestfailed', (req) => {
  const url = req.url();
  if (/google|gstatic|\.map$/.test(url)) return;
  networkErrors.push(`REQFAIL ${req.method()} ${url}`);
  findings.push({ severity: 'HIGH', stage: stageLabel, msg: `[reqfail] ${req.method()} ${url.slice(0, 120)}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/.test(u)) return;
  if (/google|gstatic/.test(u)) return;
  networkErrors.push(`HTTP${s} ${u}`);
  findings.push({
    severity: s >= 500 ? 'CRITICAL' : 'MEDIUM',
    stage: stageLabel,
    msg: `[http${s}] ${u.slice(0, 140)}`,
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function shot(filename) {
  const p = `${SHOTS}/${filename}`;
  await page.screenshot({ path: p, fullPage: true }).catch((e) => log(`screenshot error: ${e.message}`));
  log(`  screenshot → ${p}`);
}

async function loginSpec() {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Try quick-login button first
  let used = false;
  const handles = await page.locator('button').elementHandles();
  for (const h of handles) {
    const txt = (await h.innerText().catch(() => '')).trim();
    if (/sp[eé]cification|spec/i.test(txt) && !/connect/i.test(txt)) {
      log(`  clicking quick-login button: "${txt}"`);
      await h.click();
      used = true;
      break;
    }
  }

  if (!used) {
    log('  no quick-login button found — using email/password form');
    await page.locator('input[type="email"]').first().fill(SPEC.email);
    await page.locator('input[type="password"]').first().fill(SPEC.password);
    await page.locator(
      'button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")'
    ).first().click();
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const url = page.url();
  log(`  post-login URL: ${url}`);
  if (!/\/app/.test(url)) {
    throw new Error(`Login failed — ended up at ${url}`);
  }
  return url;
}

async function apiGet(path) {
  return page.evaluate(async (p) => {
    const tok = localStorage.getItem('nl_jwt') || '';
    const r = await fetch(p, {
      headers: { Authorization: 'Bearer ' + tok },
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data };
  }, path);
}

// ─── Test ────────────────────────────────────────────────────────────────────
try {

  // Step 1 — Login
  setStage('1.spec-login');
  const landingUrl = await loginSpec();
  PASS('login succeeded', landingUrl);
  await shot('01-landing.png');

  // Introspect what's on the landing page
  const pageTitle = await page.title().catch(() => '');
  const bodyText  = await page.locator('body').innerText().catch(() => '');

  // Check for HomeView / Validations card
  const hasValidationsCard =
    /validations?\s*en\s*attente|pending.{0,20}review|cahiers?\s*à\s*valider/i.test(bodyText);
  const hasHomeViewMarkers =
    /tableau\s*de\s*bord|bienvenue|dashboard|bonjour/i.test(bodyText);

  NOTE('page title', pageTitle);
  NOTE('landing URL matches /app/home or /app', landingUrl);
  NOTE('has validations card', String(hasValidationsCard));
  NOTE('has homeview dashboard markers', String(hasHomeViewMarkers));

  if (hasValidationsCard) {
    PASS('Validations en attente card visible on landing (HomeView with showValidations=true)');
  } else {
    FAIL('MEDIUM', 'No "Validations en attente" card visible on landing — HomeView may not have showValidations flag active, or UI text differs');
  }

  if (hasHomeViewMarkers) {
    PASS('HomeView-style dashboard content present on landing');
  } else {
    NOTE('no explicit HomeView markers found — may already be a different view or blank content');
  }

  // Step 2 — Probe the NEW SpecTeam dashboard URL
  setStage('2.probe-new-dashboard');
  log('  navigating to /app/team/dashboard …');

  // Clear any response-tracking side effects from login stage for this navigation
  const newDashboardStatuses = [];
  const dashboardListener = (resp) => {
    const u = resp.url();
    if (u.includes('/app/team/dashboard') || u.endsWith('/app/team/dashboard')) return;
    // We care about the actual page navigation result captured via page.url()
  };

  await page.goto(ROOT + '/app/team/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const newDashUrl = page.url();
  const newDashBody = await page.locator('body').innerText().catch(() => '');
  await shot('02-new-spec-dashboard.png');

  const is404 =
    /\b404\b/.test(newDashBody) ||
    /not\s*found|page\s*introuvable|cette\s*page\s*n'existe/i.test(newDashBody);
  const redirectedAway = !newDashUrl.includes('/team/dashboard');
  const rendersContent =
    /tableau\s*de\s*bord|spec.*team|spécification|validations|cahier/i.test(newDashBody);

  NOTE('URL after navigating to /app/team/dashboard', newDashUrl);
  NOTE('is404 markers present', String(is404));
  NOTE('redirected away', String(redirectedAway));
  NOTE('renders spec-team-like content', String(rendersContent));

  if (is404 || redirectedAway) {
    FAIL('INFO', `NEW SpecTeam dashboard not yet deployed — /app/team/dashboard ${redirectedAway ? 'redirected to ' + newDashUrl : '404s'}`);
    NOTE('DEPLOY GAP CONFIRMED: /app/team/dashboard does not exist on live server');
  } else if (rendersContent) {
    PASS('/app/team/dashboard renders content — may already be deployed', newDashUrl);
  } else {
    NOTE('/app/team/dashboard loaded but content unclear — inspect screenshot 02-new-spec-dashboard.png');
  }

  // Step 3 — Navigate back and walk sidebar
  setStage('3.sidebar-pending-reviews');
  log('  navigating to /app/team/pending-reviews …');
  await page.goto(ROOT + '/app/team/pending-reviews', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const pendingUrl = page.url();
  const pendingBody = await page.locator('body').innerText().catch(() => '');
  await shot('03-pending-reviews.png');

  const hasPendingContent =
    /cahier|valider|examiner|pending|review|validation/i.test(pendingBody);
  if (hasPendingContent) {
    PASS('pending-reviews page rendered', pendingUrl);
  } else {
    FAIL('MEDIUM', `pending-reviews page may not have rendered correctly — url=${pendingUrl}`);
  }

  // API check: count pending reviews
  setStage('3a.api-pending-count');
  const pendingApi = await apiGet('/spec/pending-reviews');
  log(`  /spec/pending-reviews → HTTP ${pendingApi.status}`);
  const pendingRows = Array.isArray(pendingApi.data)
    ? pendingApi.data
    : (pendingApi.data?.items ?? pendingApi.data?.data ?? []);
  const pendingCount = Array.isArray(pendingRows) ? pendingRows.length : 'unknown';
  NOTE('pending reviews API count', String(pendingCount));
  if (pendingApi.status === 200) {
    PASS('pending-reviews API responded 200', `count=${pendingCount}`);
  } else {
    FAIL('MEDIUM', `/spec/pending-reviews returned HTTP ${pendingApi.status}`);
  }

  // Count visible rows in UI
  const rowSelectors = [
    'tbody tr',
    '[data-testid="review-row"]',
    '.p-datatable-row',
    'table tr:not(:first-child)',
    '.review-item',
    '.cahier-item',
  ];
  let visibleRowCount = 0;
  for (const sel of rowSelectors) {
    const c = await page.locator(sel).count().catch(() => 0);
    if (c > 0) {
      visibleRowCount = c;
      log(`  visible rows via "${sel}": ${c}`);
      break;
    }
  }
  NOTE('visible UI rows on pending-reviews', String(visibleRowCount));

  // Try to find and click "Examiner" on a row
  setStage('3b.examiner-click');
  const examinerBtn = page.locator(
    'button:has-text("Examiner"), a:has-text("Examiner"), button:has-text("Voir"), a:has-text("Voir détail")'
  ).first();
  const examinerVisible = await examinerBtn.isVisible().catch(() => false);

  if (examinerVisible) {
    log('  clicking first "Examiner" button …');
    await examinerBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const examinerUrl = page.url();
    await shot('04-examiner-detail.png');
    PASS('Examiner opened project detail', examinerUrl);
    // Navigate back
    await page.goBack().catch(() => {});
    await page.waitForTimeout(800);
  } else {
    NOTE('no "Examiner" button visible on pending-reviews — either no items or different UI label');
    await shot('04-no-examiner.png');
  }

  // Step 4 — Other sidebar links
  setStage('4.sidebar-projects');
  await page.goto(ROOT + '/app/team/projects', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot('05-projects.png');
  const projectsBody = await page.locator('body').innerText().catch(() => '');
  const projectsOk = !/5\d\d\s*error|server\s*error/i.test(projectsBody);
  if (projectsOk) PASS('projects page — no 5xx');
  else FAIL('HIGH', 'projects page shows server error');

  setStage('4b.sidebar-validations');
  // "Mes validations" - try common paths
  for (const path of ['/app/team/validations', '/app/team/my-validations', '/app/team/reviews']) {
    await page.goto(ROOT + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const u = page.url();
    const b = await page.locator('body').innerText().catch(() => '');
    const has5xx = /5\d\d\s*error|server\s*error/i.test(b);
    log(`  ${path} → ${u} — 5xx=${has5xx}`);
    if (!has5xx) { PASS(`${path} no 5xx`); break; }
  }
  await shot('06-mes-validations.png');

  setStage('4c.sidebar-tasks');
  for (const path of ['/app/team/tasks', '/app/team/my-tasks', '/app/workpackages']) {
    await page.goto(ROOT + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const u = page.url();
    const b = await page.locator('body').innerText().catch(() => '');
    const has5xx = /5\d\d\s*error|server\s*error/i.test(b);
    log(`  ${path} → ${u} — 5xx=${has5xx}`);
    if (!has5xx) { PASS(`${path} no 5xx`); break; }
  }
  await shot('07-mes-taches.png');

} catch (err) {
  log(`FATAL: ${err.message}`);
  findings.push({ severity: 'CRITICAL', stage: stageLabel, msg: `FATAL: ${err.message}` });
  await page.screenshot({ path: `${SHOTS}/fatal-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

// ─── Final report ─────────────────────────────────────────────────────────────
console.log('\n====== SPEC DASHBOARD E2E REPORT ======');
console.log(`\nPASSED (${passed.length}):`);
for (const p of passed) console.log(`  [${p.stage}] ${p.label}`);

console.log(`\nFINDINGS (${findings.length}):`);
for (const f of findings) console.log(`  [${f.severity}][${f.stage}] ${f.msg}`);

console.log('\nCONSOLE ERRORS:', consoleErrors.length);
for (const e of consoleErrors) console.log(`  [${e.type}] ${e.text}`);

console.log('\nNETWORK ERRORS:', networkErrors.length);
for (const e of networkErrors) console.log(`  ${e}`);

console.log(`\nScreenshots in: ${SHOTS}/`);
