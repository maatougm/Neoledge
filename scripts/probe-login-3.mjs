import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

await p.goto('https://neoleadge.pythagore-init.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('initial url:', p.url());

await p.locator('input[type="email"]').first().fill('admin@neoleadge.com');
await p.locator('input[type="password"]').first().fill('Admin@123');
await p.locator('button:has-text("Se connecter")').first().click();

// Wait for URL to actually change off /login.
const ok = await p.waitForURL(/\/app/, { timeout: 30000 }).then(() => true).catch(() => false);
console.log('waitForURL(/app):', ok);
console.log('final url:', p.url());
console.log('jwt:', !!(await p.evaluate(() => localStorage.getItem('nl_jwt'))));
await b.close();
