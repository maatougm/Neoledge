# Scenario-driven abuse / user-misbehaviour audit — Phase 6

Files opened:
- `web/back-nest/src/common/guards/roles.guard.ts`
- `web/back-nest/src/common/guards/jwt-auth.guard.ts` (referenced only)
- `web/back-nest/src/work-packages/work-packages.controller.ts`
- `web/back-nest/src/work-packages/work-packages.service.ts`
- `web/back-nest/src/work-packages/dto/work-package.dto.ts`
- `web/back-nest/src/gantt/gantt.controller.ts`
- `web/back-nest/src/wiki/wiki.controller.ts`
- `web/back-nest/src/wiki/wiki.service.ts`
- `web/back-nest/src/budgeting/budgeting.controller.ts`
- `web/back-nest/src/budgeting/budgeting.service.ts`
- `web/back-nest/src/time-tracking/time-tracking.controller.ts`
- `web/back-nest/src/time-tracking/time-tracking.service.ts`
- `web/back-nest/src/meetings/meetings.controller.ts`
- `web/back-nest/src/meetings/meetings.service.ts`
- `web/back-nest/src/attachments/attachments.controller.ts`
- `web/back-nest/src/attachments/attachments.service.ts`
- `web/back-nest/src/portal/portal.controller.ts`
- `web/back-nest/src/portal/portal.service.ts`
- `web/back-nest/src/collaboration/collaboration.gateway.ts`
- `web/back-nest/src/collaboration/collaboration.service.ts`
- `web/back-nest/src/automation/automation.controller.ts`
- `web/back-nest/src/automation/automation.service.ts`
- `web/back-nest/src/automation/dto/automation.dto.ts`
- `web/back-nest/src/projects/projects.controller.ts`
- `web/back-nest/src/projects/pm.controller.ts`
- `web/back-nest/src/projects/projects.service.ts`
- `web/back-nest/src/users/users.controller.ts`
- `web/back-nest/src/users/users.service.ts`
- `web/back-nest/src/users/dto/update-user.dto.ts`
- `web/back-nest/src/auth/auth.controller.ts`
- `web/back-nest/src/auth/auth.service.ts`
- `web/back-nest/src/auth/jwt.strategy.ts`
- `web/back-nest/src/main.ts`
- `web/back-nest/prisma/schema.prisma`
- `web/Front/customapp/src/router/guards.ts`, `router/index.ts`, `stores/authStore.ts` (mustChangePassword only)

Skipped scenarios (refuted or not reachable):

- **#4 Non-Admin PATCH `/admin/users/:id` with `{role:'Admin'}`** — refuted. `UsersController` is mounted at `admin/appuser` and decorated with `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('Admin')` (users.controller.ts:23-25). A non-admin JWT is rejected by `RolesGuard` before reaching the service.
- **#11 Non-Admin creates automation rule with `action=update_field target=role value=Admin`** — refuted. `executeAction` branch `update_field` writes only to `ProjectFieldValue` (automation.service.ts:221-235). There is no path from an automation action to `AppUser.role`. Privilege escalation via this vector is not reachable.
- **#12 Infinite automation loop** — refuted. Automation rules only fire from `ProjectsService`, `WorkPackagesService`, `AgileService`, `GanttService` mutations (static `executeRulesForEvent` callsites). The action handlers (`send_notification`, `update_field`) do not re-publish events, so no self-triggering cycle is reachable. (No depth guard exists, but no loop source exists either.)
- **#19 Time entry forge `userId` in POST** — refuted. `TimeEntriesController.create` takes `userId` from `@CurrentUser()` (time-tracking.controller.ts:31) and the service signature is `create(userId, dto)` (time-tracking.service.ts:61). `userId` is never read from the body.
- **#20 2FA temp-token boundary** — no evidence of bypass. Temp token expires in 5 minutes via `jwtService.sign(..., { expiresIn: TEMP_TOKEN_EXPIRES_IN })` (auth.service.ts:432-438). `loginWithTotp` verifies the token and checks `totpPending` flag (auth.service.ts:199-209). Not a finding.
- **#23 Frontend `userRole === 'Admin'` mismatch** — frontend uses JWT `role` claim for UI, backend Admin routes enforce via `@Roles('Admin') + RolesGuard`. No divergence found that grants data access.

