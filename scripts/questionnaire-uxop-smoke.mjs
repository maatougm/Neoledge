#!/usr/bin/env node
/**
 * Smoke test for the questionnaire UX overhaul (phases 3a, 1, 2, 4, 5, 3b).
 *
 *  - PM can list templates at /pm/templates (Phase 1)
 *  - Admin is BLOCKED from /pm/templates (Phase 1)
 *  - Realiz (Member) is BLOCKED from POST /pm/projects/:id/fields (Phase 3a)
 *  - PM can fetch cahier-des-charges/status on their project (Phase 5)
 *  - PM cannot self-approve cahier (server-side block intact) (Phase 5)
 *  - PATCH /admin/project/:id/toggle-manager-fields is gone (Phase 3b)
 */

const BASE = 'https://neoleadge.pythagore-init.com'
const DEMO_PROJECT = 'dddddddd-dem0-0000-0000-000000000001'

const ACCOUNTS = {
  admin:  { email: 'admin@neoleadge.com',  pwd: 'Admin@123'  },
  pm:     { email: 'pm@neoleadge.com',     pwd: 'Pm@123'     },
  realiz: { email: 'realiz@neoleadge.com', pwd: 'Realiz@123' },
}

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
  if (!res.ok) throw new Error(`login(${email}) -> ${res.status}`)
  const body = await res.json()
  if (!body.jwt) throw new Error(`login(${email}) -> no jwt`)
  return body.jwt
}

async function request(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.text() }
}

const get = (t, p) => request(t, 'GET', p)
const post = (t, p, b) => request(t, 'POST', p, b ?? {})
const patch = (t, p, b) => request(t, 'PATCH', p, b ?? {})

async function main() {
  console.log(`[questionnaire-smoke] target = ${BASE}`)

  console.log('\n--- Logins')
  const tokens = {}
  for (const [r, c] of Object.entries(ACCOUNTS)) {
    tokens[r] = await login(c.email, c.pwd)
    record(`login as ${r}`, true)
  }

  console.log('\n--- Phase 1: templates module is PM-only')
  let r = await get(tokens.pm, '/pm/templates')
  record('pm    -> GET /pm/templates 200', r.status === 200, `status=${r.status}`)
  r = await get(tokens.admin, '/pm/templates')
  record('admin -> GET /pm/templates 403', r.status === 403, `status=${r.status}`)
  r = await get(tokens.realiz, '/pm/templates')
  record('realiz-> GET /pm/templates 403', r.status === 403, `status=${r.status}`)
  // The legacy /admin/projecttemplate path should be gone
  r = await get(tokens.admin, '/admin/projecttemplate')
  record('admin -> /admin/projecttemplate is 404', r.status === 404, `status=${r.status}`)

  console.log('\n--- Phase 3a: PM-fields is locked to project owner')
  // realiz is a ProjectMember of the demo project but not its PM
  r = await post(tokens.realiz, `/pm/projects/${DEMO_PROJECT}/fields`, {
    label: 'Smoke test field',
    fieldType: 'Text',
    isRequired: false,
  })
  record('realiz-> add field on demo project 403', r.status === 403, `status=${r.status}`)

  console.log('\n--- Phase 3b: legacy admin toggle-manager-fields endpoint is gone')
  r = await patch(tokens.admin, `/admin/project/${DEMO_PROJECT}/toggle-manager-fields`, { allow: true })
  record('admin -> PATCH toggle-manager-fields 404', r.status === 404, `status=${r.status}`)

  console.log('\n--- Phase 5: cahier-status reachable; PM cannot self-approve')
  r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}/cahier-des-charges/status`)
  record('pm    -> cahier status 200', r.status === 200, `status=${r.status}`)
  let payload; try { payload = JSON.parse(r.body) } catch { payload = null }
  record('pm    -> status field present', !!payload && typeof payload.status === 'string',
         JSON.stringify(payload).slice(0, 120))
  // PM self-approval must still 400
  r = await post(tokens.pm, `/pm/projects/${DEMO_PROJECT}/cahier-des-charges/feedback`, {
    status: 'approved',
    comment: 'self-approve smoke',
  })
  record('pm    -> self-approve cahier 400 (blocked)', r.status === 400, `status=${r.status}`)

  console.log(`\n--- Summary: ${pass} pass / ${fail} fail`)
  if (fail) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[smoke] aborted:', e); process.exit(2) })
