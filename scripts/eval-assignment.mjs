/**
 * Lightweight latency + sanity test for POST /pm/projects/:id/work-packages/suggest-assignments.
 * No fixture seeding — uses whichever project the PM already has WPs on.
 */
const ROOT = process.env.EVAL_BACKEND_URL ?? 'https://neoleadge.pythagore-init.com'

async function login() {
  const r = await fetch(`${ROOT}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@neoleadge.com', password: 'Pm@123' }),
  })
  if (!r.ok) throw new Error(`login ${r.status}`)
  return (await r.json()).jwt
}

async function main() {
  const jwt = await login()
  const H = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }

  // Pick a project + some WPs
  const projects = await fetch(`${ROOT}/pm/projects`, { headers: H }).then((r) => r.json())
  const projList = Array.isArray(projects) ? projects : (projects.items ?? [])
  if (projList.length === 0) { console.error('no projects'); process.exit(1) }

  // Find a project with WPs
  for (const p of projList) {
    const wps = await fetch(`${ROOT}/pm/projects/${p.id}/work-packages?limit=10`, { headers: H }).then((r) => r.json())
    const items = Array.isArray(wps) ? wps : (wps.items ?? [])
    const candidates = items.filter((w) => w.type !== 'Epic').slice(0, 5)
    if (candidates.length === 0) continue

    console.log(`project: ${p.name} (${p.id})  candidates: ${candidates.length}`)
    const wpIds = candidates.map((c) => c.id)
    const start = Date.now()
    const r = await fetch(`${ROOT}/pm/projects/${p.id}/work-packages/suggest-assignments`, {
      method: 'POST', headers: H, body: JSON.stringify({ wpIds }),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const body = await r.json().catch(() => ({}))
    console.log(`status=${r.status} elapsed=${elapsed}s`)
    if (r.status >= 400) {
      console.log('body:', JSON.stringify(body).slice(0, 400))
      process.exit(1)
    }
    const itemsOut = body.items ?? []
    console.log(`items=${itemsOut.length} sample=${JSON.stringify(itemsOut[0]).slice(0, 200)}`)
    process.exit(0)
  }
  console.error('no project with WPs'); process.exit(1)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
