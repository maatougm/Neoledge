#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(ROOT + '/');
await page.waitForLoadState('networkidle');
await page.locator('button:has-text("Administrateur")').first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
await page.goto(ROOT + '/app/admin/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('button:has-text("Nouveau projet")').first().click();
await page.waitForTimeout(1500);

// Dump the form structure
const html = await page.evaluate(() => {
  const form = document.querySelector('.project-form, [class*="project-form"]') || document.body;
  // Walk all labels + their associated inputs
  const labels = Array.from(form.querySelectorAll('label'));
  return labels.map((l) => {
    const inputs = Array.from(l.querySelectorAll('input,textarea,select')).map((i) => ({
      tag: i.tagName,
      type: i.getAttribute('type'),
      name: i.getAttribute('name'),
      placeholder: i.getAttribute('placeholder'),
      cls: i.className.slice(0, 100),
    }));
    const next = l.nextElementSibling;
    const nextInputs = next
      ? Array.from(next.querySelectorAll('input,textarea,select')).slice(0, 2).map((i) => ({
        tag: i.tagName, type: i.getAttribute('type'), name: i.getAttribute('name'),
        placeholder: i.getAttribute('placeholder'), cls: i.className.slice(0, 100),
      }))
      : [];
    const parent = l.parentElement;
    const parentInputs = parent
      ? Array.from(parent.querySelectorAll('input,textarea,select')).slice(0, 2).map((i) => ({
        tag: i.tagName, type: i.getAttribute('type'), name: i.getAttribute('name'),
        placeholder: i.getAttribute('placeholder'), cls: i.className.slice(0, 100),
      }))
      : [];
    return {
      labelText: l.textContent.trim().slice(0, 80),
      labelClass: l.className.slice(0, 80),
      htmlFor: l.getAttribute('for'),
      childInputs: inputs,
      nextSiblingInputs: nextInputs,
      parentInputs,
    };
  });
});
console.log(JSON.stringify(html, null, 2));
await browser.close();
