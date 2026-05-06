// Run inside the server container — exercises the demo project's API surface.
import http from 'http'
import { createRequire } from 'module'
const require = createRequire('/app/')
const jwt = require('jsonwebtoken')

const PID = 'dddddddd-dem0-0000-0000-000000000001'
const ADMIN_ID = '525e5c6d-64c5-49e5-a1a3-22727dd20757'
const tok = jwt.sign(
  { sub: ADMIN_ID, email: 'admin@neoleadge.com', role: 'Admin', firstName: 'A', lastName: 'A', tokenVersion: 1, aud: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: '5m', algorithm: 'HS256' },
)

function call(path) {
  return new Promise((r) => {
    const req = http.request(
      { hostname: 'localhost', port: 3000, path, method: 'GET', headers: { authorization: 'Bearer ' + tok } },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => r({ status: res.statusCode, body: d }))
      },
    )
    req.on('error', (e) => r({ status: 0, body: e.message }))
    req.end()
  })
}

const routes = [
  `/pm/projects/${PID}`,
  `/pm/projects/${PID}/members`,
  `/pm/projects/${PID}/work-packages?limit=50`,
  `/pm/projects/${PID}/meetings`,
  `/pm/projects/${PID}/milestones`,
  `/pm/projects/${PID}/cahier-des-charges/saved`,
  `/pm/projects/${PID}/cahier-des-charges/versions`,
  `/pm/projects/${PID}/boards`,
  `/pm/projects/${PID}/time-entries`,
]

for (const p of routes) {
  const r = await call(p)
  let summary = r.body.slice(0, 100)
  try {
    const j = JSON.parse(r.body)
    if (Array.isArray(j)) summary = `array(${j.length})`
    else if (j.members) summary = `members=${j.members.length} pm=${j.projectManagerId?.slice(0, 8)}`
    else if (j.items) summary = `items=${j.items.length}`
    else if (j.versions) summary = `versions=${j.versions.length}`
    else if (j.aiContent) summary = `cahier sections=${Object.keys(j.aiContent).length}`
    else if (j.name) summary = `project=${j.name}`
  } catch {}
  console.log(String(r.status).padEnd(4), p, '->', summary)
}
