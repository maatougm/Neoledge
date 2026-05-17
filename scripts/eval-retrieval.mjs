#!/usr/bin/env node
/**
 * Phase 4 — retrieval eval harness for the pgvector semantic tools.
 *
 * Reuses the cahier eval fixture-loading + seeding helpers so we don't
 * duplicate test data. For each golden query in
 * `scripts/fixtures/retrieval-golden.json`:
 *   1. Look up the seeded project by fixture name (or seed it now).
 *   2. POST to /admin/eval/retrieval/batch with that fixture's queries.
 *   3. Score each hit list: did any top-K hit contain a `mustContain` substring?
 *
 * Metrics:
 *   - recall@5  — fraction of queries that returned a matching hit in top-5
 *   - recall@10 — same, top-10
 *   - MRR       — mean reciprocal rank of the first matching hit
 *   - p95Latency — 95th percentile retrieval latency
 *
 * Exit 0 if recall@5 ≥ RETRIEVAL_RECALL_THRESHOLD (default 0.70), exit 1 otherwise.
 *
 * Required env vars:
 *   EVAL_BACKEND_URL   base URL of the backend
 *   EVAL_PM_EMAIL      admin email
 *   EVAL_PM_PASSWORD   admin password
 *
 * Optional:
 *   RETRIEVAL_RECALL_THRESHOLD  pass/fail threshold (default 0.70)
 *   EVAL_SEED_WAIT_MS           ms to wait after seeding before querying (default 8000)
 *   EVAL_FIXTURE_FILTER         substring filter on fixture name
 *   EVAL_SKIP_CLEANUP=1         leave the temp projects behind
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const DATASET_DIR = resolve(REPO_ROOT, 'tests/eval/cahier-dataset')
const GOLDEN_PATH = resolve(__dirname, 'fixtures/retrieval-golden.json')
const REPORT_PATH = resolve(REPO_ROOT, 'docs/AI_EVAL_RETRIEVAL.md')

const BACKEND_URL = (process.env.EVAL_BACKEND_URL ?? 'https://neoleadge.pythagore-init.com').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.EVAL_PM_EMAIL ?? 'admin@neoleadge.com'
const ADMIN_PASSWORD = process.env.EVAL_PM_PASSWORD ?? 'Admin@123'

const SEED_WAIT_MS = Number(process.env.EVAL_SEED_WAIT_MS ?? 8000)
const FIXTURE_FILTER = process.env.EVAL_FIXTURE_FILTER ?? ''
const SKIP_CLEANUP = process.env.EVAL_SKIP_CLEANUP === '1'
const RECALL_THRESHOLD = Number(process.env.RETRIEVAL_RECALL_THRESHOLD ?? 0.7)

const ts = () => new Date().toISOString().slice(11, 19)
const log = (...args) => console.error(`[${ts()}]`, ...args)

async function api(method, path, { token, body, timeoutMs = 30_000 } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 400 ? text.slice(0, 400) + '…' : text
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${snippet}`)
  }
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

async function login() {
  const r = await api('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    timeoutMs: 15_000,
  })
  if (!r?.jwt) throw new Error('Login did not return a JWT')
  return r.jwt
}

async function findProjectManager(token) {
  const users = await api('GET', '/pm/users', { token })
  if (!Array.isArray(users)) throw new Error('Expected /pm/users to return an array')
  const pm = users.find((u) => u && u.role === 'ProjectManager' && u.isActive)
  if (!pm) throw new Error('No active ProjectManager user available on the live server')
  return pm
}

function loadFixtures() {
  const entries = readdirSync(DATASET_DIR)
    .filter((e) => {
      try { return statSync(join(DATASET_DIR, e)).isDirectory() } catch { return false }
    })
    .sort()
  const out = {}
  for (const name of entries) {
    const inputPath = join(DATASET_DIR, name, 'input.json')
    try {
      out[name] = JSON.parse(readFileSync(inputPath, 'utf8'))
    } catch (e) {
      log(`!! skipping fixture ${name}: ${e.message}`)
    }
  }
  return out
}

/** Seeds a fixture project; same shape as eval-cahier.mjs but inlined to
 *  avoid a hard import dependency. Returns { projectId, fieldIdsByLabel }. */
