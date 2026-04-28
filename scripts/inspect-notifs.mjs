#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const events = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') events.push({ k: t, t: m.text().slice(0, 200) }); });
page.on('pageerror', (e) => events.push({ k: 'pageerror', t: e.message }));
page.on('requestfailed', (r) => events.push({ k: 'reqfail', t: `${r.method()} ${r.url()} — ${r.failure()?.errorText}` }));
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/notifications') || u.includes('/socket.io/')) {
    events.push({ k: 'req', t: `${r.method()} ${u}` });
  }
});
page.on('websocket', (ws) => {
  events.push({ k: 'ws-open', t: ws.url() });
  ws.on('framereceived', (frame) => {
    const txt = String(frame.payload || '').slice(0, 200);
    if (txt && txt.length > 1) events.push({ k: 'ws-rx', t: txt });
  });
  ws.on('framesent', (frame) => {
    const txt = String(frame.payload || '').slice(0, 200);
    if (txt && txt.length > 1) events.push({ k: 'ws-tx', t: txt });
  });
  ws.on('close', () => events.push({ k: 'ws-close', t: ws.url() }));
  ws.on('socketerror', (e) => events.push({ k: 'ws-err', t: `${ws.url()} | ${e}` }));
});
page.on('response', async (resp) => {
  const u = resp.url();
  if (u.includes('/notifications') || u.includes('/socket.io/')) {
    let body = '';
    try { body = (await resp.text()).slice(0, 200); } catch {}
    events.push({ k: 'resp', t: `${resp.status()} ${u} | ${body}` });
  }
});

await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Administrateur")').first().click();
await page.waitForLoadState('networkidle', { timeout: 20000 });
await page.waitForTimeout(5000);

// Try clicking the notification bell if there is one
const bellSelectors = [
  '[aria-label*="otification"]',
  'button[title*="otification"]',
  '.notification-trigger',
  'i.pi-bell',
];
for (const sel of bellSelectors) {
  const loc = page.locator(sel).first();
  if (await loc.count() > 0) {
    console.error(`>> click ${sel}`);
    try { await loc.click(); await page.waitForTimeout(1500); } catch {}
    break;
  }
}

// Visible notification UI?
const bellVisible = await page.locator('i.pi-bell, [class*="bell"], [class*="notif"]').count();
console.error(`>> bell-like elements found: ${bellVisible}`);

// Take screenshot
await page.screenshot({ path: '/tmp/notif-page.png', fullPage: true });
console.error('>> screenshot: /tmp/notif-page.png');

console.log(JSON.stringify(events, null, 2));
await browser.close();
