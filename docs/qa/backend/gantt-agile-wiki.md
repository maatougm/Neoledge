# QA report — Gantt, Agile, Wiki modules

**Files opened:**
- `web/back-nest/src/gantt/gantt.controller.ts` (95 lines)
- `web/back-nest/src/gantt/gantt.module.ts` (13 lines)
- `web/back-nest/src/gantt/gantt.service.ts` (176 lines)
- `web/back-nest/src/agile/agile.controller.ts` (160 lines)
- `web/back-nest/src/agile/agile.module.ts` (14 lines)
- `web/back-nest/src/agile/agile.service.ts` (307 lines)
- `web/back-nest/src/agile/agile.service.spec.ts` (58 lines)
- `web/back-nest/src/wiki/wiki.controller.ts` (106 lines)
- `web/back-nest/src/wiki/wiki.module.ts` (11 lines)
- `web/back-nest/src/wiki/wiki.service.ts` (207 lines)
- `web/back-nest/src/wiki/wiki.service.spec.ts` (80 lines)

Supporting evidence files consulted (not modified): `web/back-nest/prisma/schema.prisma`, `web/back-nest/src/collaboration/collaboration.gateway.ts`.

---

## CRITICAL / HIGH findings

### [CRITICAL] Wiki routes have no project-membership IDOR check — any authenticated user can read/write/delete/restore any project's wiki
- File: `web/back-nest/src/wiki/wiki.controller.ts:10-11` (and every handler 13-104)
- Category: auth|idor
- Evidence:
```ts
@Controller('pm/projects/:projectId/wiki')
@UseGuards(JwtAuthGuard)
export class WikiController {
  constructor(private readonly service: WikiService) {}
```
And the service queries use `projectId` verbatim from the URL with no membership check. Example — read:
```ts
async getBySlug(projectId: string, slug: string) {
  ...
  const page = await this.prisma.wikiPage.findFirst({
    where: { projectId, slug, isDeleted: false },
```
- Impact: Any user with a valid JWT (e.g., a `Viewer` attached to project A) can read, create, update, soft-delete and restore wiki pages of project B by simply changing the `:projectId` URL segment. No `@Roles(...)` and no PM/membership lookup is performed anywhere in the wiki module.
- Fix: Apply `RolesGuard` or an explicit project-membership guard (check `ProjectRoleAssignment` / `Project.projectManagerId` like `projects.service.ts` does) on every wiki route, and validate that the authenticated user is a member of `projectId` before hitting Prisma.

### [CRITICAL] Gantt & Agile controllers have no role or project-membership enforcement
- File: `web/back-nest/src/gantt/gantt.controller.ts:8-11`, `web/back-nest/src/agile/agile.controller.ts:5-8`
- Category: auth|idor
- Evidence:
```ts
@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class GanttController {
```
```ts
@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class AgileController {
```
No `RolesGuard`, no `@Roles('ProjectManager','Admin')`, no project-scope validation. Services then query Prisma by `projectId` supplied by the client.
- Impact: Any authenticated user (e.g. `Viewer`, `DeploymentTeam`, or a PM scoped to a different project) can:
  - Read the full Gantt / milestones / baselines of any project (`GET /pm/projects/:projectId/gantt`).
  - Create / update / delete milestones, capture / delete baselines.
  - Read and modify any board / column / sprint, move cards cross-project, start/close sprints, change burndown data.
  - See `CLAUDE.md` § "Admin routes on new modules use `@Roles('Admin')`" — this stack is explicitly required and missing here.
- Fix: Add `RolesGuard` and `@Roles('Admin','ProjectManager')` on controller classes, plus a project-membership check for PMs. Mirror the pattern used in `portfolio.controller.ts` / `time-tracking.controller.ts`.

### [CRITICAL] `moveCard` authorization: cross-board / cross-project card move is possible by ID
- File: `web/back-nest/src/agile/agile.service.ts:161-178`
- Category: idor|auth
- Evidence:
```ts
async moveCard(workPackageId: string, boardColumnId: string | null, position: number) {
  try {
    const col = boardColumnId ? await this.prisma.boardColumn.findUnique({ where: { id: boardColumnId } }) : null;
    const data: Record<string, unknown> = { boardColumnId, position };
    if (col?.mapStatus) data.status = col.mapStatus;
    const wp = await this.prisma.workPackage.update({ where: { id: workPackageId }, data });
```
Controller `web/back-nest/src/agile/agile.controller.ts:79-87` never validates that `:projectId`, `:id` (board), the card, and the target column are all from the same project:
```ts
@Patch('boards/:id/cards/:wpId/move')
async moveCard(
  @Param('wpId') wpId: string,
  @Body() body: { columnId: string | null; position?: number },
) {
  const r = await this.service.moveCard(wpId, body.columnId, body.position ?? 0);
```
- Impact:
  1. An attacker with any valid JWT can send `PATCH /pm/projects/<anyProjectId>/boards/<anyBoardId>/cards/<anyWpId>/move` with `columnId` belonging to yet another project. The service re-parents the WP to a column of a different board/project and overwrites `status` with `col.mapStatus`. Combined with finding #2 this silently corrupts other tenants' boards.
  2. The `projectId` URL segment is completely ignored in `moveCard`.
  3. `collab.broadcastCardMoved(wp.projectId, …)` then leaks the cross-project update to subscribers of that other project.
