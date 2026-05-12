/**
 * Live cahier hallucination test against the actual prod server.
 *
 * Flow:
 *   1. Login as PM
 *   2. List the PM's projects, pick one with questionnaire data
 *   3. Run preflight to see what's missing
 *   4. Generate a cahier (real LLM call — costs tokens)
 *   5. Build a source corpus from the project's questionnaire + meetings
 *   6. Scan the cahier output for:
 *      - INFO_MANQUANTE markers (✓ good — model honestly flagged gaps)
 *      - Known tech names not in the source (✗ likely hallucination)
 *      - Numbers with units not in the source (suspicious)
 *   7. Print a structured verdict
 */
const ROOT = 'https://neoleadge.pythagore-init.com'

async function loginPm() {
  const r = await fetch(`${ROOT}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@neoleadge.com', password: 'Pm@123' }),
  })
  if (!r.ok) throw new Error(`login failed: ${r.status}`)
  return (await r.json()).jwt
}

const KNOWN_TECH = [
  'postgresql', 'postgres', 'mysql', 'mariadb', 'sql server', 'mssql', 'oracle',
  'mongodb', 'mongo', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'firebase',
  'aws', 'azure', 'gcp', 'google cloud', 'ovh', 'scaleway', 'digitalocean', 'heroku',
  'docker', 'kubernetes', 'k8s', 'openshift',
  'vue', 'vue.js', 'react', 'angular', 'svelte', 'next.js', 'nuxt',
  '.net core', 'asp.net', 'nestjs', 'express', 'spring boot', 'django', 'fastapi',
  'laravel', 'symfony',
  'typescript', 'javascript', 'python', 'java', 'c#', 'golang', 'rust', 'php',
  'kafka', 'rabbitmq', 'oauth', 'saml', 'okta', 'auth0', 'stripe',
  'docusign', 'adobe sign', 'salesforce', 'sharepoint', 'sap',
  'power bi', 'tableau', 'looker', 'metabase', 'grafana',
  'openai', 'anthropic', 'gemini', 'azure openai',
]

const jwt = await loginPm()
const auth = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
console.log('✓ logged in as PM')

// Find a project with at least some questionnaire data.
const projRes = await fetch(`${ROOT}/pm/projects`, { headers: auth })
const projData = await projRes.json()
const projects = Array.isArray(projData) ? projData : (projData.items ?? [])
console.log(`✓ ${projects.length} projects visible to PM`)

let pickedProject = null
let sourceCorpus = ''
let pickedData = null
for (const p of projects) {
  const detailRes = await fetch(`${ROOT}/pm/projects/${p.id}`, { headers: auth })
  if (!detailRes.ok) continue
  const detail = await detailRes.json()
  // Build corpus from field values
  const filledFields = (detail.fieldValues ?? []).filter((v) => v?.value && v.value.trim().length > 10)
  if (filledFields.length < 3) continue
  pickedProject = p
  pickedData = detail
  const fieldParts = filledFields.map((v) => `${v.field?.label ?? ''}\n${v.value}`).join('\n')
  // Add meeting summaries if any
  const meetingsRes = await fetch(`${ROOT}/pm/projects/${p.id}/meetings`, { headers: auth })
  let meetingsTxt = ''
  if (meetingsRes.ok) {
    const meetings = await meetingsRes.json()
    const list = Array.isArray(meetings) ? meetings : (meetings.items ?? [])
    meetingsTxt = list.map((m) => `${m.title ?? ''}\n${m.aiSummary ?? ''}`).join('\n')
  }
  sourceCorpus = (p.name + '\n' + (p.clientName ?? '') + '\n' + fieldParts + '\n' + meetingsTxt).toLowerCase()
  break
}

if (!pickedProject) {
  console.log('✘ No project with enough questionnaire data found. Aborting.')
  process.exit(1)
}
console.log(`✓ picked project: ${pickedProject.name} (${pickedProject.id})`)
console.log(`  source corpus: ${sourceCorpus.length} chars`)

// 1. Preflight
console.log('\n── PREFLIGHT ──')
const preflightRes = await fetch(`${ROOT}/pm/projects/${pickedProject.id}/cahier-des-charges/preflight`, { headers: auth })
if (!preflightRes.ok) {
  console.log(`✘ preflight failed: ${preflightRes.status}`)
} else {
  const preflight = await preflightRes.json()
  console.log(`readiness score: ${Math.round((preflight.readinessScore ?? 0) * 100)}%`)
  console.log(`canGenerate: ${preflight.canGenerate}`)
  console.log(`source: ${preflight.source}`)
  console.log(`answered (${preflight.answeredFields?.length ?? 0}):`, (preflight.answeredFields ?? []).slice(0, 3).join(', '))
  console.log(`missing (${preflight.missingFields?.length ?? 0}):`)
  for (const m of (preflight.missingFields ?? []).slice(0, 6)) {
    console.log(`  [${m.severity}] ${m.section}: ${m.topic}`)
  }
}

// 2. Generate the cahier
console.log('\n── GENERATING CAHIER (real LLM call) ──')
const start = Date.now()
const cahierRes = await fetch(`${ROOT}/pm/projects/${pickedProject.id}/cahier-des-charges/preview`, { headers: auth })
const elapsed = ((Date.now() - start) / 1000).toFixed(1)
if (!cahierRes.ok) {
  const text = await cahierRes.text()
  console.log(`✘ generation failed: ${cahierRes.status} ${text.slice(0, 200)}`)
  process.exit(1)
}
const { aiContent } = await cahierRes.json()
console.log(`✓ generated in ${elapsed}s`)

// 3. Inspect
console.log('\n── INSPECTION ──')
const fullText = [
  aiContent.objectifDocument,
  aiContent.contexte,
  aiContent.objectifProjet,
  aiContent.perimetreInclus,
  aiContent.perimetreExclus,
  ...(aiContent.exigencesFonctionnelles ?? []).flatMap((s) => [s.title, s.content]),
  ...(aiContent.architectureTechnique ?? []).flatMap((s) => [s.title, s.content]),
  aiContent.livrables,
  aiContent.conclusion,
].filter(Boolean).join('\n').toLowerCase()

// Count INFO_MANQUANTE markers
const markers = (fullText.match(/info_manquante:/g) ?? []).length
console.log(`✓ INFO_MANQUANTE markers: ${markers} (model honestly flagged gaps)`)

// Detect ungrounded tech mentions
const ungrounded = []
for (const tech of KNOWN_TECH) {
  if (fullText.includes(tech) && !sourceCorpus.includes(tech)) {
    ungrounded.push(tech)
  }
}
if (ungrounded.length === 0) {
  console.log(`✓ no ungrounded tech mentions detected`)
} else {
  console.log(`✘ ${ungrounded.length} ungrounded tech mention(s):`)
  for (const t of ungrounded.slice(0, 12)) {
    // Pull a snippet of context
    const idx = fullText.indexOf(t)
    const ctx = fullText.slice(Math.max(0, idx - 40), idx + t.length + 40)
    console.log(`   "${t}" — context: …${ctx}…`)
  }
}

// Detect "À définir" leaks (should be replaced by INFO_MANQUANTE per the new rule)
const adef = (fullText.match(/à définir/g) ?? []).length
if (adef > 0) console.log(`⚠ "À définir" still present ${adef} time(s) — should have been replaced by INFO_MANQUANTE`)

console.log('\n── VERDICT ──')
const verdict = ungrounded.length === 0 ? 'PASS' : 'FAIL'
console.log(`${verdict}: ${ungrounded.length} hallucinated tech, ${markers} honest gap markers`)
