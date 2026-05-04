#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const all = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  all.push({ kind: t, text: msg.text(), loc: msg.location().url + ':' + msg.location().lineNumber });
});
page.on('pageerror', (err) => all.push({ kind: 'pageerror', text: err.message, stack: (err.stack || '').split('\n')[1] }));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('googleapis') || url.includes('gstatic')) return; // ignore font CDN
  all.push({ kind: 'reqfail', text: `${req.method()} ${url} — ${req.failure()?.errorText}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s >= 400 && !u.match(/\.(js|css|png|jpg|svg|ico|woff|woff2)(\?|$)/)) {
    all.push({ kind: 'http' + s, text: u });
  }
});

console.error(`>> ${ROOT}`);
await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Login admin
try {
  const btn = page.locator('button:has-text("Administrateur")').first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await page.waitForTimeout(3000);
  }
} catch (e) {
  all.push({ kind: 'click-fail', text: e.message });
}

console.error(`>> after login URL: ${page.url()}`);

// Visit pages
const routes = [
  '/app', '/app/admin/dashboard', '/app/admin/projects', '/app/admin/users',
  '/app/admin/templates', '/app/admin/audit', '/app/admin/system',
  '/app/admin/portfolio', '/app/profile',
];
for (const p of routes) {
  try {
    console.error(`>> ${p}`);
    await page.goto(ROOT + p, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    all.push({ kind: 'navfail', text: `${p}: ${e.message}` });
  }
}

// Try opening a project detail
try {
  await page.goto(ROOT + '/app/admin/projects', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  // Click first project row if any
  const row = page.locator('table tr td button, table tr td a').first();
  if (await row.count() > 0 && await row.isVisible({ timeout: 2000 })) {
    await row.click();
    await page.waitForTimeout(3000);
  }
} catch {}

// Dedup
const dedup = {};
for (const m of all) {
  const key = m.kind + '::' + (m.text || '').slice(0, 300);
  if (!dedup[key]) dedup[key] = { ...m, count: 0 };
  dedup[key].count += 1;
}
const out = Object.values(dedup).sort((a, b) => b.count - a.count);
console.error(`>> distinct: ${out.length}, total: ${all.length}`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
