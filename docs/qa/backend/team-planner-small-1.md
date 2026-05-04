# Backend QA — team-planner, attachments, audit, checklists

Files opened:
- `web/back-nest/src/team-planner/team-planner.module.ts` (10 lines)
- `web/back-nest/src/team-planner/team-planner.controller.ts` (70 lines)
- `web/back-nest/src/team-planner/team-planner.service.ts` (142 lines)
- `web/back-nest/src/attachments/attachments.module.ts` (9 lines)
- `web/back-nest/src/attachments/attachments.controller.ts` (70 lines)
- `web/back-nest/src/attachments/attachments.service.ts` (129 lines)
- `web/back-nest/src/audit/audit.module.ts` (11 lines)
- `web/back-nest/src/audit/audit.controller.ts` (27 lines)
- `web/back-nest/src/audit/audit.service.ts` (78 lines)
- `web/back-nest/src/checklists/checklists.module.ts` (10 lines)
- `web/back-nest/src/checklists/checklists.controller.ts` (55 lines)
- `web/back-nest/src/checklists/checklists.service.ts` (137 lines)

Supporting files read for context:
- `web/back-nest/src/common/enums/statuses.ts` (line 71 — `DEFAULT_DAILY_CAPACITY_HOURS`)
- `web/back-nest/src/common/guards/roles.guard.ts` (legacy `@Roles()` shim, still active)
- `web/back-nest/src/common/decorators/current-user.decorator.ts`
- `web/back-nest/prisma/schema.prisma` (AppUser line 20, ProjectAttachment line 319, PhaseChecklist line 444, AuditLog line 500)

---

## team-planner

### [HIGH] `reassign` has zero authorization — any authenticated user can re-assign any work package on any project
- File: `web/back-nest/src/team-planner/team-planner.controller.ts:45-53`
- Category: auth
- Evidence:
```ts
  @Patch('work-packages/:wpId/reassign')
  async reassign(
    @Param('wpId') wpId: string,
    @Body() dto: { assigneeId: string; startDate?: string; dueDate?: string },
  ) {
    const r = await this.service.reassign(wpId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
```
and service (`team-planner.service.ts:127-137`):
```ts
  async reassign(wpId: string, dto: { assigneeId: string; startDate?: string; dueDate?: string }) {
    try {
      const data: Record<string, unknown> = { assigneeId: dto.assigneeId };
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
      const wp = await this.prisma.workPackage.update({ where: { id: wpId }, data });
      return Result.ok(wp);
    } catch {
      return Result.fail('Échec de la réaffectation.');
    }
  }
```
- Impact: Controller is only behind `JwtAuthGuard` — no role check, no project-member check on the **source** project of the WP, no verification that the **target** `assigneeId` is a member of that project, no role check on the current user. Any `Viewer` with a valid JWT can reassign any WP to any user in any project (IDOR). The task brief explicitly flagged "reassign re-authz on source+target" — neither side is re-authorized here.
- Fix: Add `RolesGuard` + `@Roles('Admin','ProjectManager')`, load the WP with its `projectId`, verify current user is Admin or PM of that project (or member with write rights via `PermissionsService`), and verify the new `assigneeId` belongs to the same project's team. Validate `assigneeId` is a non-empty UUID and exists in `AppUser`.

### [HIGH] Admin utilization endpoint leaks exactly the same data to non-admins via `GET /pm/team-planner/capacity`
- File: `web/back-nest/src/team-planner/team-planner.service.ts:139-141`
- Category: auth
- Evidence:
```ts
  async getUtilization(from: string, to: string) {
    return this.getCapacity(from, to);
  }
```
and controllers (`team-planner.controller.ts:29-35, 56-68`):
```ts
  @Get('capacity')
  async getCapacity(@Query('from') from: string, @Query('to') to: string) {
    ...
    const r = await this.service.getCapacity(from, to);
...
@Controller('admin/team-planner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AdminTeamPlannerController {
...
  @Get('utilization')
  async utilization(@Query('from') from: string, @Query('to') to: string) {
    ...
    const r = await this.service.getUtilization(from, to);
```
- Impact: The `/admin/team-planner/utilization` endpoint returns whatever `/pm/team-planner/capacity` returns — same rows, same users, same allocated hours. Since `/pm/team-planner/capacity` has **no role gate** (only `JwtAuthGuard`), any authenticated user (even a `Viewer`) can retrieve per-user workload for every active `ProjectManager` / `SpecificationTeam` / `RealizationTeam` / `DeploymentTeam` user in the org — the admin endpoint becomes cosmetic. The CLAUDE.md contract says utilization is `Admin only`, but the PM-scoped capacity endpoint exposes the same dataset.
- Fix: Either (a) gate `/pm/team-planner/capacity` with `@Roles('Admin','ProjectManager')`, or (b) have `/pm/team-planner/capacity` restrict the user list to users on projects the caller manages/is-member-of, keeping org-wide visibility only for the admin controller.

### [HIGH] Conflicts endpoint ignores `userIds` / `projectIds` scoping and exposes all users' overlapping work org-wide
- File: `web/back-nest/src/team-planner/team-planner.controller.ts:37-43` + service `team-planner.service.ts:92-125`
- Category: auth
- Evidence:
```ts
  @Get('conflicts')
  async getConflicts(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new BadRequestException('from et to requis.');
    const r = await this.service.getConflicts(from, to);
    ...
  }
...
  async getConflicts(from: string, to: string) {
    try {
      const assignments = await this.prisma.workPackage.findMany({
        where: {
          isDeleted: false,
          assigneeId: { not: null },
          startDate: { lte: new Date(to) },
          dueDate: { gte: new Date(from) },
        },
        select: { id: true, title: true, assigneeId: true, startDate: true, dueDate: true, project: { select: { id: true, name: true } } },
      });
```
- Impact: Any authenticated user gets **titles and project names** of all WPs across all projects in the date range. Combined with `/pm/team-planner` (also only JWT-gated), this forms a cross-project data leak for any `Viewer`.
- Fix: Require Admin/PM role or scope to projects the caller has membership in.

