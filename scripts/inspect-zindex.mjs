#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Administrateur")').first().click();
await page.waitForLoadState('networkidle', { timeout: 20000 });
await page.waitForTimeout(2000);

await page.goto(ROOT + '/app/admin/templates', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('>> click "Nouveau modèle"');
await page.locator('button:has-text("Nouveau modèle")').first().click();
await page.waitForTimeout(1500);

console.log('>> click "Ajouter un champ"');
await page.locator('button:has-text("Ajouter un champ")').first().click();
await page.waitForTimeout(800);

// Find the type dropdown trigger
console.log('>> click type dropdown trigger');
const select = page.locator('.field-row .p-select, .field-row .p-dropdown, .field-row [class*="select"]').first();
if (await select.count() > 0) {
  await select.click();
  await page.waitForTimeout(1500);
} else {
  // Fallback selector
  await page.locator('.field-row [role="combobox"]').first().click().catch(() => {});
  await page.waitForTimeout(1500);
}

await page.screenshot({ path: '/tmp/zindex-modal-dropdown.png', fullPage: false });
console.log('screenshot: /tmp/zindex-modal-dropdown.png');

// Inspect z-indexes
const zIndexes = await page.evaluate(() => {
  const all = document.querySelectorAll('[style*="z-index"], .p-dialog, .p-overlay, .p-select-overlay, .p-dropdown-panel, .modal-scrim, .modal-box, [data-pc-name="select"]');
  return Array.from(all).slice(0, 20).map(el => ({
    tag: el.tagName,
    cls: el.className?.toString?.().slice(0, 100) || '',
    z: getComputedStyle(el).zIndex,
    inlineZ: el.style.zIndex,
    visible: el.offsetParent !== null || el.tagName === 'BODY',
  }));
});
console.log(JSON.stringify(zIndexes, null, 2));

await browser.close();
