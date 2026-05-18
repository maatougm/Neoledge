#!/usr/bin/env node
/**
 * Deep console + network audit against the live test site. Logs in as
 * Admin (one-click button), then walks every major route the user can
 * reach, capturing console warnings/errors, page errors, request failures
 * and any 4xx/5xx HTML responses. Output is a deduped JSON array on stdout.
 */
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

const all = [];
const FONT_HOSTS = ['googleapis', 'gstatic'];
const ASSET_RE = /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|map)(\?|$)/;

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  const loc = msg.location();
  all.push({
    kind: t,
    text: msg.text(),
    where: page.url(),
    loc: loc.url ? `${loc.url}:${loc.lineNumber}` : '',
  });
});
page.on('pageerror', (err) =>
  all.push({
    kind: 'pageerror',
    text: err.message,
    where: page.url(),
    loc: (err.stack || '').split('\n')[1]?.trim() || '',
  })
);
page.on('requestfailed', (req) => {
  const url = req.url();
  if (FONT_HOSTS.some((h) => url.includes(h))) return;
  // ERR_ABORTED on .js/.css/.map is almost always "navigated away mid-load"
  // (Vite chunks for the previous page). Not a real bug.
  const failureText = req.failure()?.errorText || '';
  if (failureText === 'net::ERR_ABORTED' && ASSET_RE.test(url)) return;
  all.push({
    kind: 'reqfail',
    text: `${req.method()} ${url} — ${failureText}`,
    where: page.url(),
  });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s >= 400 && !ASSET_RE.test(u)) {
    all.push({ kind: `http${s}`, text: u, where: page.url() });
  }
});

const log = (m) => console.error(`>> ${m}`);

log(ROOT);
await page.goto(`${ROOT}/`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Login by hitting the API directly, then injecting the JWT into localStorage.
// Walking through the form UI is fragile and we want this audit fast.
let token = null;
try {
  const resp = await page.request.post(`${ROOT}/auth/login`, {
    data: { email: 'admin@neoleadge.com', password: 'Admin@123' },
    failOnStatusCode: false,
  });
  const data = await resp.json().catch(() => ({}));
  if (data.jwt) {
    token = data.jwt;
    await page.goto(`${ROOT}/`, { waitUntil: 'load' });
    await page.evaluate((t) => localStorage.setItem('nl_jwt', t), token);
    log('login OK via API, jwt injected');
  } else {
    all.push({ kind: 'login-fail', text: `status=${resp.status()} body=${JSON.stringify(data).slice(0, 200)}` });
  }
} catch (e) {
  all.push({ kind: 'login-fail', text: e.message });
}

// Skip discovery — use a known seeded project from the prod DB.
const projectId = process.env.PROJECT_ID || 'b49c1a04-a428-4d9c-a2c6-6fad59dce7ba';
log(`using projectId ${projectId}`);

// Walk admin routes
const adminRoutes = [
  '/app',
  '/app/admin/dashboard',
  '/app/admin/projects',
  '/app/admin/users',
  '/app/admin/audit',
  '/app/admin/system',
  '/app/profile',
];

// PM project routes — only if we found a project
const pmRoutes = projectId
  ? [
      `/app/pm/projects`,
      `/app/pm/projects/${projectId}`,
      `/app/pm/projects/${projectId}/questionnaire`,
      `/app/pm/projects/${projectId}/meetings`,
      `/app/pm/projects/${projectId}/cahier`,
      `/app/pm/projects/${projectId}/validations`,
      `/app/pm/projects/${projectId}/workpackages`,
      `/app/pm/projects/${projectId}/board`,
      `/app/pm/projects/${projectId}/gantt`,
      `/app/pm/projects/${projectId}/backlogs`,
      `/app/pm/projects/${projectId}/sprint`,
      `/app/pm/projects/${projectId}/members`,
      `/app/pm/projects/${projectId}/time`,
      `/app/pm/projects/${projectId}/activity`,
    ]
  : [];

const teamRoutes = projectId ? [`/app/team/projects/${projectId}?from=queue`] : [];

const routes = [...adminRoutes, ...pmRoutes, ...teamRoutes];

for (const p of routes) {
  try {
    log(p);
    await page.goto(`${ROOT}${p}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    all.push({ kind: 'navfail', text: `${p}: ${e.message}`, where: p });
  }
}

// ── Interactive probes — open the buttons / modals users actually click.
// Each step is best-effort; we just want to surface warnings, not fail.
async function safe(label, fn) {
  try { await fn(); log(`interact: ${label}`); }
  catch (e) { log(`interact-fail ${label}: ${e.message.slice(0, 80)}`); }
}

await safe('open Add Member modal', async () => {
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/members`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Ajouter un membre")');
  await page.waitForTimeout(1500);
  // Click on user select if visible
  const sel = page.locator('.p-select, .p-dropdown').first();
  if (await sel.count() > 0) { await sel.click({ timeout: 2000 }); await page.waitForTimeout(800); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

await safe('open Notifications panel', async () => {
  const bell = page.locator('button[aria-label*="otification" i], button:has(.pi-bell)').first();
  if (await bell.count() > 0) { await bell.click(); await page.waitForTimeout(1200); await bell.click(); }
});

await safe('open Profile menu', async () => {
  const avatar = page.locator('.topbar [class*="avatar"], button[aria-haspopup="menu"]').first();
  if (await avatar.count() > 0) { await avatar.click(); await page.waitForTimeout(1000); await page.keyboard.press('Escape'); }
});

await safe('Cahier tab → Modifier', async () => {
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/cahier`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const editBtn = page.locator('button:has-text("Modifier")').first();
  if (await editBtn.count() > 0 && await editBtn.isVisible()) {
    await editBtn.click();
    await page.waitForTimeout(1200);
    const cancel = page.locator('button:has-text("Annuler")').first();
    if (await cancel.count() > 0) await cancel.click();
  }
});

await safe('Meetings → Réunion en direct picker', async () => {
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/meetings`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const live = page.locator('button:has-text("Réunion en direct")').first();
  if (await live.count() > 0) {
    await live.click();
    await page.waitForTimeout(1500);
    const back = page.locator('button:has-text("Retour")').first();
    if (await back.count() > 0) await back.click();
  }
});

await safe('Workpackages → first WP detail', async () => {
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/workpackages`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  const row = page.locator('table tbody tr').first();
  if (await row.count() > 0) { await row.click(); await page.waitForTimeout(1200); await page.keyboard.press('Escape'); }
});

await safe('Board (kanban)', async () => {
  await page.goto(`${ROOT}/app/pm/projects/${projectId}/board`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
});

await safe('admin user list filters', async () => {
  await page.goto(`${ROOT}/app/admin/users`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  const search = page.locator('input[placeholder*="Recherch"]').first();
  if (await search.count() > 0) { await search.fill('admin'); await page.waitForTimeout(800); }
});

// Dedup with rolled-up first occurrence
const dedup = {};
for (const m of all) {
  const key = `${m.kind}::${(m.text || '').slice(0, 300)}`;
  if (!dedup[key]) dedup[key] = { ...m, count: 0, examples: [] };
  dedup[key].count += 1;
  if (dedup[key].examples.length < 3 && m.where && !dedup[key].examples.includes(m.where)) {
    dedup[key].examples.push(m.where);
  }
}
const out = Object.values(dedup).sort((a, b) => b.count - a.count);
log(`distinct: ${out.length}, total: ${all.length}, projectId: ${projectId}`);
console.log(JSON.stringify({ projectId, totals: { distinct: out.length, total: all.length }, issues: out }, null, 2));

await browser.close();
