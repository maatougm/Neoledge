import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('response', (r) => {
  if (r.url().includes('/auth') || r.url().includes('/api')) {
    console.log('  RESP:', r.status(), r.url().slice(0, 80));
  }
});
p.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log('  CONSOLE', msg.type() + ':', msg.text().slice(0, 200));
  }
});

await p.goto('https://neoleadge.pythagore-init.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('--- after initial load ---');
console.log('url:', p.url());

// Try: fill email + password + click Se connecter
console.log('--- attempting form login ---');
await p.locator('input[type="email"]').first().fill('admin@neoleadge.com');
await p.locator('input[type="password"]').first().fill('Admin@123');
await p.locator('button:has-text("Se connecter")').first().click();
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(2000);
console.log('--- after submit ---');
console.log('url:', p.url());
console.log('jwt in localStorage:', await p.evaluate(() => localStorage.getItem('nl_jwt')?.slice(0, 30)));
const errorBanner = await p.locator('.p-message-error, .neo-toast-error, [role="alert"]').first().textContent().catch(() => null);
if (errorBanner) console.log('error banner:', errorBanner);
await p.screenshot({ path: './scripts/probe-login-2.png' });
await b.close();