- Fix: In `moveCard`, load the WP with `projectId` + `boardColumnId.boardId`, assert the target column's `board.projectId === wp.projectId === urlProjectId`, reject otherwise. Add membership check per finding #2.

### [CRITICAL] Gantt baseline snapshot has no uniqueness / duplicate guard — re-capturing same `snapshotName` silently duplicates every row
- File: `web/back-nest/src/gantt/gantt.service.ts:104-124`
- Category: logic|validation
- Evidence:
```ts
async captureBaseline(projectId: string, snapshotName: string, createdById: string) {
  try {
    const wps = await this.prisma.workPackage.findMany({ where: { projectId, isDeleted: false } });
    await this.prisma.ganttBaseline.createMany({
      data: wps.map((wp) => ({
        projectId,
        workPackageId: wp.id,
        snapshotName,
        ...
      })),
    });
    return Result.ok({ snapshotName, count: wps.length });
```
Prisma schema (`schema.prisma:769-784`) has no `@@unique([projectId, snapshotName, workPackageId])` on `GanttBaseline`. `compareBaseline` therefore will emit duplicate rows, and `listBaselines` will show inflated `wpCount`.
- Impact:
  - Unbounded table growth: calling `POST /baselines` with an existing `snapshotName` duplicates every WP row each time — no error is thrown, `count` returned to the client is misleading.
  - Storage/perf: repeated captures on a 500-WP project balloon the table with each click.
  - `compareBaseline` returns duplicated drift rows, corrupting the report.
  - Can be weaponised as a cheap disk-fill DoS via finding #2.
- Fix:
  1. Add a unique composite index on `GanttBaseline(projectId, snapshotName, workPackageId)` (raw SQL — `prisma db push` is banned per `CLAUDE.md`).
  2. In `captureBaseline`, reject if `ganttBaseline.count({ projectId, snapshotName }) > 0`, or upsert; also trim/validate `snapshotName` length (column is `VARCHAR(120)`).
  3. Run the whole insert inside a transaction so a failure halfway doesn't leave partial snapshots.

### [HIGH] Gantt baseline payload size — no projection, no pagination, dumps all `workPackage` columns
- File: `web/back-nest/src/gantt/gantt.service.ts:15-39`
- Category: logic|validation
- Evidence:
```ts
this.prisma.workPackage.findMany({
  where: { projectId, isDeleted: false, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
  include: {
    assignee: { select: { id: true, firstName: true, lastName: true } },
    dependenciesOut: { select: { toWpId: true, type: true } },
  },
  orderBy: [{ startDate: 'asc' }, { position: 'asc' }],
}),
```
Every column of `WorkPackage` (incl. `description: LongText` at `schema.prisma:642`) is serialised back over HTTP. No `select` clause, no `take` limit.
- Impact: On a project with thousands of WPs (OpenProject-parity goal) the JSON payload is multi-megabyte and contains full markdown descriptions that the Gantt view never renders. Real N+1 risk is bounded because everything is one query, but payload bloat is large.
- Fix: Add an explicit `select` with only Gantt-relevant fields (`id, title, status, priority, startDate, dueDate, percentDone, parentId, assigneeId, estimatedHours, position`). Optionally expose `?limit`/`?cursor`.

