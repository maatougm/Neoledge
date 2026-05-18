#!/usr/bin/env node
// Quick probe: what URL does Admin land on when navigating to /app/pm/dashboard
// and /app/team/dashboard? Check body text too.

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT  = 'https://neoleadge.pythagore-init.com';
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Login
await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.locator('input[type="email"]').first().fill(ADMIN.email);
await page.locator('input[type="password"]').first().fill(ADMIN.password);
await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);
console.log('Logged in, url:', page.url());

// PM dashboard probe
await page.goto(ROOT + '/app/pm/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(1500);
const pmUrl  = page.url();
const pmBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
console.log('\n--- /app/pm/dashboard ---');
console.log('URL:', pmUrl);
console.log('Body (first 400):', pmBody);

// Team dashboard probe
await page.goto(ROOT + '/app/team/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(1500);
const teamUrl  = page.url();
const teamBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
console.log('\n--- /app/team/dashboard ---');
console.log('URL:', teamUrl);
console.log('Body (first 400):', teamBody);

await browser.close();
