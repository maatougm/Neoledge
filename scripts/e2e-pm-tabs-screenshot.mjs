#!/usr/bin/env node
// Quick visual check: PM should NOT see "Validation équipes" tab.
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT = 'https://neoleadge.pythagore-init.com';
const PM = { email: 'pm@neoleadge.com', password: 'Pm@123' };
const SPEC = { email: 'spec@neoleadge.com', password: 'Spec@123' };
const SHOTS = './scripts/e2e-bughunt-shots';
await mkdir(SHOTS, { recursive: true }).catch(() => {});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function login(creds) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const wanted = creds.email === PM.email ? /chef de projet|^pm$/i : /sp[eé]cification|spec/i;
  const handles = await page.locator('button').elementHandles();
  for (const h of handles) {
    const txt = (await h.innerText().catch(() => '') || '').trim();
    if (wanted.test(txt) && !/connect/i.test(txt)) { await h.click(); break; }
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function logout() {
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function listVisibleTabs() {
  // The detail uses .inner-tab buttons
  const labels = await page.locator('.inner-tab').allTextContents();
  return labels.map((s) => s.trim().replace(/\s+/g, ' '));
}

await login(PM);
// First find a project the PM owns
const projId = await page.evaluate(async () => {
  const tok = localStorage.getItem('nl_jwt') || '';
  const r = await fetch('/pm/projects', { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  const d = await r.json();
  const list = Array.isArray(d) ? d : (d.items ?? []);
  return list[0]?.id ?? null;
});
if (!projId) { console.log('PM has no projects'); process.exit(1); }
// Open the URL the user shared (the /questionnaire deep-link)
await page.goto(`${ROOT}/app/pm/projects/${projId}/questionnaire`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
let tabs = await listVisibleTabs();
if (tabs.length === 0) {
  // fall back — get any project the PM can see
  const proj = await page.evaluate(async () => {
    const tok = localStorage.getItem('nl_jwt') || '';
    const r = await fetch('/pm/projects', { headers: { Authorization: 'Bearer ' + tok } });
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d.items ?? []);
    return list[0]?.id ?? null;
  });
  if (proj) {
    await page.goto(`${ROOT}/app/pm/projects/${proj}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    tabs = await listVisibleTabs();
  }
}

await page.screenshot({ path: `${SHOTS}/pm-tabs.png`, fullPage: true });
console.log('PM sees tabs:', JSON.stringify(tabs, null, 2));
const hasValidation = tabs.some((t) => /Validation [éée]quipes/.test(t));
console.log(hasValidation ? '✘ FAIL: PM still sees Validation équipes tab' : '✔ PASS: PM does NOT see Validation équipes tab');

// Now spec
await logout();
await login(SPEC);
const specProj = await page.evaluate(async () => {
  const tok = localStorage.getItem('nl_jwt') || '';
  const r = await fetch('/pm/projects', { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  const d = await r.json();
  const list = Array.isArray(d) ? d : (d.items ?? []);
  return list[0]?.id ?? null;
});
if (specProj) {
  await page.goto(`${ROOT}/app/pm/projects/${specProj}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const specTabs = await listVisibleTabs();
  console.log('Spec sees tabs:', JSON.stringify(specTabs, null, 2));
  await page.screenshot({ path: `${SHOTS}/spec-tabs.png`, fullPage: true });
  const specHasValidation = specTabs.some((t) => /Validation [éée]quipes/.test(t));
  console.log(specHasValidation ? '✔ PASS: Spec sees Validation équipes (correct)' : '✘ FAIL: Spec missing Validation équipes');
}

await browser.close();