async function seedProject(token, pm, name, input) {
  const projectName = `${input.projectName} [retr-${Date.now().toString().slice(-6)}]`
  const dto = {
    name: projectName.slice(0, 200),
    clientName: String(input.clientName ?? 'EVAL Client').slice(0, 200),
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 180 * 86_400_000).toISOString(),
    projectManagerId: pm.id,
  }
  const created = await api('POST', '/admin/project', { token, body: dto, timeoutMs: 20_000 })
  if (!created?.id) throw new Error(`Project creation did not return an id for ${name}`)
  const projectId = created.id

  const project = await api('GET', `/admin/project/${projectId}`, { token })
  const existingFields = Array.isArray(project?.fields) ? project.fields : []
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const valueWrites = []
  for (const fx of input.fields ?? []) {
    if (!fx.label) continue
    const match = existingFields.find((pf) => norm(pf.label) === norm(fx.label))
    let fieldId = match?.id
    if (!fieldId) {
      const addBody = { label: fx.label.slice(0, 200), fieldType: 'Text', isRequired: false }
      const added = await api('POST', `/admin/project/${projectId}/fields`, { token, body: addBody })
      fieldId = added?.id ?? added?.fieldId
    }
    if (!fieldId) continue
    valueWrites.push({ projectFieldId: fieldId, value: String(fx.value ?? '').slice(0, 10_000) })
  }
  if (valueWrites.length > 0) {
    await api('PATCH', `/pm/projects/${projectId}/field-values`, {
      token,
      body: { fieldValues: valueWrites },
    })
  }

  for (const tx of input.transcripts ?? []) {
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
      log(`  !! transcript "${tx.title}" failed to seed (${name}): ${e.message}`)
    }
  }
  return projectId
}

async function deleteProject(token, projectId) {
  try {
    await api('DELETE', `/admin/project/${projectId}`, { token, timeoutMs: 15_000 })
  } catch (e) {
    log(`  !! failed to delete ${projectId}: ${e.message}`)
  }
}

function containsAnyCI(haystack, needles) {
  const hay = String(haystack ?? '').toLowerCase()
  for (const n of needles) {
    if (!n) continue
    if (hay.includes(String(n).toLowerCase())) return true
  }
  return false
}