---

### [HIGH] Scenario: Viewer / SpecTeam POST `/pm/projects/:id/work-packages`
- **Setup**: any authenticated non-Admin user (e.g. Viewer, SpecificationTeam) with a valid JWT.
- **Action**: `POST /pm/projects/<any-id>/work-packages` with `{"title":"pwned"}`.
- **Expected**: server checks the caller has at least `project.edit` or equivalent permission (Viewer should be denied).
- **Actual** (Evidence):
  File: `web/back-nest/src/work-packages/work-packages.controller.ts:32-80`
  ```ts
  @Controller('pm/projects/:projectId/work-packages')
  @UseGuards(JwtAuthGuard)
  export class WorkPackagesController {
    ...
    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
      @Param('projectId') projectId: string,
      @Body() dto: CreateWorkPackageDto,
      @CurrentUser() user: AuthUser,
    ) {
      const r = await this.service.create(projectId, dto, user.userId);
  ```
  The controller has only `JwtAuthGuard` — no `@Roles(...)`, no `@RequirePermission(...)`, no project-membership check. Service `create()` does not validate caller access either (work-packages.service.ts:180-234).
- **Category**: auth
- **Impact**: any logged-in user — including a Viewer — can create/edit/delete work packages in every project in the system.
- **Fix**: apply `RolesGuard` + `@Roles('Admin','ProjectManager',...)` (or the new `@RequirePermission('work_package.edit')`) and enforce project membership inside the service.

### [HIGH] Scenario: PM of project A calls `/pm/projects/B/gantt`
- **Setup**: PM user is `projectManagerId` of project A only.
- **Action**: `GET /pm/projects/<projectB-id>/gantt`.
- **Expected**: 403 if the caller is not PM/member of project B.
- **Actual** (Evidence):
  File: `web/back-nest/src/gantt/gantt.controller.ts:8-18`
  ```ts
  @Controller('pm/projects/:projectId')
  @UseGuards(JwtAuthGuard)
  export class GanttController {
    constructor(private readonly service: GanttService) {}

    @Get('gantt')
    async getGantt(@Param('projectId') projectId: string) {
      const r = await this.service.getGanttPayload(projectId);
  ```
  Same pattern for `PmController` (pm.controller.ts:30-35 `getProject`) and `WikiController` (wiki.controller.ts:8-32). None verifies the caller is PM or member of `:projectId`.
- **Category**: idor / auth
- **Impact**: any authenticated user can read the Gantt timeline, wiki pages, field values, meetings, work packages, budget, and members of every project. Confidentiality breach across tenants.
- **Fix**: introduce a `ProjectAccessGuard` (or helper) reading `:projectId` param and checking `projectManagerId === userId` OR presence in `UserRoleAssignment` for that project; apply on every `pm/projects/:projectId/**` controller.

