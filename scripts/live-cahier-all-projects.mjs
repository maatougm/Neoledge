/**
 * Run the cahier hallucination test across EVERY project the PM has access to.
 * Reports source-corpus size, generation time, hallucinated tech count,
 * INFO_MANQUANTE marker count, and per-project verdict.
 *
 * Stops early on the first project with rich source data (> 500 chars) so we
 * don't burn LLM tokens on every project.
 */
const ROOT = 'https://neoleadge.pythagore-init.com'

async function loginPm() {
  const r = await fetch(`${ROOT}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@neoleadge.com', password: 'Pm@123' }),
  })
  return (await r.json()).jwt
}

const KNOWN_TECH = [
  'postgresql', 'postgres', 'mysql', 'mariadb', 'sql server',
  'mongodb', 'redis', 'elasticsearch',
  'aws', 'azure', 'gcp', 'ovh', 'scaleway', 'heroku',
  'docker', 'kubernetes',
  'vue.js', 'reactjs', 'react.js', 'angular', 'svelte', 'next.js', 'nuxt',
  '.net core', 'asp.net', 'nestjs', 'spring boot', 'django', 'fastapi', 'laravel',
  'typescript', 'javascript', 'golang',
  'kafka', 'rabbitmq', 'oauth', 'okta', 'stripe', 'paypal',
  'docusign', 'adobe sign', 'salesforce', 'sharepoint',
  'power bi', 'looker', 'grafana',
  'openai', 'anthropic', 'gemini', 'mistral',
]

function tokenRe(tech) {
  const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-zA-Z0-9])${escaped}(?=[^a-zA-Z0-9]|$)`, 'i')
}

const jwt = await loginPm()
const auth = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }

const projRes = await fetch(`${ROOT}/pm/projects`, { headers: auth })
const projData = await projRes.json()
const projects = Array.isArray(projData) ? projData : (projData.items ?? [])
console.log(`Found ${projects.length} projects`)

// Build per-project source corpus + score by data density.
const scored = []
for (const p of projects) {
  const detailRes = await fetch(`${ROOT}/pm/projects/${p.id}`, { headers: auth })
  if (!detailRes.ok) continue
  const detail = await detailRes.json()
  const filled = (detail.fieldValues ?? []).filter((v) => v?.value && v.value.trim().length > 5)
  let txt = `${p.name}\n${p.clientName ?? ''}\n` +
    filled.map((v) => `${v.field?.label ?? ''}\n${v.value}`).join('\n')
  // Append meeting summaries
  const meetingsRes = await fetch(`${ROOT}/pm/projects/${p.id}/meetings`, { headers: auth })
  if (meetingsRes.ok) {
    const m = await meetingsRes.json()
    const list = Array.isArray(m) ? m : (m.items ?? [])
    txt += '\n' + list.map((x) => `${x.title ?? ''}\n${x.aiSummary ?? ''}`).join('\n')
  }
  scored.push({ project: p, corpus: txt.toLowerCase(), score: txt.length })
}
scored.sort((a, b) => b.score - a.score)

console.log('\nProject corpus sizes:')
for (const s of scored) console.log(`  ${s.score.toString().padStart(6)} chars · ${s.project.name}`)

// Test the richest project.
const top = scored[0]
if (!top || top.score < 200) {
  console.log('\n✘ No project with enough source data to test richer scenarios.')
  process.exit(0)
}

console.log(`\n── Testing richest project: "${top.project.name}" (${top.score} chars) ──`)
const start = Date.now()
const cahierRes = await fetch(`${ROOT}/pm/projects/${top.project.id}/cahier-des-charges/preview`, { headers: auth })
const elapsed = ((Date.now() - start) / 1000).toFixed(1)
if (!cahierRes.ok) {
  console.log(`✘ generation failed: ${cahierRes.status}`)
  process.exit(1)
}
const { aiContent } = await cahierRes.json()
console.log(`✓ generated in ${elapsed}s`)

// Inspect
const fullText = [
  aiContent.objectifDocument, aiContent.contexte, aiContent.objectifProjet,
  aiContent.perimetreInclus, aiContent.perimetreExclus,
  ...(aiContent.exigencesFonctionnelles ?? []).flatMap((s) => [s.title, s.content]),
  ...(aiContent.architectureTechnique ?? []).flatMap((s) => [s.title, s.content]),
  aiContent.livrables, aiContent.conclusion,
].filter(Boolean).join('\n').toLowerCase()

const markers = (fullText.match(/info_manquante:/g) ?? []).length
const stripped = fullText.replace(/\[?info_manquante:[^\]\n]*\]?/g, '')
const ungrounded = []
for (const tech of KNOWN_TECH) {
  const re = tokenRe(tech)
  if (re.test(stripped) && !re.test(top.corpus)) ungrounded.push(tech)
}

// Total length signal
const totalLen = Object.values(aiContent).reduce((acc, v) => {
  if (typeof v === 'string') return acc + v.length
  if (Array.isArray(v)) return acc + v.reduce((s, x) => s + (x.title?.length ?? 0) + (x.content?.length ?? 0), 0)
  return acc
}, 0)

console.log(`\n── INSPECTION ──`)
console.log(`Total cahier length: ${totalLen} chars`)
console.log(`INFO_MANQUANTE markers: ${markers}`)
if (ungrounded.length === 0) {
  console.log(`✓ no ungrounded tech mentions`)
} else {
  console.log(`✘ ${ungrounded.length} ungrounded tech:`)
  for (const t of ungrounded.slice(0, 8)) {
    const idx = stripped.indexOf(t.split(' ')[0])
    const ctx = stripped.slice(Math.max(0, idx - 50), idx + t.length + 50).replace(/\s+/g, ' ')
    console.log(`   "${t}" — …${ctx}…`)
  }
}

// Sample one section so user can eyeball
console.log(`\n── Sample: architectureTechnique ──`)
for (const s of (aiContent.architectureTechnique ?? []).slice(0, 3)) {
  console.log(`  • ${s.title}: ${s.content.slice(0, 200)}`)
}

console.log(`\n── VERDICT ──`)
const verdict = ungrounded.length === 0 ? 'PASS' : 'FAIL'
console.log(`${verdict}: ${ungrounded.length} hallucinated, ${markers} markers, ${totalLen} chars output`)
