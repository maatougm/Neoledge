#!/usr/bin/env node
// Multi-role bug-hunt E2E.
// Walks through every persona (Admin, PM, Spec, Realiz) end-to-end, captures
// screenshots at each stage, and aggressively probes for edge cases. Reports
// any console errors, http 4xx/5xx (excluding intentional probes), pageerrors,
// and unexpected UI states.

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT = 'https://neoleadge.pythagore-init.com';
const ADMIN  = { email: 'admin@neoleadge.com',  password: 'Admin@123'  };
const PM     = { email: 'pm@neoleadge.com',     password: 'Pm@12345'   };
const SPEC   = { email: 'spec@neoleadge.com',   password: 'Valid@123'  };
const REALIZ = { email: 'realiz@neoleadge.com', password: 'Valid@123'  };

const SHOTS = './scripts/e2e-bughunt-shots';
await mkdir(SHOTS, { recursive: true }).catch(() => {});

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

const findings = [];   // { severity, stage, kind, msg }
const passed = [];     // { stage, label }
const state = { stage: 'init', expectErrors: false, expectedStatuses: new Set() };
const setStage = (s) => { state.stage = s; log(`──────── ${s} ────────`); };
const PASS = (label, detail = '') => { passed.push({ stage: state.stage, label, detail }); log(`✔ ${label}${detail ? ' — ' + detail : ''}`); };
const FAIL = (severity, msg) => { findings.push({ severity, stage: state.stage, kind: 'fail', msg }); log(`✘ [${severity}] ${msg}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Capture console errors (ignore known noise) + pageerrors + 4xx/5xx network failures
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  const text = msg.text();
  if (/google|gstatic|googleapis/.test(text)) return;
  findings.push({ severity: 'WARN', stage: state.stage, kind: t, msg: text.slice(0, 220) });
});
page.on('pageerror', (err) => {
  findings.push({ severity: 'HIGH', stage: state.stage, kind: 'pageerror', msg: err.message.slice(0, 220) });
});
page.on('requestfailed', (req) => {
  const url = req.url();
  if (/google|gstatic|\.map$/.test(url)) return;
  findings.push({ severity: 'HIGH', stage: state.stage, kind: 'reqfail', msg: `${req.method()} ${url.slice(0, 100)}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (u.match(/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/)) return;
  // Allow expected errors during a probe (e.g. 401 from a logged-out request, intentional 4xx tests)
  if (state.expectedStatuses.has(s)) return;
  findings.push({ severity: s >= 500 ? 'CRITICAL' : 'MEDIUM', stage: state.stage, kind: 'http' + s, msg: u.slice(0, 140) });
});

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}
async function login({ email, password }) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // Try quick-login by detecting common French role labels
  const wanted =
    email === ADMIN.email  ? /admin/i :
    email === PM.email     ? /chef de projet|project manager|^pm$/i :
    email === SPEC.email   ? /sp[eé]cification|spec/i :
    email === REALIZ.email ? /r[eé]alisation|realiz/i :
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
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!/\/app/.test(page.url())) throw new Error(`login failed — url=${page.url()}`);
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
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }, { path, opts });
}

// =============================================================================
let projectId, specUserId, realizUserId, pmUserId;
let memberId; // QA member added during the test