### [HIGH] Scenario: PM of project A PATCHes `/pm/projects/B/work-packages/:wpId`
- **Setup**: PM of A. Work package `wpId` belongs to project B.
- **Action**: `PATCH /pm/projects/<A-id>/work-packages/<wpId-of-B>` with `{"status":"Closed"}`.
- **Expected**: 404 (wp does not belong to path's project) or 403 (no access to B).
- **Actual** (Evidence):
  File: `web/back-nest/src/work-packages/work-packages.service.ts:237-297`
  ```ts
  async update(id: string, projectId: string, dto: UpdateWorkPackageDto, actorId?: string) {
    ...
    const existing = await this.prisma.workPackage.findFirst({ where: { id, projectId, isDeleted: false } });
    if (!existing) return Result.fail('Work package introuvable.');
  ```
  The service scopes by `{ id, projectId }`, so a cross-project wpId is rejected (good). BUT same service has:
  File: `web/back-nest/src/work-packages/work-packages.service.ts:311-324`
  ```ts
  async moveCard(id: string, dto: MoveWorkPackageDto) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.boardColumnId !== undefined) data.boardColumnId = dto.boardColumnId;
      ...
      const wp = await this.prisma.workPackage.update({ where: { id }, data });
  ```
  `move`, `addWatcher`, `addDependency`, `removeDependency`, `upsertCustomValues`, `deleteCustomField` all take raw IDs and never verify `projectId` or caller access. Combined with no controller-level project membership check, a PM of A can reposition / add watchers / inject dependencies on any work package in the system.
- **Category**: idor
- **Impact**: cross-project tampering of work packages — move into foreign sprints/columns, inject fake `blocks`/`follows` edges, attach watchers to private WPs.
- **Fix**: load the WP first and reject if `wp.projectId !== pathProjectId`; add project-membership gate at controller level.

### [HIGH] Scenario: Wiki IDOR — any authenticated user reads/writes any project's wiki
- **Setup**: SpecificationTeam user, not a member of project B.
- **Action**: `GET /pm/projects/<B>/wiki/pages/<slug>` or `PATCH .../wiki/pages/<slug>` with `{content:"..."}`.
- **Expected**: 403.
- **Actual** (Evidence):
  File: `web/back-nest/src/wiki/wiki.controller.ts:8-56`
  ```ts
  @Controller('pm/projects/:projectId/wiki')
  @UseGuards(JwtAuthGuard)
  export class WikiController {
    ...
    @Get('pages/:slug')
    async get(@Param('projectId') projectId: string, @Param('slug') slug: string) {
      const r = await this.service.getBySlug(projectId, slug);
  ```
  Only JwtAuthGuard. `WikiService.getBySlug`/`update`/`softDelete` only filter by `{ projectId, slug }` (wiki.service.ts:34-49, 87-117, 119-128) — no access check.
- **Category**: idor
- **Impact**: knowledge-base disclosure across tenants; arbitrary wiki deletion and revision tampering.
- **Fix**: same `ProjectAccessGuard` as above.

### [HIGH] Scenario: Budget line-items cross-project IDOR via bare `id`
- **Setup**: Any authenticated user. Victim line item `li-123` belongs to project X's budget.
- **Action**: `PATCH /pm/projects/<any-project>/budget/line-items/li-123` with `{unitCost: 9999999}` or `DELETE .../line-items/li-123`.
- **Expected**: 404 (line item not under `:projectId`).
- **Actual** (Evidence):
  File: `web/back-nest/src/budgeting/budgeting.controller.ts:41-56`
  ```ts
  @Patch('line-items/:id')
  async updateLine(
    @Param('id') id: string,
    @Body() dto: { description?: string; type?: string; unitCost?: number; units?: number; position?: number },
  ) {
    const r = await this.service.updateLineItem(id, dto);
  ```
  File: `web/back-nest/src/budgeting/budgeting.service.ts:82-112`
  ```ts
  async updateLineItem(id: string, dto: ...) {
    const existing = await this.prisma.budgetLineItem.findUnique({ where: { id } });
    if (!existing) return Result.fail('Ligne introuvable.');
    ...
    const item = await this.prisma.budgetLineItem.update({ where: { id }, data: ...
  }
  async deleteLineItem(id: string) {
    await this.prisma.budgetLineItem.delete({ where: { id } });
  ```
  No check that the line item belongs to the `:projectId` in the URL, no membership check.
- **Category**: idor / mass-assignment
- **Impact**: any logged-in user can edit or delete budget line items of every project by ID enumeration.
- **Fix**: load the line item via budget join and reject when `lineItem.budget.projectId !== pathProjectId`; add project membership check.

### [HIGH] Scenario: Attachment download IDOR
- **Setup**: Any authenticated user. Attachment `att-123` belongs to project X.
- **Action**: `GET /api/projects/<any-project>/attachments/att-123/download`.
- **Expected**: 404 / 403 when attachment is not in `:projectId`.
- **Actual** (Evidence):
  File: `web/back-nest/src/attachments/attachments.controller.ts:49-56`
  ```ts
  @Get(':attachmentId/download')
  async download(@Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const result = await this.service.download(attachmentId);
  ```
  File: `web/back-nest/src/attachments/attachments.service.ts:84-94`
  ```ts
  async download(attachmentId: string) {
    const a = await this.prisma.projectAttachment.findFirst({ where: { id: attachmentId, isDeleted: false } });
    if (!a) return Result.fail<any>('Pièce jointe non trouvée.');
    ...
    return Result.ok({
      content: fs.readFileSync(a.storagePath),
  ```
  The `:projectId` in the path is completely ignored; same for `getById`, `update`, `delete`. Also the admin-only endpoint pairing is only `@Roles('Admin')` on `/api/attachments/storage` — the `/api/projects/:projectId/attachments/*` routes have JwtAuthGuard only.
- **Category**: idor
- **Impact**: any authenticated user can download/update/delete every attachment in the system by guessing ids.
- **Fix**: scope Prisma query to `{ id, projectId }` and 404 on mismatch; add project-membership guard on the controller.

### [HIGH] Scenario: WebSocket forged `join-project` + `field-update` without project membership
- **Setup**: attacker logs in as any authenticated user (JWT). They never belong to project B.
- **Action**: open `ws://.../collaboration`, emit `join-project` with `projectB-id`, then `field-update` with `{projectId: "B", projectFieldId, value}`.
- **Expected**: gateway rejects `join-project` for non-members and ignores `field-update` for projects the socket is not a member of.
- **Actual** (Evidence):
  File: `web/back-nest/src/collaboration/collaboration.gateway.ts:116-185`
  ```ts
  @SubscribeMessage('join-project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() projectId: string,
  ): Promise<void> {
    const userId: string = client.data['userId'] as string;
    if (!userId) return;
    ...
    this.presence.get(projectId)!.set(client.id, presenceUser);
    await client.join(`project:${projectId}`);
    ...

  @SubscribeMessage('field-update')
  async handleFieldUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FieldUpdatePayload,
  ): Promise<void> {
    ...
    try {
      await this.collaborationService.saveField(projectId, projectFieldId, value, userId);
    } catch { ... }

    client.to(`project:${projectId}`).emit('field-changed', ...);
  ```
  File: `web/back-nest/src/collaboration/collaboration.service.ts:8-29`
  ```ts
  async saveField(projectId, projectFieldId, value, userId): Promise<void> {
    const updated = await this.prisma.projectFieldValue.updateMany({
      where: { projectId, projectFieldId },
      data: { value, updatedBy: userId },
    });
    if (updated.count === 0) {
      await this.prisma.projectFieldValue.create({ data: { projectId, projectFieldId, value, updatedBy: userId } });
    }
  }
  ```
  Nothing verifies the authenticated user is a member of `projectId` before joining the room, persisting the write, or broadcasting `field-changed`. A single JWT can mutate questionnaire data of every project and harvest presence info.
- **Category**: auth / idor
- **Impact**: any logged-in user can silently overwrite questionnaire fields of every project, trigger fake presence indicators, and spy on real-time edits.
- **Fix**: on `join-project`, resolve project membership against DB and `client.disconnect()` or ignore if not allowed; on `field-update`, verify `socket.rooms` contains `project:${projectId}` AND the user has `project.edit` permission for that project; on `field-blur/focus` same guard.

### [HIGH] Scenario: `mustChangePassword=true` user navigates directly to protected API
- **Setup**: admin triggers `POST /admin/appuser/:id/reset-password`; user receives temp password, logs in, JWT is issued.
- **Action**: user (with `mustChangePassword=true`) calls any protected endpoint directly with Authorization header (e.g. `curl` against `/pm/projects/:id/work-packages`).
- **Expected**: backend rejects protected requests until `/auth/change-password` is completed, returning 403/401.
- **Actual** (Evidence):
  File: `web/back-nest/src/auth/jwt.strategy.ts:40-56`
  ```ts
  async validate(payload: JwtPayload): Promise<AuthedUser> {
    const tokenVersion = payload.tokenVersion ?? 0;
    const currentVersion = await this.permissions.getTokenVersion(payload.sub);
    if (tokenVersion !== currentVersion) { throw new UnauthorizedException(...); }
    return { userId: payload.sub, email: payload.email, role: payload.role, ...};
  }
  ```
  The JWT strategy does not read `mustChangePassword` nor any claim equivalent. The guard is purely client-side:
  File: `web/Front/customapp/src/router/guards.ts:28`
  ```ts
  if (auth.mustChangePassword && to.name !== 'force-change-password') {
  ```
  A sophisticated user (or attacker replaying a stolen token) bypasses the flow by skipping the SPA and issuing raw API requests.
- **Category**: auth
- **Impact**: temp-password lifecycle is non-binding server-side — the forced-change flow is only a UI nudge.
- **Fix**: add a `MustChangePasswordGuard` globally (or fold into `JwtStrategy.validate()`) that rejects all requests except `POST /auth/change-password` and `GET /auth/me` while `user.mustChangePassword === true`.

### [MEDIUM] Scenario: Portal signoff replay — same token signs off arbitrarily many times
- **Setup**: Admin issues a portal token and sends the URL to a client. Token has not been revoked and has not expired.
- **Action**: `POST /api/portal/<token>/signoff` called N times with different `clientName` and mixed `isApproved` booleans.
- **Expected**: one-shot per token (or at least idempotent per client email) — second submission rejected.
- **Actual** (Evidence):
  File: `web/back-nest/src/portal/portal.service.ts:188-234`
  ```ts
  async submitSignoff(token, dto, ipAddress) {
    if (!dto.clientName?.trim()) return Result.fail('Le nom est requis.');
    const record = await this.prisma.portalToken.findUnique({ where: { token }, ...});
    if (!record) return Result.fail('Lien invalide.');
    if (record.isRevoked) return Result.fail('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) return Result.fail('Ce lien a expiré.');
    ...
    const signoff = await this.prisma.portalSignoff.create({ data: { ... } });
  ```
  File: `web/back-nest/prisma/schema.prisma:484-498`
  ```
  model PortalSignoff {
    id            String   @id @default(uuid())
    portalTokenId String
    clientName    String   @db.VarChar(200)
    clientEmail   String?  @db.VarChar(256)
    comment       String?  @db.Text
    isApproved    Boolean
    signedAt      DateTime @default(now())
    ipAddress     String?  @db.VarChar(45)

    portalToken PortalToken @relation(fields: [portalTokenId], references: [id], onDelete: Cascade)
    @@index([portalTokenId])
  ```
  No `@@unique([portalTokenId])` or status flag; no check for existing signoffs in the service. Each call creates a new row, notifies the PM again, and the client portal view renders every row. An attacker who intercepts a portal URL can flip an approval by posting an `isApproved:false` signoff after the client's approval; conversely, a client can spam approvals.
- **Category**: race / validation
- **Impact**: audit trail pollution, contradictory approval state, repeated portal_signoff notifications, denial of service of the PM's inbox. No rate-limit either.
- **Fix**: either `@@unique([portalTokenId])` on `PortalSignoff`, or set `PortalToken.isRevoked = true` (or add `signedAt`) after first successful signoff, and reject further calls. Add a rate limit on `/api/portal/*`.

### [MEDIUM] Scenario: Concurrent questionnaire edit — last-write-wins, no conflict detection
- **Setup**: PM A and PM B both load the questionnaire form at the same time. Each edits different field values and saves.
- **Action**: both call `PATCH /pm/projects/:id/field-values` with full `fieldValues[]` arrays.
- **Expected**: last save either merges by field, or 409 on version conflict.
- **Actual** (Evidence):
  File: `web/back-nest/src/projects/projects.service.ts:416-428`
  ```ts
  async saveFieldValues(projectId: string, fieldValues: { projectFieldId: string; value: string | null }[]) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    for (const fv of fieldValues) {
      await this.prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fv.projectFieldId } },
        update: { value: fv.value },
        create: { projectId, projectFieldId: fv.projectFieldId, value: fv.value },
      });
    }
    return Result.ok();
  }
  ```
  No `updatedAt` comparison, no optimistic lock, no `updatedBy` check. The loop persists every field in the payload; a stale client silently overwrites a concurrent save.
- **Category**: race
- **Impact**: silent loss of edits in the collaboration scenario advertised by the product.
- **Fix**: require `If-Match` (row `updatedAt`) or a `version` counter on `ProjectFieldValue`; reject stale writes with 409. The WebSocket `field-changed` event is advisory — it does not prevent this at the REST layer.

### [MEDIUM] Scenario: Meeting upload — 100 MB buffered, no MIME/type check (`.exe` renamed `.mp3`)
- **Setup**: Any authenticated user. `audio.mp3` is actually a PE executable.
- **Action**: `POST /pm/projects/:id/meetings/upload` with `multipart/form-data`, `audio` field = `malware.mp3` (100 MB max).
- **Expected**: server rejects non-audio MIME and refuses oversized / non-streamed uploads.
- **Actual** (Evidence):
  File: `web/back-nest/src/meetings/meetings.controller.ts:26-38`
  ```ts
  @Post('upload')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() audio: Express.Multer.File,
    ...
  ) {
    if (!audio || !audio.buffer.length) throw new BadRequestException('Fichier audio requis.')
    const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title, speakerMap)
  ```
  Default multer storage is **in-memory** (`audio.buffer`), so 100 MB per upload is held in the Node heap; no streaming to disk. No `fileFilter` accepting only audio MIME, no server-side magic-byte check. The buffer is then forwarded to the Python transcription service which may fail on a non-audio payload — but the file has already been fully buffered into memory and is echoed into `originalFileName` (meetings.service.ts:37) and logs.
- **Category**: upload / dos
- **Impact**: (1) Memory-based DoS — a few concurrent 100 MB uploads exhaust the Node process; (2) attacker uploads arbitrary binary content labelled as an audio meeting, which the DB stores under `originalFileName`. No malware scanning.
- **Fix**: add a `fileFilter` that rejects non-`audio/*` MIME and cross-checks the magic bytes server-side; switch to `diskStorage` or stream directly to the transcription service; lower the per-upload limit to what the transcription pipeline can actually handle (e.g. 25 MB).

### [MEDIUM] Scenario: Time entry — any authenticated user can log time to a project they are not a member of
- **Setup**: Viewer or team member with no role on project B.
- **Action**: `POST /api/time-entries` with `{projectId:"B", hours:8, spentOn:"2026-04-18"}`.
- **Expected**: 403 — user is not assigned to that project.
- **Actual** (Evidence):
  File: `web/back-nest/src/time-tracking/time-tracking.service.ts:61-94`
  ```ts
  async create(userId: string, dto: { projectId: string; workPackageId?: string; hours: number; ... }) {
    try {
      if (dto.hours <= 0 || dto.hours > 24) return Result.fail('Heures invalides (0-24).');
      const e = await this.prisma.timeEntry.create({
        data: {
          userId, projectId: dto.projectId, workPackageId: dto.workPackageId ?? null, ...
        },
      });
      // Update workPackage.spentHours
      if (dto.workPackageId) {
        const agg = await this.prisma.timeEntry.aggregate({ where: { workPackageId: dto.workPackageId }, ...});
        await this.prisma.workPackage.update({ where: { id: dto.workPackageId }, data: { spentHours: agg._sum.hours ?? 0 } });
      }
  ```
  No membership check. The `workPackageId` update is also unscoped — any authenticated user can inflate `spentHours` on any WP by logging time against it.
- **Category**: validation / idor
- **Impact**: budget burn-down and timesheet reports become untrusted; WP `spentHours` can be inflated for any project.
- **Fix**: verify the user is a member of `dto.projectId` (and, if provided, that `dto.workPackageId.projectId === dto.projectId`) before creating.

### [LOW] Scenario: Password reset — temp password persists indefinitely
- **Setup**: Admin clicks "Reset password" for a user. `mustChangePassword=true` is set, a random temp password is emailed.
- **Action**: attacker captures the mailbox days later; the user has not yet logged in.
- **Expected**: temp password expires after a short window (e.g. 24 h) or requires a single-use token with TTL.
- **Actual** (Evidence):
  File: `web/back-nest/src/users/users.service.ts:191-218`
  ```ts
  async resetPassword(id: string): Promise<Result<{ tempPassword: string }>> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });
    if (!user) return Result.fail('Utilisateur non trouvé.');
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await this.prisma.appUser.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    void this.mail.send(user.email, ...);
    return Result.ok({ tempPassword });
  }
  ```
  The temp password is a plain bcrypt replacement for `passwordHash` with no expiry column, no single-use token, and no `tempPasswordExpiresAt`. It remains valid forever until the user logs in and changes it (and see scenario #22 — `mustChangePassword` isn't enforced backend-side either).
- **Category**: auth
- **Impact**: delayed-capture of the password-reset email gives full account takeover. Combined with scenario #22 the attacker can use the account for anything before the legitimate owner notices.
- **Fix**: store a separate `tempPasswordHash` + `tempPasswordExpiresAt` (24 h), or issue a signed short-lived reset URL instead of emailing the plaintext password.

### [LOW] Scenario: Inline/`any` body types & undecorated DTO fields — ValidationPipe whitelist strips data
- **Setup**: global `ValidationPipe({ whitelist: true, transform: true })` (main.ts:17-22).
- **Action**: `PUT /pm/projects/:id/work-packages/:wpId/custom-values` with `{"values":[{"customFieldId":"cf1","value":"x"}]}`.
- **Expected**: service receives the `values` array.
- **Actual** (Evidence):
  File: `web/back-nest/src/work-packages/dto/work-package.dto.ts:55-57`
  ```ts
  export class UpsertCustomValuesDto {
    values!: CustomValueDto[];
  }
  ```
  No class-validator decorator (`@ValidateNested() @Type(() => CustomValueDto) @IsArray() values`). With `whitelist: true` and `transform: true`, any property lacking a validator decorator is considered non-whitelisted and **stripped** from the transformed class instance. The controller then reads `dto.values || []` (work-packages.controller.ts:140) and silently invokes the service with an empty array — custom values are never saved.
  Several other controllers use inline object literal types such as `@Body() dto: { ... }` (budgeting.controller.ts:22-46, wiki.controller.ts:38-54, time-tracking.controller.ts:32-44, agile.controller.ts, gantt.controller.ts:31-41, meeting-extras.controller.ts:*). Inline types resolve to metatype `Object`, which skips validation entirely and keeps all fields — the opposite failure mode: unknown/extra fields like `projectBudgetId`, `userId`, `spentHours`, `isDeleted`, `status` can ride on the payload undetected.
- **Category**: validation / mass-assignment
- **Impact**: (1) `UpsertCustomValuesDto.values` is silently dropped — broken feature; (2) inline-typed bodies allow mass-assignment because `whitelist` does not apply; a crafted body like `PATCH /api/time-entries/:id {"userId":"other","lockedAt":null}` currently only works because the service hand-picks fields, but any future service that does `this.prisma.X.update({data: dto})` instantly becomes mass-assignable.
- **Fix**: decorate every DTO class property with class-validator (`@IsArray() @ValidateNested({each:true}) @Type(() => CustomValueDto)` on `values`); replace inline `{...}` body types with proper DTO classes; add `forbidNonWhitelisted: true` to the global pipe.

### [UNCERTAIN] Scenario: Portal token enumeration via response time / status
- **Setup**: attacker hits `/api/portal/<guess>` with a 64-hex candidate.
- **Action**: look at response timing / body differences.
- **Expected**: constant-time comparison against DB.
- **Actual** (Evidence):
  File: `web/back-nest/src/portal/portal.service.ts:134-153`
  ```ts
  async validateAndFetchProject(token: string): Promise<PortalProjectView> {
    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      ...
    });
    if (!record) throw new NotFoundException('Ce lien est invalide ou n\'existe pas.');
    if (record.isRevoked) throw new ForbiddenException('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) throw new ForbiddenException('Ce lien a expiré.');
  ```
  The DB lookup is indexed (`@@index([token])`, schema.prisma:479). Tokens are 32 random bytes (256 bits) — brute force is not feasible. Distinct error messages (`invalide`, `révoqué`, `expiré`) leak token lifecycle state but not existence of a specific project, so a successful hit still requires the 64-hex secret. Flagged UNCERTAIN because the distinct statuses could be used to tell "valid but revoked" from "unknown" given an already-known token, which is a minor oracle.
- **Category**: auth
- **Impact**: minor — 2^256 keyspace makes enumeration impractical; only existing holders can distinguish revoked vs expired vs invalid.
- **Fix** (defence in depth): collapse the three error messages into one generic `Lien invalide ou expiré.`

### [UNCERTAIN] Scenario: Portal token cross-project leak when revoked mid-flight
- **Setup**: Admin clicks "Revoke" while a client has `getPortalView` in flight.
- **Action**: client reloads with the same (now-revoked) token, or replays the response.
- **Expected**: revoked token blocks both views and signoffs.
- **Actual** (Evidence):
  File: `web/back-nest/src/portal/portal.service.ts:134-186`
  ```ts
  if (record.isRevoked) throw new ForbiddenException('Ce lien a été révoqué.');
  ...
  await this.prisma.portalToken.update({
    where: { id: record.id },
    data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
  });
  ```
  Check happens before the `increment` update and before building the view. No read-modify-write race exposure on the read path. `submitSignoff` repeats the same guard (portal.service.ts:203-207). No finding beyond what is already called out in #7 (no single-use). Keeping as UNCERTAIN because no race window could be demonstrated from the code alone.
- **Category**: auth
- **Impact**: nothing material beyond #7.
- **Fix**: n/a (adopt #7's fix).

---

## Summary

| # | Scenario | Severity |
|---|---|---|
| 1 | Non-privileged user creates work packages anywhere | HIGH |
| 2 | PM of A reads Gantt/Wiki/etc of project B | HIGH |
| 3 | WP mutation scope holes (`move`, watchers, deps, custom values) | HIGH |
| 6 | Portal token enumeration timing | UNCERTAIN |
| 7 | Portal signoff replay / flip | MEDIUM |
| 8 | Portal token cross-project race | UNCERTAIN |
| 9 | WS `join-project` / `field-update` without membership | HIGH |
| 10 | WS field-update by view-only user | HIGH (covered by #9) |
| 13 | Concurrent questionnaire edit — last write wins | MEDIUM |
| 14/15 | Meeting upload MIME + in-memory 100 MB | MEDIUM |
| 16 | Attachment download IDOR | HIGH |
| 17 | Wiki page IDOR | HIGH |
| 18 | Budget line-item mass-assign / cross-project `id` | HIGH |
| 19 | Time entry forge `userId` | refuted |
| 20 | 2FA boundary | refuted |
| 21 | Password reset not time-boxed | LOW |
| 22 | `mustChangePassword` bypass via direct API | HIGH |
| 23 | Frontend-backend role mismatch | refuted |
| 5 | DTO validation drift (inline/undecorated) | LOW |

The single biggest theme: **no project-scope / membership guard on `pm/projects/:projectId/**` controllers**. The new permission system is in place (`PermissionsService`, `@RequirePermission`), but hasn't been applied to the v2.0 modules (work packages, Gantt, Wiki, Budget, Attachments, Collaboration gateway). Fixing that gap collapses #1, #2, #3, #9, #10, #16, #17, #18 into a single guard rollout.
