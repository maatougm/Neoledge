#!/usr/bin/env node
/**
 * Live smoke test for the meeting copilot.
 *
 * Flow:
 *   1. PM logs in.
 *   2. Start session, append a meaningful transcript chunk, fire.
 *   3. Wait briefly, query the DB-backed listing of suggestions for the
 *      session via the controller (we'll just hit append+fire enough times
 *      to confirm the agent is reachable and returns 202).
 *   4. End session.
 */

const BASE = process.env.BASE ?? 'https://neoleadge.pythagore-init.com'
const DEMO_PROJECT = 'dddddddd-dem0-0000-0000-000000000001'
const PM = { email: 'pm@neoleadge.com', pwd: 'Pm@123' }

let pass = 0, fail = 0
const failures = []

function record(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ::  ${detail}`) }
}

async function login(email, pwd) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pwd }),
  })
  if (!res.ok) throw new Error(`login -> ${res.status}`)
  return (await res.json()).jwt
}

async function req(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  return { status: res.status, body: await res.text() }
}

async function main() {
  console.log(`[copilot-smoke] target = ${BASE}`)
  const pm = await login(PM.email, PM.pwd)
  record('PM login', !!pm)

  const sid = `smoke-${Date.now()}`
  const PATH = `/pm/projects/${DEMO_PROJECT}/meetings/live/copilot`

  let r = await req(pm, 'POST', `${PATH}/session`, { liveSessionId: sid })
  record('start session 201', r.status === 201, `status=${r.status} body=${r.body.slice(0, 120)}`)

  r = await req(pm, 'GET', `${PATH}/_drivers`)
  record('drivers endpoint 200', r.status === 200, `status=${r.status}`)
  if (r.status === 200) {
    let parsed
    try { parsed = JSON.parse(r.body) } catch { parsed = null }
    record('drivers items array', !!parsed?.items, JSON.stringify(parsed).slice(0, 100))
  }

  // Append enough transcript content to pass the 200-char gate.
  const meaty = 'Le client souhaite une plateforme web pour gérer les dossiers Elise GED. Il faut prévoir une intégration avec Elise.Automate pour les workflows de validation. Le périmètre inclus est la gestion des projets et le suivi des tâches. Les utilisateurs cibles sont les chefs de projet et les ingénieurs déploiement. La sécurité est critique : authentification SSO et chiffrement au repos.'
  r = await req(pm, 'POST', `${PATH}/append`, { liveSessionId: sid, chunk: meaty })
  record('append chunk 200', r.status === 200, `status=${r.status} body=${r.body.slice(0, 120)}`)
  let appendBody
  try { appendBody = JSON.parse(r.body) } catch { appendBody = null }
  record('append returns shouldFire', appendBody && typeof appendBody.shouldFire === 'boolean', JSON.stringify(appendBody))

  r = await req(pm, 'POST', `${PATH}/fire`, { liveSessionId: sid })
  record('fire 202 (non-blocking)', r.status === 202, `status=${r.status}`)

  // Give the agent ~25s. Z.AI typically replies in 6-15s for a small loop.
  console.log('  ⏳ waiting 25s for agent fire to complete...')
  await new Promise((res) => setTimeout(res, 25_000))

  // End session.
  r = await req(pm, 'DELETE', `${PATH}/session`, { liveSessionId: sid })
  record('end session 204', r.status === 204, `status=${r.status} body=${r.body.slice(0, 120)}`)

  console.log(`\n--- Summary: ${pass} pass / ${fail} fail`)
  if (fail) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[smoke] aborted:', e); process.exit(2) })
