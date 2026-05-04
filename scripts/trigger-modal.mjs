#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errs = [];
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') errs.push({ k: msg.type(), t: msg.text() }); });
page.on('pageerror', (err) => errs.push({ k: 'pageerror', t: err.message }));

await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Administrateur")').first().click();
await page.waitForLoadState('networkidle', { timeout: 20000 });
await page.waitForTimeout(2000);

// Open admin/projects, click Nouveau (which opens an AppModal in the create form)
await page.goto(ROOT + '/app/admin/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const newBtn = page.locator('button:has-text("Nouveau")').first();
if (await newBtn.count() > 0) {
  console.error('>> click Nouveau');
  try {
    await newBtn.click();
    await page.waitForTimeout(2000);
  } catch (e) { errs.push({ k: 'click', t: e.message }); }
}

// Try opening a WP detail (StatusChip is used everywhere)
await page.goto(ROOT + '/app/pm/projects/b49c1a04-a428-4d9c-a2c6-6fad59dce7ba/workpackages', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log(JSON.stringify(errs, null, 2));
await browser.close();
