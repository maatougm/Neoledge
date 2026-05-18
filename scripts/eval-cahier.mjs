#!/usr/bin/env node
/**
 * Cahier-des-charges evaluation harness for NeoLeadge.
 *
 * Loads every fixture under `tests/eval/cahier-dataset/*`, drives the live
 * backend through admin APIs to create a temp project, seed questionnaire
 * answers + transcripts, then calls /cahier-des-charges/preview to get the
 * AI output. Scores each output on three axes:
 *   (a) fact-grounding     — % of mustMention strings present
 *   (b) anti-hallucination — % of mustNotMention strings absent
 *   (c) French style       — LLM-judge call (Z.AI glm-4.5-air) returning 1-10
 *
 * Aggregate score per fixture is weighted 50/30/20.
 * Suite-wide weighted average is emitted to docs/AI_EVAL.md.
 *
 * Exit 0 if suite >= 80, exit 1 otherwise (CI-suitable).
 *
 * Required env vars:
 *   EVAL_BACKEND_URL     base URL of the backend (e.g. https://neoleadge.pythagore-init.com)
 *   EVAL_PM_EMAIL        admin email used to drive the API (Admin role bypasses ProjectAccessGuard)
 *   EVAL_PM_PASSWORD     admin password
 *   EVAL_LLM_BASE_URL    LLM-judge base URL (e.g. https://api.z.ai/api/coding/paas/v4)
 *   EVAL_LLM_API_KEY     LLM-judge API key
 *
 * Optional env vars:
 *   EVAL_LLM_JUDGE_MODEL judge model name (defaults to glm-4.5-air — MUST differ from cahier model)
 *   EVAL_FIXTURE_FILTER  substring filter to run a single fixture (e.g. "01-ged-rich")
 *   EVAL_SKIP_CLEANUP    if set to "1", leaves the temp projects in place for debugging
 *   EVAL_SUITE_THRESHOLD pass/fail threshold for exit code (default: 80)
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

// ─── Config ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const DATASET_DIR = resolve(REPO_ROOT, 'tests/eval/cahier-dataset')
const REPORT_PATH = resolve(REPO_ROOT, 'docs/AI_EVAL.md')

const BACKEND_URL = (process.env.EVAL_BACKEND_URL ?? 'https://neoleadge.pythagore-init.com').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.EVAL_PM_EMAIL ?? 'admin@neoleadge.com'
const ADMIN_PASSWORD = process.env.EVAL_PM_PASSWORD ?? 'Admin@123'

const JUDGE_BASE_URL = (process.env.EVAL_LLM_BASE_URL ?? 'https://api.z.ai/api/coding/paas/v4').replace(/\/$/, '')
const JUDGE_API_KEY = process.env.EVAL_LLM_API_KEY ?? ''
const JUDGE_MODEL = process.env.EVAL_LLM_JUDGE_MODEL ?? 'glm-4.5-air'

const FIXTURE_FILTER = process.env.EVAL_FIXTURE_FILTER ?? ''
const SKIP_CLEANUP = process.env.EVAL_SKIP_CLEANUP === '1'
const SUITE_THRESHOLD = Number(process.env.EVAL_SUITE_THRESHOLD ?? 80)

// Models we are JUDGING — judge must be different from any of these.
const CAHIER_MODELS_BLOCKLIST = new Set(['glm-5-turbo', 'gpt-4o-mini', 'gpt-4o'])
if (CAHIER_MODELS_BLOCKLIST.has(JUDGE_MODEL)) {
  console.error(
    `FATAL: EVAL_LLM_JUDGE_MODEL=${JUDGE_MODEL} is in the cahier model blocklist. ` +
      `Use glm-4.5 or glm-4.5-air (or any other distinct model) to avoid self-flattery.`
  )
  process.exit(2)
}

// ─── Utils ───────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 19)
const log = (...args) => console.error(`[${ts()}]`, ...args)

function getCommitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

/** Wraps fetch with timeout + JSON parsing + error narrowing. */
async function api(method, path, { token, body, timeoutMs = 30_000 } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const url = `${BACKEND_URL}${path}`
  const ctrl = AbortSignal.timeout(timeoutMs)
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: ctrl,
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 500 ? text.slice(0, 500) + '…' : text
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${snippet}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function login() {
  const r = await api('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    timeoutMs: 15_000,
  })
  if (!r || typeof r !== 'object' || !('jwt' in r)) {
    throw new Error(`Login did not return a JWT — got: ${JSON.stringify(r).slice(0, 200)}`)
  }
  return r.jwt
}