### [HIGH] `markMilestoneReached` race — read-modify-write without atomic check, can re-trigger automation
- File: `web/back-nest/src/gantt/gantt.service.ts:93-102`
- Category: race|logic
- Evidence:
```ts
async markMilestoneReached(id: string) {
  const r = await this.updateMilestone(id, { isReached: true });
  const ms = r.value as { projectId?: string; title?: string; date?: Date } | undefined;
  if (r.isSuccess && ms?.projectId) {
    void this.automation.executeRulesForEvent(ms.projectId, 'milestone_reached', {
      milestoneId: id, title: ms.title, date: ms.date,
    });
  }
  return r;
}
```
`updateMilestone` always fires the side-effect: two concurrent `POST /milestones/:id/reach` calls each see `isReached: false`, both set it `true`, and both fire `milestone_reached` automation rules. The plain `updateMilestone` called at `:69-82` also accepts `isReached` with no prior-state check.
- Impact: Duplicate notifications, duplicate automation side-effects (field updates, webhooks). Also, setting `isReached: false → true → false` via the generic PATCH will not fire the event, while a direct PATCH that goes `false → true` via `updateMilestone` won't fire it either, producing inconsistent behaviour.
- Fix: Use a conditional update with `WHERE isReached = false` and check `affectedRows === 1`, or do the transition inside `prisma.$transaction` with `SELECT ... FOR UPDATE`. Only emit the automation event when the transition actually happens. Forbid clients from toggling `isReached` through the generic PATCH handler.

### [HIGH] `listBoards` auto-create idempotency — concurrent first-open creates two default boards
- File: `web/back-nest/src/agile/agile.service.ts:33-51`
- Category: race|logic
- Evidence:
```ts
async listBoards(projectId: string) {
  try {
    const boards = await this.prisma.board.findMany({ where: { projectId }, ... });
    if (boards.length === 0) {
      const r = await this.createBoard(projectId, { name: 'Default Board', type: 'Kanban', isDefault: true });
      if (r.isSuccess && r.value) {
        return this.listBoards(projectId);
      }
    }
```
No DB-level uniqueness on `Board(projectId)` in `schema.prisma` (no unique constraint on `projectId`). Two parallel `GET /boards` on a cold project both see 0 rows and each call `createBoard`, producing two `isDefault=true` boards with a full 4-column set each.
- Impact: Duplicate default boards, duplicate 4 columns, subsequent card moves ambiguous, `boards[0]` order non-deterministic.
- Fix: Add `@@unique([projectId, isDefault])` (partial / filtered) — MariaDB lacks partial unique, so alternative: put the auto-create inside `prisma.$transaction` with `SELECT ... FOR UPDATE` on a sentinel row, or make `createBoard` catch the unique violation. Even simpler: do the auto-create on project creation instead of at read time.

### [HIGH] `deleteColumn` leaves WPs with stale `boardColumnId` FK — but FK is `NoAction`, so delete throws and is silently swallowed
- File: `web/back-nest/src/agile/agile.service.ts:141-148`
- Category: logic|validation
- Evidence:
```ts
async deleteColumn(columnId: string) {
  try {
    await this.prisma.boardColumn.delete({ where: { id: columnId } });
    return Result.ok<void>();
  } catch {
    return Result.fail<void>('Échec de la suppression.');
  }
}
```
Schema (`schema.prisma:668`): `boardColumn BoardColumn? @relation(fields: [boardColumnId], references: [id], onDelete: NoAction, onUpdate: NoAction)`.
- Impact: If the column has any WP attached, the FK rejects — user sees the generic "Échec de la suppression." with no hint. The catch block also hides the real error (Prisma code `P2003`) from the logs (no `logger.error`). And because the FK is `NoAction`, WPs are never orphaned — but the UX is poor and operators cannot diagnose.
- Fix: Before delete, `updateMany` attached WPs to a nullable target column (or set `boardColumnId = null`), wrap in a transaction, return a specific error like `"Déplacez d'abord les cartes."`, and log the real exception.

### [HIGH] `reorderColumns` is not atomic and may break `UNIQUE`-ish position invariants
- File: `web/back-nest/src/agile/agile.service.ts:150-159`
- Category: race|logic
- Evidence:
```ts
async reorderColumns(boardId: string, order: string[]) {
  try {
    await Promise.all(order.map((id, idx) =>
      this.prisma.boardColumn.update({ where: { id }, data: { position: idx } }),
    ));
```
- Impact: No `boardId` verification — caller can reorder columns of another board (IDOR). No transaction: partial failure leaves inconsistent positions. No check that `order` covers exactly the board's column set; passing only a subset leaves omitted columns with stale positions, passing extras silently moves columns from other boards.
- Fix: Load all columns for `boardId`, assert `order` is an exact permutation, then run updates inside `prisma.$transaction`. Validate each id belongs to `boardId`.

