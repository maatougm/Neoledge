#!/usr/bin/env node
// PM Dashboard Baseline E2E
// Tests the current live experience for the ProjectManager role.
// Screenshots → scripts/e2e-dashboards-shots/pm/

import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const ROOT  = 'https://neoleadge.pythagore-init.com';
const PM    = { email: 'pm@neoleadge.com', password: 'Pm@123' };
const SHOTS = './scripts/e2e-dashboards-shots/pm';

await mkdir(SHOTS, { recursive: true }).catch(() => {});

const ts    = () => new Date().toISOString().slice(11, 19);
const log   = (...a) => console.error(`[${ts()}]`, ...a);

// ─── Findings collector ────────────────────────────────────────────────────
const findings = [];   // { severity, stage, kind, msg }
const passed   = [];

const state = { stage: 'init' };
const setStage = (s) => { state.stage = s; log(`──────── ${s} ────────`); };
const PASS = (label, detail = '') => {
  passed.push({ stage: state.stage, label, detail });
  log(`✔ ${label}${detail ? ' — ' + detail : ''}`);
};
const NOTE = (msg) => {
  findings.push({ severity: 'INFO', stage: state.stage, kind: 'note', msg });
  log(`ℹ ${msg}`);
};
const FAIL = (severity, msg) => {
  findings.push({ severity, stage: state.stage, kind: 'fail', msg });
  log(`✘ [${severity}] ${msg}`);
};

// ─── Browser setup ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

// Console errors
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  const text = msg.text();
  if (/google|gstatic|googleapis/.test(text)) return;
  findings.push({ severity: 'WARN', stage: state.stage, kind: t, msg: text.slice(0, 220) });
});

// Uncaught page errors
page.on('pageerror', (err) => {
  findings.push({ severity: 'HIGH', stage: state.stage, kind: 'pageerror', msg: err.message.slice(0, 220) });
});

// Failed requests
page.on('requestfailed', (req) => {
  const url = req.url();
  if (/google|gstatic|\.map$/.test(url)) return;
  findings.push({ severity: 'HIGH', stage: state.stage, kind: 'reqfail', msg: `${req.method()} ${url.slice(0, 120)}` });
});