### [MEDIUM] Conflicts over-reports — any two WPs with any date overlap are flagged, even if one starts the second ends
- File: `web/back-nest/src/team-planner/team-planner.service.ts:114-117`
- Category: logic
- Evidence:
```ts
            if (!a.startDate || !a.dueDate || !b.startDate || !b.dueDate) continue;
            if (new Date(a.startDate) <= new Date(b.dueDate) && new Date(b.startDate) <= new Date(a.dueDate)) {
              conflicts.push({ userId, wp1: a, wp2: b });
            }
```
- Impact: Overlap is inclusive on both ends, so two WPs where WP-A ends exactly the same day WP-B starts are counted as a conflict. More importantly, a single day of overlap on two small WPs that together consume only 4 hours are flagged as a "conflict" with equal weight as two simultaneous month-long 100% allocations — there is no check on `estimatedHours`, no check that overlapping hours exceed daily capacity, and no deduplication (WP-A vs WP-B is reported, but then every subsequent WP-C overlapping A will also list an A-C pair, creating N^2 noise). The frontend will render every intersecting pair as an equally urgent "conflict".
- Fix: Filter with strict inequality on dates (`<` not `<=`) or require `> 0` days overlap, and compute effective daily load — only flag when `sum(estimatedHours / (dueDate - startDate)) > DAILY_CAPACITY_HOURS` on overlapping days. Alternatively expose a severity score instead of a binary conflict.

### [MEDIUM] Capacity math double-counts WPs that extend outside the window — allocatedHours is not pro-rated to the window
- File: `web/back-nest/src/team-planner/team-planner.service.ts:64-85`
- Category: logic
- Evidence:
```ts
      const assignments = await this.prisma.workPackage.findMany({
        where: {
          isDeleted: false,
          assigneeId: { in: users.map((u) => u.id) },
          OR: [
            { startDate: { lte: end }, dueDate: { gte: start } },
          ],
        },
        select: { assigneeId: true, estimatedHours: true, startDate: true, dueDate: true },
      });

      return Result.ok(users.map((u) => {
        const userAssignments = assignments.filter((a) => a.assigneeId === u.id);
        const allocatedHours = userAssignments.reduce((s, a) => s + Number(a.estimatedHours ?? 0), 0);
        const capacityHours = days * DAILY_CAPACITY_HOURS;
```
- Impact: A WP with `estimatedHours = 80` that starts 3 months before the window and ends 2 months after is counted in full (80h) against a 7-day window (7×8 = 56h), giving a spurious 142% utilization. Any long-running WP will blow up utilization reporting. Also WPs with `startDate = null` or `dueDate = null` are excluded by `OR: [{ startDate: { lte: end }, dueDate: { gte: start } }]` — the OR has only one clause, so the name "OR" is misleading; it's really an AND on both dates being non-null.
- Fix: Pro-rate `estimatedHours × (overlap_days / total_wp_days)` into the window. Also handle the case where `startDate` or `dueDate` is null explicitly (either skip or use project dates).

### [MEDIUM] `getAssignments` `OR` clause redundant + mutated when `userIds` supplied (overwrites `assigneeId: { not: null }`)
- File: `web/back-nest/src/team-planner/team-planner.service.ts:18-28`
- Category: logic
- Evidence:
```ts
      const where: Record<string, unknown> = {
        isDeleted: false,
        assigneeId: { not: null },
        OR: [
          { startDate: { lte: to }, dueDate: { gte: from } },
          { startDate: { gte: from, lte: to } },
          { dueDate: { gte: from, lte: to } },
        ],
      };
      if (filters.userIds?.length) where.assigneeId = { in: filters.userIds };
```
- Impact: When `userIds` is passed, `assigneeId` is overwritten — `{ not: null }` is lost but replaced by `{ in: [...] }` which is stricter, so the net effect is fine. However the three-clause `OR` is redundant: `[{ startDate: { lte: to }, dueDate: { gte: from } }]` alone already covers any WP that intersects the window; the 2nd and 3rd clauses are strict subsets. The redundancy forces Prisma to emit a wider SQL OR and drags in WPs where `startDate` exists but `dueDate` is null (clause 2 with no `dueDate` check) — the loop in `getConflicts` then filters those out with `!a.startDate || !a.dueDate` but `getAssignments` returns them, producing items the frontend can't render on a timeline.
- Fix: Keep only `{ startDate: { lte: to }, dueDate: { gte: from } }`. If partial-date WPs should be included, handle them explicitly with a separate clause and document the intent.

### [LOW] `DEFAULT_DAILY_CAPACITY_HOURS` is evaluated once at module load from `process.env.TEAM_DAILY_CAPACITY` — no validation, `NaN` on non-numeric
- File: `web/back-nest/src/common/enums/statuses.ts:71` (referenced by `team-planner.service.ts:4-6`)
- Category: validation
- Evidence:
```ts
/** Days of 8h each for team-planner capacity calculation. Configurable via TEAM_DAILY_CAPACITY env. */
export const DEFAULT_DAILY_CAPACITY_HOURS = Number(process.env.TEAM_DAILY_CAPACITY ?? 8);
```
- Impact: Setting `TEAM_DAILY_CAPACITY=eight` or `TEAM_DAILY_CAPACITY=` (empty string) produces `NaN`, which propagates to `capacityHours = days * NaN = NaN` and `utilizationPercent = Math.round(NaN / NaN * 100) = NaN`. The service returns `NaN` in JSON, which serializes as `null`.
- Fix: Guard with `Number.isFinite` + positive check: `const parsed = Number(process.env.TEAM_DAILY_CAPACITY); DEFAULT_DAILY_CAPACITY_HOURS = Number.isFinite(parsed) && parsed > 0 ? parsed : 8;`

