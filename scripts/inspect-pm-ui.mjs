#!/usr/bin/env node
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const PROJECT_ID = 'b49c1a04-a428-4d9c-a2c6-6fad59dce7ba';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(ROOT + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Chef de projet")').first().click();
await page.waitForLoadState('networkidle', { timeout: 20000 });
await page.waitForTimeout(2500);
console.log(`>> after login: ${page.url()}`);

// Sidebar nav
const navItems = await page.locator('nav a, nav button, .sidebar a, .sidebar button, [class*="nav"] a, [class*="nav"] button').allInnerTexts().catch(() => []);
console.log('\n=== SIDEBAR NAV (PM root) ===');
console.log(navItems.filter(t => t.trim() && t.length < 80).join(' | '));

// 1. Mes projets page
await page.goto(ROOT + '/app/pm/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/pm-projects-list.png', fullPage: true });
console.log('\n>> screenshot: /tmp/pm-projects-list.png');

// Try to find any clickable element with the project name
const projectLinks = await page.locator(':text("QA-Test")').all();
console.log(`>> "QA-Test" matches: ${projectLinks.length}`);

// 2. Direct project view
console.log(`\n=== Going to /app/pm/projects/${PROJECT_ID} ===`);
await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);
console.log(`>> URL: ${page.url()}`);

const projNav = await page.locator('nav a, nav button, .sidebar a, .sidebar button, [class*="nav"] a, [class*="nav"] button').allInnerTexts().catch(() => []);
console.log('\n=== SIDEBAR NAV (project context) ===');
console.log(projNav.filter(t => t.trim() && t.length < 80).join(' | '));

// All buttons on project overview
const overviewButtons = await page.locator('button').allInnerTexts().catch(() => []);
console.log('\n=== BUTTONS on project overview ===');
console.log(overviewButtons.filter(t => t.trim() && t.length < 80).join(' | '));

await page.screenshot({ path: '/tmp/pm-project-overview.png', fullPage: true });
console.log('>> screenshot: /tmp/pm-project-overview.png');

// 3. WorkPackages view
console.log(`\n=== Going to .../workpackages ===`);
await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/workpackages`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);
console.log(`>> URL: ${page.url()}`);
const wpButtons = await page.locator('button').allInnerTexts().catch(() => []);
console.log('=== BUTTONS on WP view ===');
console.log(wpButtons.filter(t => t.trim() && t.length < 80).join(' | '));
await page.screenshot({ path: '/tmp/pm-wp-view.png', fullPage: true });

// 4. Check various known sub-routes
const subroutes = ['gantt', 'board', 'sprint', 'backlogs', 'wiki', 'budget', 'time', 'members', 'activity'];
for (const r of subroutes) {
  await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/${r}`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const u = page.url();
  const ok = u.includes(`/${r}`);
  const buttons = await page.locator('button').count().catch(() => 0);
  console.log(`  /${r} → ${ok ? 'OK' : 'redirect'} (${buttons} buttons) ${u}`);
}

// 5. Page text scan for AI features
const fullText = await page.textContent('body');
console.log('\n=== Feature keyword counts (last loaded page) ===');
for (const kw of ['Backlog', 'IA', 'AI', 'Cahier', 'cahier', 'Générer', 'En direct', 'live', 'AwaitingReview', 'Réunion']) {
  console.log(`  ${kw}: ${(fullText.match(new RegExp(kw, 'g')) || []).length}`);
}

await browser.close();
