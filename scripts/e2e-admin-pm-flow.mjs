#!/usr/bin/env node
// End-to-end smoke test against the live test server.
// 1. Sign in as admin → create a template → create a project assigned to a PM
// 2. Sign out, sign in as PM → walk the project workflow
// Captures console errors/warnings + network failures throughout.
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const ADMIN = { email: 'admin@neoleadge.com', password: 'Admin@123' };
const PM    = { email: 'pm@neoleadge.com',    password: 'Pm@12345'  };

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const events = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  events.push({ stage: state.stage, kind: t, text: msg.text() });
});
page.on('pageerror', (err) => events.push({ stage: state.stage, kind: 'pageerror', text: err.message }));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('googleapis') || url.includes('gstatic')) return;
  events.push({ stage: state.stage, kind: 'reqfail', text: `${req.method()} ${url} — ${req.failure()?.errorText}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s >= 400 && !u.match(/\.(js|css|png|jpg|svg|ico|woff|woff2|map)(\?|$)/)) {
    events.push({ stage: state.stage, kind: 'http' + s, text: u });
  }
});

const state = { stage: 'init' };
const setStage = (s) => { state.stage = s; log(`── ${s} ──`); };

async function loginViaForm({ email, password }) {
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // Try quick-login button matching the email role first.
  const quickBtns = await page.locator('button').elementHandles();
  for (const btn of quickBtns) {
    const txt = (await btn.innerText().catch(() => '') || '').trim();
    if (email === ADMIN.email && /admin/i.test(txt) && !/connect/i.test(txt)) {
      log(`quick-login: clicking "${txt}"`);
      await btn.click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
    if (email === PM.email && /chef de projet|project manager|^pm$/i.test(txt) && !/connect/i.test(txt)) {
      log(`quick-login: clicking "${txt}"`);
      await btn.click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
  // Fall back to typing into form
  log('falling back to email/password form');
  const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]').first();
  const pwInput    = page.locator('input[type="password"]').first();
  await emailInput.fill(email);
  await pwInput.fill(password);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click(),
  ]);
  await page.waitForTimeout(2000);
}

async function logout() {
  // Drop tokens and reload — simplest reliable signout in this app.
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.context().clearCookies();
  await page.goto(ROOT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
}

async function snapButtonsContaining(locatorRoot, label) {
  const btns = await locatorRoot.locator('button').elementHandles();
  const out = [];
  for (const b of btns) {
    const t = (await b.innerText().catch(() => '') || '').trim();
    if (t.toLowerCase().includes(label.toLowerCase())) out.push({ handle: b, text: t });
  }
  return out;
}

// ─── 1. ADMIN: login + template + project ────────────────────────────────────
try {
  setStage('admin-login');
  await loginViaForm(ADMIN);
  log('after-admin-login URL:', page.url());

  // ── Create a template ──
  setStage('admin-templates');
  await page.goto(ROOT + '/app/admin/templates', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  const newTplBtn = page.locator('button:has-text("Nouveau"), button:has-text("Ajouter"), button:has-text("Créer")').first();
  if (await newTplBtn.count() > 0) {
    log('opening "new template" dialog');
    await newTplBtn.click();
    await page.waitForTimeout(1000);
    const nameInput = page.locator('input[placeholder*="om" i], input[name="name"], input[type="text"]').first();
    const tplName = `E2E Template ${Date.now().toString().slice(-6)}`;
    await nameInput.fill(tplName);
    // Try to submit
    const submitBtn = page.locator('button:has-text("Enregistrer"), button:has-text("Créer"), button:has-text("Sauvegarder")').last();
    await submitBtn.click().catch((e) => events.push({ stage: state.stage, kind: 'click-fail', text: e.message }));
    await page.waitForTimeout(2000);
    log(`template created: ${tplName}`);
    state.tplName = tplName;
  } else {
    log('no "create template" button visible — skipping template creation');
  }

  // ── Create a project assigned to the PM ──
  setStage('admin-projects');
  await page.goto(ROOT + '/app/admin/projects', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  const newProjBtn = page.locator('button:has-text("Nouveau projet")').first();
  if (await newProjBtn.count() === 0) {
    log('!! no "Nouveau projet" button on /app/admin/projects');
  } else {
    log('opening "new project" form');
    await newProjBtn.click();
    await page.waitForTimeout(1500);

    const projName = `E2E Project ${Date.now().toString().slice(-6)}`;
    state.projName = projName;

    // Fields are NeoInputText / NeoDatePicker / NeoSelect.
    // The labels use htmlFor="neo-field-N" but the input doesn't have that id —
    // the input lives inside the next-sibling wrapper of the label.
    const fieldByLabel = (lbl) =>
      page.locator(
        `xpath=//label[contains(normalize-space(),"${lbl}")]/following-sibling::*[1]//input` +
        ` | //label[contains(normalize-space(),"${lbl}")]/following-sibling::input[1]`
      ).first();

    await fieldByLabel('Nom du projet').fill(projName);
    await fieldByLabel('Nom du client').fill('E2E Client ACME');

    const startInput = fieldByLabel('Date de début');
    await startInput.click();
    await startInput.fill('01/05/2026');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const endInput = fieldByLabel('Date de fin');
    await endInput.click();
    await endInput.fill('30/06/2026');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // PM picker — NeoSelect: the trigger is a sibling/descendant after the
    // "Chef de projet" label. PrimeVue uses .p-select with role="combobox".
    log('opening PM dropdown');
    const pmTrigger = page
      .locator(
        'xpath=//label[contains(normalize-space(),"Chef de projet")]/following-sibling::*[1]' +
        '//*[@role="combobox" or contains(@class,"p-select") or contains(@class,"neo-select")]' +
        ' | //label[contains(normalize-space(),"Chef de projet")]/following-sibling::*[1]'
      )
      .first();
    await pmTrigger.click();
    await page.waitForTimeout(700);

    const pmOptionLocator = page.locator(
      '[role="option"]:has-text("pm@"), [role="option"]:has-text("Project Manager"), [role="option"]:has-text("PM"), li:has-text("pm@neoleadge.com")'
    ).first();
    if (await pmOptionLocator.count() > 0) {
      const txt = await pmOptionLocator.innerText().catch(() => '');
      await pmOptionLocator.click();
      log(`PM picked: "${txt.slice(0, 60).replace(/\n/g, ' | ')}"`);
    } else {
      const anyOpt = page.locator('[role="option"]').first();
      if (await anyOpt.count() > 0) {
        const t = await anyOpt.innerText().catch(() => '');
        await anyOpt.click();
        log(`PM fallback picked: "${t.slice(0, 60).replace(/\n/g, ' | ')}"`);
      } else {
        log('!! no PM options visible');
      }
    }
    await page.waitForTimeout(500);

    // Submit
    const submit = page.locator('button:has-text("Créer le projet")').first();
    if (await submit.count() === 0) {
      log('!! no "Créer le projet" submit button');
    } else {
      const enabled = await submit.isEnabled().catch(() => false);
      log(`submit enabled: ${enabled}`);
      await submit.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      log(`project create submitted: ${projName}`);

      // Verify by searching the table for the new project name
      const row = page.locator(`tr:has-text("${projName}")`).first();
      const found = await row.count() > 0;
      log(`project row visible after create: ${found}`);
      state.projectCreated = found;
    }
  }
} catch (e) {
  events.push({ stage: state.stage, kind: 'flow-fail', text: e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n') });
}

// ─── 2. PM: login + walk workflow ────────────────────────────────────────────
try {
  setStage('pm-logout');
  await logout();

  setStage('pm-login');
  await loginViaForm(PM);
  log('after-pm-login URL:', page.url());

  setStage('pm-projects');
  await page.goto(ROOT + '/app/pm/projects', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Click the freshly-created E2E project if visible, else the first card.
  setStage('pm-open-project');
  const namedCard = state.projName
    ? page.locator(`.project-card:has-text("${state.projName}")`).first()
    : null;
  const card = namedCard && (await namedCard.count()) > 0
    ? namedCard
    : page.locator('.project-card, [class*="project-card"]').first();
  if (await card.count() > 0) {
    log(`opening card: ${(await card.innerText().catch(() => '')).slice(0, 60).replace(/\n/g, ' | ')}`);
    await card.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    log('after-card-click URL:', page.url());
  } else {
    log('!! no project card visible to PM');
  }

  // ── PM module walk: questionnaire → cahier → validations → workpackages → gantt ──
  const projUrl = page.url().replace(/\/+$/, '');
  const m = projUrl.match(/\/app\/pm\/projects\/([^/?]+)/);
  if (m) {
    const id = m[1];
    log('project id:', id);
    state.projectId = id;
    const modules = [
      ['questionnaire',  `/app/pm/projects/${id}/questionnaire`],
      ['cahier',         `/app/pm/projects/${id}/cahier`],
      ['validations',    `/app/pm/projects/${id}/validations`],
      ['meetings',       `/app/pm/projects/${id}/meetings`],
      ['workpackages',   `/app/pm/projects/${id}/workpackages`],
      ['gantt',          `/app/pm/projects/${id}/gantt`],
      ['board',          `/app/pm/projects/${id}/board`],
      ['backlogs',       `/app/pm/projects/${id}/backlogs`],
      ['sprint',         `/app/pm/projects/${id}/sprint`],
      ['wiki',           `/app/pm/projects/${id}/wiki`],
      ['budget',         `/app/pm/projects/${id}/budget`],
      ['time',           `/app/pm/projects/${id}/time`],
      ['members',        `/app/pm/projects/${id}/members`],
      ['activity',       `/app/pm/projects/${id}/activity`],
    ];
    for (const [name, url] of modules) {
      setStage(`pm-${name}`);
      try {
        await page.goto(ROOT + url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
      } catch (e) {
        events.push({ stage: state.stage, kind: 'navfail', text: e.message });
      }
    }

    // Try generating cahier (button click)
    setStage('pm-cahier-generate');
    await page.goto(ROOT + `/app/pm/projects/${id}/cahier`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const genBtn = page.locator('button:has-text("Générer le cahier"), button:has-text("Régénérer")').first();
    if (await genBtn.count() > 0 && await genBtn.isEnabled().catch(() => false)) {
      log('clicking cahier "Générer"');
      await genBtn.click();
      // Wait up to 60s for generation
      await page.waitForTimeout(60000);
      const saved = page.locator(':has-text("Cahier des charges enregistré"), :has-text("Cahier des charges généré")').first();
      const found = await saved.count() > 0;
      log('cahier saved tag visible:', found);
    } else {
      log('cahier generate button not visible/enabled');
    }
  }
} catch (e) {
  events.push({ stage: state.stage, kind: 'flow-fail', text: e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n') });
}

// ─── Report ──────────────────────────────────────────────────────────────────
const dedup = {};
for (const m of events) {
  const key = m.stage + '::' + m.kind + '::' + (m.text || '').slice(0, 300);
  if (!dedup[key]) dedup[key] = { ...m, count: 0 };
  dedup[key].count += 1;
}
const out = Object.values(dedup).sort((a, b) => (b.count - a.count) || a.stage.localeCompare(b.stage));
console.error(`>> distinct events: ${out.length} | total: ${events.length}`);
console.log(JSON.stringify({
  state,
  events: out,
}, null, 2));

await browser.close();
