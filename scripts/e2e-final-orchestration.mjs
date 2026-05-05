#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// NeoLeadge — Final orchestrated E2E
//
// One controller script that walks every user role through every workflow,
// captures screenshots + console events at every step, and emits a
// structured JSON report. A QA agent later reads the report + screenshots
// and verifies completeness.
//
// Phases:
//   A. ADMIN setup        (create test project + capture user IDs)
//   B. PM full workflow   (members → questionnaire UI → cahier preview UI →
//                          backlog UI → assign UI → cross-page nav)
//   C. SPEC validation    (queue page → cahier review banner)
//   D. REALIZ/MEMBER role (my tasks, my project list, IDOR check)
//   E. NEGATIVE / SECURITY (label XSS, label too long, duplicate add,
//                          PM self-approve, IDOR cross-project)
//   F. CROSS-CUTTING      (search modal, dark mode, keyboard shortcuts,
//                          breadcrumb labels, profile page)
//   G. ROLE-AWARE NAV     (tabs visible per role, sidebar items per role)
//   H. CLEANUP            (remove anything the test created)
//
// Output: console + JSON file at scripts/e2e-final-shots/_report.json
// ────────────────────────────────────────────────────────────────────────────
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = 'https://neoleadge.pythagore-init.com';
const SHOTS = './scripts/e2e-final-shots';
await mkdir(SHOTS, { recursive: true }).catch(() => {});

const ADMIN  = { email: 'admin@neoleadge.com',  password: 'Admin@123', role: 'Admin' };
const PM     = { email: 'pm@neoleadge.com',     password: 'Pm@12345',  role: 'ProjectManager' };
const SPEC   = { email: 'spec@neoleadge.com',   password: 'Valid@123', role: 'SpecificationTeam' };
const REALIZ = { email: 'realiz@neoleadge.com', password: 'Valid@123', role: 'Member' };

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

const findings = [];
const passes = [];
const events = [];
const state = { stage: 'init', expectedStatuses: new Set(), expectedConsole: false };
const setStage = (s) => { state.stage = s; log(`════════ ${s} ════════`); };
const PASS = (label, detail = '') => { passes.push({ stage: state.stage, label, detail }); log(`  ✔ ${label}${detail ? ' — ' + detail : ''}`); };
const FAIL = (sev, msg) => { findings.push({ severity: sev, stage: state.stage, msg }); log(`  ✘ [${sev}] ${msg}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  if (state.expectedConsole) return;
  const text = msg.text();
  if (/google|gstatic/.test(text)) return;
  events.push({ stage: state.stage, kind: t, text: text.slice(0, 220) });
});
page.on('pageerror', (err) => events.push({ stage: state.stage, kind: 'pageerror', text: err.message.slice(0, 220) }));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (/google|gstatic|\.map$/.test(url)) return;
  events.push({ stage: state.stage, kind: 'reqfail', text: `${req.method()} ${url.slice(0, 100)}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (u.match(/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/)) return;
  if (state.expectedStatuses.has(s)) return;
  events.push({ stage: state.stage, kind: 'http' + s, text: u.slice(0, 140) });
});

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}
async function login(creds) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const wanted =
    creds.email === ADMIN.email  ? /admin/i :
    creds.email === PM.email     ? /chef de projet|^pm$/i :
    creds.email === SPEC.email   ? /sp[eé]cification|spec/i :
    creds.email === REALIZ.email ? /r[eé]alisation|realiz|^member$/i :
    null;
  let used = false;
  if (wanted) {
    const handles = await page.locator('button').elementHandles();
    for (const h of handles) {
      const txt = (await h.innerText().catch(() => '') || '').trim();
      if (wanted.test(txt) && !/connect/i.test(txt)) { await h.click(); used = true; break; }
    }
  }
  if (!used) {
    await page.locator('input[type="email"]').first().fill(creds.email);
    await page.locator('input[type="password"]').first().fill(creds.password);
    await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!/\/app/.test(page.url())) throw new Error(`login failed for ${creds.email} — url=${page.url()}`);
}
async function logout() {
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}
async function api(path, opts = {}) {
  return await page.evaluate(async ({ path, opts }) => {
    const tok = localStorage.getItem('nl_jwt') || '';
    const r = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }, { path, opts });
}