### [HIGH] Sprint state machine — no transitions enforcement; burndown divides by `totalDays` that can be 0 for same-day sprint
- File: `web/back-nest/src/agile/agile.service.ts:238-254`, `277-305`
- Category: logic|validation
- Evidence:
```ts
async startSprint(id: string) {
  const r = await this.updateSprint(id, { status: 'Active' });
  ...
}
async closeSprint(id: string) {
  const r = await this.updateSprint(id, { status: 'Closed' });
```
```ts
const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

for (let i = 0; i <= totalDays; i++) {
  ...
  const ideal = totalHours - (totalHours * i) / totalDays;
```
- Impact:
  - State machine: you can start an already-Closed sprint, close a Planning sprint, close a Closed sprint, or have two concurrent Active sprints on the same board. No invariant, no transitions. The generic `updateSprint` at `:213-227` also accepts any `status: string` from the client.
  - Burndown division-by-zero is *partially* guarded by `Math.max(1, ...)`, which is fine. But `endDate < startDate` produces a negative `totalDays`, then `Math.max(1, negative)=1`, and `i<=1` loops producing misleading graph. `start` is mutated by `d.setDate(start.getDate() + i)` (see below).
  - `d.setDate(start.getDate() + i)` **mutates `start`** each iteration. Because `d` is `new Date(start)`, `start` itself stays put — but `start.getDate()` returns day-of-month which overflows around month boundaries, so on `i=30` for a sprint starting Apr 15, `start.getDate()+i = 45`, JavaScript converts to May 15. This is actually correct because `setDate` normalizes, but the code is reading `start.getDate()` every iteration instead of the cleaner `start.getTime() + i*DAY_MS`. [UNCERTAIN] whether this actually misbehaves across DST boundaries; it could drift by an hour.
  - `remaining` filter: `new Date(wp.updatedAt) >= d || wp.status !== 'Closed'` is a logical OR, not an AND, so a WP that was closed before `d` but updated recently still counts as remaining. The burndown is effectively always the current remaining hours for every day, never actually burning down historically. [UNCERTAIN] whether this was intentional.
- Fix:
  - Reject invalid transitions (`Planning → Active → Closed` only); optionally forbid `updateSprint` from receiving `status`.
  - Enforce at most one `Active` sprint per board (DB unique partial index or app-level check).
  - Rewrite `remaining` historical computation properly (requires historical WP state — e.g., a `WorkPackageHistory`/audit trail) or at minimum use AND logic and document limitation.
  - Clamp `endDate > startDate` before compute.

### [HIGH] `addWpToSprint` cross-project bulk — no check that WPs belong to the sprint's project
- File: `web/back-nest/src/agile/agile.service.ts:256-266`
- Category: idor|validation
- Evidence:
```ts
async addWpToSprint(sprintId: string, workPackageIds: string[]) {
  try {
    await this.prisma.workPackage.updateMany({
      where: { id: { in: workPackageIds } },
      data: { sprintId },
    });
```
- Impact: A caller can attach WPs from project A to a sprint of project B. The FK `WorkPackage.sprintId → Sprint.id (NoAction)` allows it because Prisma doesn't enforce business rules. Combined with finding #2, any authenticated user can mass-hijack another project's sprint backlog.
- Fix: Load the sprint to get `sprint.board.projectId`, then include `where: { id: { in: ids }, projectId: sprint.board.projectId }` in the `updateMany`. Return `{ matched, updated }` for caller feedback.

### [HIGH] Wiki slug uniqueness race — check-then-insert window
- File: `web/back-nest/src/wiki/wiki.service.ts:51-69`
- Category: race|logic
- Evidence:
```ts
let slug = slugify(dto.title);
let i = 1;
while (await this.prisma.wikiPage.findFirst({ where: { projectId, slug } })) {
  slug = `${slugify(dto.title)}-${i++}`;
}
const page = await this.prisma.wikiPage.create({
  data: { projectId, title: dto.title, slug, ... },
});
```
Schema (`schema.prisma:884`) has `@@unique([projectId, slug])` — good defense-in-depth — but two concurrent `create` requests with the same title can both pass the `while` and one will get `P2002` unique-violation, caught by the outer try/catch and returned as generic "Échec de la création." with no retry.
- Impact: Concurrent creates intermittently fail with a generic message that blames the server, not the conflict. Under load, users see flaky creation. The loop is also O(N) — a title with 1000 existing duplicates hits the DB 1000 times.
- Fix: On `P2002` catch, retry with `-${Date.now()}` suffix or increment a counter. Better: compute candidate, attempt insert, on conflict append a random 4-char suffix and retry once. Or use a single SQL round-trip: `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(slug,'-', -1) AS UNSIGNED)),0) FROM WikiPages WHERE projectId=? AND slug LIKE ?`.

