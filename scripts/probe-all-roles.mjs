/**
 * Quick per-role landing probe. For each role, logs in, waits for the
 * dashboard, then captures the URL + any pageerror / 5xx response. Fast
 * sanity check across all personas.
 */
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const ROLES = [
  { tag: 'Admin',  email: 'admin@neoleadge.com',  password: 'Admin@123' },
  { tag: 'PM',     email: 'pm@neoleadge.com',     password: 'Pm@123' },
  { tag: 'Spec',   email: 'spec@neoleadge.com',   password: 'Spec@123' },
  { tag: 'Realiz', email: 'realiz@neoleadge.com', password: 'Realiz@123' },
];

const findings = [];

for (const role of ROLES) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const roleFindings = [];
  p.on('pageerror', (e) => roleFindings.push({ kind: 'pageerror', msg: e.message.slice(0, 200) }));
  p.on('response', (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 500 || (s >= 400 && !u.match(/\.(js|css|png|jpg|svg|ico|woff2?|map)/) && !u.includes('/auth/me'))) {
      // /auth/me 401 is expected on bootstrap before login
      if (u.includes('/auth/me') && s === 401) return;
      roleFindings.push({ kind: 'http' + s, msg: u.slice(0, 120) });
    }
  });
  p.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/google|gstatic|favicon/.test(t)) return;
      roleFindings.push({ kind: 'console-error', msg: t.slice(0, 200) });
    }
  });

  try {
    await p.goto(ROOT + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await p.locator('input[type="email"]').first().fill(role.email);
    await p.locator('input[type="password"]').first().fill(role.password);
    await p.locator('button:has-text("Se connecter")').first().click();
    const ok = await p.waitForURL(/\/app/, { timeout: 30000 }).then(() => true).catch(() => false);
    if (!ok) {
      console.log(`✘ ${role.tag}: login redirect failed (url=${p.url()})`);
      findings.push({ role: role.tag, ...{ kind: 'login-redirect-fail', msg: p.url() } });
      await b.close();
      continue;
    }
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log(`✔ ${role.tag} → ${p.url()}`);

    // Tiny sub-probes per role — try opening notifications + scrolling
    try {
      const bell = p.locator('[aria-label*="notif" i], button:has(.pi-bell), button[title*="notif" i]').first();
      if (await bell.count()) {
        await bell.click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(800);
        await p.keyboard.press('Escape');
      }
    } catch { /* ignore */ }
  } catch (e) {
    findings.push({ role: role.tag, kind: 'exception', msg: String(e).slice(0, 200) });
  }

  if (roleFindings.length) {
    for (const f of roleFindings) findings.push({ role: role.tag, ...f });
  }
  await b.close();
}

console.log('\n──── Findings ────');
if (findings.length === 0) console.log('No issues found.');
else for (const f of findings) console.log(`  [${f.role}] ${f.kind}: ${f.msg}`);
