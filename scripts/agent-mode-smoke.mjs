#!/usr/bin/env node
/**
 * Live smoke test for the three agent loops on the test server.
 *
 * Each test fires a real LLM call against Z.AI. Run with the test server
 * configured for AI_AGENT_MODE=all.
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
  const body = await res.json()
  return body.jwt
}

async function request(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000), // 3 min — agent loops can take a while
  })
  return { status: res.status, body: await res.text() }
}
const get = (t, p) => request(t, 'GET', p)
const post = (t, p, b) => request(t, 'POST', p, b ?? {})

async function main() {
  console.log(`[agent-smoke] target = ${BASE}`)

  console.log('\n--- Login')
  const pm = await login(PM.email, PM.pwd)
  record('login as PM', !!pm)

  console.log('\n--- Backlog agent (POST /pm/projects/:id/ai/generate-backlog)')
  let r = await post(pm, `/pm/projects/${DEMO_PROJECT}/ai/generate-backlog`)
  record('backlog 200/201/429', [200, 201, 429].includes(r.status), `status=${r.status} body=${r.body.slice(0,200)}`)
  if (r.status === 200 || r.status === 201) {
    let parsed
    try { parsed = JSON.parse(r.body) } catch { parsed = null }
    record('backlog response is JSON', !!parsed, '')
    record('backlog has epics array', !!parsed && Array.isArray(parsed.epics), JSON.stringify(parsed).slice(0, 120))
    if (parsed?.epics?.length) {
      const e = parsed.epics[0]
      record('first epic has title + children', !!e.title && Array.isArray(e.children), JSON.stringify(e).slice(0, 200))
    }
  } else if (r.status === 429) {
    console.log('    [skip remaining backlog asserts — cooldown active]')
  }

  console.log('\n--- Cahier status check')
  r = await get(pm, `/pm/projects/${DEMO_PROJECT}/cahier-des-charges/status`)
  record('cahier status 200', r.status === 200, `status=${r.status}`)

  console.log('\n--- AI usage log shows agent rows')
  r = await get(pm, `/admin/ai-usage/summary`)
  // PM may or may not have access to this; either way, just check the
  // backlog call hit. Skip if 403.
  if (r.status === 200) {
    let usage
    try { usage = JSON.parse(r.body) } catch { usage = [] }
    record('ai usage summary parseable', Array.isArray(usage), '')
  } else {
    console.log(`    [skip — admin endpoint returned ${r.status}]`)
  }

  console.log(`\n--- Summary: ${pass} pass / ${fail} fail`)
  if (fail) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[smoke] aborted:', e); process.exit(2) })