### [HIGH] Wiki `movePage` has no cycle detection — parent can become descendant
- File: `web/back-nest/src/wiki/wiki.service.ts:130-139`
- Category: logic|validation
- Evidence:
```ts
async movePage(projectId: string, slug: string, parentId: string | null) {
  try {
    const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug } });
    if (!p) return Result.fail('Page introuvable.');
    const updated = await this.prisma.wikiPage.update({ where: { id: p.id }, data: { parentId } });
    return Result.ok(updated);
```
- Impact:
  - You can set `parentId = p.id` (self-parent) — the schema relation is self-referential with no CHECK constraint — making a page its own parent.
  - You can set `parentId` to one of `p`'s descendants, creating an orphan cycle in the tree. `getPageTree` then returns pages that are unreachable from the root.
  - Cross-project move: `parentId` is only validated by FK existence, not by `projectId`. A user could set a wiki page's parent to a page belonging to another project.
- Fix: Walk upward from the new `parentId` to root; if you encounter `p.id`, reject. Also load the candidate parent and assert `parent.projectId === p.projectId` and `parent.isDeleted === false`.

### [HIGH] Wiki revision restore has no authorization / ownership check
- File: `web/back-nest/src/wiki/wiki.service.ts:170-187`, `web/back-nest/src/wiki/wiki.controller.ts:94-104`
- Category: auth|idor
- Evidence:
```ts
async restoreRevision(projectId: string, slug: string, version: number, authorId: string) {
  try {
    const page = await this.prisma.wikiPage.findFirst({ where: { projectId, slug } });
    if (!page) return Result.fail('Page introuvable.');
    const rev = await this.prisma.wikiRevision.findUnique({
      where: { wikiPageId_version: { wikiPageId: page.id, version } },
    });
    if (!rev) return Result.fail('Révision introuvable.');
    return this.update(
      projectId, slug,
      { title: rev.title, content: rev.content, comment: `Restored from v${version}` },
      authorId,
    );
```
- Impact: Compounds finding #1 — any JWT can overwrite any wiki page with any prior revision of any project. Also, `getRevision` and `listRevisions` don't filter `isDeleted`, so users can restore from a soft-deleted page they shouldn't see. No audit-log entry is written for the restore.
- Fix: Add membership/role guard (finding #1). Also require an explicit audit record of who performed the restore and from which version.

### [HIGH] Wiki markdown stored **raw** — XSS risk depends on frontend sanitisation
- File: `web/back-nest/src/wiki/wiki.service.ts:59-68`, `87-101`
- Category: xss
- Evidence:
```ts
const page = await this.prisma.wikiPage.create({
  data: {
    projectId,
    title: dto.title,
    slug,
    content: dto.content ?? '',
    ...
```
No sanitisation of `content` (markdown or HTML) on write. Title is `VARCHAR(255)` but never trimmed/validated beyond `!dto.title?.trim()`.
- Impact: If the frontend `WikiView` renders markdown with `v-html` or any `rehype-raw`-equivalent that allows raw HTML, a user can store `<script>` / `<img onerror>` / `javascript:` URIs — classic stored XSS. Attacks land under an authenticated PM/Admin context, so cookie-theft or CSRF-token theft is possible.
- Fix: Sanitise on **write** (defence-in-depth): strip `<script>`, event handlers, `javascript:` URIs server-side with `sanitize-html` or `DOMPurify`-equivalent. Also sanitise on render. Document expectation that content is markdown-only, not HTML. [UNCERTAIN] on frontend — did not read `WikiView.vue` — so the concrete XSS impact depends on that component's renderer.

### [HIGH] Wiki search — user-controlled `q` flows directly into Prisma `contains`; not SQL-injectable but enables full-text DoS
- File: `web/back-nest/src/wiki/wiki.service.ts:189-205`
- Category: validation|logic
- Evidence:
```ts
async search(projectId: string, q: string) {
  try {
    if (!q?.trim()) return Result.ok([]);
    const pages = await this.prisma.wikiPage.findMany({
      where: {
        projectId,
        isDeleted: false,
        OR: [{ title: { contains: q } }, { content: { contains: q } }],
      },
      select: { id: true, title: true, slug: true, updatedAt: true },
      take: 50,
    });
```
- Impact:
  - **SQL injection**: Prisma parameterises `contains` so there is no classical SQLi on `q` itself. Not vulnerable.
  - **DoS**: `content` is `LONGTEXT` with no FULLTEXT index on `(title, content)` in `schema.prisma`. `WHERE content LIKE '%<q>%'` is an unindexed full scan of all wiki content in the DB. A single-character `q` scans everything; a pathological regex-looking pattern still walks every row. With no per-user rate limit this is a trivial DoS.
  - No minimum length — single-character / empty-after-trim searches slam the DB.
  - `take: 50` limits payload but not scan cost.
  - Missing IDOR guard from finding #1 means a user can DoS search across **any** project's content.
- Fix: Require `q.length >= 3` and `<= 100`. Add a MySQL FULLTEXT index `FULLTEXT(title, content)` and use raw SQL `MATCH ... AGAINST` or Prisma's `search` mode (if supported by MariaDB adapter — [UNCERTAIN], Prisma's `search` is Postgres-specific). Rate-limit the endpoint.