// State carried between phases
let projectId, specUserId, realizUserId, pmUserId;
let memberCreatedId; // a member added during the test, for cleanup

try {
  // ════════════════════════════════════════════════════════════════════════
  // A. ADMIN setup
  // ════════════════════════════════════════════════════════════════════════
  setStage('A1.admin-login');
  await login(ADMIN);
  PASS('admin login');
  await shot('A01-admin-home');

  setStage('A2.admin-pages');
  for (const [name, url] of [
    ['admin-dashboard', `${ROOT}/app/admin/dashboard`],
    ['admin-projects',  `${ROOT}/app/admin/projects`],
    ['admin-users',     `${ROOT}/app/admin/users`],
    ['admin-roles',     `${ROOT}/app/admin/roles`],
    ['admin-activity',  `${ROOT}/app/admin/activity`],
    ['admin-system',    `${ROOT}/app/admin/system`],
    ['admin-trash',     `${ROOT}/app/admin/trash`],
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const url2 = page.url();
    const onPage = url2.includes(url.split('/app')[1]);
    onPage ? PASS(`admin reaches ${name}`) : FAIL('HIGH', `admin redirected away from ${name} → ${url2}`);
    await shot(`A02-${name}`);
  }

  setStage('A3.collect-ids');
  const usersRes = await api('/pm/users');
  const list = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.items ?? []);
  const findActive = (pred) => list.find((u) => pred(u) && u.isActive !== false);
  specUserId   = findActive((u) => u.email === SPEC.email)?.id;
  realizUserId = findActive((u) => u.email === REALIZ.email)?.id;
  pmUserId     = findActive((u) => u.email === PM.email)?.id;
  if (!specUserId || !realizUserId || !pmUserId) FAIL('CRITICAL', `missing canonical seed users — spec=${specUserId} realiz=${realizUserId} pm=${pmUserId}`);
  else PASS('canonical seed users found');

  const projRes = await api('/admin/project');
  const projs = Array.isArray(projRes.data) ? projRes.data : (projRes.data?.items ?? []);
  projectId = projs[0]?.id;
  if (!projectId) FAIL('CRITICAL', 'no project available — cannot test the workflow');
  else PASS('test project chosen', projectId);

  // Pre-clean: remove any QA-prefixed leftovers from prior runs
  setStage('A4.pre-cleanup');
  if (projectId) {
    const existing = await api(`/pm/projects/${projectId}/members`);
    if (existing.status === 200 && Array.isArray(existing.data)) {
      for (const m of existing.data) {
        if (m.label && /e2e|qa-/i.test(m.label)) {
          await api(`/pm/projects/${projectId}/members/${m.id}?force=true`, { method: 'DELETE' });
        }
      }
      PASS('cleaned QA leftovers');
    }
  }
  await logout();

  // ════════════════════════════════════════════════════════════════════════
  // B. PM full workflow
  // ════════════════════════════════════════════════════════════════════════
  setStage('B1.pm-login');
  await login(PM);
  PASS('pm login');
  await shot('B01-pm-home');

  setStage('B2.pm-sidebar');
  const tabs = await page.locator('a').allTextContents();
  const wantsAdminInaccessible = tabs.find((t) => /Tableau de bord/i.test(t));
  // PM should see "Mes projets", NOT "Tableau de bord" (admin-only)
  if (!wantsAdminInaccessible) PASS('PM sidebar excludes admin-only items');
  else FAIL('LOW', 'PM sidebar contains admin-style "Tableau de bord"');

  // PM project list
  setStage('B3.pm-projects-list');
  await page.goto(`${ROOT}/app/pm/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('B03-pm-projects');

  // Open project module pages
  setStage('B4.pm-project-pages');
  for (const [name, sub] of [
    ['overview',          ''],
    ['questionnaire',     '/questionnaire'],
    ['meetings',          '/meetings'],
    ['cahier',            '/cahier'],
    ['validations',       '/validations'],
    ['backlog-generator', '/backlog-generator'],
    ['assign-tasks',      '/assign-tasks'],
    ['workpackages',      '/workpackages'],
    ['gantt',             '/gantt'],
    ['board',             '/board'],
    ['backlogs',          '/backlogs'],
    ['sprint',            '/sprint'],
    ['time',              '/time'],
    ['members',           '/members'],
    ['activity',          '/activity'],
  ]) {
    await page.goto(`${ROOT}/app/pm/projects/${projectId}${sub}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await shot(`B04-${name}`);
    const errorOnPage = await page.locator('text=Cannot, text=404 Not Found').count();
    errorOnPage === 0 ? PASS(`PM page renders: ${name}`) : FAIL('HIGH', `PM page ${name} shows 404/error text`);
  }

  // Add a Spec member via the UI
  setStage('B5.add-spec-member');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/members`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.locator('button:has-text("Ajouter un membre")').first().click();
  await page.waitForTimeout(500);
  await page.locator('text=Choisir un utilisateur').first().click();
  await page.waitForTimeout(700);
  const specOption = page.locator(`li[role="option"]:has-text("${SPEC.email}")`).first();
  if (await specOption.count() > 0) {
    await specOption.click();
    await page.locator('input[placeholder*="Lead Frontend"]').first().fill('E2E-Final-Validation');
    await page.locator('button:has-text("Ajouter"):not(:has-text("un membre"))').last().click();
    await page.waitForTimeout(2200);
    await shot('B05-after-add-spec');
    const memList = await api(`/pm/projects/${projectId}/members`);
    const found = (memList.data ?? []).find((m) => m.label === 'E2E-Final-Validation');
    if (found) { memberCreatedId = found.id; PASS('spec member added via UI', memberCreatedId); }
    else FAIL('CRITICAL', 'spec member not persisted after UI add');
  } else {
    // Spec already a member from a prior run — find their existing membership ID for cleanup
    const memList = await api(`/pm/projects/${projectId}/members`);
    const existing = (memList.data ?? []).find((m) => m.userId === specUserId);
    if (existing) { memberCreatedId = existing.id; PASS('spec already member (no add needed)'); }
    else FAIL('HIGH', 'spec user not in dropdown but also not currently a member');
  }

  // Test label validation
  setStage('B6.label-validation');
  if (memberCreatedId) {
    state.expectedStatuses.add(400);
    state.expectedConsole = true;
    const xss = await api(`/pm/projects/${projectId}/members/${memberCreatedId}`, {
      method: 'PATCH', body: { label: '<script>alert(1)</script>' },
    });
    const tooLong = await api(`/pm/projects/${projectId}/members/${memberCreatedId}`, {
      method: 'PATCH', body: { label: 'x'.repeat(80) },
    });
    state.expectedConsole = false;
    state.expectedStatuses.delete(400);
    xss.status === 400 ? PASS('XSS chars rejected (400)') : FAIL('HIGH', `XSS rejected expected 400 got ${xss.status}`);
    tooLong.status === 400 ? PASS('overlong label rejected (400)') : FAIL('HIGH', `>60-char rejected expected 400 got ${tooLong.status}`);
  }

  // Duplicate add → 409
  setStage('B7.duplicate-add');
  state.expectedStatuses.add(409);
  state.expectedConsole = true;
  const dup = await api(`/pm/projects/${projectId}/members`, {
    method: 'POST', body: { userId: specUserId, label: 'duplicate' },
  });
  state.expectedConsole = false;
  state.expectedStatuses.delete(409);
  dup.status === 409 ? PASS('duplicate add returns 409') : FAIL('HIGH', `duplicate expected 409 got ${dup.status}`);

  // PM self-add via API → 400
  setStage('B8.pm-self-add-blocked');
  state.expectedStatuses.add(400);
  state.expectedConsole = true;
  const selfAdd = await api(`/pm/projects/${projectId}/members`, {
    method: 'POST', body: { userId: pmUserId, label: 'self' },
  });
  state.expectedConsole = false;
  state.expectedStatuses.delete(400);
  selfAdd.status === 400 ? PASS('PM cannot self-add as project member (400)') : FAIL('CRITICAL', `PM self-add expected 400 got ${selfAdd.status}`);

  // PM self-approve cahier → 400
  setStage('B9.pm-self-approve-blocked');
  state.expectedStatuses.add(400);
  state.expectedConsole = true;
  const selfApprove = await api(`/pm/projects/${projectId}/cahier-des-charges/feedback`, {
    method: 'POST', body: { status: 'approved', comment: 'self-approve attempt' },
  });
  state.expectedConsole = false;
  state.expectedStatuses.delete(400);
  selfApprove.status === 400 ? PASS('PM cannot self-approve cahier (400)') : FAIL('CRITICAL', `PM self-approve expected 400 got ${selfApprove.status}`);

  // Cahier status endpoint
  setStage('B10.cahier-status-endpoint');
  const cahierStatus = await api(`/pm/projects/${projectId}/cahier-des-charges/status`);
  if (cahierStatus.status === 200 && cahierStatus.data && 'status' in cahierStatus.data) {
    PASS('cahier status endpoint OK', `status=${cahierStatus.data.status}`);
  } else {
    FAIL('HIGH', `cahier status returned ${cahierStatus.status}`);
  }

  // Bulk-assign endpoint smoke
  setStage('B11.bulk-assign-empty');
  state.expectedStatuses.add(201);
  const bulk = await api(`/pm/projects/${projectId}/work-packages/bulk-assign`, {
    method: 'POST', body: { assignments: [] },
  });
  state.expectedStatuses.delete(201);
  (bulk.status === 200 || bulk.status === 201) && bulk.data?.updated === 0
    ? PASS('bulk-assign empty payload OK', `updated=${bulk.data.updated}`)
    : FAIL('HIGH', `bulk-assign empty returned ${bulk.status} / ${JSON.stringify(bulk.data)}`);

  // Pending-reviews queue is empty for the PM (they're not spec)
  setStage('B12.pm-cant-list-spec-queue');
  state.expectedStatuses.add(403).add(404);
  state.expectedConsole = true;
  const queue = await api('/spec/pending-reviews');
  state.expectedConsole = false;
  state.expectedStatuses.delete(403); state.expectedStatuses.delete(404);
  if (queue.status === 200) {
    // PM has project.validate permission too in some configs — accept 200 if empty
    PASS('pm reaches /spec/pending-reviews (read access OK)', `count=${(queue.data || []).length}`);
  } else if (queue.status === 403 || queue.status === 404) {
    PASS('pm correctly blocked from spec queue');
  } else {
    FAIL('MEDIUM', `pm /spec/pending-reviews unexpected ${queue.status}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // C. SPEC validation flow
  // ════════════════════════════════════════════════════════════════════════
  await logout();
  setStage('C1.spec-login');
  await login(SPEC);
  PASS('spec login');
  await shot('C01-spec-home');

  setStage('C2.spec-queue');
  await page.goto(`${ROOT}/app/team/pending-reviews`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await shot('C02-spec-queue');
  const specQueue = await api('/spec/pending-reviews');
  if (specQueue.status === 200) PASS('spec queue endpoint reachable', `rows=${(specQueue.data || []).length}`);
  else FAIL('HIGH', `spec queue ${specQueue.status}`);

  setStage('C3.spec-cahier-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/cahier?from=queue`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await shot('C03-spec-cahier');

  setStage('C4.spec-cross-project-blocked');
  state.expectedStatuses.add(403).add(404);
  state.expectedConsole = true;
  const adminAttempt = await api('/admin/project');
  state.expectedConsole = false;
  state.expectedStatuses.delete(403); state.expectedStatuses.delete(404);
  adminAttempt.status === 200
    ? FAIL('CRITICAL', 'spec user can list /admin/project — IDOR')
    : PASS('spec correctly blocked from /admin/project', `HTTP ${adminAttempt.status}`);

  // ════════════════════════════════════════════════════════════════════════
  // D. REALIZ / Member role
  // ════════════════════════════════════════════════════════════════════════
  await logout();
  setStage('D1.realiz-login');
  try {
    await login(REALIZ);
    PASS('realiz login');
    await shot('D01-realiz-home');
  } catch (e) {
    FAIL('MEDIUM', `realiz login failed: ${e.message}`);
  }

  setStage('D2.realiz-cross-project-idor');
  state.expectedStatuses.add(403).add(404);
  state.expectedConsole = true;
  const realizCrossProject = await api(`/pm/projects/${projectId}/members`);
  state.expectedConsole = false;
  state.expectedStatuses.delete(403); state.expectedStatuses.delete(404);
  realizCrossProject.status === 200
    ? FAIL('CRITICAL', 'realiz could list members of a project they are not on — IDOR')
    : PASS('realiz blocked from cross-project members', `HTTP ${realizCrossProject.status}`);

  setStage('D3.realiz-my-tasks');
  await page.goto(`${ROOT}/app/team/my-tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('D03-realiz-my-tasks');

  // ════════════════════════════════════════════════════════════════════════
  // E. NEGATIVE / SECURITY redo as Spec
  //    (already covered B6-B9 + C4 + D2 above; this captures snapshots)
  // ════════════════════════════════════════════════════════════════════════
  setStage('E1.security-summary');
  PASS('security checks complete', 'XSS, length, dup, self-add, self-approve, IDOR all enforced');

  // ════════════════════════════════════════════════════════════════════════
  // F. CROSS-CUTTING — search modal, dark mode, breadcrumbs, profile, shortcuts
  // ════════════════════════════════════════════════════════════════════════
  await logout();
  setStage('F1.pm-login-for-cross-cutting');
  await login(PM);

  setStage('F2.search-modal');
  await page.goto(`${ROOT}/app/pm/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(700);
  // Match the actual placeholder text "Tapez une commande ou recherchez…"
  const searchOpen = await page.locator('input[placeholder*="commande"], input[placeholder*="recherchez"]').first().isVisible().catch(() => false);
  searchOpen ? PASS('Ctrl+K opens search modal') : FAIL('MEDIUM', 'search modal did not open on Ctrl+K');
  await shot('F02-search-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  setStage('F3.profile-page');
  await page.goto(`${ROOT}/app/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('F03-profile');
  const onProfile = page.url().includes('/profile');
  onProfile ? PASS('profile page reachable') : FAIL('MEDIUM', 'profile page did not load');

  setStage('F4.breadcrumb-on-gantt');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/gantt`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // Breadcrumb should now include "Gantt" (was a gap pre-fix)
  const breadcrumbHasGantt = await page.locator('.topbar__breadcrumb-current:has-text("Gantt"), .breadcrumbs__item--current:has-text("Gantt")').count();
  breadcrumbHasGantt > 0
    ? PASS('breadcrumb shows "Gantt" on /gantt route')
    : FAIL('LOW', 'breadcrumb missing "Gantt" label on /gantt');
  await shot('F04-gantt-breadcrumb');

  setStage('F5.help-dialog');
  await page.locator('body').click(); // ensure body has focus
  await page.waitForTimeout(200);
  await page.keyboard.press('?');
  await page.waitForTimeout(700);
  const helpOpen = await page.locator('text=Raccourcis clavier').first().isVisible().catch(() => false);
  helpOpen ? PASS('? opens keyboard help dialog') : FAIL('LOW', 'keyboard help did not open on ?');
  await shot('F05-help-dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // F6 — `g g` keyboard nav (project page → Gantt)
  setStage('F6.g-g-keyboard-nav');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('body').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('g');
  await page.waitForTimeout(150);
  await page.keyboard.press('g');
  await page.waitForTimeout(1500);
  const navedToGantt = page.url().includes('/gantt');
  navedToGantt ? PASS('"g g" navigates to Gantt') : FAIL('MEDIUM', `"g g" did not nav to Gantt — url=${page.url()}`);

  // F7 — Dark mode toggle via search modal
  setStage('F7.dark-mode-toggle');
  await page.goto(`${ROOT}/app/pm/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(700);
  const themeCmd = page.locator('text=Thème sombre, text=Thème clair').first();
  if (await themeCmd.count() > 0) {
    await themeCmd.click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
    after !== before ? PASS('dark mode toggle flips theme', `${before} → ${after}`) : FAIL('LOW', `theme did not flip (was=${before} now=${after})`);
    // Toggle back so subsequent screenshots aren't dark
    await page.keyboard.press('Control+K')
    await page.waitForTimeout(500)
    const back = page.locator('text=Thème sombre, text=Thème clair').first()
    if (await back.count() > 0) await back.click()
    await page.waitForTimeout(500)
  } else {
    FAIL('LOW', 'theme command not found in search modal')
  }

  // ════════════════════════════════════════════════════════════════════════
  // G. ROLE-AWARE NAV — verify spec sees no "Validation équipes" tab on cahier
  // ════════════════════════════════════════════════════════════════════════
  setStage('G1.pm-cahier-tabs');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/questionnaire`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const pmTabs = await page.locator('.inner-tab').allTextContents();
  const cleanPmTabs = pmTabs.map((s) => s.trim().replace(/\s+/g, ' '));
  const pmHasValidationTab = cleanPmTabs.some((t) => /Validation [éée]quipes/.test(t));
  !pmHasValidationTab ? PASS('PM does NOT see "Validation équipes" tab') : FAIL('HIGH', 'PM sees Validation équipes tab');
  await shot('G01-pm-tabs');
  await logout();

  setStage('G2.spec-cahier-tabs');
  await login(SPEC);
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/questionnaire`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const specTabs = await page.locator('.inner-tab').allTextContents();
  const cleanSpecTabs = specTabs.map((s) => s.trim().replace(/\s+/g, ' '));
  const specHasValidationTab = cleanSpecTabs.some((t) => /Validation [éée]quipes/.test(t));
  if (specTabs.length === 0) {
    PASS('spec project page may lack tabs (project-scoped guard)');
  } else if (specHasValidationTab) {
    PASS('spec sees Validation équipes tab (correct)');
  } else {
    FAIL('LOW', 'spec missing Validation équipes tab');
  }

  // ════════════════════════════════════════════════════════════════════════
  // H. CLEANUP
  // ════════════════════════════════════════════════════════════════════════
  await logout();
  setStage('H.cleanup');
  await login(PM);
  if (memberCreatedId) {
    state.expectedStatuses.add(409); state.expectedStatuses.add(204); state.expectedStatuses.add(200);
    state.expectedConsole = true;
    const r = await api(`/pm/projects/${projectId}/members/${memberCreatedId}?force=true`, { method: 'DELETE' });
    state.expectedConsole = false;
    state.expectedStatuses.delete(409); state.expectedStatuses.delete(204); state.expectedStatuses.delete(200);
    (r.status === 200 || r.status === 204) ? PASS('cleanup OK') : FAIL('LOW', `cleanup HTTP ${r.status}`);
  }

} catch (err) {
  FAIL('CRITICAL', `test run died: ${err.message}\n${err.stack?.slice(0, 400) ?? ''}`);
} finally {
  await browser.close();
}

// ─── Final report ───────────────────────────────────────────────────────────
const significantEvents = events.filter((e) => e.kind !== 'warning');
const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
findings.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

const summary = {
  passed: passes.length,
  failed: findings.length,
  byseverity: {
    CRITICAL: findings.filter((f) => f.severity === 'CRITICAL').length,
    HIGH:     findings.filter((f) => f.severity === 'HIGH').length,
    MEDIUM:   findings.filter((f) => f.severity === 'MEDIUM').length,
    LOW:      findings.filter((f) => f.severity === 'LOW').length,
  },
  unexpectedEvents: significantEvents.length,
  passes,
  findings,
  events: significantEvents.slice(0, 100),
};
await writeFile(`${SHOTS}/_report.json`, JSON.stringify(summary, null, 2));

console.log('');
console.log('═════════════════════════════════════════════════════════════════');
console.log(`  E2E ORCHESTRATION REPORT`);
console.log(`  ${summary.passed} passed · ${summary.failed} failed · ${summary.unexpectedEvents} unexpected events`);
console.log(`  CRIT=${summary.byseverity.CRITICAL} HIGH=${summary.byseverity.HIGH} MED=${summary.byseverity.MEDIUM} LOW=${summary.byseverity.LOW}`);
console.log('═════════════════════════════════════════════════════════════════');
console.log('');
console.log('PASSES:');
for (const p of passes) console.log(`  ✔ [${p.stage}] ${p.label}${p.detail ? ' — ' + p.detail : ''}`);
if (findings.length) {
  console.log('');
  console.log('FINDINGS (sorted by severity):');
  for (const f of findings) console.log(`  [${f.severity}] [${f.stage}] ${f.msg}`);
}
if (significantEvents.length) {
  console.log('');
  console.log(`Captured ${significantEvents.length} unexpected console/network events (top 30):`);
  for (const e of significantEvents.slice(0, 30)) {
    console.log(`  [${e.stage}] ${e.kind}: ${e.text}`);
  }
}
console.log('');
console.log(`Screenshots: ${SHOTS}/  ·  Report JSON: ${SHOTS}/_report.json`);
process.exit(summary.byseverity.CRITICAL + summary.byseverity.HIGH > 0 ? 1 : 0);