### [LOW] No input validation on `from` / `to` query — arbitrary strings produce `Invalid Date`
- File: `web/back-nest/src/team-planner/team-planner.service.ts:16-17, 55-56, 98-99`
- Category: validation
- Evidence:
```ts
      const from = new Date(filters.from);
      const to = new Date(filters.to);
...
      const start = new Date(from);
      const end = new Date(to);
...
          startDate: { lte: new Date(to) },
          dueDate: { gte: new Date(from) },
```
- Impact: Query like `?from=not-a-date&to=alsonot` yields `Invalid Date` objects, which Prisma will either reject with an obscure error or coerce to `1970-01-01`. `getCapacity` then computes `days = Math.max(1, Math.ceil((NaN) / ...) + 1) = NaN` (since `Math.ceil(NaN) = NaN`, and `Math.max(1, NaN) = NaN`), again producing `NaN` output.
- Fix: Validate with `class-validator` `@IsDateString()` DTO; return 400 for malformed dates.

### [LOW] `reassign` accepts any date string — no validation, silent on past/inverted dates
- File: `web/back-nest/src/team-planner/team-planner.service.ts:127-137`
- Category: validation
- Evidence:
```ts
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
```
- Impact: A caller can set `startDate` after `dueDate`, or send `undefined`/garbage leading to `Invalid Date` which Prisma will reject with a 500 wrapped as "Échec de la réaffectation." masking the real cause.
- Fix: DTO class + `class-validator` (`@IsOptional() @IsDateString()`), plus a logical check `startDate <= dueDate`.

### [LOW] Teardown filter is org-wide — `getCapacity` includes all active users of those roles, not just users in the caller's projects
- File: `web/back-nest/src/team-planner/team-planner.service.ts:59-62`
- Category: auth
- Evidence:
```ts
      const users = await this.prisma.appUser.findMany({
        where: { isActive: true, role: { in: ['ProjectManager', 'SpecificationTeam', 'RealizationTeam', 'DeploymentTeam'] } },
        select: { id: true, firstName: true, lastName: true },
      });
```
- Impact: Any authenticated user sees the full internal directory of those four roles. This is an org chart leak layered on top of the data leak flagged in the HIGH issue above.
- Fix: Scope to users on projects where the caller is PM/member; Admins get org-wide.

### [LOW] `typeof assignments` is used as a Map generic — awkward but valid; fragile if Prisma selectors change
- File: `web/back-nest/src/team-planner/team-planner.service.ts:103`
- Category: logic
- Evidence:
```ts
      const byUser = new Map<string, typeof assignments>();
```
- Impact: Non-blocking; TS infers the array type correctly. Mentioned only for completeness.
- Fix: Extract a named type.

---

## attachments

### [CRITICAL] Any authenticated user can list/download/delete attachments for any project — no project-membership check
- File: `web/back-nest/src/attachments/attachments.controller.ts:9-11, 14-17, 49-56, 42-47`
- Category: auth / idor
- Evidence:
```ts
@Controller('api/projects/:projectId/attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
...
  @Get()
  async getAll(@Param('projectId') projectId: string) {
    const result = await this.service.getProjectAttachments(projectId);
    return result.value;
  }
...
  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('attachmentId') attachmentId: string) {
    const result = await this.service.deleteAttachment(attachmentId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Get(':attachmentId/download')
  async download(@Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const result = await this.service.download(attachmentId);
...
```
- Impact: `AttachmentsController` only applies `JwtAuthGuard`. There is **no** check that the caller is the uploader, PM, Admin, or member of the project. A `Viewer` JWT can:
  - `GET /api/projects/<any-projectId>/attachments` — list every file name, uploader, and metadata on any project.
  - `GET /api/projects/<any-projectId>/attachments/<id>/download` — the `attachmentId` is never cross-checked against `projectId`, so even the URL path doesn't need to be truthful; ANY attachment id downloads.
  - `DELETE /api/projects/<any-projectId>/attachments/<id>` — soft-delete any attachment in the DB.
  - `PATCH` — change `description` / `category` on any attachment.
- Fix: Apply `RolesGuard` + membership check. Load the attachment, verify `attachment.projectId === param.projectId` (to prevent path-id mismatch), then verify the caller is Admin or a project member via `PermissionsService`. Delete should additionally require Admin or uploader.

### [CRITICAL] Path-traversal via `fileName` — `path.extname(dto.fileName)` accepts `..\\..\\evil.exe` and writes under `uploads/attachments/<projectId>/` with attacker-controlled extension
- File: `web/back-nest/src/attachments/attachments.service.ts:36-42`
- Category: security
- Evidence:
```ts
    const ext = path.extname(dto.fileName).toLowerCase();
    const dir = path.join(UPLOAD_DIR, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storageName = `${crypto.randomUUID()}${ext}`;
    const storagePath = path.join(dir, storageName);
    fs.writeFileSync(storagePath, buffer);
```
- Impact: The **stored** filename is `uuid + ext` so path traversal on the *storage* path is unlikely (storage name is the UUID). **However**:
  1. The `projectId` is attacker-controlled via URL param and goes directly into `path.join(UPLOAD_DIR, projectId)`. A `projectId` like `../../../Windows/Temp` would escape the upload directory and create an attacker-controlled folder (then write a uuid-named file there). The route param is not validated as a UUID. Combined with the auth bypass above, this is a remote arbitrary-file-write primitive.
  2. `dto.fileName` is persisted into the DB (`fileName`) and sent back in `Content-Disposition: attachment; filename="${fileName}"` (`attachments.controller.ts:54`) without quoting-safe escaping — a filename containing a `"` breaks the header and enables header injection.
  3. `ext` is whatever the user sends — `.exe`, `.html`, `.svg`, `.js` — no allowlist.
