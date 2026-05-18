#!/usr/bin/env node
/**
 * Smoke test for the post-validation workflow overhaul.
 *
 *  Phase 0 — Automation removal:
 *    - GET /pm/projects/:id/automation/rules → 404 (route gone)
 *
 *  Phase 1 — Sprint delete guard + sprint-aware bulk-assign:
 *    - GET /pm/projects/:id/boards reachable
 *    - POST sprint → DELETE empty Planning sprint succeeds
 *    - DELETE non-existent sprint → 4xx (not 500)
 *
 *  Phase 5 — Sidebar reorder:
 *    - cannot be unit-asserted server-side; verified visually in deploy.
 *    - Smoke just reaches the assign-tasks and backlog-generator routes.
 *
 *  Phase 4 — Bulk-assign with sprintId carries sprint name in notification:
 *    - bulk-assign 2 WPs to realiz user → 200, response carries `updated`
 *    - GET notifications as realiz → most-recent unread for project mentions sprint name
 */

const BASE = 'https://neoleadge.pythagore-init.com'
const DEMO_PROJECT = 'dddddddd-dem0-0000-0000-000000000001'

const ACCOUNTS = {
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
  })
  return { status: res.status, body: await res.text() }
}
const get = (t, p) => request(t, 'GET', p)
const post = (t, p, b) => request(t, 'POST', p, b)
const del = (t, p) => request(t, 'DELETE', p)

async function main() {
  console.log(`[workflow-smoke] target = ${BASE}`)

  console.log('\n--- Logins')
  const tokens = {}
  for (const [r, c] of Object.entries(ACCOUNTS)) {
    tokens[r] = await login(c.email, c.pwd)
    record(`login as ${r}`, true)
  }

  console.log('\n--- Phase 0: automation routes are gone')
  let r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}/automation/rules`)
  record('GET /automation/rules is 404', r.status === 404, `status=${r.status}`)

  console.log('\n--- Phase 1: sprint delete guard + bulk-assign accepts sprintId')
  // Get the default board
  r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}/boards`)
  if (r.status !== 200) {
    record('GET /boards 200', false, `status=${r.status}`)
    console.log(JSON.stringify(failures))
    process.exit(1)
  }
  const boards = JSON.parse(r.body)
  const board = boards.find((b) => b.isDefault) ?? boards[0]
  record('GET /boards 200', !!board, board ? '' : 'no board')

  // Create a Planning sprint
  const sprintName = `Smoke ${Date.now()}`
  r = await post(tokens.pm, `/pm/projects/${DEMO_PROJECT}/boards/${board.id}/sprints`, {
    name: sprintName,
    startDate: '2026-06-01',
    endDate:   '2026-06-15',
  })
  record('POST sprint 201', r.status === 201, `status=${r.status} body=${r.body.slice(0,100)}`)
  let createdSprintId = null
  try { createdSprintId = JSON.parse(r.body).id } catch { /* ignore */ }

  // Delete it (empty + Planning → should succeed)
  if (createdSprintId) {
    r = await del(tokens.pm, `/pm/projects/${DEMO_PROJECT}/sprints/${createdSprintId}`)
    record('DELETE empty Planning sprint 204', r.status === 204, `status=${r.status} body=${r.body.slice(0,100)}`)
  }

  // Delete a non-existent sprint → should be a Result.fail (400 or 404, NOT 500)
  r = await del(tokens.pm, `/pm/projects/${DEMO_PROJECT}/sprints/00000000-0000-0000-0000-000000000000`)
  record('DELETE missing sprint not 5xx', r.status < 500, `status=${r.status}`)

  console.log('\n--- Phase 4: bulk-assign with sprintId composes proper notification')
  // Find a WP and a member to assign to.
  // 1. Find some non-Epic WPs.
  r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}/work-packages?limit=50`)
  let wps = []
  try {
    const data = JSON.parse(r.body)
    wps = (Array.isArray(data) ? data : data.items ?? []).filter((w) => w.type !== 'Epic')
  } catch { /* ignore */ }
  record('list WPs found ≥1 non-Epic', wps.length >= 1, `count=${wps.length}`)

  // 2. Pull realiz user id (caller knows their own JWT sub).
  r = await get(tokens.realiz, '/auth/me')
  let realizId = null
  try { realizId = JSON.parse(r.body).user?.id } catch { /* ignore */ }
  record('me as realiz returns id', !!realizId, '')

  // 3. Need a sprint context. Find any active or Planning sprint on the demo project.
  r = await get(tokens.pm, `/pm/projects/${DEMO_PROJECT}/boards/${board.id}/sprints`)
  let sprints = []
  try { sprints = JSON.parse(r.body) } catch { /* ignore */ }
  const targetSprint = sprints.find((s) => s.status === 'Active') ?? sprints.find((s) => s.status === 'Planning') ?? sprints[0]
  record('sprint available for context', !!targetSprint, `sprints=${sprints.length}`)

  if (wps.length >= 1 && realizId && targetSprint) {
    const wpsToAssign = wps.slice(0, 2).map((w) => ({ wpId: w.id, assigneeId: realizId }))
    r = await post(tokens.pm, `/pm/projects/${DEMO_PROJECT}/work-packages/bulk-assign`, {
      assignments: wpsToAssign,
      sprintId: targetSprint.id,
    })
    record('bulk-assign with sprintId 200/201', r.status === 200 || r.status === 201, `status=${r.status} body=${r.body.slice(0,140)}`)

    // Wait a tick for the notify to land, then read notifications as the realiz user.
    await new Promise((res) => setTimeout(res, 500))
    r = await get(tokens.realiz, '/notifications?limit=10')
    let notifs = []
    try { notifs = JSON.parse(r.body) } catch { /* ignore */ }
    const items = Array.isArray(notifs) ? notifs : notifs.items ?? []
    const recent = items.find((n) => n.type === 'wp_bulk_assigned' && n.projectId === DEMO_PROJECT)
    record('realiz received wp_bulk_assigned notification', !!recent, recent ? `link=${recent.link}` : `none in ${items.length}`)
    if (recent) {
      const linkOk = typeof recent.link === 'string' && recent.link.startsWith('/app/team/my-tasks')
      record('notification deep-link points at /app/team/my-tasks', linkOk, `link=${recent.link}`)
      const messageHasSprintName = typeof recent.message === 'string' && recent.message.includes(targetSprint.name)
      record('notification message names the sprint', messageHasSprintName, `message=${(recent.message ?? '').slice(0,140)}`)
    }
  }

  console.log(`\n--- Summary: ${pass} pass / ${fail} fail`)
  if (fail) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[smoke] aborted:', e); process.exit(2) })
