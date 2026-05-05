#!/usr/bin/env node
// UX-audit screenshot pass — captures every key page so the human reviewer
// has visual context for the agents' findings.
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' };
const PM    = { email: 'pm@neoleadge.com',    password: 'Pm@12345'  };
const SPEC  = { email: 'spec@neoleadge.com',  password: 'Valid@123' };
const SHOTS = './scripts/ux-audit-shots';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function login(creds) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const wanted = creds.email === ADMIN.email ? /admin/i
    : creds.email === PM.email ? /chef de projet|^pm$/i
    : /sp[eé]cification|spec/i;
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
async function shot(name, url) {
  console.log(`  → ${name}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}

console.log('── Admin views');
await login(ADMIN);
await shot('admin-01-dashboard', `${ROOT}/app/admin/dashboard`);
await shot('admin-02-projects',  `${ROOT}/app/admin/projects`);
await shot('admin-03-users',     `${ROOT}/app/admin/users`);
await shot('admin-04-roles',     `${ROOT}/app/admin/roles`);
await shot('admin-05-activity',  `${ROOT}/app/admin/activity`);
await shot('admin-06-system',    `${ROOT}/app/admin/system`);
await shot('admin-07-trash',     `${ROOT}/app/admin/trash`);

const proj = await page.evaluate(async () => {
  const tok = localStorage.getItem('nl_jwt') || '';
  const r = await fetch('/admin/project', { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  const d = await r.json();
  const list = Array.isArray(d) ? d : (d.items ?? []);
  return list[0]?.id ?? null;
});
console.log('  using project:', proj);

await logout();

console.log('── PM views');
await login(PM);
await shot('pm-01-projects-list',     `${ROOT}/app/pm/projects`);
await shot('pm-02-my-tasks',          `${ROOT}/app/pm/my-tasks`);
await shot('pm-03-team-planner',      `${ROOT}/app/pm/team-planner`);
await shot('pm-04-templates',         `${ROOT}/app/pm/templates`);
await shot('pm-05-analytics',         `${ROOT}/app/pm/analytics`);
await shot('pm-06-profile',           `${ROOT}/app/profile`);

if (proj) {
  await shot('proj-01-overview',         `${ROOT}/app/pm/projects/${proj}`);
  await shot('proj-02-questionnaire',    `${ROOT}/app/pm/projects/${proj}/questionnaire`);
  await shot('proj-03-meetings',         `${ROOT}/app/pm/projects/${proj}/meetings`);
  await shot('proj-04-cahier',           `${ROOT}/app/pm/projects/${proj}/cahier`);
  await shot('proj-05-validations',      `${ROOT}/app/pm/projects/${proj}/validations`);
  await shot('proj-06-backlog-generator',`${ROOT}/app/pm/projects/${proj}/backlog-generator`);
  await shot('proj-07-assign-tasks',     `${ROOT}/app/pm/projects/${proj}/assign-tasks`);
  await shot('proj-08-workpackages',     `${ROOT}/app/pm/projects/${proj}/workpackages`);
  await shot('proj-09-gantt',            `${ROOT}/app/pm/projects/${proj}/gantt`);
  await shot('proj-10-board',            `${ROOT}/app/pm/projects/${proj}/board`);
  await shot('proj-11-backlogs',         `${ROOT}/app/pm/projects/${proj}/backlogs`);
  await shot('proj-12-sprint',           `${ROOT}/app/pm/projects/${proj}/sprint`);
  await shot('proj-13-time',             `${ROOT}/app/pm/projects/${proj}/time`);
  await shot('proj-14-members',          `${ROOT}/app/pm/projects/${proj}/members`);
  await shot('proj-15-activity',         `${ROOT}/app/pm/projects/${proj}/activity`);
}

await logout();

console.log('── Spec team views');
await login(SPEC);
await shot('spec-01-pending-reviews', `${ROOT}/app/team/pending-reviews`);
await shot('spec-02-validations',     `${ROOT}/app/team/validations`);
await shot('spec-03-projects',        `${ROOT}/app/team/projects`);
if (proj) await shot('spec-04-cahier-readonly', `${ROOT}/app/pm/projects/${proj}/cahier`);

await browser.close();
console.log(`Done — screenshots in ${SHOTS}/`);
