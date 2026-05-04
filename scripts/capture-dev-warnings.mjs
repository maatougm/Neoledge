#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'http://localhost:5173/Sample/Front';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const all = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return; // skip noisy types
  all.push({ kind: t, text: msg.text(), loc: msg.location().url + ':' + msg.location().lineNumber });
});
page.on('pageerror', (err) => all.push({ kind: 'pageerror', text: err.message }));
page.on('requestfailed', (req) => all.push({ kind: 'requestfailed', text: `${req.method()} ${req.url()} — ${req.failure()?.errorText}` }));
page.on('response', (resp) => {
  const s = resp.status();
  if (s >= 400 && !resp.url().match(/\.(js|css|png|jpg|svg|ico|woff)$/)) {
    all.push({ kind: 'http' + s, text: resp.url() });
  }
});

console.error(`>> goto ${ROOT}/`);
await page.goto(ROOT + '/app', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Login Admin
try {
  await page.goto(ROOT + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const btn = page.locator('button:has-text("Administrateur")').first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.waitForTimeout(2500);
  }
} catch (e) {
  all.push({ kind: 'click-fail', text: e.message });
}

// Visit several routes to trigger more components
for (const p of [
  '/app', '/app/admin', '/app/admin/projects', '/app/admin/users',
  '/app/admin/templates', '/app/admin/audit', '/app/admin/dashboard',
  '/app/profile',
]) {
  try {
    console.error(`>> goto ${p}`);
    await page.goto(ROOT + p, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    all.push({ kind: 'navfail', text: `${p}: ${e.message}` });
  }
}

// Dedup by kind + first 200 chars of text
const dedup = {};
for (const m of all) {
  const key = m.kind + '::' + (m.text || '').slice(0, 250);
  if (!dedup[key]) dedup[key] = { ...m, count: 0 };
  dedup[key].count += 1;
}
const out = Object.values(dedup).sort((a, b) => b.count - a.count);
console.error(`>> distinct entries: ${out.length}, total: ${all.length}`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