- Fix: Validate `projectId` matches a UUID regex (or better, look up the project first and use `project.id`). Validate `fileName` against a strict allowlist (no path separators, no nulls, length limit). Enforce an extension/MIME allowlist. Sanitize `Content-Disposition` using RFC 5987 (`filename*=UTF-8''...`) or a percent-encoded ASCII fallback.

### [HIGH] No MIME sniffing — `contentType` is whatever the client sent; served back with `res.set({ 'Content-Type': contentType, ... })` enabling stored-XSS via HTML/SVG upload
- File: `web/back-nest/src/attachments/attachments.service.ts:44-56` + `attachments.controller.ts:50-55`
- Category: security
- Evidence:
```ts
    const attachment = await this.prisma.projectAttachment.create({
      data: {
        ...
        contentType: dto.contentType,
        ...
```
```ts
    const { content, fileName, contentType } = result.value!;
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(content);
```
- Impact: A malicious actor uploads `evil.html` with `contentType: 'text/html'` and body `<script>...</script>`. Because there's no sniffing and no `X-Content-Type-Options: nosniff`, any user who downloads it will be served the file as HTML. `Content-Disposition: attachment` usually forces download, but if a frontend ever serves this via an `<img>` / `<iframe>` or renders the link on the same origin, XSS executes. SVG with embedded `<script>` behaves the same with `image/svg+xml`.
- Fix: Validate `contentType` against an allowlist server-side using magic-byte sniffing (`file-type` npm package). Force `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, and serve from a separate origin/CDN if user-uploaded HTML is expected.

### [HIGH] Size cap bypassable — `MAX_FILE_SIZE` is 10 MB but request body itself is not limited
- File: `web/back-nest/src/attachments/attachments.service.ts:7, 32-34`
- Category: security
- Evidence:
```ts
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
...
  async upload(projectId: string, userId: string, dto: any) {
    const buffer = Buffer.from(dto.base64Content, 'base64');
    if (buffer.length > MAX_FILE_SIZE) return Result.fail<any>('Fichier trop volumineux (max 10 Mo).');
```
- Impact: The HTTP body containing base64-encoded bytes is ~1.33× the raw size. A 500 MB base64 body is fully parsed by the JSON body parser **before** the `buffer.length` check runs — the process may OOM or timeout on the JSON parse. `Buffer.from` also silently truncates malformed base64 (no throw), so the real file might differ from what the client intended.
- Fix: Use `multer` with `limits.fileSize: 10 MB` or set a strict body-size limit on the Nest app (e.g. `app.use(json({ limit: '13mb' }))`). Validate `dto.base64Content` looks like base64 before decoding.

### [HIGH] `AttachmentAdminController` uses legacy `@Roles('Admin')` shim — should migrate to `@RequirePermission` per task brief
- File: `web/back-nest/src/attachments/attachments.controller.ts:59-70`
- Category: auth
- Evidence:
```ts
@Controller('api/attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AttachmentAdminController {
  constructor(private readonly service: AttachmentsService) {}

  @Get('storage')
  async getStorage() {
    const result = await this.service.getTotalStorage();
    return result.value;
  }
}
```
and `roles.guard.ts:7-17` documents this as a back-compat shim to be deleted once all callers migrate to `@RequirePermission()`.
- Impact: Per the task brief, this is flagged as legacy. Functionally correct today, but the shim is slated for removal. The `Admin` string is hardcoded — if `PRESET_ROLE_PERMISSIONS['Admin']` is ever reworked, access semantics change silently. Additionally, `getStorage` currently returns `result.value` without checking `result.isFailure` — if aggregate ever fails, `value` is undefined and response is `{}`.
- Fix: Replace with `@RequirePermission('attachments.readStorage')` or similar permission key. Add `isFailure` check in `getStorage`.

### [MEDIUM] `dto: any` on upload/update disables `ValidationPipe` — per CLAUDE.md DTOs must be classes with `class-validator`
- File: `web/back-nest/src/attachments/attachments.controller.ts:29, 36`
- Category: validation
- Evidence:
```ts
  async upload(@Param('projectId') projectId: string, @CurrentUser() user: any, @Body() dto: any) {
    const result = await this.service.upload(projectId, user.userId, dto);
...
  async update(@Param('attachmentId') attachmentId: string, @Body() dto: any) {
    const result = await this.service.updateMetadata(attachmentId, dto);
```
- Impact: Any fields allowed through — `fileName`, `contentType`, `base64Content`, `description`, `category` — with zero length/format checks. `description` could be 10 MB of text. `category` could be `'Document'; DROP TABLE ...'` (safe because Prisma parameterizes, but persists garbage). No `@IsNotEmpty`, no length limits matching schema (`description VARCHAR(500)`, `category VARCHAR(50)`, `fileName VARCHAR(255)`).
- Fix: Declare `UploadAttachmentDto` and `UpdateAttachmentDto` as classes with `class-validator` decorators; apply `ValidationPipe({ whitelist: true })`.

### [MEDIUM] `download` uses `fs.readFileSync` — blocks the event loop, loads entire file into memory
- File: `web/back-nest/src/attachments/attachments.service.ts:88-94`
- Category: perf
- Evidence:
```ts
    return Result.ok({
      content: fs.readFileSync(a.storagePath),
      fileName: a.fileName,
      contentType: a.contentType,
    });
```
- Impact: A 10 MB file blocks the event loop long enough to stall other requests. Concurrent downloads spike heap usage.
- Fix: Stream the file: `res.sendFile(absolutePath)` with proper headers, or use `fs.createReadStream` piped into `res`.

### [MEDIUM] `fs.writeFileSync` blocks the event loop on upload
- File: `web/back-nest/src/attachments/attachments.service.ts:42`
- Category: perf
- Evidence:
```ts
    fs.writeFileSync(storagePath, buffer);
```
- Impact: Same as above; blocks event loop proportional to file size.
- Fix: Use `fs.promises.writeFile` or pipe a multer stream to disk.

### [MEDIUM] `deleteAttachment` is soft-delete only — on-disk file is never removed, storage grows unbounded
- File: `web/back-nest/src/attachments/attachments.service.ts:77-82`
- Category: data-integrity
- Evidence:
```ts
  async deleteAttachment(attachmentId: string) {
    const a = await this.prisma.projectAttachment.findFirst({ where: { id: attachmentId, isDeleted: false } });
    if (!a) return Result.fail('Pièce jointe non trouvée.');
    await this.prisma.projectAttachment.update({ where: { id: attachmentId }, data: { isDeleted: true } });
    return Result.ok();
  }
```
- Impact: Disk usage grows forever; soft-deleted attachments can still be downloaded IF the download code ever strips the `isDeleted: false` filter (it currently doesn't — OK for now). A later "hard delete" sweep job must be written, or storage grows.
- Fix: Either unlink the file here, or schedule a cleanup worker. Clarify retention policy.

### [MEDIUM] `Content-Disposition` filename not sanitized — header injection via `"` / `\r\n` in `fileName`
- File: `web/back-nest/src/attachments/attachments.controller.ts:54`
- Category: security
- Evidence:
```ts
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` });
```
- Impact: A filename containing `"` closes the quoted-string early. A filename with `\r\n` injects a new HTTP header (Express usually sanitizes but this depends on the underlying implementation).
- Fix: Use `encodeURIComponent` + RFC 5987 form: `filename*=UTF-8''${encodeURIComponent(fileName)}`.

### [LOW] `getAll` / `getStorage` / `getById` ignore `result.isFailure` / service never returns failure so control flow is OK
- File: `web/back-nest/src/attachments/attachments.controller.ts:14-18, 66-69`
- Category: logic
- Evidence:
```ts
  @Get()
  async getAll(@Param('projectId') projectId: string) {
    const result = await this.service.getProjectAttachments(projectId);
    return result.value;
  }
...
  @Get('storage')
  async getStorage() {
    const result = await this.service.getTotalStorage();
    return result.value;
  }
```
- Impact: Non-blocking today (service always returns `Result.ok`), but if someone adds error paths later, callers will silently return `undefined`.
- Fix: Consistently check `isFailure`.

### [LOW] `getProjectAttachments` has no pagination — a project with thousands of files returns everything
- File: `web/back-nest/src/attachments/attachments.service.ts:14-21`
- Category: perf
- Evidence:
```ts
    const attachments = await this.prisma.projectAttachment.findMany({
      where: { projectId, isDeleted: false },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
```
- Impact: Heavy payload, slow queries over time.
- Fix: Add `skip`/`take` with defaults.

### [LOW] `crypto.randomUUID()` relies on the Node >=19 global — no import statement present
- File: `web/back-nest/src/attachments/attachments.service.ts:40`
- Category: logic
- Evidence:
```ts
    const storageName = `${crypto.randomUUID()}${ext}`;
```
- Impact: Works on Node 19+ (globals include Web Crypto `crypto`). On Node 18 LTS (`crypto` is a global only via `--experimental-global-webcrypto`). If the runtime is ever 18 or a compat shim is removed, this throws `ReferenceError`. `[UNCERTAIN]` which Node version is targeted — package.json was not opened here.
- Fix: `import { randomUUID } from 'node:crypto';` and call `randomUUID()`.

---

## audit

### [HIGH] Audit query exposes `user.role` on every log row — tolerable, but does NOT leak password hash (positive finding)
- File: `web/back-nest/src/audit/audit.service.ts:36-44, 55-62, 64-77`
- Category: security
- Evidence:
```ts
    const logs = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
...
  private toDto(log: any) {
    return {
      ...
      user: log.user ? `${log.user.firstName} ${log.user.lastName}` : null,
      userRole: log.user?.role ?? null,
      changes: log.changes ? (() => { try { return JSON.parse(log.changes); } catch { return null; } })() : null,
      metadata: log.metadata ? (() => { try { return JSON.parse(log.metadata); } catch { return null; } })() : null,
```
- Impact: The `include.user.select` explicitly whitelists 4 fields — `id, firstName, lastName, role`. `passwordHash`, `totpSecret`, `tokenVersion` are **not** selected, so they do not leak. **However**, `changes` is parsed raw from the JSON blob. If any upstream caller ever writes a sensitive field like `passwordHash`, `totpSecret`, `email` before/after into `changes`, the audit controller (`@Roles('Admin')`) happily ships it to the Admin UI. The service has no denylist.
- Fix: Add a denylist scrubber in `AuditService.log` that strips `passwordHash`, `totpSecret`, `tokenVersion`, authorization tokens, session ids from `changes` before persisting.

### [MEDIUM] `AuditService.log` is not idempotent — repeated calls with same args create duplicate rows
- File: `web/back-nest/src/audit/audit.service.ts:12-34`
- Category: data-integrity
- Evidence:
```ts
  /** Fire-and-forget — never throws. Call without await from other services. */
  async log(
    entityType: string,
    entityId: string,
    action: AuditAction,
    userId?: string,
    changes?: Record<string, { before: unknown; after: unknown }>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType,
          entityId,
          action,
          userId: userId ?? null,
          changes: changes ? JSON.stringify(changes) : null,
          metadata: metadata ? JSON.stringify(metadata).slice(0, 1000) : null,
        },
      });
    } catch {
      // Audit failure must never break business logic
    }
  }
```
- Impact: A retried controller call (e.g. client double-click, upstream retry) inserts two identical audit rows. The brief asked about write idempotency — there is none. There is no natural unique key on `(entityType, entityId, action, userId, createdAt)`.
- Fix: Either (a) deliberately document append-only and accept duplicates as correct (two real clicks = two real audit entries), or (b) accept a caller-supplied `idempotencyKey` and `@@unique` it in the schema. A simpler middle ground: dedupe on `(entityType, entityId, action, userId, changes_hash)` within a short window.

### [MEDIUM] `metadata` is truncated to 1000 chars via `.slice(0, 1000)` — if truncation happens mid-JSON, `JSON.parse` in `toDto` throws and silently returns `null`
- File: `web/back-nest/src/audit/audit.service.ts:28` + `audit.service.ts:74`
- Category: data-integrity
- Evidence:
```ts
          metadata: metadata ? JSON.stringify(metadata).slice(0, 1000) : null,
...
      metadata: log.metadata ? (() => { try { return JSON.parse(log.metadata); } catch { return null; } })() : null,
```
- Impact: A metadata payload of 1001 chars gets stored as truncated JSON like `{"ip":"1.2.3.4","long":"aaa...`. On read, `JSON.parse` throws and the DTO silently returns `metadata: null` — the audit trail looks intact but is empty. This violates the "never silently swallow errors" principle in global coding rules.
- Fix: Either reject metadata > 1000 chars at write, or store a separate `metadataTruncated: boolean` flag and keep the readable prefix.

### [MEDIUM] `AuditService.log` swallows all errors silently — violates "never silently swallow errors" rule
- File: `web/back-nest/src/audit/audit.service.ts:31-33`
- Category: logic
- Evidence:
```ts
    } catch {
      // Audit failure must never break business logic
    }
  }
```
- Impact: The comment justifies swallowing for availability, but there is zero logging — DB failures are invisible. Auditing silently breaks in production, compliance posture is false.
- Fix: `catch (e) { this.logger.error('AuditLog write failed', e); }` — requires adding `private readonly logger = new Logger(AuditService.name);`.

### [LOW] `getRecent` `limit` default is 50 and max 200 — controller correctly clamps, but no lower bound means `?limit=0` returns all rows
- File: `web/back-nest/src/audit/audit.controller.ts:13-17`
- Category: validation
- Evidence:
```ts
  @Get()
  async getRecent(@Query('limit') limit?: string) {
    const result = await this.service.getRecent(limit ? Math.min(Number(limit), 200) : 50);
    return result.value;
  }
```
- Impact: `?limit=0` → `Math.min(0, 200) = 0` → Prisma `take: 0` (returns empty) — safe. `?limit=-1` → Prisma `take: -1` (actually **reverses** ordering in some ORMs but Prisma rejects negative takes with an error since v4). `?limit=foo` → `Number('foo') = NaN` → `Math.min(NaN, 200) = NaN` → Prisma throws. No validation surface.
- Fix: Clamp with `Math.max(1, Math.min(Number(limit) || 50, 200))`.

### [LOW] `getRecent` / `getForEntity` / `getForUser` ignore `Result` failure path (but service always returns ok)
- File: `web/back-nest/src/audit/audit.controller.ts:15-17, 24-26`
- Category: logic
- Evidence:
```ts
    const result = await this.service.getRecent(limit ? Math.min(Number(limit), 200) : 50);
    return result.value;
...
    const result = await this.service.getForEntity(entityType, entityId);
    return result.value;
```
- Impact: Non-blocking; service never fails today. If future edits add failure branches, responses silently return `undefined`.
- Fix: Consistent `if (result.isFailure) throw ...` pattern.

### [LOW] `getForEntity` has no validation on `entityType` / `entityId` — enumerable DB probe
- File: `web/back-nest/src/audit/audit.controller.ts:19-26`
- Category: validation
- Evidence:
```ts
  @Get(':entityType/:entityId')
  async getForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const result = await this.service.getForEntity(entityType, entityId);
    return result.value;
  }
```
- Impact: Admin-only, so low severity. But `entityType` is a free-form string — a caller can probe arbitrary types. Since only admins can reach this endpoint, impact is minimal, but pattern-wise it's better to validate against a known enum.
- Fix: Validate `entityType` against the set of models that actually produce audit logs.

### [LOW] `AuditModule` is `@Global()` — fine, but exporting `AuditService` is redundant when the module is already global
- File: `web/back-nest/src/audit/audit.module.ts:5-10`
- Category: logic
- Evidence:
```ts
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```
- Impact: Cosmetic — `@Global()` alone would expose providers, `exports` is kept for explicitness. Harmless.
- Fix: None necessary; documentation-only.

---

## checklists

### [HIGH] Per-phase authorization is not enforced — a Deployment-team user CAN check Specification checklist items
- File: `web/back-nest/src/checklists/checklists.controller.ts:25-34` + `checklists.service.ts:57-72`
- Category: auth
- Evidence:
```ts
  @Patch(':itemId/toggle')
  async toggle(
    @Param('itemId') itemId: string,
    @CurrentUser() user: any,
    @Body() body: { isChecked: boolean },
  ) {
    const result = await this.service.toggle(itemId, user.userId, body.isChecked);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }
```
```ts
  async toggle(itemId: string, userId: string, isChecked: boolean) {
    const item = await this.prisma.phaseChecklist.findUnique({ where: { id: itemId } });
    if (!item) return Result.fail<any>('Élément non trouvée.');

    const updated = await this.prisma.phaseChecklist.update({
      where: { id: itemId },
      data: {
        isChecked,
        checkedBy: isChecked ? userId : null,
        checkedAt: isChecked ? new Date() : null,
      },
```
- Impact: The brief explicitly flagged "Checklist per-phase authz (Deployment team can't check Specification items)". The code does **no** phase-vs-role check. A user with role `DeploymentTeam` can PATCH `:itemId/toggle` for a `SpecificationValidation` phase item with a 200 OK. Only `JwtAuthGuard` is applied — no `RolesGuard`, no phase-to-role mapping.
- Fix: After loading `item`, map `item.phase` → authorized roles (`SpecificationValidation` → `['SpecificationTeam','ProjectManager','Admin']`, `Realization` → `['RealizationTeam','ProjectManager','Admin']`, `DeploymentValidation` → `['DeploymentTeam','ProjectManager','Admin']`, etc.). Reject with 403 if caller's role is not in the set. Additionally verify caller is a member of `item.projectId`.

### [HIGH] `deleteItem` / `addItem` / `toggle` / `getProgress` have no project-membership authz — any JWT can modify any project's checklist
- File: `web/back-nest/src/checklists/checklists.controller.ts:8-11, 36-54`
- Category: auth / idor
- Evidence:
```ts
@Controller('api/projects/:projectId/checklists')
@UseGuards(JwtAuthGuard)
export class ChecklistsController {
...
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Param('projectId') projectId: string,
    @Body() body: { phase: string; label: string },
  ) {
...
    const result = await this.service.addItem(projectId, body.phase, body.label);
...
  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(@Param('itemId') itemId: string) {
    const result = await this.service.deleteItem(itemId);
```
- Impact: Same IDOR pattern as attachments — controller is JWT-only. Any authenticated user (Viewer) can add/delete/toggle checklist items on any project they have no role in. `deleteItem` even skips the `:projectId` route param entirely, so the attacker doesn't have to know the project — just an `itemId`.
- Fix: Load the `Project` (for add/toggle — `item.projectId` for toggle/delete), verify the caller is Admin or member. Reject with 403 otherwise.

### [HIGH] `getProgress` signature bug — controller passes only `projectId` but the route `:phase/progress` requires phase; service ignores phase
- File: `web/back-nest/src/checklists/checklists.controller.ts:19-23` + `checklists.service.ts:101-112`
- Category: logic
- Evidence:
```ts
  @Get(':phase/progress')
  async getProgress(@Param('projectId') projectId: string) {
    const result = await this.service.getProgress(projectId);
    return result.value;
  }
```
```ts
  async getProgress(projectId: string) {
    const all = await this.prisma.phaseChecklist.findMany({ where: { projectId } });
    const byPhase: Record<string, { total: number; checked: number }> = {};

    for (const item of all) {
      if (!byPhase[item.phase]) byPhase[item.phase] = { total: 0, checked: 0 };
      byPhase[item.phase].total++;
      if (item.isChecked) byPhase[item.phase].checked++;
    }

    return Result.ok(byPhase);
  }
```
- Impact: The URL shape `GET /api/projects/:projectId/checklists/:phase/progress` implies per-phase progress, but the handler never reads `:phase`. `/checklists/Draft/progress` and `/checklists/Realization/progress` return identical payloads (all phases for the project). The `:phase` URL segment is decorative. Frontend clients that assume per-phase filtering will see wrong data (e.g. total = sum of all phases, not just the requested one).
- Fix: Either change the route to `GET /api/projects/:projectId/checklists/progress` (no phase segment), or filter by phase in the service. Also note this route will be **shadowed** by `@Get(':phase')` if route order matters — Nest should disambiguate the longer path, but worth verifying.

### [MEDIUM] `seedDefaults` race — `getForProjectPhase` calls it then recursively re-reads; two concurrent callers double-seed
- File: `web/back-nest/src/checklists/checklists.service.ts:42-55, 114-122`
- Category: data-integrity
- Evidence:
```ts
  async getForProjectPhase(projectId: string, phase: string) {
    const items = await this.prisma.phaseChecklist.findMany({
      where: { projectId, phase },
      include: { checker: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { orderIndex: 'asc' },
    });

    if (items.length === 0) {
      await this.seedDefaults(projectId, phase);
      return this.getForProjectPhase(projectId, phase);
    }

    return Result.ok(items.map((i) => this.toDto(i)));
  }
...
  private async seedDefaults(projectId: string, phase: string) {
    const labels = PHASE_DEFAULTS[phase] ?? [];
    if (!labels.length) return;

    await this.prisma.phaseChecklist.createMany({
      data: labels.map((label, orderIndex) => ({ projectId, phase, label, orderIndex })),
      skipDuplicates: true,
    });
  }
```
- Impact: `skipDuplicates: true` only helps if there's a unique constraint that matches — the schema (`schema.prisma:444-461`) has `@@index([projectId, phase])` but **no** `@@unique([projectId, phase, label])`. `skipDuplicates` needs a unique constraint to actually dedupe. Two concurrent requests hitting an empty checklist simultaneously will both see `items.length === 0`, both call `createMany`, and since there's no unique constraint, **both will succeed** — the project ends up with 6 "Cadrage initial validé" rows instead of 1.
- Fix: Add `@@unique([projectId, phase, label])` to `PhaseChecklist` and run the SQL migration (per CLAUDE.md, raw SQL — `prisma db push` is banned). Then `skipDuplicates` will actually dedupe. Alternatively, wrap the check-and-seed in a transaction with `SELECT ... FOR UPDATE`.

### [MEDIUM] Unknown/invalid `phase` strings are accepted — `addItem('Banana', 'foo')` persists junk rows
- File: `web/back-nest/src/checklists/checklists.controller.ts:37-47` + service `checklists.service.ts:74-91`
- Category: validation
- Evidence:
```ts
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Param('projectId') projectId: string,
    @Body() body: { phase: string; label: string },
  ) {
    if (!body.label?.trim()) throw new BadRequestException('Label requis.');
    if (!body.phase?.trim()) throw new BadRequestException('Phase requise.');
    const result = await this.service.addItem(projectId, body.phase, body.label);
```
- Impact: `phase` is not validated against the project-status enum. A user can create `phase: 'Hacked'` rows that the UI never displays but that still bloat the DB. Similarly `getForProjectPhase` with an unknown phase happily calls `seedDefaults` with `PHASE_DEFAULTS[phase] ?? []` — safe by fallback but silent no-op.
- Fix: Validate `phase` against the `PHASE_DEFAULTS` key set or the actual `ProjectStatus` enum. Return 400 on unknown phase.

### [MEDIUM] `label` length not bounded — schema caps at `VARCHAR(300)` but service doesn't enforce; Prisma will throw cryptic P2000
- File: `web/back-nest/src/checklists/checklists.controller.ts:41` + service `checklists.service.ts:80-90`
- Category: validation
- Evidence:
```ts
    if (!body.label?.trim()) throw new BadRequestException('Label requis.');
    if (!body.phase?.trim()) throw new BadRequestException('Phase requise.');
    const result = await this.service.addItem(projectId, body.phase, body.label);
```
- Impact: `label.length > 300` → Prisma P2000 bubbles as an unhandled error or a 500 "Internal Server Error".
- Fix: DTO class with `@MaxLength(300)`.

### [LOW] `deleteItem` hard-deletes — no audit trail for checklist removal
- File: `web/back-nest/src/checklists/checklists.service.ts:93-99`
- Category: data-integrity
- Evidence:
```ts
  async deleteItem(itemId: string) {
    const item = await this.prisma.phaseChecklist.findUnique({ where: { id: itemId } });
    if (!item) return Result.fail('Élément non trouvée.');

    await this.prisma.phaseChecklist.delete({ where: { id: itemId } });
    return Result.ok();
  }
```
- Impact: No soft-delete flag, no audit log. A PM who completed 15/20 items and then removes 3 leaves no trace.
- Fix: Call `AuditService.log(..., 'DELETE', userId, { before: item })` or add `isDeleted` flag.

### [LOW] `toggle` — when unchecking, `checkedBy` + `checkedAt` are cleared but no audit entry records who unchecked
- File: `web/back-nest/src/checklists/checklists.service.ts:57-72`
- Category: data-integrity
- Evidence:
```ts
    const updated = await this.prisma.phaseChecklist.update({
      where: { id: itemId },
      data: {
        isChecked,
        checkedBy: isChecked ? userId : null,
        checkedAt: isChecked ? new Date() : null,
      },
```
- Impact: An attacker who gained access and unchecks a completed validation leaves no audit trail — the previous checker's identity is wiped.
- Fix: Keep `checkedBy/checkedAt` history in a separate log table or keep the last checker and add `uncheckedBy/uncheckedAt` fields. At minimum, emit an `AuditService.log` row.

### [LOW] `getForProjectPhase` recursion depth is 1 but still uses recursion instead of loop
- File: `web/back-nest/src/checklists/checklists.service.ts:49-52`
- Category: logic
- Evidence:
```ts
    if (items.length === 0) {
      await this.seedDefaults(projectId, phase);
      return this.getForProjectPhase(projectId, phase);
    }
```
- Impact: Safe today — `seedDefaults` always inserts at least one row if `PHASE_DEFAULTS[phase]` exists, so recursion terminates. However if `PHASE_DEFAULTS[phase]` is empty (`'Hacked'`), `seedDefaults` inserts nothing, the second call sees `items.length === 0` again, calls `seedDefaults` again... infinite loop. The `?? []` early-return in `seedDefaults` means it just no-ops silently, but the re-fetch still returns empty and recursion continues. Stack overflow likely.
- Fix: Replace recursion with a single loop: seed once, then `findMany` once; if still empty, `return Result.ok([])`.

### [LOW] `getForProjectPhase` ignores `Result.fail` — there's no way to return an error from the service
- File: `web/back-nest/src/checklists/checklists.controller.ts:13-17`
- Category: logic
- Evidence:
```ts
  @Get(':phase')
  async getPhase(@Param('projectId') projectId: string, @Param('phase') phase: string) {
    const result = await this.service.getForProjectPhase(projectId, phase);
    return result.value;
  }
```
- Impact: Service never fails today, but pattern-wise this drops errors silently (consistent with other controllers in these modules).
- Fix: Handle `isFailure` consistently.

---

## Summary

- **team-planner**: reassign has no source-or-target authz (HIGH), conflicts/capacity leak org-wide data to any JWT (HIGH×2), conflict math over-reports and capacity double-counts long-running WPs (MEDIUM×2), input validation missing (LOW×3).
- **attachments**: no project-membership authz on any method (CRITICAL), path-traversal via attacker-controlled `projectId` URL param combined with stored `contentType` / `fileName` (CRITICAL + HIGH), size cap bypassable pre-parse (HIGH), admin still on legacy `@Roles('Admin')` shim (HIGH), sync FS I/O blocks event loop (MEDIUM×2), on-disk files never reclaimed (MEDIUM), DTOs are `any` (MEDIUM).
- **audit**: `changes` blob not scrubbed for sensitive fields — no password hash leak today but no denylist (HIGH), write is non-idempotent (MEDIUM), metadata truncation corrupts JSON silently (MEDIUM), errors swallowed without logging (MEDIUM).
- **checklists**: per-phase role gate missing entirely — Deployment team can check Specification items (HIGH), no project-membership authz (HIGH), `:phase` route param ignored by progress handler (HIGH), `seedDefaults` double-seeds due to missing unique constraint (MEDIUM), unknown phases accepted (MEDIUM), recursion could go infinite on unknown phase + empty table (LOW).

Top fixes in priority order:
1. Add project-membership + role checks to every controller in attachments, checklists, and team-planner reassign/capacity/conflicts.
2. Fix path-traversal by validating `:projectId` as UUID and sanitizing `Content-Disposition`.
3. Add phase→role mapping in `ChecklistsService.toggle`.
4. Fix `getProgress` to honor `:phase` URL segment (or drop the segment).
5. Add `@@unique([projectId, phase, label])` on `PhaseChecklist` so `skipDuplicates` actually works.
6. Scrub `passwordHash` / `totpSecret` / `tokenVersion` from `AuditService.log` input before persisting.
7. Pro-rate `estimatedHours` in `getCapacity` based on overlap days.
