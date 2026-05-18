import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://neoleadge.pythagore-init.com/');
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
const handles = await page.locator('button').elementHandles();
for (const h of handles) {
  const t = (await h.innerText().catch(() => '') || '').trim();
  if (/admin/i.test(t) && !/connect/i.test(t)) { await h.click(); break; }
}
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);

// 1. Admin users page should now show users
await page.goto('https://neoleadge.pythagore-init.com/app/admin/users', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.screenshot({ path: './scripts/e2e-final-shots/_verify-admin-users-FIXED.png', fullPage: true });
const subText = await page.locator('.section-sub').first().textContent().catch(() => '');
console.log('Admin users header:', (subText || '').trim());

// 2. Admin sidebar should NOT have Modèles
const sidebarLinks = await page.locator('aside a, .sidebar a, nav a').allTextContents();
const cleaned = sidebarLinks.map(t => t.trim().replace(/\s+/g, ' ')).filter(Boolean);
const hasModeles = cleaned.some(t => /Modèles/i.test(t));
console.log('Admin sidebar entries:', JSON.stringify(cleaned, null, 2));
console.log(hasModeles ? '✘ Modèles STILL visible in admin sidebar' : '✔ Modèles correctly absent from admin sidebar');

await browser.close();