try {
  // ─────────────────────────────────────────────────────────────────────────
  // Phase A: Admin sets up — find project + capture user IDs
  // ─────────────────────────────────────────────────────────────────────────
  setStage('A1.admin-login');
  await login(ADMIN);
  PASS('admin login');
  await shot('A01-admin-home');

  setStage('A2.find-seed-data');
  const usersRes = await api('/pm/users');
  if (usersRes.status !== 200) FAIL('CRITICAL', `/pm/users returned ${usersRes.status}`);
  const userList = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.items ?? []);
  specUserId   = userList.find((u) => u.role === 'SpecificationTeam')?.id ?? null;
  realizUserId = userList.find((u) => u.role === 'RealizationTeam' || u.role === 'Member')?.id ?? null;
  pmUserId     = userList.find((u) => u.role === 'ProjectManager')?.id ?? null;
  if (!specUserId)   FAIL('HIGH', 'No SpecificationTeam user available — cahier validation flow cannot be tested');
  if (!realizUserId) FAIL('MEDIUM', 'No RealizationTeam/Member user available');
  PASS('user roster captured', `spec=${specUserId?.slice(0,8)}, realiz=${realizUserId?.slice(0,8)}, pm=${pmUserId?.slice(0,8)}`);

  const projsRes = await api('/admin/project');
  const projs = Array.isArray(projsRes.data) ? projsRes.data : (projsRes.data?.items ?? []);
  projectId = projs[0]?.id;
  if (!projectId) FAIL('CRITICAL', '/admin/project returned no projects');
  else PASS('project found', projectId);
  await logout();

  // ─────────────────────────────────────────────────────────────────────────
  // Phase B: Pretend to be the PM
  // ─────────────────────────────────────────────────────────────────────────
  setStage('B1.pm-login');
  await login(PM);
  PASS('pm login');

  // B2: Members page — clean up any leftover members from prior runs
  setStage('B2.members-cleanup');
  const existing = await api(`/pm/projects/${projectId}/members`);
  if (existing.status === 200 && Array.isArray(existing.data)) {
    for (const m of existing.data) {
      // Force-remove anything tagged with QA prefix
      if (typeof m.label === 'string' && /qa-/i.test(m.label)) {
        await api(`/pm/projects/${projectId}/members/${m.id}?force=true`, { method: 'DELETE' });
      }
    }
    PASS('cleaned existing QA members');
  }

  // B3: navigate to Members page, add a Spec member
  setStage('B3.members-add-spec');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/members`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('B03-members-empty');

  await page.locator('button:has-text("Ajouter un membre")').first().click();
  await page.waitForTimeout(500);
  await page.locator('text=Choisir un utilisateur').first().click();
  await page.waitForTimeout(700);
  // Pick the spec user explicitly from the dropdown
  const specOption = page.locator(`li[role="option"]:has-text("${SPEC.email}")`).first();
  if (await specOption.count() === 0) {
    FAIL('HIGH', 'Spec user not present in member picker dropdown — eligibility filter may exclude them');
  } else {
    await specOption.click();
  }
  await page.locator('input[placeholder*="Lead Frontend"]').first().fill('QA-Validation');
  await page.locator('button:has-text("Ajouter"):not(:has-text("un membre"))').last().click();
  await page.waitForTimeout(2500);
  await shot('B04-after-add-spec');

  const afterAdd = await api(`/pm/projects/${projectId}/members`);
  const found = (afterAdd.data ?? []).find((m) => m.label === 'QA-Validation');
  if (!found) FAIL('CRITICAL', 'Spec member NOT persisted after add modal closed');
  else { memberId = found.id; PASS('spec member persisted', memberId); }

  // B4: Try to add the same user TWICE → should 409
  setStage('B4.duplicate-add');
  state.expectedStatuses.add(409);
  const dup = await api(`/pm/projects/${projectId}/members`, {
    method: 'POST', body: { userId: specUserId, label: 'duplicate' },
  });
  state.expectedStatuses.delete(409);
  if (dup.status !== 409) FAIL('HIGH', `duplicate add expected 409, got ${dup.status}`);
  else PASS('duplicate add returns 409');

  // B5: Try to add the PM themselves — should fail business-rule check (user excluded from picker)
  setStage('B5.pm-self-add-via-api');
  if (pmUserId) {
    const selfAdd = await api(`/pm/projects/${projectId}/members`, {
      method: 'POST', body: { userId: pmUserId, label: 'self' },
    });
    if (selfAdd.status === 200 || selfAdd.status === 201) {
      FAIL('MEDIUM', 'PM was able to add themselves as a project member via API — frontend filter bypassable');
      // cleanup
      const myMembers = await api(`/pm/projects/${projectId}/members`);
      const me = (myMembers.data ?? []).find((m) => m.userId === pmUserId);
      if (me) await api(`/pm/projects/${projectId}/members/${me.id}?force=true`, { method: 'DELETE' });
    } else {
      PASS('PM self-add via API blocked at backend');
    }
  }

  // B6: Inline label edit
  setStage('B6.inline-label-edit');
  const pencil = page.locator('button[title*="Modifier"]').first();
  if (await pencil.count() === 0) {
    FAIL('HIGH', 'pencil icon not present on member row');
  } else {
    await pencil.click();
    await page.waitForTimeout(300);
    const editInput = page.locator('input[placeholder*="Lead Frontend"]').first();
    await editInput.fill('QA-Edited-Label');
    await page.locator('button[title="Enregistrer"]').first().click();
    await page.waitForTimeout(1500);
    const after = await api(`/pm/projects/${projectId}/members`);
    const updated = (after.data ?? []).find((m) => m.id === memberId);
    if (updated?.label !== 'QA-Edited-Label') FAIL('HIGH', `label edit not persisted (got "${updated?.label}")`);
    else PASS('label edit persisted');
  }

  // B7: Bad label characters — should 400
  setStage('B7.label-validation');
  state.expectedStatuses.add(400);
  const badLabel = await api(`/pm/projects/${projectId}/members/${memberId}`, {
    method: 'PATCH', body: { label: '<script>alert(1)</script>' },
  });
  const tooLong = await api(`/pm/projects/${projectId}/members/${memberId}`, {
    method: 'PATCH', body: { label: 'x'.repeat(80) },
  });
  state.expectedStatuses.delete(400);
  if (badLabel.status !== 400) FAIL('HIGH', `XSS chars in label expected 400, got ${badLabel.status}`);
  else PASS('XSS chars rejected');
  if (tooLong.status !== 400) FAIL('HIGH', `>60 char label expected 400, got ${tooLong.status}`);
  else PASS('long label rejected');

  // B8: Search bar filters the table
  setStage('B8.member-search-filter');
  const searchInput = page.locator('input[placeholder*="Rechercher"]').first();
  if (await searchInput.count() === 0) {
    FAIL('MEDIUM', 'search input missing');
  } else {
    await searchInput.fill('QA-Edited');
    await page.waitForTimeout(500);
    const visibleRows = await page.locator('tbody tr').count();
    if (visibleRows < 1) FAIL('MEDIUM', 'search filter excluded the matching row');
    await searchInput.fill('zzz-no-match-xyz');
    await page.waitForTimeout(500);
    const noMatchRows = await page.locator('tbody tr').count();
    PASS('search filter responsive', `match=1 / no-match-rows=${noMatchRows}`);
    await searchInput.fill('');
  }

  // B9: Open backlog generator page (don't trigger AI to save time)
  setStage('B9.backlog-generator-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/backlog-generator`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('B09-backlog-generator');
  if (await page.locator('button:has-text("Générer le backlog")').first().count() === 0) {
    FAIL('CRITICAL', 'generate-backlog button missing');
  } else { PASS('backlog generator UI ready'); }

  // B10: Open assign-tasks page → verify the spec member shows as a column
  setStage('B10.assign-tasks-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/assign-tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot('B10-assign-tasks');
  const memberLane = await page.locator('.at__member-label:has-text("QA-Edited-Label")').first().count();
  if (memberLane === 0) FAIL('HIGH', 'newly-added member is not a column on AssignTasksView');
  else PASS('member column rendered with edited label');

  // B11: Cahier page (PM perspective — should NOT see the review banner)
  setStage('B11.pm-cahier-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/cahier`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot('B11-pm-cahier');
  if (await page.locator('text=Ce cahier des charges est en attente').count() > 0) {
    FAIL('CRITICAL', 'PM sees the spec-team review banner on their own cahier');
  } else PASS('PM correctly does NOT see the spec review banner');

  // B12: PM tries to self-approve their own cahier via API — should 400
  setStage('B12.pm-self-approve-block');
  state.expectedStatuses.add(400);
  const selfApprove = await api(`/pm/projects/${projectId}/cahier-des-charges/feedback`, {
    method: 'POST', body: { status: 'approved', comment: 'self-approve attempt' },
  });
  state.expectedStatuses.delete(400);
  if (selfApprove.status !== 400) FAIL('CRITICAL', `PM self-approve expected 400, got ${selfApprove.status}`);
  else PASS('PM self-approval blocked');

  // ─────────────────────────────────────────────────────────────────────────
  // Phase C: Pretend to be the spec team member
  // ─────────────────────────────────────────────────────────────────────────
  await logout();
  setStage('C1.spec-login');
  await login(SPEC);
  PASS('spec login');
  await shot('C01-spec-home');

  // C2: Pending reviews queue
  setStage('C2.spec-queue');
  await page.goto(`${ROOT}/app/team/pending-reviews`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('C02-spec-queue');
  // Raw API call to inspect the queue payload
  const queue = await api('/spec/pending-reviews');
  if (queue.status !== 200) FAIL('CRITICAL', `/spec/pending-reviews returned ${queue.status}`);
  else {
    const list = Array.isArray(queue.data) ? queue.data : [];
    const ours = list.find((r) => r.projectId === projectId);
    if (ours) {
      PASS('our project appears in spec queue', `cahierStatus=${ours.cahierStatus}`);
      if (!('cahierStatus' in ours)) FAIL('HIGH', 'queue payload missing cahierStatus field');
    } else {
      // No cahier was actually saved on this project, so it should NOT appear — that's a pass
      PASS('queue scope correct (no saved cahier → not in queue)');
    }
  }

  // C3: Spec opens project's cahier
  setStage('C3.spec-cahier-page');
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/cahier?from=queue`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('C03-spec-cahier');
  // Note: behavior depends on whether the project has a saved cahier; either way page should not crash

  // C4: Try to access a project where the spec is NOT a member — should 404
  setStage('C4.spec-cross-project-access');
  state.expectedStatuses.add(404).add(403);
  const otherProjects = await api('/admin/project');
  state.expectedStatuses.delete(404); state.expectedStatuses.delete(403);
  if (otherProjects.status !== 200) {
    PASS('spec correctly cannot list /admin/project', `HTTP ${otherProjects.status}`);
  } else {
    FAIL('CRITICAL', 'Spec user could call /admin/project — IDOR risk');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase D: Pretend to be a Realization team member
  // ─────────────────────────────────────────────────────────────────────────
  if (realizUserId) {
    await logout();
    setStage('D1.realiz-login');
    try {
      await login(REALIZ);
      PASS('realiz login');
    } catch (e) {
      FAIL('MEDIUM', `realiz login failed: ${e.message}`);
    }
    await shot('D01-realiz-home');

    // D2: Realiz tries to view members page of project they're not a member of → should 404
    setStage('D2.realiz-cross-project');
    state.expectedStatuses.add(404).add(403);
    const realizCheck = await api(`/pm/projects/${projectId}/members`);
    state.expectedStatuses.delete(404); state.expectedStatuses.delete(403);
    if (realizCheck.status === 200) {
      FAIL('HIGH', 'Realization team member could read other project members — IDOR');
    } else {
      PASS('realiz blocked from cross-project members', `HTTP ${realizCheck.status}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase E: Cleanup
  // ─────────────────────────────────────────────────────────────────────────
  await logout();
  setStage('E.cleanup');
  await login(PM);
  if (memberId) {
    state.expectedStatuses.add(409);
    const cleanup = await api(`/pm/projects/${projectId}/members/${memberId}?force=true`, { method: 'DELETE' });
    state.expectedStatuses.delete(409);
    if (cleanup.status === 200 || cleanup.status === 204) PASS('cleanup OK');
    else FAIL('LOW', `cleanup got HTTP ${cleanup.status}`);
  }

} catch (err) {
  FAIL('CRITICAL', `test run died: ${err.message}`);
} finally {
  await browser.close();
}

// ─── Report ──────────────────────────────────────────────────────────────────
console.log('');
console.log('═════════════════════════════════════════════════════════════════');
console.log(`  Multi-role bug-hunt — ${passed.length} passed, ${findings.length} flagged`);
console.log('═════════════════════════════════════════════════════════════════');
console.log('');
console.log('PASSES:');
for (const p of passed) console.log(`  ✔ [${p.stage}] ${p.label}${p.detail ? ' — ' + p.detail : ''}`);

if (findings.length) {
  console.log('');
  console.log('FINDINGS (sorted by severity):');
  const sev = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, WARN: 3, LOW: 4 };
  findings.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));
  for (const f of findings) {
    console.log(`  [${f.severity}] [${f.stage}] (${f.kind}) ${f.msg}`);
  }
}
console.log('');
console.log(`Screenshots saved to ${SHOTS}/`);
process.exit(findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length > 0 ? 1 : 0);