// 4xx / 5xx HTTP responses
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s < 400) return;
  if (/\.(js|css|png|jpg|svg|ico|woff2?|map)(\?|$)/.test(u)) return;
  if (/google|gstatic/.test(u)) return;
  findings.push({
    severity: s >= 500 ? 'CRITICAL' : 'MEDIUM',
    stage: state.stage,
    kind: 'http' + s,
    msg: u.slice(0, 140),
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────
async function shot(name) {
  const path = `${SHOTS}/${name}`;
  await page.screenshot({ path, fullPage: true }).catch((e) => log(`shot failed: ${e.message}`));
  log(`screenshot → ${path}`);
}

async function login({ email, password }) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Try quick-login button first (matches French role labels)
  const wanted = /chef de projet|project manager|^pm$/i;
  let used = false;
  const handles = await page.locator('button').elementHandles();
  for (const h of handles) {
    const txt = (await h.innerText().catch(() => '') || '').trim();
    if (wanted.test(txt) && !/connect/i.test(txt)) {
      await h.click();
      used = true;
      log(`used quick-login button: "${txt}"`);
      break;
    }
  }

  if (!used) {
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator(
      'button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")'
    ).first().click();
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!/\/app/.test(page.url())) {
    throw new Error(`login failed — landed on: ${page.url()}`);
  }
}

// ─── Main flow ─────────────────────────────────────────────────────────────
try {
  // ── Step 1: Login ─────────────────────────────────────────────────────────
  setStage('01-pm-login');
  await login(PM);
  const landingUrl = page.url();
  PASS('PM login succeeded', `url=${landingUrl}`);

  // ── Step 2: Landing screenshot ────────────────────────────────────────────
  setStage('02-pm-landing');
  await shot('01-landing.png');
  NOTE(`landing URL: ${landingUrl}`);

  // Check what's on the home page
  const pageText = await page.evaluate(() => document.body.innerText);
  const hasMesTaches      = /mes t[aâ]ches/i.test(pageText);
  const hasJalons         = /jalons|milestone/i.test(pageText);
  const hasNotifications  = /notifications/i.test(pageText);
  const hasBienvenue      = /bienvenue|welcome|tableau de bord/i.test(pageText);
  const hasHomeView       = hasMesTaches || hasJalons || hasBienvenue;

  NOTE(`page text samples — mesTaches:${hasMesTaches}, jalons:${hasJalons}, notifications:${hasNotifications}, bienvenue/dashboard:${hasBienvenue}`);

  if (hasHomeView) {
    PASS('HomeView detected on landing', 'contains expected old home sections');
  } else {
    NOTE('HomeView sections NOT detected — page may have different content');
  }

  // ── Step 3: Probe new PM dashboard URL ───────────────────────────────────
  setStage('03-new-pm-dashboard-probe');
  log('Navigating to /app/pm/dashboard (expected: 404 / fallback — not yet deployed)');
  await page.goto(ROOT + '/app/pm/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const dashUrl        = page.url();
  const dashText       = await page.evaluate(() => document.body.innerText);
  const is404          = /404|not found|page introuvable/i.test(dashText) || page.url().includes('404');
  const redirectedHome = /\/app$|\/app\/$|\/app\/home/i.test(dashUrl);
  const sameAsDash     = dashUrl.includes('/app/pm/dashboard');

  await shot('02-new-pm-dashboard.png');

  NOTE(`/app/pm/dashboard → url=${dashUrl}`);
  if (is404) {
    NOTE('NEW PM DASHBOARD NOT YET DEPLOYED — page returned 404/not-found content');
  } else if (redirectedHome) {
    NOTE('NEW PM DASHBOARD NOT YET DEPLOYED — redirected back to home/app root');
  } else if (sameAsDash) {
    // It stayed on the URL — check if it rendered any real dashboard content
    const hasDashContent = /tableau de bord|mes projets|pm dashboard|statistiques/i.test(dashText);
    if (hasDashContent) {
      PASS('/app/pm/dashboard rendered with content — possibly deployed already');
    } else {
      NOTE('NEW PM DASHBOARD NOT YET DEPLOYED — URL accepted but no dashboard content rendered (likely SPA fallback to home)');
    }
  } else {
    NOTE(`NEW PM DASHBOARD NOT YET DEPLOYED — unexpected redirect to: ${dashUrl}`);
  }

  // ── Step 4: PM nav sections ───────────────────────────────────────────────
  const navItems = [
    { label: 'Mes projets',     urlPattern: '/pm/projects',   shotName: '03-mes-projets.png'     },
    { label: 'Mes tâches',      urlPattern: '/pm/tasks',      shotName: '04-mes-taches.png'      },
    { label: 'Planif. équipe',  urlPattern: '/pm/planning',   shotName: '05-planif-equipe.png'   },
    { label: 'Modèles',         urlPattern: '/pm/templates',  shotName: '06-modeles.png'         },
    { label: 'Analytiques',     urlPattern: '/pm/analytics',  shotName: '07-analytiques.png'     },
  ];

  for (const { label, urlPattern, shotName } of navItems) {
    setStage(`nav-${shotName}`);
    // Try to find nav link by text
    const navLink = page.locator(`a, [role="menuitem"], [role="link"], button`).filter({ hasText: new RegExp(label, 'i') }).first();
    const exists = await navLink.count() > 0;
    if (exists) {
      try {
        await navLink.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(800);
        const navUrl = page.url();
        await shot(shotName);
        PASS(`nav "${label}"`, `url=${navUrl}`);
        const urlMatch = navUrl.includes(urlPattern.split('/').pop());
        if (!urlMatch) {
          NOTE(`"${label}" URL ${navUrl} does not match expected pattern ${urlPattern}`);
        }
      } catch (e) {
        FAIL('MEDIUM', `clicking nav "${label}" threw: ${e.message.slice(0, 120)}`);
        await shot(shotName);
      }
    } else {
      // Try direct navigation as fallback
      log(`Nav link "${label}" not found in DOM — trying direct navigation to ${urlPattern}`);
      await page.goto(ROOT + urlPattern, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const navUrl = page.url();
      await shot(shotName);
      const body = await page.evaluate(() => document.body.innerText);
      const has5xx = /500|503|erreur serveur|server error/i.test(body);
      if (has5xx) {
        FAIL('CRITICAL', `"${label}" page (${urlPattern}) returned 5xx content`);
      } else if (/404|not found|introuvable/i.test(body)) {
        NOTE(`"${label}" (${urlPattern}) → 404/not-found`);
      } else {
        PASS(`nav "${label}" via direct URL`, `url=${navUrl}`);
      }
    }
  }

  // ── Step 5: Pick first project and screenshot project module nav ──────────
  setStage('05-project-detail');
  await page.goto(ROOT + '/app/pm/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Find a project card/row link
  const projectLink = page.locator('a[href*="/pm/projects/"]').first();
  const projectExists = await projectLink.count() > 0;

  if (projectExists) {
    const projectHref = await projectLink.getAttribute('href');
    await projectLink.click({ timeout: 8000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const projUrl = page.url();
    PASS('project detail opened', `url=${projUrl}`);
    await shot('08-project-overview.png');

    // Sub-nav items to probe
    const subNavItems = [
      { text: 'Questionnaire',  shot: '09-questionnaire.png'  },
      { text: 'Réunions',       shot: '10-meetings.png'        },
      { text: 'Cahier',         shot: '11-cahier.png'          },
      { text: 'Tâches',         shot: '12-workpackages.png'    },
      { text: 'Membres',        shot: '13-members.png'         },
    ];

    for (const item of subNavItems) {
      setStage(`project-subnav-${item.text}`);
      const link = page.locator(`a, [role="menuitem"]`).filter({ hasText: new RegExp(item.text, 'i') }).first();
      if (await link.count() > 0) {
        try {
          await link.click({ timeout: 5000 });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(700);
          await shot(item.shot);
          PASS(`project subnav "${item.text}"`, page.url());
        } catch (e) {
          FAIL('LOW', `project subnav "${item.text}" click threw: ${e.message.slice(0, 100)}`);
          await shot(item.shot);
        }
      } else {
        NOTE(`project subnav "${item.text}" link not found in DOM`);
      }
    }
  } else {
    NOTE('No projects found in /pm/projects — skipping project detail probe');
    await shot('08-no-projects.png');
  }

} catch (err) {
  FAIL('CRITICAL', `Unhandled error at stage ${state.stage}: ${err.message}`);
  await page.screenshot({ path: `${SHOTS}/error-crash.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

// ─── Report ────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════');
console.log('PM DASHBOARD BASELINE — FINAL REPORT');
console.log('════════════════════════════════════════════════════');

// Passed
console.log(`\nPASSED (${passed.length}):`);
for (const p of passed) {
  console.log(`  ✔ [${p.stage}] ${p.label}${p.detail ? ' — ' + p.detail : ''}`);
}

// Findings grouped by severity
const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'WARN', 'INFO'];
const bySeverity = {};
for (const f of findings) {
  (bySeverity[f.severity] ??= []).push(f);
}
console.log(`\nFINDINGS (${findings.length}):`);
for (const sev of severityOrder) {
  const group = bySeverity[sev] ?? [];
  if (!group.length) continue;
  console.log(`\n  ${sev} (${group.length}):`);
  for (const f of group) {
    console.log(`    [${f.stage}] ${f.kind}: ${f.msg}`);
  }
}

console.log('\n════════════════════════════════════════════════════\n');
