#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const PROJECT_ID = process.argv[2] || '6eb94bd4-8cf4-42a1-b2b5-dc8e2a2a3015';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(ROOT + '/');
await page.waitForLoadState('networkidle');
await page.locator('button:has-text("Chef de projet")').first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/cahier`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

const dump = await page.evaluate(() => {
  // Find all buttons + their disabled state and visibility
  const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
    text: b.innerText.trim().slice(0, 80),
    disabled: b.disabled,
    hidden: b.offsetParent === null,
    cls: b.className.slice(0, 60),
  }));
  // Anchor tags that look like buttons
  const links = Array.from(document.querySelectorAll('a')).slice(0, 30).map((a) => ({
    text: a.innerText.trim().slice(0, 60),
    href: a.getAttribute('href'),
  }));
  // Body text excerpt
  const bodyText = document.body.innerText.slice(0, 2500);
  // Check for the cahier section markers specifically
  const cahierHeader = document.querySelector('.cahier-header, [class*="cahier"]');
  const cahierSnippet = cahierHeader ? cahierHeader.outerHTML.slice(0, 2000) : null;
  return { buttons, links, bodyText, cahierSnippet };
});

console.log(JSON.stringify(dump, null, 2));
await page.screenshot({ path: 'scripts/cahier-probe.png', fullPage: true });
await browser.close();
