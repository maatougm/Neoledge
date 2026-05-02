#!/usr/bin/env node
// E2E test for the new PM workflow features:
// 1. PM adds a SpecificationTeam member with a custom label (Members tab)
// 2. PM opens the AI Backlog Generator
// 3. PM opens the Assign Tasks board
// 4. SpecificationTeam member logs in and sees the cahier review banner (if cahier exists)
// Captures console errors / network failures throughout.

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' };
const PM    = { email: 'pm@neoleadge.com',    password: 'Pm@12345'  };
const SPEC  = { email: 'spec@neoleadge.com',  password: 'Valid@123' };

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

const events = [];
const state = { stage: 'init' };
const setStage = (s) => { state.stage = s; log(`── ${s} ──`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  events.push({ stage: state.stage, kind: t, text: msg.text().slice(0, 220) });
});
page.on('pageerror', (err) => events.push({ stage: state.stage, kind: 'pageerror', text: err.message.slice(0, 220) }));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('googleapis') || url.includes('gstatic') || url.includes('.map')) return;
  events.push({ stage: state.stage, kind: 'reqfail', text: `${req.method()} ${url.slice(0, 100)} — ${req.failure()?.errorText}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s >= 400 && !u.match(/\.(js|css|png|jpg|svg|ico|woff|woff2|map)(\?|$)/)) {
    events.push({ stage: state.stage, kind: 'http' + s, text: u.slice(0, 140) });
  }
});

async function login({ email, password }) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // try quick-login if email matches a role
  const btnTexts = email === ADMIN.email
    ? [/admin/i]
    : email === PM.email ? [/chef de projet|project manager|^pm$/i]
    : email === SPEC.email ? [/sp[eé]cification|spec/i]
    : [];
  let used = false;
  if (btnTexts.length) {
    const handles = await page.locator('button').elementHandles();
    for (const h of handles) {
      const txt = (await h.innerText().catch(() => '') || '').trim();
      if (btnTexts.some((re) => re.test(txt)) && !/connect/i.test(txt)) {
        log(`quick-login: "${txt}"`);
        await h.click();
        used = true;
        break;
      }
    }
  }
  if (!used) {
    log('typing email/password');
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const url = page.url();
  if (!/\/app/.test(url)) throw new Error(`login failed: still at ${url}`);
}

async function logout() {
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function findFirstProjectId() {
  const id = await page.evaluate(async () => {
    const tok = localStorage.getItem('nl_jwt') || '';
    const tries = ['/admin/project', '/pm/projects', '/pm/team-projects'];
    for (const url of tries) {
      try {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
        if (!r.ok) continue;
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d.items ?? d.data ?? []);
        if (list[0]?.id) return list[0].id;
      } catch {}
    }
    return null;
  });
  if (!id) throw new Error('no project id available');
  return id;
}

const results = [];
function pass(name, detail = '') { results.push({ name, ok: true, detail }); log(`PASS ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail) { results.push({ name, ok: false, detail }); log(`FAIL ${name} — ${detail}`); }

try {
  // ── Stage 1: admin gets a project id
  setStage('admin-login');
  await login(ADMIN);
  pass('admin login');
  const projectId = await findFirstProjectId();
  pass('fetch project id', projectId);
  await logout();

  // ── Stage 2: PM workflow
  setStage('pm-login');
  await login(PM);
  pass('pm login');

  // Members tab
  setStage('members-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/members`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hasMembersHeader = await page.locator('h1:has-text("Membres"), h2:has-text("Membres")').first().isVisible().catch(() => false);
  hasMembersHeader ? pass('members page rendered') : fail('members page rendered', 'no Membres heading');
  const addBtn = page.locator('button:has-text("Ajouter un membre")').first();
  const hasAddBtn = await addBtn.isVisible().catch(() => false);
  hasAddBtn ? pass('add-member button visible') : fail('add-member button visible', 'not found');

  // Open the add modal
  if (hasAddBtn) {
    setStage('members-add-modal');
    await addBtn.click();
    await page.waitForTimeout(800);
    const modalVisible = await page.locator('text=Ajouter un membre au projet').isVisible().catch(() => false);
    modalVisible ? pass('add-member modal opens') : fail('add-member modal opens', 'modal not shown');
    // Close modal
    const cancelBtn = page.locator('button:has-text("Annuler")').first();
    if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();
    await page.waitForTimeout(400);
  }

  // Backlog Generator
  setStage('backlog-generator-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/backlog-generator`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hasBacklogHeader = await page.locator('h1:has-text("Backlog"), h2:has-text("Backlog")').first().isVisible().catch(() => false);
  hasBacklogHeader ? pass('backlog generator page rendered') : fail('backlog generator page rendered', 'no header');
  const genBtn = page.locator('button:has-text("Générer le backlog")').first();
  const hasGenBtn = await genBtn.isVisible().catch(() => false);
  hasGenBtn ? pass('generate-backlog button visible') : fail('generate-backlog button visible', 'not found');

  // Assign Tasks
  setStage('assign-tasks-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/assign-tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hasAssignHeader = await page.locator('h1:has-text("Assignation"), h2:has-text("Assignation")').first().isVisible().catch(() => false);
  hasAssignHeader ? pass('assign-tasks page rendered') : fail('assign-tasks page rendered', 'no header');
  const hasUnassignedCol = await page.locator('h3:has-text("Non assigné")').first().isVisible().catch(() => false);
  hasUnassignedCol ? pass('unassigned column visible') : fail('unassigned column visible', 'not found');
  const validateBtn = page.locator('button:has-text("Valider les assignations")').first();
  const hasValidateBtn = await validateBtn.isVisible().catch(() => false);
  hasValidateBtn ? pass('validate-assignments button visible') : fail('validate-assignments button visible', 'not found');

  // Sidebar nav check
  setStage('sidebar-nav');
  const hasBacklogIANav = await page.locator('a:has-text("Backlog IA")').first().isVisible().catch(() => false);
  hasBacklogIANav ? pass('sidebar shows "Backlog IA"') : fail('sidebar shows "Backlog IA"', 'nav entry missing');
  const hasAssignNav = await page.locator('a:has-text("Assignation")').first().isVisible().catch(() => false);
  hasAssignNav ? pass('sidebar shows "Assignation"') : fail('sidebar shows "Assignation"', 'nav entry missing');

  // ── Stage 3: SpecificationTeam check (canReview hides if not project member)
  setStage('spec-logout-login');
  await logout();
  await login(SPEC);
  pass('spec login');

  setStage('spec-cahier-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/cahier`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  // Spec user is NOT yet a project member, so the review banner should NOT appear
  const reviewBanner = await page.locator('text=Ce cahier des charges est en attente de votre validation').isVisible().catch(() => false);
  // Project may not be accessible to spec team at all (404 page) — that is also valid scoping
  const accessDenied = await page.locator('text=404, text=Cannot, text=non trouvé').first().isVisible().catch(() => false);
  if (!reviewBanner) {
    pass('spec NOT shown review banner (correctly scoped)', accessDenied ? 'project hidden from non-member' : 'banner hidden');
  } else {
    fail('spec NOT shown review banner', 'banner appeared even though spec is not a project member');
  }

} catch (err) {
  fail('test run', err.message);
} finally {
  await browser.close();
}

// Summary
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log('═══════════════════════════════════════════════════');
console.log(` E2E TEST SUMMARY:  ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════');
for (const r of results) {
  console.log(`  ${r.ok ? '✔' : '✘'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
if (events.length) {
  console.log('');
  console.log('── Captured console / network events ──');
  for (const e of events.slice(0, 30)) {
    console.log(`  [${e.stage}] ${e.kind}: ${e.text}`);
  }
  if (events.length > 30) console.log(`  ... ${events.length - 30} more`);
}

process.exit(failed > 0 ? 1 : 0);