---

## MEDIUM findings

### [MEDIUM] `deleteBaseline` and `deleteMilestone` are unauthenticated against project ownership
- File: `web/back-nest/src/gantt/gantt.controller.ts:47-52`, `81-86`
- Category: idor
- Evidence:
```ts
@Delete('milestones/:id')
@HttpCode(HttpStatus.NO_CONTENT)
async deleteMs(@Param('id') id: string) {
  const r = await this.service.deleteMilestone(id);
```
Service at `:84-91`:
```ts
async deleteMilestone(id: string) {
  try {
    await this.prisma.milestone.delete({ where: { id } });
```
- Impact: `:projectId` URL segment is never used, so a user can delete any milestone by guessing the id, even a project they have no access to. Same pattern for `reachMs`.
- Fix: Always load the entity, compare `entity.projectId === urlProjectId`, and check membership.

### [MEDIUM] `compareBaseline` N+1 risk is absent, but returns rows for deleted WPs with `delta: 0`
- File: `web/back-nest/src/gantt/gantt.service.ts:150-174`
- Category: logic
- Evidence:
```ts
const drift = baselines.map((b) => {
  const wp = currentMap.get(b.workPackageId);
  return {
    workPackageId: b.workPackageId,
    title: wp?.title ?? '(deleted)',
    baseline: { startDate: b.startDate, dueDate: b.dueDate, percentDone: b.percentDone },
    current: wp ? { startDate: wp.startDate, dueDate: wp.dueDate, percentDone: wp.percentDone } : null,
    delta: wp && b.dueDate && wp.dueDate
      ? Math.round((new Date(wp.dueDate).getTime() - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0,
  };
});
```
- Impact: Deleted WPs produce `delta: 0` masking large drift. Also the baseline captures `estimatedHours` and `percentDone` (`:115`) but the comparison never surfaces estimatedHours drift.
- Fix: Return `delta: null` when WP missing; also compute `estimatedHoursDelta` and `percentDoneDelta`.

### [MEDIUM] `createMilestone` / `createSprint` accept arbitrary `Date` parsing; no bound/ordering checks
- File: `web/back-nest/src/gantt/gantt.service.ts:50-67`, `web/back-nest/src/agile/agile.service.ts:193-211`
- Category: validation
- Evidence:
```ts
date: new Date(dto.date),
```
```ts
startDate: new Date(dto.startDate),
endDate: new Date(dto.endDate),
```
- Impact: `new Date('not-a-date')` produces `Invalid Date`, Prisma rejects with `P2007` which is caught and returned as "Échec de la création." — poor UX. Also `endDate < startDate` is accepted (sprint). No `workPackageId` existence/project check on milestone create.
- Fix: Parse with a schema (class-validator `@IsISO8601()` + `@ValidateIf`) and assert ordering; validate `workPackageId.projectId === projectId`.

### [MEDIUM] `createColumn` race on `position`
- File: `web/back-nest/src/agile/agile.service.ts:120-130`
- Category: race
- Evidence:
```ts
const max = await this.prisma.boardColumn.aggregate({ where: { boardId }, _max: { position: true } });
const col = await this.prisma.boardColumn.create({
  data: { boardId, name: dto.name, wipLimit: dto.wipLimit, mapStatus: dto.mapStatus, position: (max._max.position ?? -1) + 1 },
});
```
- Impact: Two parallel create-column requests compute the same `max.position` and both insert with the same position. Not a unique-constraint violation (position has no unique), but the UI shows two columns at the same rank.
- Fix: Run in a transaction with `SELECT ... FOR UPDATE`, or use `UPDATE ... position = position + 1 WHERE boardId=? AND position >= ?` shift pattern, or simply append using `COUNT(*)`.

### [MEDIUM] Controller-level input validation weak: no class-validator DTOs anywhere
- File: all three controllers — e.g. `web/back-nest/src/gantt/gantt.controller.ts:31`, `web/back-nest/src/wiki/wiki.controller.ts:38`
- Category: validation
- Evidence:
```ts
@Body() dto: { title: string; date: string; description?: string; color?: string; workPackageId?: string },
```
- Impact: `CLAUDE.md` explicitly warns: "DTOs must be classes, not interfaces, when used with `@Body()` — `ValidationPipe` with `whitelist: true` will strip all fields because metatype resolves to `Object`." These are inline TS types — under global `whitelist: true` pipe, every field can be stripped at runtime. Whether fields actually get stripped depends on the global pipe config ([UNCERTAIN] — did not inspect `main.ts`). If whitelist is off, request bodies are not validated at all.
- Fix: Convert every inline type to a `class` with `class-validator` decorators (`@IsString`, `@IsOptional`, `@IsISO8601`, `@IsUUID`, `@MaxLength`). This is a CLAUDE.md mandated pattern.

