#!/usr/bin/env node
// Fill the questionnaire on an existing project as the PM, then trigger
// cahier-des-charges generation and verify the saved cahier renders inline.
import { chromium } from '../web/Front/customapp/node_modules/playwright/index.mjs';

const ROOT = 'https://neoleadge.pythagore-init.com';
const PROJECT_ID = process.argv[2] || '6eb94bd4-8cf4-42a1-b2b5-dc8e2a2a3015';

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const events = [];
const state = { stage: 'init' };
const setStage = (s) => { state.stage = s; log(`── ${s} ──`); };

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'log' || t === 'debug' || t === 'info') return;
  events.push({ stage: state.stage, kind: t, text: msg.text() });
});
page.on('pageerror', (err) => events.push({ stage: state.stage, kind: 'pageerror', text: err.message }));
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('googleapis') || url.includes('gstatic')) return;
  const errTxt = req.failure()?.errorText || '';
  // ERR_ABORTED is just navigation cancelling in-flight requests — not a real failure.
  if (errTxt === 'net::ERR_ABORTED') return;
  events.push({ stage: state.stage, kind: 'reqfail', text: `${req.method()} ${url} — ${errTxt}` });
});
page.on('response', (resp) => {
  const s = resp.status();
  const u = resp.url();
  if (s >= 400 && !u.match(/\.(js|css|png|jpg|svg|ico|woff|woff2|map)(\?|$)/)) {
    events.push({ stage: state.stage, kind: 'http' + s, text: u });
  }
});

// ── 1. Sign in as PM ──
setStage('pm-login');
await page.goto(ROOT + '/');
await page.waitForLoadState('networkidle');
await page.locator('button:has-text("Chef de projet")').first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
log('after-login URL:', page.url());

// ── 2. Open the questionnaire ──
setStage('questionnaire-open');
await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/questionnaire`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// ── 3. Fill the 5 required fields by placeholder match ──
setStage('questionnaire-fill');
const fills = [
  ['Contexte et problématique',
   'Le client NeoLeadge souhaite déployer un système de gestion de projet collaboratif pour ses équipes ' +
   'afin de remplacer un outil legacy manquant de fonctionnalités modernes (Gantt, Kanban, IA).'],
  ['Objectif du projet et résultats attendus',
   'Mettre en place une plateforme web fonctionnelle, sécurisée et scalable, livrée en juin 2026, ' +
   'avec une adoption immédiate par les 50 utilisateurs cibles.'],
  ['Périmètre fonctionnel (modules à développer)',
   'Authentification SSO ; gestion des projets ; questionnaire dynamique ; génération automatique de cahier des charges ; ' +
   'work packages ; Gantt ; Kanban ; analytics ; notifications temps réel.'],
  ['Stack technique proposée',
   'Frontend Vue 3 + Vite + NeoLibrary (PrimeVue) ; Backend NestJS 11 + Prisma 7 + PostgreSQL 16 ; ' +
   'Socket.IO pour le temps réel ; AI provider OpenAI / Z.AI ; déploiement Docker + Caddy.'],
  ['Livrables attendus',
   'Application web déployée ; documentation technique et utilisateur ; cahier des charges signé ; ' +
   'rapport de tests E2E ; formation des utilisateurs clés.'],
];

for (const [placeholder, value] of fills) {
  const input = page.locator(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`).first();
  if (await input.count() === 0) {
    log(`!! missing field: ${placeholder}`);
    events.push({ stage: state.stage, kind: 'missing-field', text: placeholder });
    continue;
  }
  await input.fill(value);
  log(`filled "${placeholder}" (${value.length} chars)`);
}

// ── 4. Click "Enregistrer" — should now be enabled ──
setStage('questionnaire-save');
const saveBtn = page.locator('button:has-text("Enregistrer")').first();
const enabled = await saveBtn.isEnabled().catch(() => false);
log(`save button enabled: ${enabled}`);
if (!enabled) {
  events.push({ stage: state.stage, kind: 'save-disabled', text: 'Enregistrer button never enabled' });
} else {
  await saveBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  log('questionnaire saved');
}

// ── 5. Navigate to cahier and click "Générer le cahier" ──
setStage('cahier-open');
await page.goto(`${ROOT}/app/pm/projects/${PROJECT_ID}/cahier`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

setStage('cahier-generate');
const genBtn = page.locator(
  'button:has-text("Générer le cahier"), button:has-text("Régénérer")'
).first();
const genEnabled = await genBtn.isEnabled().catch(() => false);
log(`cahier generate button enabled: ${genEnabled}`);
state.cahierGenEnabled = genEnabled;
if (!genEnabled) {
  events.push({ stage: state.stage, kind: 'gen-disabled', text: 'Générer button never enabled' });
} else {
  log('clicking "Générer le cahier" — waiting for AI generation (up to 3 min)…');
  await genBtn.click();

  // Wait for either: success state ("Cahier des charges enregistré") or error
  const successLocator = page.locator(':text("Cahier des charges enregistré")').first();
  const errorLocator = page.locator('.cahier-error, :text("Erreur lors de la génération")').first();

  const startedAt = Date.now();
  let outcome = 'timeout';
  while (Date.now() - startedAt < 180_000) {
    if (await successLocator.count() > 0 && await successLocator.isVisible().catch(() => false)) {
      outcome = 'success';
      break;
    }
    if (await errorLocator.count() > 0 && await errorLocator.isVisible().catch(() => false)) {
      outcome = 'error';
      break;
    }
    await page.waitForTimeout(2000);
  }
  state.cahierOutcome = outcome;
  state.cahierElapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log(`cahier outcome: ${outcome} after ${state.cahierElapsedSec}s`);

  // Capture some of the rendered cahier content as proof it stuck
  if (outcome === 'success') {
    const visibleSections = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.cahier-doc-section__title, .cahier-doc-h'))
        .map((e) => e.textContent.trim());
      return titles.slice(0, 20);
    });
    state.cahierVisibleSections = visibleSections;
    log(`rendered sections: ${visibleSections.length}`);
  }
}

// ── 6. Reload page → verify saved cahier persists in the tab ──
setStage('cahier-reload-persistence');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const persistedTag = page.locator(':text("Cahier des charges enregistré"), :text("Enregistré")').first();
state.cahierPersistsAfterReload = await persistedTag.count() > 0;
log(`cahier persists after reload: ${state.cahierPersistsAfterReload}`);

// ── Report ──
const dedup = {};
for (const m of events) {
  const key = m.stage + '::' + m.kind + '::' + (m.text || '').slice(0, 300);
  if (!dedup[key]) dedup[key] = { ...m, count: 0 };
  dedup[key].count += 1;
}
const out = Object.values(dedup).sort((a, b) => (b.count - a.count) || a.stage.localeCompare(b.stage));
console.error(`>> distinct events: ${out.length} | total: ${events.length}`);
console.log(JSON.stringify({ state, events: out }, null, 2));

await browser.close();
