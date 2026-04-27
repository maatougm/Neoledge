#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const all = [];
page.on('console', (msg) => all.push({ kind: msg.type(), text: msg.text(), loc: msg.location().url + ':' + msg.location().lineNumber }));
page.on('pageerror', (err) => all.push({ kind: 'pageerror', text: err.message, stack: (err.stack || '').split('\n').slice(0, 3).join(' | ') }));
page.on('requestfailed', (req) => all.push({ kind: 'requestfailed', text: `${req.method()} ${req.url()} — ${req.failure()?.errorText}` }));
page.on('response', (resp) => {
  const s = resp.status();
  if (s >= 400) all.push({ kind: 'http' + s, text: resp.url() });
});

// Hook before any page scripts to capture EARLY warnings
await page.addInitScript(() => {
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  window.__capturedWarn = [];
  console.warn = (...args) => { window.__capturedWarn.push(['warn', String(args[0])]); return origWarn(...args); };
  console.error = (...args) => { window.__capturedWarn.push(['error', String(args[0])]); return origError(...args); };
});

console.error(`>> goto ${ROOT}/`);
await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Click quick-login Admin
try {
  const btn = page.locator('button:has-text("Administrateur")').first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.waitForTimeout(2500);
  }
} catch (e) {
  all.push({ kind: 'click-fail', text: e.message });
}

// Visit app routes
for (const p of ['/app', '/app/admin/projects', '/app/admin/users', '/app/admin/templates', '/app/admin/audit']) {
  try {
    await page.goto(ROOT + p, { waitUntil: 'networkidle', timeout: 12000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    all.push({ kind: 'navfail', text: `${p}: ${e.message}` });
  }
}

// Also check what was captured by our injected hook
const captured = await page.evaluate(() => window.__capturedWarn || []);
for (const [k, t] of captured) all.push({ kind: 'hook-' + k, text: t });

console.error(`>> total captured: ${all.length}`);
const dedup = {};
for (const m of all) {
  const key = m.kind + '::' + (m.text || '').slice(0, 200);
  if (!dedup[key]) dedup[key] = { ...m, count: 0 };
  dedup[key].count += 1;
}
console.log(JSON.stringify(Object.values(dedup), null, 2));
await browser.close();
