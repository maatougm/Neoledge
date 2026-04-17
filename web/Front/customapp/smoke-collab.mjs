/**
 * @file smoke-collab.mjs — Two-browser real-time collaboration test.
 *
 * Launches two browser contexts (admin + PM) both on the same project's
 * Kanban board. When admin moves a card via API, the PM's board should
 * receive a `card-moved` socket event and the DOM should update without
 * a full refresh.
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const API_BASE = 'http://localhost:5122'
const BASE = 'http://localhost:5174/Sample/Front'

async function getToken(email, password) {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await r.json()).jwt
}

async function run() {
  const adminToken = await getToken('admin@neoleadge.com', 'Admin@123')
  const pmToken = await getToken('testpm@neoleadge.test', 'TestPm@123')

  // Use the specific seeded project that has populated kanban cards
  const projectsRes = await fetch(`${API_BASE}/admin/project`, { headers: { Authorization: `Bearer ${adminToken}` } })
  const d = await projectsRes.json()
  const items = Array.isArray(d) ? d : d.items
  // Prefer a specific seeded project with known cards
  const preferred = items.find((p) => p.id === 'bbbbbbbb-0001-0000-0000-000000000000')
  const projectId = preferred?.id ?? items.find((p) => p.id.startsWith('bbbbbbbb-0001'))?.id ?? items[0].id

  // Ensure there's a board + a WP to move
  const boardsRes = await fetch(`${API_BASE}/pm/projects/${projectId}/boards`, { headers: { Authorization: `Bearer ${adminToken}` } })
  const boards = await boardsRes.json()
  const board = boards[0]
  if (!board) throw new Error('No board')

  const fullBoardRes = await fetch(`${API_BASE}/pm/projects/${projectId}/boards/${board.id}`, { headers: { Authorization: `Bearer ${adminToken}` } })
  const fullBoard = await fullBoardRes.json()
  const cols = fullBoard.columns ?? []
  const srcCol = cols.find((c) => (c.workPackages ?? []).length > 0)
  const dstCol = cols.find((c) => c.id !== srcCol?.id)
  if (!srcCol || !dstCol) throw new Error('Need at least 2 columns and a WP')
  const wp = srcCol.workPackages[0]
  console.log(`Will move WP "${wp.title}" from "${srcCol.name}" → "${dstCol.name}"`)

  const browser = await chromium.launch({ headless: true })

  // Admin context
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await adminCtx.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: adminToken })
  await adminCtx.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))

  // PM context
  const pmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await pmCtx.addInitScript(({ t }) => { try { localStorage.setItem('nl_jwt', t) } catch {} }, { t: pmToken })
  await pmCtx.route('**/config.json*', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ GLB_API_URL: API_BASE, GLB_ELISE_URL: '' }),
  }))

  const adminPage = await adminCtx.newPage()
  const pmPage = await pmCtx.newPage()

  // Diagnostic: capture PM client console + WS frames + WebSocket events
  const pmDiag = []
  pmPage.on('console', (m) => {
    const t = m.text()
    pmDiag.push(`[${m.type()}] ${t.slice(0, 200)}`)
  })
  pmPage.on('pageerror', (e) => pmDiag.push(`[error] ${e.message.slice(0, 200)}`))
  pmPage.on('websocket', (ws) => {
    pmDiag.push(`[ws-open] ${ws.url()}`)
    ws.on('framesent', (f) => pmDiag.push(`[ws-send] ${(f.payload || '').slice(0, 100)}`))
    ws.on('framereceived', (f) => pmDiag.push(`[ws-recv] ${(f.payload || '').slice(0, 100)}`))
    ws.on('close', () => pmDiag.push('[ws-close]'))
  })

  // Both navigate to the project board
  await Promise.all([
    adminPage.goto(`${BASE}/app/pm/projects/${projectId}/board`, { waitUntil: 'networkidle', timeout: 15000 }),
    pmPage.goto(`${BASE}/app/pm/projects/${projectId}/board`, { waitUntil: 'networkidle', timeout: 15000 }),
  ])
  // Let the Socket.IO connect, authenticate, and the join-project message complete.
  // Real-world this happens in 200-500ms but headless Chromium needs more headroom.
  await adminPage.waitForTimeout(3000)
  await pmPage.waitForTimeout(3000)

  // Record PM's "card-moved" socket events
  const pmCardMoved = []
  await pmPage.addInitScript(() => {
    window.__cardMovedEvents__ = []
  })
  // Alternative approach: inject a MutationObserver on the kanban content
  // so we can detect DOM changes caused by the remote update.
  const observerPromise = pmPage.evaluate(async () => {
    return new Promise((resolve) => {
      const start = Date.now()
      const kb = document.querySelector('.kb')
      if (!kb) return resolve({ detected: false, reason: 'no .kb container' })
      const observer = new MutationObserver(() => {
        observer.disconnect()
        resolve({ detected: true, elapsed: Date.now() - start })
      })
      observer.observe(kb, { childList: true, subtree: true, attributes: true })
      setTimeout(() => { observer.disconnect(); resolve({ detected: false, elapsed: Date.now() - start }) }, 5000)
    })
  })
  // Tiny delay to make sure the observer is attached before we trigger the move
  await pmPage.waitForTimeout(200)

  // Admin triggers the card move via API (same as UI drag would)
  const moveRes = await fetch(
    `${API_BASE}/pm/projects/${projectId}/boards/${board.id}/cards/${wp.id}/move`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ columnId: dstCol.id, position: 0 }),
    },
  )
  const moveOk = moveRes.ok

  const obsResult = await observerPromise

  // Move the card back so we don't leave state drift
  await fetch(
    `${API_BASE}/pm/projects/${projectId}/boards/${board.id}/cards/${wp.id}/move`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ columnId: srcCol.id, position: wp.position ?? 0 }),
    },
  )

  // Read socket connection state from PM client
  const socketState = await pmPage.evaluate(() => {
    // useCollaborationSocket exposes a singleton socket on `window` for debugging if patched;
    // otherwise we can't introspect. Best-effort.
    return { url: location.pathname }
  })
  console.log('PM diag log:', pmDiag.length ? pmDiag.slice(-10) : '(empty)')
  console.log('PM page url:', socketState.url)

  await browser.close()

  const pass = moveOk && obsResult.detected
  const result = {
    moveStatus: moveRes.status,
    pmObserverDetectedChange: obsResult.detected,
    pmElapsedMs: obsResult.elapsed ?? null,
    pass,
  }
  writeFileSync('/tmp/smoke-collab.json', JSON.stringify(result, null, 2))

  console.log(`\nMove API:                ${moveOk ? '✓ 200' : `✗ ${moveRes.status}`}`)
  console.log(`PM saw DOM change:       ${obsResult.detected ? `✓ after ${obsResult.elapsed}ms` : '✗ no change in 5s'}`)
  console.log(`\n${pass ? 'PASS' : 'FAIL'}`)
  process.exit(pass ? 0 : 1)
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1) })