function scoreHits(hits, mustContain) {
  // Returns { rankOfFirstMatch | null, matchedAt5: bool, matchedAt10: bool }
  let firstMatch = null
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const text = h.text ?? h.value ?? ''
    if (containsAnyCI(text, mustContain)) {
      firstMatch = i + 1
      break
    }
  }
  return {
    rankOfFirstMatch: firstMatch,
    matchedAt5: firstMatch !== null && firstMatch <= 5,
    matchedAt10: firstMatch !== null && firstMatch <= 10,
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function main() {
  const startedAt = Date.now()
  log(`Backend: ${BACKEND_URL}`)
  log(`Recall threshold: ${RECALL_THRESHOLD}`)

  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))
  if (!Array.isArray(golden.queries)) throw new Error('Golden dataset missing `queries` array')

  // Filter golden queries by fixture name if requested.
  const queries = golden.queries.filter((q) =>
    FIXTURE_FILTER ? q.fixture.includes(FIXTURE_FILTER) : true,
  )
  if (queries.length === 0) {
    log('No queries after fixture filter — exiting.')
    process.exit(2)
  }
  const fixtureNames = [...new Set(queries.map((q) => q.fixture))]
  log(`Will seed ${fixtureNames.length} fixture(s) and run ${queries.length} query/queries`)

  const token = await login()
  const pm = await findProjectManager(token)
  log(`Admin login OK; will assign PM ${pm.id}`)

  // Seed each unique fixture.
  const allFixtures = loadFixtures()
  const projectByFixture = {}
  for (const fname of fixtureNames) {
    const input = allFixtures[fname]
    if (!input) {
      log(`!! fixture ${fname} not found on disk — skipping its queries`)
      continue
    }
    log(`Seeding ${fname}…`)
    projectByFixture[fname] = await seedProject(token, pm, fname, input)
    log(`  ▸ projectId = ${projectByFixture[fname]}`)
  }

  log(`Waiting ${SEED_WAIT_MS}ms for embedding hooks to finish…`)
  await new Promise((r) => setTimeout(r, SEED_WAIT_MS))

  // Group queries by fixture for batch calls.
  const byFixture = new Map()
  for (const q of queries) {
    if (!projectByFixture[q.fixture]) continue
    if (!byFixture.has(q.fixture)) byFixture.set(q.fixture, [])
    byFixture.get(q.fixture).push(q)
  }

  const allResults = []
  const allLatencies = []

  for (const [fixture, qs] of byFixture.entries()) {
    const projectId = projectByFixture[fixture]
    log(`Running ${qs.length} queries against ${fixture}…`)
    const batchBody = {
      queries: qs.map((q) => ({
        projectId,
        query: q.query,
        target: q.target,
        limit: 10,
      })),
    }
    let batch
    try {
      batch = await api('POST', '/admin/eval/retrieval/batch', {
        token,
        body: batchBody,
        timeoutMs: 60_000,
      })
    } catch (e) {
      log(`  !! batch retrieve failed for ${fixture}: ${e.message}`)
      continue
    }
    if (!Array.isArray(batch)) {
      log(`  !! batch retrieve returned non-array for ${fixture}: ${JSON.stringify(batch).slice(0, 200)}`)
      continue
    }
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]
      const resp = batch[i] ?? { hits: [], latencyMs: 0, error: 'no_response' }
      if (typeof resp.latencyMs === 'number') allLatencies.push(resp.latencyMs)
      const hits = Array.isArray(resp.hits) ? resp.hits : []
      const score = scoreHits(hits, q.mustContain ?? [])
      allResults.push({
        fixture: q.fixture,
        target: q.target,
        query: q.query,
        mustContain: q.mustContain,
        rank: score.rankOfFirstMatch,
        matchedAt5: score.matchedAt5,
        matchedAt10: score.matchedAt10,
        latencyMs: resp.latencyMs ?? null,
        error: resp.error ?? null,
        topHit: hits[0]
          ? { similarity: hits[0].similarity, snippet: String(hits[0].text ?? hits[0].value ?? '').slice(0, 160) }
          : null,
      })
      const marker = score.matchedAt5 ? '✓' : score.matchedAt10 ? '~' : '✗'
      log(`  ${marker} [${q.target}] "${q.query}" — rank=${score.rankOfFirstMatch ?? 'miss'} (${resp.latencyMs ?? '?'}ms)`)
    }
  }

  // Aggregate
  const total = allResults.length
  const hitsAt5 = allResults.filter((r) => r.matchedAt5).length
  const hitsAt10 = allResults.filter((r) => r.matchedAt10).length
  const mrr = total === 0
    ? 0
    : allResults.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / total
  const recallAt5 = total === 0 ? 0 : hitsAt5 / total
  const recallAt10 = total === 0 ? 0 : hitsAt10 / total
  const p95 = percentile(allLatencies, 95)
  const p50 = percentile(allLatencies, 50)

  const summary = {
    backend: BACKEND_URL,
    totalQueries: total,
    recallAt5: Number(recallAt5.toFixed(3)),
    recallAt10: Number(recallAt10.toFixed(3)),
    mrr: Number(mrr.toFixed(3)),
    latencyMsP50: p50,
    latencyMsP95: p95,
    durationSec: Math.round((Date.now() - startedAt) / 1000),
    threshold: RECALL_THRESHOLD,
    passed: recallAt5 >= RECALL_THRESHOLD,
  }

  log('--------------------------------------------------------------------')
  log(`Total queries:    ${summary.totalQueries}`)
  log(`Recall @5:        ${(recallAt5 * 100).toFixed(1)}%`)
  log(`Recall @10:       ${(recallAt10 * 100).toFixed(1)}%`)
  log(`MRR:              ${mrr.toFixed(3)}`)
  log(`Latency p50/p95:  ${p50}ms / ${p95}ms`)
  log(`Threshold:        ${RECALL_THRESHOLD * 100}%`)
  log(`Verdict:          ${summary.passed ? '✓ PASS' : '✗ FAIL'}`)

  // Write report
  const md = []
  md.push(`# AI Eval — Retrieval (pgvector)`)
  md.push('')
  md.push(`Generated: ${new Date().toISOString()}`)
  md.push(`Backend:   \`${BACKEND_URL}\``)
  md.push('')
  md.push('## Summary')
  md.push('')
  md.push(`| Metric | Value |`)
  md.push(`|---|---|`)
  md.push(`| Total queries | ${summary.totalQueries} |`)
  md.push(`| Recall @5 | **${(recallAt5 * 100).toFixed(1)}%** |`)
  md.push(`| Recall @10 | ${(recallAt10 * 100).toFixed(1)}% |`)
  md.push(`| MRR | ${mrr.toFixed(3)} |`)
  md.push(`| Latency p50 / p95 | ${p50}ms / ${p95}ms |`)
  md.push(`| Threshold (recall@5) | ${RECALL_THRESHOLD * 100}% |`)
  md.push(`| Verdict | ${summary.passed ? '✓ PASS' : '✗ FAIL'} |`)
  md.push('')
  md.push('## Per-query results')
  md.push('')
  md.push('| Fixture | Target | Query | Rank | Top hit similarity | Top hit snippet |')
  md.push('|---|---|---|---|---|---|')
  for (const r of allResults) {
    const rank = r.rank === null ? '✗ miss' : String(r.rank)
    const sim = r.topHit?.similarity != null ? r.topHit.similarity.toFixed(3) : '—'
    const snip = (r.topHit?.snippet ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    md.push(`| ${r.fixture} | ${r.target} | ${r.query.replace(/\|/g, '\\|')} | ${rank} | ${sim} | ${snip} |`)
  }
  writeFileSync(REPORT_PATH, md.join('\n') + '\n')
  log(`Report written: ${REPORT_PATH}`)

  if (!SKIP_CLEANUP) {
    log('Cleaning up seed projects…')
    for (const projectId of Object.values(projectByFixture)) {
      await deleteProject(token, projectId)
    }
  } else {
    log('EVAL_SKIP_CLEANUP=1 — leaving seed projects in place')
  }

  process.exit(summary.passed ? 0 : 1)
}

main().catch((e) => {
  log(`FATAL: ${e?.message ?? e}`)
  if (e?.stack) log(e.stack)
  process.exit(2)
})
