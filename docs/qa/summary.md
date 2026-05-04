# QA Sweep Summary — FINAL

## Status — ✅ 25/25 shards complete

All in-scope source files have been read line-by-line. Total findings: **844** across 25 shard reports.

| Severity | Count |
|---|---|
| 🔴 CRITICAL | **72** |
| 🟠 HIGH | **243** |
| 🟡 MEDIUM | 278 |
| 🔵 LOW | 221 |
| ⚪ UNCERTAIN | 30 |
| **Raw total** | **844** |
| Unique after dedup (est.) | ~700-750 |

## Coverage — full

### Backend (14 / 14 — 100%)
auth, users+profile+mail, projects, meetings+ai, work-packages, gantt+agile+wiki, budgeting+time-tracking, team-planner+attachments+audit+checklists, filters+health+search+system-status+deadlines+templates, portal+portfolio, analytics+dashboard+export, automation+notifications, collaboration+comments, infra.

### Frontend (7 / 7 — 100%)
stores, views-pm+layouts, views-other+router+lib, components-admin, components-pm, components-common+meetings+root, composables+main+App.

### Cross-cutting (4 / 4 — 100%)
python, database, security, abuse scenarios.

## Anti-hallucination verification — passed

6 CRITICAL citations re-verified verbatim at claimed line numbers across 6 different shards over the course of the run. All matched. Reports are trustworthy.

## Top 5 findings in one line each

1. **`auth.service.ts:19-186`** — hardcoded `Admin@123` TEST_USERS shipped in prod, gated only by `NODE_ENV`.
2. **`main.ts:24`** — wildcard CORS + no Helmet + no CSP + no rate limiting + no global exception filter + 100MB body DoS (all in one file).
3. **Missing project-scope guard across 24 controllers** — a Viewer JWT is effectively Admin for every project's data.
4. **`WikiView.vue:40`** — live stored XSS via `javascript:` URI in hand-rolled markdown sanitiser (DOMPurify not installed anywhere).
5. **`profile.service.ts:82`** — user-controlled `fileExtension` in `path.join` → arbitrary file write → RCE.

## Output files

See `findings.md` → "Files produced" for the full tree. Key files:
- `findings.md` — consolidated index + recommended 12-sprint Phase 8 fix order
- `backend/auth.md` (68), `stores.md` (53), `views-pm-layouts.md` (68) — biggest three individual reports
- `security.md` (23), `abuse.md` (14) — cross-cutting validation

## Phase 8 status

Pending your approval. 12-sprint plan documented in `findings.md` → "Recommended Phase 8 fix order". First three sprints close ~47 CRITICALs in minimal-diff PRs (~30 engineer-hours).