async function findProjectManager(token) {
  const users = await api('GET', '/pm/users', { token })
  if (!Array.isArray(users)) throw new Error('Expected /pm/users to return an array')
  const pm = users.find((u) => u && u.role === 'ProjectManager' && u.isActive)
  if (!pm) throw new Error('No active ProjectManager user available on the live server')
  return pm
}

// ─── Fixture loader ──────────────────────────────────────────────────────────

function loadFixtures() {
  const entries = readdirSync(DATASET_DIR)
    .filter((e) => {
      try {
        return statSync(join(DATASET_DIR, e)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()

  const out = []
  for (const name of entries) {
    if (FIXTURE_FILTER && !name.includes(FIXTURE_FILTER)) continue
    const inputPath = join(DATASET_DIR, name, 'input.json')
    const expectedPath = join(DATASET_DIR, name, 'expected.json')
    let input, expected
    try {
      input = JSON.parse(readFileSync(inputPath, 'utf8'))
      expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
    } catch (e) {
      log(`!! skipping ${name}: ${e.message}`)
      continue
    }
    out.push({ name, input, expected })
  }
  return out
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/**
 * Create a temp project, then seed questionnaire field values + transcripts.
 * Returns { projectId }.
 */
async function seedProject(token, pm, fixture) {
  // 1. Create the project — admin endpoint requires a real ProjectManager.
  const projectName = `${fixture.input.projectName} [${Date.now().toString().slice(-6)}]`
  const startDate = new Date()
  const endDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) // +6 months
  const dto = {
    name: projectName.slice(0, 200),
    clientName: String(fixture.input.clientName ?? 'EVAL Client').slice(0, 200),
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    projectManagerId: pm.id,
  }
  const created = await api('POST', '/admin/project', { token, body: dto, timeoutMs: 20_000 })
  const projectId = created?.id
  if (!projectId) throw new Error(`Project creation did not return an id: ${JSON.stringify(created).slice(0, 200)}`)
  log(`  ▸ project created: ${projectId}`)

  // 2. Fetch the auto-created fields (the backend pre-seeds 7 static fields).
  const project = await api('GET', `/admin/project/${projectId}`, { token })
  const projectFields = Array.isArray(project?.fields) ? project.fields : []

  // 3. Match fixture field labels to existing field IDs by case-insensitive
  //    label match; create any extras via /admin/project/:id/fields.
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const valueWrites = []
  for (const fx of fixture.input.fields ?? []) {
    if (!fx.label) continue
    const match = projectFields.find((pf) => norm(pf.label) === norm(fx.label))
    let fieldId = match?.id
    if (!fieldId) {
      // Create the extra field on the project
      const addBody = { label: fx.label.slice(0, 200), fieldType: 'Text', isRequired: false }
      const added = await api('POST', `/admin/project/${projectId}/fields`, { token, body: addBody })
      fieldId = added?.id ?? added?.fieldId
      if (!fieldId) {
        log(`  !! could not create extra field "${fx.label}" — skipping`)
        continue
      }
    }
    valueWrites.push({ projectFieldId: fieldId, value: String(fx.value ?? '').slice(0, 10000) })
  }

  if (valueWrites.length > 0) {
    await api('PATCH', `/pm/projects/${projectId}/field-values`, {
      token,
      body: { fieldValues: valueWrites },
    })
    log(`  ▸ wrote ${valueWrites.length} field value(s)`)
  }

  // 4. Seed each transcript as a "live meeting" save call. The endpoint
  //    requires >= 20 chars; we synthesise a transcript from summary +
  //    decisions to give the AI enough substance.
  for (const tx of fixture.input.transcripts ?? []) {
    const segments = []
    if (tx.summary) segments.push(`Animateur: ${tx.summary}`)
    if (tx.decisions) segments.push(`Animateur: ${tx.decisions}`)
    const text = segments.join('\n').trim()
    if (text.length < 30) continue
    try {
      await api('POST', `/pm/projects/${projectId}/meetings/live/save`, {
        token,
        body: {
          title: String(tx.title ?? 'Réunion').slice(0, 200),
          transcript: text.slice(0, 100_000),
          durationSeconds: 1800,
        },
        timeoutMs: 30_000,
      })
    } catch (e) {
      log(`  !! transcript "${tx.title}" failed to seed: ${e.message}`)
    }
  }

  return { projectId }
}

// ─── Cahier preview + scoring ────────────────────────────────────────────────

async function getCahierPreview(token, projectId) {
  // The cahier generation is slow (~110s on Z.AI) — give it a generous timeout.
  return api('GET', `/pm/projects/${projectId}/cahier-des-charges/preview`, {
    token,
    timeoutMs: 240_000,
  })
}

/** Convert the aiContent (9-key JSON) into a flat searchable string. */
function flattenCahier(aiContent) {
  if (!aiContent || typeof aiContent !== 'object') return ''
  const parts = []
  for (const [key, val] of Object.entries(aiContent)) {
    parts.push(`# ${key}`)
    if (typeof val === 'string') parts.push(val)
    else if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          if ('title' in item) parts.push(String(item.title))
          if ('content' in item) parts.push(String(item.content))
        } else {
          parts.push(String(item))
        }
      }
    } else if (val && typeof val === 'object') {
      parts.push(JSON.stringify(val))
    }
  }
  return parts.join('\n')
}

function scoreFactGrounding(haystack, mustMention) {
  if (!mustMention || mustMention.length === 0) return { score: 100, hits: [], misses: [] }
  const lc = haystack.toLowerCase()
  const hits = []
  const misses = []
  for (const term of mustMention) {
    const t = String(term).toLowerCase().trim()
    if (!t) continue
    if (lc.includes(t)) hits.push(term)
    else misses.push(term)
  }
  const total = hits.length + misses.length
  const score = total === 0 ? 100 : Math.round((hits.length / total) * 100)
  return { score, hits, misses }
}

function scoreAntiHallucination(haystack, mustNotMention) {
  if (!mustNotMention || mustNotMention.length === 0) return { score: 100, leaks: [], clean: [] }
  const lc = haystack.toLowerCase()
  const leaks = []
  const clean = []
  for (const term of mustNotMention) {
    const t = String(term).toLowerCase().trim()
    if (!t) continue
    if (lc.includes(t)) leaks.push(term)
    else clean.push(term)
  }
  const total = leaks.length + clean.length
  const score = total === 0 ? 100 : Math.round((clean.length / total) * 100)
  return { score, leaks, clean }
}

function scoreRequiredSections(aiContent, required) {
  if (!aiContent || typeof aiContent !== 'object') {
    return { score: 0, missing: required ?? [], present: [] }
  }
  const present = []
  const missing = []
  for (const section of required ?? []) {
    const v = aiContent[section]
    const ok =
      v !== null &&
      v !== undefined &&
      (typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : true)
    if (ok) present.push(section)
    else missing.push(section)
  }
  return { score: required?.length ? Math.round((present.length / required.length) * 100) : 100, missing, present }
}

// ─── LLM judge ───────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `Tu es un évaluateur professionnel de cahiers des charges contractuels français. On va te montrer un cahier des charges généré automatiquement. Tu dois lui attribuer une note de 1 à 10 sur deux critères combinés :
1. Professionnalisme du français (grammaire, vocabulaire métier, registre contractuel).
2. Cohérence et structuration (pas de répétitions, pas de "À définir" évitable, pas de hallucinations évidentes, sections bien articulées).

Retourne UNIQUEMENT un JSON compact, sans markdown :
{"score": <int 1-10>, "justification": "<une phrase max 200 caractères>"}

Échelle : 1-3 = inacceptable, 4-5 = médiocre, 6-7 = correct, 8-9 = très bon, 10 = excellent.`

async function callJudge(cahierJson) {
  if (!JUDGE_API_KEY) {
    return { score: null, justification: 'EVAL_LLM_API_KEY not set — judge skipped', skipped: true }
  }
  // Truncate to avoid blowing the judge's context — 12K chars is ample.
  const flat = flattenCahier(cahierJson).slice(0, 12_000)
  const payload = {
    model: JUDGE_MODEL,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: `Cahier à évaluer :\n\n${flat}` },
    ],
    temperature: 0.2,
    max_tokens: 256,
    response_format: { type: 'json_object' },
  }
  let resp
  try {
    resp = await fetch(`${JUDGE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JUDGE_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (e) {
    return { score: null, justification: `judge fetch failed: ${e.message}`, skipped: true }
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    return {
      score: null,
      justification: `judge HTTP ${resp.status}: ${t.slice(0, 120)}`,
      skipped: true,
    }
  }
  const data = await resp.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content ?? ''
  // Strip code fences just in case
  let raw = String(content).trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(raw)
    const score = Number(parsed.score)
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      return { score: null, justification: `judge returned non-numeric score: ${raw.slice(0, 120)}`, skipped: true }
    }
    return {
      score: Math.round(score),
      justification: String(parsed.justification ?? '').slice(0, 200),
      skipped: false,
    }
  } catch (e) {
    return { score: null, justification: `judge parse failed: ${e.message}`, skipped: true }
  }
}

