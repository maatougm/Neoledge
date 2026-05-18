#!/usr/bin/env node
/**
 * Captures BOTH the regular console messages AND Chrome's DevTools "Issues"
 * panel events (DOM, security, deprecation, low-text-contrast, etc.) which
 * surface via the CDP `Audits.issueAdded` channel — NOT through `console.warn`.
 *
 * The autocomplete-attribute warning the user reported (DOM Issue) is one of
 * these. Standard Playwright captures miss them.
 */
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const findings = [];

// Hook into CDP for the Audits domain (Chrome Issues panel).
const cdp = await ctx.newCDPSession(page);
await cdp.send('Audits.enable');
cdp.on('Audits.issueAdded', ({ issue }) => {
  const code = issue.code;
  // Each issue has a typed details bag; grab the most useful fields per code.
  let detail = '';
  try {
    if (code === 'GenericIssue') detail = JSON.stringify(issue.details.genericIssueDetails ?? {});
    else if (code === 'MixedContentIssue') detail = JSON.stringify(issue.details.mixedContentIssueDetails ?? {});
    else if (code === 'DeprecationIssue') detail = JSON.stringify(issue.details.deprecationIssueDetails ?? {});
    else if (code === 'AttributionReportingIssue') detail = JSON.stringify(issue.details.attributionReportingIssueDetails ?? {});
    else detail = JSON.stringify(issue.details ?? {}).slice(0, 500);
  } catch { detail = ''; }
  findings.push({ kind: `issue:${code}`, where: page.url(), detail: detail.slice(0, 600) });
});

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  findings.push({ kind: t, text: msg.text(), where: page.url() });
});
page.on('pageerror', (e) => findings.push({ kind: 'pageerror', text: e.message, where: page.url() }));

const log = (m) => console.error(`>> ${m}`);
log(ROOT);

// Login via API + inject jwt.
let token = null;
try {
  const r = await page.request.post(`${ROOT}/auth/login`, {
    data: { email: 'admin@neoleadge.com', password: 'Admin@123' },
    failOnStatusCode: false,
  });
  const d = await r.json().catch(() => ({}));
  if (d.jwt) {
    token = d.jwt;
    await page.goto(`${ROOT}/`, { waitUntil: 'load' });
    await page.evaluate((t) => localStorage.setItem('nl_jwt', t), token);
    log('login OK');
  }
} catch (e) {
  log(`login failed: ${e.message}`);
}

const projectId = process.env.PROJECT_ID || 'b49c1a04-a428-4d9c-a2c6-6fad59dce7ba';

// Visit pages most likely to surface DOM Issues — login, modals, forms.
const routes = [
  '/login',
  '/forgot-password',
  '/reset-password?token=fake-for-render',
  '/app/profile',
  '/app/admin/users',
  `/app/pm/projects/${projectId}/members`,
  `/app/pm/projects/${projectId}/cahier`,
];
for (const p of routes) {
  try {
    log(p);
    await page.goto(`${ROOT}${p}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    findings.push({ kind: 'navfail', text: `${p}: ${e.message}`, where: p });
  }
}

// Open the new-user dialog (admin form) — exercises the password input.
try {
  await page.goto(`${ROOT}/app/admin/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const newBtn = page.locator('button:has-text("Nouvel utilisateur")').first();
  if (await newBtn.count() > 0) {
    await newBtn.click();
    await page.waitForTimeout(2000);
  }
} catch (e) { log(`new-user open failed: ${e.message}`); }

// Open change-password from profile.
try {
  await page.goto(`${ROOT}/app/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const cp = page.locator('button:has-text("Changer le mot de passe"), button:has-text("Mot de passe")').first();
  if (await cp.count() > 0) { await cp.click(); await page.waitForTimeout(2000); }
} catch (e) { log(`change-pw open failed: ${e.message}`); }

const dedup = {};
for (const f of findings) {
  const key = `${f.kind}::${(f.text || f.detail || '').slice(0, 200)}`;
  dedup[key] = dedup[key] || { ...f, count: 0, examples: [] };
  dedup[key].count++;
  if (dedup[key].examples.length < 3 && f.where && !dedup[key].examples.includes(f.where)) {
    dedup[key].examples.push(f.where);
  }
}
const out = Object.values(dedup).sort((a, b) => b.count - a.count);
log(`distinct: ${out.length}, total: ${findings.length}`);
console.log(JSON.stringify({ totals: { distinct: out.length, total: findings.length }, issues: out }, null, 2));
await browser.close();
