#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const PROJECT_ID = process.argv[2] || '6eb94bd4-8cf4-42a1-b2b5-dc8e2a2a3015';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(ROOT + '/');
await page.waitForLoadState('networkidle');
const pmBtn = page.locator('button:has-text("Chef de projet")').first();
await pmBtn.click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/questionnaire`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const dump = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('label, .neo-field-label, [class*="field-label"], h3, h2'));
  const out = [];
  for (const l of labels) {
    const text = l.textContent.trim().slice(0, 100);
    if (!text) continue;
    out.push({
      tag: l.tagName,
      text,
      classes: l.className.toString().slice(0, 80),
    });
  }
  // Also dump any text inputs / textareas / selects on the page
  const inputs = Array.from(document.querySelectorAll('input, textarea, [role="combobox"]')).map((i) => ({
    tag: i.tagName,
    type: i.getAttribute('type'),
    placeholder: i.getAttribute('placeholder'),
    name: i.getAttribute('name'),
    id: i.id,
    cls: i.className.toString().slice(0, 80),
  }));
  // Buttons
  const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
    text: b.innerText.trim().slice(0, 60),
    disabled: b.disabled,
  }));
  // First 1000 chars of body text for a narrative view
  const bodyText = document.body.innerText.slice(0, 1500);
  return { labels: out.slice(0, 40), inputs: inputs.slice(0, 30), buttons: buttons.slice(0, 20), bodyText };
});

console.log(JSON.stringify(dump, null, 2));
await page.screenshot({ path: 'scripts/q-probe.png', fullPage: true });
await browser.close();