// ─── Per-fixture run ─────────────────────────────────────────────────────────

async function runFixture(token, pm, fixture) {
  log(`── ${fixture.name} ──`)
  const seed = await seedProject(token, pm, fixture)
  let aiContent = null
  let preview = null
  let error = null
  try {
    log(`  ▸ requesting cahier preview (this can take ~110s)…`)
    const t0 = Date.now()
    preview = await getCahierPreview(token, seed.projectId)
    aiContent = preview?.aiContent ?? null
    log(`  ✓ preview returned in ${Math.round((Date.now() - t0) / 1000)}s`)
  } catch (e) {
    error = e.message
    log(`  !! preview failed: ${error}`)
  } finally {
    if (!SKIP_CLEANUP) {
      try {
        await api('DELETE', `/admin/project/${seed.projectId}`, { token })
        log(`  ▸ cleaned up project ${seed.projectId}`)
      } catch (e) {
        log(`  !! cleanup failed: ${e.message}`)
      }
    }
  }

  if (!aiContent) {
    return {
      fixture: fixture.name,
      projectId: seed.projectId,
      error: error ?? 'no aiContent returned',
      factGrounding: { score: 0, hits: [], misses: fixture.expected.mustMention ?? [] },
      antiHallucination: { score: 0, leaks: [], clean: fixture.expected.mustNotMention ?? [] },
      sections: { score: 0, missing: fixture.expected.requiredSections ?? [], present: [] },
      judge: { score: null, justification: 'preview failed', skipped: true },
      finalScore: 0,
    }
  }

  const flat = flattenCahier(aiContent)
  const factGrounding = scoreFactGrounding(flat, fixture.expected.mustMention ?? [])
  const antiHallucination = scoreAntiHallucination(flat, fixture.expected.mustNotMention ?? [])
  const sections = scoreRequiredSections(aiContent, fixture.expected.requiredSections ?? [])
  log(
    `  ▸ fact-grounding: ${factGrounding.score}%  anti-hallucination: ${antiHallucination.score}%  sections: ${sections.score}%`
  )

  const judge = await callJudge(aiContent)
  log(`  ▸ judge: ${judge.score ?? '—'} (${judge.justification})`)

  // Final weighted score:
  //   50% fact-grounding, 30% anti-hallucination, 20% French-style (judge x10)
  // If judge is skipped, redistribute its weight equally onto the other two so
  // we still emit a meaningful score (60/40 split).
  const judgePct = judge.score === null ? null : judge.score * 10
  let finalScore
  if (judgePct === null) {
    finalScore = Math.round(factGrounding.score * 0.6 + antiHallucination.score * 0.4)
  } else {
    finalScore = Math.round(factGrounding.score * 0.5 + antiHallucination.score * 0.3 + judgePct * 0.2)
  }
  // Section completeness acts as a hard cap — if you're missing required keys
  // your output is unusable regardless of fact coverage.
  finalScore = Math.min(finalScore, sections.score)

  return {
    fixture: fixture.name,
    projectId: seed.projectId,
    factGrounding,
    antiHallucination,
    sections,
    judge,
    finalScore,
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

function renderReport({ results, suiteAverage, modelName, runStartedAt, runDurationSec, commitSha }) {
  const lines = []
  lines.push('# AI evaluation — cahier des charges')
  lines.push('')
  lines.push(`- **Run timestamp:** ${runStartedAt.toISOString()}`)
  lines.push(`- **Duration:** ${runDurationSec}s`)
  lines.push(`- **Backend:** ${BACKEND_URL}`)
  lines.push(`- **Judge model:** \`${JUDGE_MODEL}\` (cahier model under test: \`${modelName}\`)`)
  lines.push(`- **Commit:** \`${commitSha}\``)
  lines.push(`- **Suite weighted average:** **${suiteAverage}/100**`)
  lines.push(`- **Pass threshold:** ${SUITE_THRESHOLD}`)
  lines.push(`- **Verdict:** ${suiteAverage >= SUITE_THRESHOLD ? 'PASS ✅' : 'FAIL ❌'}`)
  lines.push('')
  lines.push('## Per-fixture results')
  lines.push('')
  lines.push('| Fixture | Fact-grounding | Anti-hallucination | Sections | Judge (1-10) | Final | Notes |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const r of results) {
    if (r.error) {
      lines.push(
        `| \`${r.fixture}\` | — | — | — | — | **${r.finalScore}** | ERROR: ${escapeCell(r.error)} |`
      )
      continue
    }
    const fg = `${r.factGrounding.score}% (${r.factGrounding.hits.length}/${r.factGrounding.hits.length + r.factGrounding.misses.length})`
    const ah = `${r.antiHallucination.score}% (${r.antiHallucination.clean.length}/${r.antiHallucination.clean.length + r.antiHallucination.leaks.length})`
    const sec = `${r.sections.score}%`
    const judge = r.judge.score === null ? `— (${escapeCell(r.judge.justification)})` : `${r.judge.score}`
    const notes = []
    if (r.factGrounding.misses.length) notes.push(`missed: ${r.factGrounding.misses.slice(0, 3).join(', ')}`)
    if (r.antiHallucination.leaks.length) notes.push(`leaked: ${r.antiHallucination.leaks.slice(0, 3).join(', ')}`)
    if (r.sections.missing.length) notes.push(`missing sections: ${r.sections.missing.join(', ')}`)
    lines.push(
      `| \`${r.fixture}\` | ${fg} | ${ah} | ${sec} | ${judge} | **${r.finalScore}** | ${escapeCell(notes.join(' · '))} |`
    )
  }
  lines.push('')
  lines.push('## Methodology')
  lines.push('')
  lines.push('Each fixture seeds a temporary project on the live backend, drives the questionnaire + transcripts ' +
    'through the existing admin/PM APIs, then calls `/cahier-des-charges/preview` to obtain the AI output. The output ' +
    'is scored on three axes and combined as a weighted sum:')
  lines.push('')
  lines.push('- **50%** Fact-grounding — `mustMention` strings present (case-insensitive).')
  lines.push('- **30%** Anti-hallucination — `mustNotMention` strings absent.')
  lines.push(`- **20%** French style — judged 1-10 by \`${JUDGE_MODEL}\` (different from the model under test to avoid self-flattery), scaled to /100.`)
  lines.push('')
  lines.push('The final per-fixture score is **capped** by the section-completeness percentage — a cahier missing required ' +
    'top-level keys is treated as unusable regardless of textual coverage.')
  lines.push('')
  lines.push('## Judge justifications')
  lines.push('')
  for (const r of results) {
    if (r.judge?.justification) {
      lines.push(`- **${r.fixture}** — ${r.judge.score ?? '—'}/10 — ${escapeCell(r.judge.justification)}`)
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('Generated by `scripts/eval-cahier.mjs`. To re-run: `node scripts/eval-cahier.mjs` (see `tests/eval/README.md`).')
  lines.push('')
  return lines.join('\n')
}

function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const runStartedAt = new Date()
  log(`Backend: ${BACKEND_URL}`)
  log(`Judge model: ${JUDGE_MODEL} @ ${JUDGE_BASE_URL}`)
  log(`Judge configured: ${JUDGE_API_KEY ? 'yes' : 'NO (skipping French-style score)'}`)

  const fixtures = loadFixtures()
  if (fixtures.length === 0) {
    log(`!! no fixtures found in ${DATASET_DIR}`)
    process.exit(2)
  }
  log(`Loaded ${fixtures.length} fixture(s): ${fixtures.map((f) => f.name).join(', ')}`)

  const token = await login()
  log(`Logged in as ${ADMIN_EMAIL}`)
  const pm = await findProjectManager(token)
  log(`Using ProjectManager ${pm.firstName} ${pm.lastName} (${pm.id})`)

  // The cahier_AI_MODEL setting lives in the server's env — we don't expose it
  // via API. Report it as "see backend env (CAHIER_AI_MODEL or fallback)".
  const modelName = process.env.EVAL_REPORTED_CAHIER_MODEL ?? 'glm-5-turbo (Z.AI primary or fallback — see backend env)'

  const results = []
  for (const fx of fixtures) {
    try {
      const r = await runFixture(token, pm, fx)
      results.push(r)
    } catch (e) {
      log(`!! fixture ${fx.name} crashed: ${e.message}`)
      results.push({
        fixture: fx.name,
        error: e.message,
        factGrounding: { score: 0, hits: [], misses: [] },
        antiHallucination: { score: 0, leaks: [], clean: [] },
        sections: { score: 0, missing: [], present: [] },
        judge: { score: null, justification: 'fixture crashed', skipped: true },
        finalScore: 0,
      })
    }
  }

  const runDurationSec = Math.round((Date.now() - runStartedAt.getTime()) / 1000)
  const suiteAverage = Math.round(results.reduce((a, r) => a + r.finalScore, 0) / results.length)
  const commitSha = getCommitSha()

  const md = renderReport({ results, suiteAverage, modelName, runStartedAt, runDurationSec, commitSha })
  writeFileSync(REPORT_PATH, md, 'utf8')
  log(`Wrote report → ${REPORT_PATH}`)
  log(`Suite weighted average: ${suiteAverage}/100 (threshold: ${SUITE_THRESHOLD})`)

  // Also print a compact JSON line for CI log parsing.
  console.log(
    JSON.stringify(
      {
        suiteAverage,
        threshold: SUITE_THRESHOLD,
        passed: suiteAverage >= SUITE_THRESHOLD,
        fixtures: results.map((r) => ({ name: r.fixture, score: r.finalScore, error: r.error ?? null })),
        runDurationSec,
        commitSha,
      },
      null,
      2
    )
  )

  process.exit(suiteAverage >= SUITE_THRESHOLD ? 0 : 1)
}

main().catch((e) => {
  console.error(`FATAL: ${e.stack ?? e.message ?? e}`)
  process.exit(2)
})