### [MEDIUM] `getBoard` exposes cross-project data if called with wrong `:projectId`
- File: `web/back-nest/src/agile/agile.controller.ts:17-22`, `web/back-nest/src/agile/agile.service.ts:53-78`
- Category: idor
- Evidence:
```ts
@Get('boards/:id')
async getBoard(@Param('id') id: string) {
  const r = await this.service.getBoard(id);
```
- Impact: `:projectId` is not passed to `getBoard`. A user with access to project A can read a board in project B by guessing its id. Combined with finding #2 this is fully exploitable.
- Fix: Pass `projectId` and `where: { id, projectId }`.

### [MEDIUM] `reorderColumns` return value discards the board list
- File: `web/back-nest/src/agile/agile.controller.ts:72-77`
- Category: logic
- Evidence:
```ts
async reorderColumns(@Param('id') boardId: string, @Body() body: { order: string[] }) {
  const r = await this.service.reorderColumns(boardId, body.order);
  if (r.isFailure) throw new BadRequestException(r.error);
  return { success: true };
}
```
- Impact: Frontend has to re-fetch the board after every reorder. Minor perf issue, not a security issue.
- Fix: Return the reordered columns.

### [MEDIUM] `search` does no wildcard escaping
- File: `web/back-nest/src/wiki/wiki.service.ts:192-200`
- Category: validation
- Evidence:
```ts
OR: [{ title: { contains: q } }, { content: { contains: q } }],
```
- Impact: Prisma's `contains` does not interpret `%` / `_` as wildcards (it's literal `LIKE '%<q>%'` with escaping in the adapter). [UNCERTAIN] whether `@prisma/adapter-mariadb` escapes `%`/`_` — most Prisma adapters do not escape these, meaning `q='%'` matches **everything** and `q='_'` matches any single char, amplifying the DoS in finding #15. Worth auditing.
- Fix: Escape `%` `_` `\` in `q` server-side before passing to `contains`.

### [MEDIUM] Wiki `getRevision` / `listRevisions` / `restoreRevision` do not filter `isDeleted`
- File: `web/back-nest/src/wiki/wiki.service.ts:141-187`
- Category: logic
- Evidence:
```ts
async listRevisions(projectId: string, slug: string) {
  try {
    const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug } });
