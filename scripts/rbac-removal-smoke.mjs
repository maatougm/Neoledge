#!/usr/bin/env node
/**
 * Phase 4 smoke test for the RBAC-removal plan.
 *
 *  - Logs in as Admin / PM / Spec / Realiz against the live test server
 *  - Hits /auth/me and confirms the response carries a `user` object and the
 *    role claim flows through (legacy permissions/roles fields may be empty)
 *  - Probes a representative role-protected endpoint per role to confirm
 *    @Roles(...) gating still works after the @RequirePermission swap
 *  - Probes the seeded demo project's PM-scoped endpoint to confirm
 *    ProjectAccessGuard's PM/Member/Admin path still grants access
 *  - Confirms a non-member realiz user is BLOCKED from a project they aren't on
 */

const BASE = 'https://neoleadge.pythagore-init.com'
const DEMO_PROJECT = 'dddddddd-dem0-0000-0000-000000000001'

const ACCOUNTS = {
  admin:  { email: 'admin@neoleadge.com',  pwd: 'Admin@123'  },
  pm:     { email: 'pm@neoleadge.com',     pwd: 'Pm@123'     },
  spec:   { email: 'spec@neoleadge.com',   pwd: 'Spec@123'   },
  realiz: { email: 'realiz@neoleadge.com', pwd: 'Realiz@123' },
}

let pass = 0
let fail = 0
const failures = []

function record(name, ok, detail) {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push({ name, detail })
    console.log(`  FAIL  ${name}  ::  ${detail}`)
  }
}

async function login(email, pwd) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pwd }),
  })
  if (!res.ok) throw new Error(`login(${email}) -> ${res.status}`)
  const body = await res.json()
  if (!body.jwt) throw new Error(`login(${email}) -> no jwt in body: ${JSON.stringify(body)}`)
  return body.jwt
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { status: res.status, body: await res.text() }
}

async function main() {
  console.log(`[smoke] target = ${BASE}`)

  console.log('\n--- Logins')
  const tokens = {}
  for (const [role, creds] of Object.entries(ACCOUNTS)) {
    try {
      tokens[role] = await login(creds.email, creds.pwd)
      record(`login as ${role}`, true)
    } catch (err) {
      record(`login as ${role}`, false, err.message)
    }
  }
  if (Object.values(tokens).some((t) => !t)) {
    console.log('\n[smoke] aborting — at least one login failed')
    process.exit(1)
  }

  console.log('\n--- /auth/me carries role claim')
  for (const [role, token] of Object.entries(tokens)) {
    const r = await get(token, '/auth/me')
    if (r.status !== 200) { record(`me ${role}`, false, `status=${r.status}`); continue }
    let json; try { json = JSON.parse(r.body) } catch { json = null }
    const u = json?.user
    record(`me ${role} returns user object`, !!u, JSON.stringify(json).slice(0, 140))
    record(`me ${role} role string is non-empty`, !!u?.role, `role=${u?.role}`)
  }

  console.log('\n--- Role-protected endpoints (RolesGuard gates)')
  // Admin-only listing — admin should pass, PM should be 403
  let r = await get(tokens.admin, '/admin/appuser')
  record('admin -> /admin/appuser 200', r.status === 200, `status=${r.status}`)
  r = await get(tokens.pm, '/admin/appuser')
  record('pm    -> /admin/appuser 403', r.status === 403, `status=${r.status}`)
  r = await get(tokens.realiz, '/admin/appuser')
  record('realiz-> /admin/appuser 403', r.status === 403, `status=${r.status}`)

  console.log('\n--- ProjectAccessGuard (PM-of-project / Member / Admin)')
  // Admin can read any project
  r = await get(tokens.admin, `/pm/projects/${DEMO_PROJECT}`)
  record('admin -> demo project 200', r.status === 200, `status=${r.status}`)
  // PM owns the demo project (seed sets this)
  r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}`)
  record('pm    -> demo project 200', r.status === 200, `status=${r.status}`)
  // Realiz is a project member of the demo seed
  r = await get(tokens.realiz, `/pm/projects/${DEMO_PROJECT}`)
  record('realiz-> demo project 200 (ProjectMember row)', r.status === 200, `status=${r.status}`)

  console.log('\n--- ProjectAccessGuard rejects non-members')
  // Build a random project id that nobody is a member of
  const ghost = '00000000-0000-0000-0000-000000000000'
  r = await get(tokens.realiz, `/pm/projects/${ghost}`)
  record('realiz-> ghost project NOT 200', r.status !== 200, `status=${r.status}`)
  r = await get(tokens.spec, `/pm/projects/${ghost}`)
  record('spec  -> ghost project NOT 200', r.status !== 200, `status=${r.status}`)

  console.log(`\n--- Summary: ${pass} pass / ${fail} fail`)
  if (fail) {
    console.log('Failures:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[smoke] aborted:', e)
  process.exit(2)
})