```
No `isDeleted: false`.
- Impact: Soft-deleted pages' revisions remain readable and restorable. The restore then re-activates a deleted page silently — no `isDeleted: false` flip — so the page is technically restored but remains hidden from the tree.
- Fix: Include `isDeleted: false` in these queries, or explicitly flip `isDeleted=false` on restore and document it.

### [MEDIUM] `updateMilestone` `isReached` flip via generic PATCH skips automation
- File: `web/back-nest/src/gantt/gantt.controller.ts:40-45`, `web/back-nest/src/gantt/gantt.service.ts:69-82`
- Category: logic
- Evidence:
```ts
@Patch('milestones/:id')
async updateMs(@Param('id') id: string, @Body() dto: { title?: string; date?: string; description?: string; color?: string; isReached?: boolean }) {
```
```ts
if (dto.isReached !== undefined) data.isReached = dto.isReached;
```
- Impact: A client that PATCHes `isReached: true` bypasses `markMilestoneReached` and therefore bypasses the automation event — inconsistent with the `/reach` endpoint.
- Fix: Either reject `isReached` in the generic PATCH, or also fire the event in `updateMilestone` when it transitions to true.

---

## LOW findings

### [LOW] `GanttController` `@Controller('pm/projects/:projectId')` route prefix includes unrelated paths
- File: `web/back-nest/src/gantt/gantt.controller.ts:8`
- Category: logic
- Evidence: Prefix collides with other controllers on the same path (e.g. `ProjectsController`). Works by route specificity but makes it harder to reason.
- Fix: Use `@Controller('pm/projects/:projectId/gantt')` and nest milestone/baseline routes under it.

### [LOW] `interface AuthUser { userId: string }` redeclared in each controller
- File: `web/back-nest/src/gantt/gantt.controller.ts:6`, `web/back-nest/src/wiki/wiki.controller.ts:6`
- Category: logic
- Fix: Extract to `src/common/types/auth-user.ts` once.

### [LOW] `agile.service.spec.ts` tests only two branches and mocks don't cover auto-create recursion
- File: `web/back-nest/src/agile/agile.service.spec.ts:3-57`
- Category: testing
- Evidence: `listBoards` auto-create path is uncovered, burndown inner filter logic bug from finding #12 is uncovered.
- Fix: Add cases for (a) cold-start board auto-create, (b) concurrent auto-create race, (c) burndown when all WPs closed.

### [LOW] Empty `catch {}` blocks swallow errors without logging
- File: `web/back-nest/src/gantt/gantt.service.ts:45,79,88,144`; `web/back-nest/src/agile/agile.service.ts:106,115,127,136,146,156,188,224,233,263,272`; `web/back-nest/src/wiki/wiki.service.ts:29,46,125,136,151,165,184,202`
- Category: logic
- Evidence:
```ts
} catch {
  return Result.fail('Échec du chargement des jalons.');
}
```
- Impact: Operators cannot diagnose production failures — no stack, no Prisma error code, no contextual data.
- Fix: `catch (e) { this.logger.error('<method> failed', e); return Result.fail(...) }` pattern that is used inconsistently in some methods.

### [LOW] `createBoard` always seeds 4 default columns even when `type` is not `Kanban`
- File: `web/back-nest/src/agile/agile.service.ts:80-100`
- Category: logic
- Evidence:
```ts
columns: { create: DEFAULT_COLUMNS },
```
`dto.type` can be `'Scrum'` (or anything) but the same four Kanban columns are seeded.
- Fix: Gate seeding on `type === 'Kanban'` or require explicit `columns` for non-Kanban.

### [LOW] `parseInt(version, 10)` with no NaN guard
- File: `web/back-nest/src/wiki/wiki.controller.ts:89,101`
- Category: validation
- Evidence:
```ts
const r = await this.service.getRevision(projectId, slug, parseInt(version, 10));
```
- Impact: `parseInt('abc', 10)` returns `NaN`, which is then passed to Prisma and yields `P2023` / generic failure.
- Fix: Validate with `@IsInt()` + `@Transform(({value}) => parseInt(value, 10))` on a class-DTO or ParseIntPipe.

### [LOW] `position` on move-card is unvalidated (negative, non-integer, very large)
- File: `web/back-nest/src/agile/agile.service.ts:161-178`
- Category: validation
- Fix: Clamp to `[0, column.workPackages.length]`.

### [LOW] `closeSprint` does not unassign remaining WPs or roll them over
- File: `web/back-nest/src/agile/agile.service.ts:247-254`
- Category: logic
- Impact: Standard scrum UX is to roll incomplete WPs to the next sprint / backlog. Not a bug but a missing feature; relevant if listed under OpenProject parity.
- Fix: Optional — expose a `rollOverIncomplete: boolean` flag.

### [LOW] Wiki `softDelete` does not cascade to children
- File: `web/back-nest/src/wiki/wiki.service.ts:119-128`
- Category: logic
- Impact: Soft-deleting a parent leaves its children orphaned (still visible in the tree with `parentId` pointing at a deleted page). `getBySlug` includes `children: { where: { isDeleted: false } }` so children of the deleted parent stay listed under it if you still find them.
- Fix: Soft-delete recursively, or reparent children to the deleted page's parent.

### [LOW] `WikiPage.authorId` overwritten on every update
- File: `web/back-nest/src/wiki/wiki.service.ts:93-101`
- Category: logic
- Evidence:
```ts
const updated = await this.prisma.wikiPage.update({
  where: { id: existing.id },
  data: {
    title: dto.title ?? existing.title,
    content: dto.content ?? existing.content,
    version: newVersion,
    authorId,
  },
});
```
- Impact: `authorId` on `WikiPage` now reflects "last editor", not "original author", even though the field is named `authorId`. This is a naming / data-semantics issue — revisions table does carry per-version author, so probably intentional, but worth flagging.
- Fix: Rename the field to `lastEditorId` (breaking DB migration — costly) or document.

---

## Summary counts

- CRITICAL: 4
- HIGH: 12
- MEDIUM: 8
- LOW: 10
- [UNCERTAIN] flags: 4 (frontend sanitisation for XSS, DST drift on burndown date arithmetic, Prisma `search` mode on MariaDB, adapter-level `%`/`_` escaping)

Top fixes to land first:
1. Add role / project-membership guards on all 3 controllers (findings #1, #2, #19, #23).
2. Fix `moveCard` + `addWpToSprint` cross-project IDOR (findings #3, #11).
3. Add uniqueness on `GanttBaseline(projectId, snapshotName, workPackageId)` and guard re-capture (finding #4).
4. Sanitise wiki markdown on write, rate-limit search, restrict min-length (findings #14, #15).
5. Cycle-check in `movePage` (finding #13).
