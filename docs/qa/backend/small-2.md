# Backend QA — filters / health / search / system-status / deadlines / templates

Files opened:
- `web/back-nest/src/filters/saved-filters.service.ts` (143 LOC)
- `web/back-nest/src/filters/saved-filters.module.ts` (10 LOC)
- `web/back-nest/src/filters/saved-filters.controller.ts` (86 LOC)
- `web/back-nest/src/health/health.controller.ts` (36 LOC)
- `web/back-nest/src/health/health.module.ts` (7 LOC)
- `web/back-nest/src/search/search.service.ts` (100 LOC)
- `web/back-nest/src/search/search.controller.ts` (16 LOC)
- `web/back-nest/src/search/search.module.ts` (10 LOC)
- `web/back-nest/src/system-status/system-status.controller.ts` (17 LOC)
- `web/back-nest/src/system-status/system-status.service.ts` (49 LOC)
- `web/back-nest/src/system-status/log.controller.ts` (35 LOC)
- `web/back-nest/src/system-status/system-status.module.ts` (12 LOC)
- `web/back-nest/src/deadlines/deadlines.service.ts` (221 LOC)
- `web/back-nest/src/deadlines/deadlines.module.ts` (12 LOC)
- `web/back-nest/src/deadlines/deadlines.service.spec.ts` (294 LOC)
- `web/back-nest/src/templates/templates.module.ts` (9 LOC)
- `web/back-nest/src/templates/templates.controller.ts` (58 LOC)
- `web/back-nest/src/templates/templates.service.ts` (123 LOC)

Supporting verification reads:
- `web/back-nest/src/common/result.ts`
- `web/back-nest/src/common/guards/roles.guard.ts`
- `web/back-nest/src/common/decorators/roles.decorator.ts`
- `web/back-nest/src/notifications/notifications.service.ts:55-90`
- `web/back-nest/prisma/schema.prisma` (AppUser.preferences, AppUser.role, ProjectField, ProjectTemplate/Field)

---

## `filters/` — SavedFilters

### [CRITICAL] Saved-filter JSON is round-tripped through `JSON.parse` without schema validation or size guard
- File: `web/back-nest/src/filters/saved-filters.service.ts:32-40`
- Category: validation
- Evidence:
```ts
  private async readPreferences(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) return {};
    if (!user.preferences) return {};
    return JSON.parse(user.preferences) as UserPreferences;
  }
```
- Impact: `preferences` is a `LONGTEXT` column (`prisma/schema.prisma:37`). `JSON.parse` is called with no try/catch and the inbound DTO (`FilterCriteria`) is typed as a `type` in `saved-filters.controller.ts:19` and not validated. Any subsequent `getAll` after a malformed write (or corruption) throws an uncaught `SyntaxError` that bubbles out as HTTP 500; any object can be injected (`[key: string]: unknown;` on line 25 preserves unknown keys). A malicious client can also put a multi-megabyte `filters` JSON per saved filter, then create many filters, bloating the user row indefinitely — no per-user count cap and no per-payload byte cap exist anywhere in this service.
- Fix: Wrap `JSON.parse` in try/catch → fall back to `{}` and log. Define DTOs as classes with `class-validator` (`@IsString`, `@IsArray`, `@MaxLength`, `@ArrayMaxSize`) per `CLAUDE.md` guidance about `@Body()` DTOs needing classes. Cap `savedFilters.length` (e.g. 50 per user) in `create` and cap the serialized `filters` size (e.g. 4 KB).

### [HIGH] `filters` object is not deep-sanitized — prototype-pollution-style keys and arbitrary nesting preserved
- File: `web/back-nest/src/filters/saved-filters.service.ts:66-79`
- Category: security
- Evidence:
```ts
    const newFilter: SavedFilter = {
      id: randomUUID(),
      name: dto.name.trim(),
      filters: { ...dto.filters },
      ...
```
- Impact: Shallow spread `{ ...dto.filters }` keeps any nested keys the client sent — `__proto__`, `constructor`, arbitrary deep objects. The `FilterCriteria` interface (lines 6-13) is a TS-only type; at runtime nothing is stripped. When the saved JSON is later consumed by the front-end to build Prisma `where` clauses (the obvious purpose of this store), the attacker controls the entire query shape unless the consumer re-validates — which is a classic filter-JSON injection vector. No `whitelist: true`/`forbidNonWhitelisted: true` applies because the DTO is an `interface`, not a class (see `CLAUDE.md` "Known Issues: DTOs must be classes").
- Fix: Define `CreateSavedFilterDto` / `FilterCriteriaDto` as classes with explicit `class-validator` decorators, enable `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` globally if not already, and on write reconstruct an allow-listed object: `{ status, priority, assignedToMe, tags, search, dateRange }`. Reject on unknown keys.

### [HIGH] No `name` length / character validation; `name.trim()` crashes on non-string
- File: `web/back-nest/src/filters/saved-filters.service.ts:68, 98`
- Category: validation
- Evidence:
```ts
      name: dto.name.trim(),
```
- Impact: If `name` is `undefined`, a number, or `null`, this throws `TypeError: Cannot read properties of undefined` → HTTP 500 instead of a 400. No max length (column is `LONGTEXT` → no DB-side guard). A client can submit a 1 MB name.
- Fix: Class DTO with `@IsString() @MinLength(1) @MaxLength(120)` on `name`. Same for update DTO.

### [MEDIUM] `setDefault` / `update` return `Result.fail` as 404 instead of 400/409
- File: `web/back-nest/src/filters/saved-filters.controller.ts:62-85`
- Category: logic
- Evidence:
```ts
    const result = await this.service.update(user.userId, filterId, dto);
    if (result.isFailure) throw new NotFoundException(result.error);
```
- Impact: When `update` fails because of a bad DTO (future validation), the client gets a 404 "Filtre non trouvé" regardless of the actual reason — both "user not found" and "filter not found" (distinct conditions) collapse to 404. Response semantics are misleading.
- Fix: Make the service distinguish error kinds (e.g. `Result.fail` with a discriminated code) and branch on it in the controller.

### [MEDIUM] Cross-tab / concurrent "set default" race — last-writer-wins with lost updates
- File: `web/back-nest/src/filters/saved-filters.service.ts:56-80, 126-142`
- Category: logic
- Evidence:
```ts
    const prefs = await this.readPreferences(userId);
    const existing = prefs.savedFilters ?? [];
    ...
    await this.writePreferences(userId, { ...prefs, savedFilters: updatedList });
```
- Impact: Read-modify-write on a JSON blob with no transaction/row lock. Two concurrent `POST /api/saved-filters` requests from the same user (two tabs, or an auto-sync client) will each read the same `existing`, compute independent `updatedList`s, and whichever serializes second will silently drop the first one's filter. `preferences` has no optimistic-concurrency column.
- Fix: Wrap in a transaction with a row lock (`$transaction` + raw `SELECT ... FOR UPDATE`) or add a `preferencesVersion` integer and do `update({ where: { id, preferencesVersion }, data: { preferencesVersion: { increment: 1 }, preferences: ... } })` retry-on-mismatch.

### [MEDIUM] Share-flag misuse — `isDefault` is the only multi-value flag and is honored blindly from user input
- File: `web/back-nest/src/filters/saved-filters.service.ts:74-76, 103-106`
- Category: logic
- Evidence:
```ts
    const updatedList: SavedFilter[] = dto.isDefault
      ? [...existing.map((f) => ({ ...f, isDefault: false })), newFilter]
      : [...existing, newFilter];
```
- Impact: `[UNCERTAIN]` — the focus area mentions "share-flag misuse"; this codebase only exposes `isDefault` (there is no `shared` / `visibility` flag in `SavedFilter`). If cross-user sharing is on the roadmap the current shape (`owner-scoped`, `isDefault` only) is safe, but nothing prevents a later DTO from smuggling a `shared: true` key into the JSON blob (see HIGH above on deep-sanitize) where a consumer could interpret it.
- Fix: Keep writes allow-listed. If sharing is added, persist it as a separate column or a separate `SavedFilter` model with explicit `ownerId` + `visibility` enum — not inside the per-user JSON blob.

### [LOW] Owner isolation relies on JWT `userId` being copied into every query — correct today but not enforced structurally
- File: `web/back-nest/src/filters/saved-filters.service.ts:33, 60, 87, 113, 127`
- Category: idor
- Evidence:
```ts
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      ...
```
- Impact: Every method passes `userId` from `@CurrentUser()` into the `where` clause, so IDOR is structurally impossible (the `filterId` path param is only matched inside the current user's `savedFilters` array). This is correct. However, the pattern depends on every new method following the convention. No explicit guard (`FilterOwnerGuard`) enforces it.
- Fix: Consider a tiny integration test asserting that user B cannot PUT `/api/saved-filters/<user-A-filter-id>` (today it would return 404 "Filtre non trouvé" because user-B's array does not contain that id — which is correct but not obvious from reading one method in isolation).

---

## `health/` — public health endpoint

### [HIGH] Health endpoint over-discloses runtime details without auth / rate limit
- File: `web/back-nest/src/health/health.controller.ts:26-34`
- Category: security
- Evidence:
```ts
    return {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? 'dev',
      uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
      node: process.version,
      checks,
      timestamp: new Date().toISOString(),
    };
```
- Impact: Public (`@Controller('health')` has no `@UseGuards`; the docstring on line 5-7 confirms no auth). The payload exposes exact Node.js version (`process.version` → e.g. `v20.11.1`), app semver (`version`), process uptime, and DB liveness bit. An attacker can fingerprint the Node major/minor for targeted CVE exploitation (e.g. ICU / HTTP server CVEs are Node-version-specific) and can watch `uptime_seconds` to confirm when deployments happen / when the server last crashed (useful for timing attacks or to confirm a DoS worked). The focus brief calls out "DB version / env" — DB version is not leaked here, but `node` + `version` + `uptime_seconds` are the same class of disclosure.
- Fix: Strip `node`, `version`, and `uptime_seconds` from the public response. Expose a second authenticated `/health/detailed` for internal monitoring if those fields are actually used by ops. Rate-limit `/health` (per-IP, e.g. 60/min) to prevent using it as an amplification beacon.

### [MEDIUM] `SELECT 1` is the sole DB liveness check — no timeout, no connection-pool backpressure
- File: `web/back-nest/src/health/health.controller.ts:20-25`
- Category: perf
- Evidence:
```ts
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      checks.db = false;
    }
```
- Impact: If MySQL is under load, this call can hang for the full Prisma connection-acquire timeout (default 10 s) while holding a request worker. A flood of monitoring probes (e.g. k8s liveness @ 1 Hz) can exhaust the connection pool and the probe itself starts reporting "degraded" as a cascading failure. No `AbortSignal.timeout` / `Promise.race` wrapper.
- Fix: Wrap in a 1-2 s `Promise.race` timeout; on timeout report `status: 'degraded'` without waiting. Optionally cache the last successful check for N seconds to avoid DB round-trip on every probe.

### [LOW] `PrismaService` is injected but `HealthModule` does not import `PrismaModule`
- File: `web/back-nest/src/health/health.module.ts:4-7`
- Category: logic
- Evidence:
```ts
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```
- Impact: `[UNCERTAIN]` — works today because `PrismaModule` is `@Global()` per `CLAUDE.md`. Still, if `@Global()` is ever removed this module silently breaks at runtime. Does not affect security.
- Fix: Keep relying on the global module, or add `imports: [PrismaModule]` for explicitness.

---

## `search/`

### [HIGH] Cross-project / cross-tenant leak — search ignores project membership
- File: `web/back-nest/src/search/search.service.ts:18-95`
- Category: idor
- Evidence:
```ts
  async search(q: string, limit = 8): Promise<Result<SearchHit[]>> {
    ...
        this.prisma.project.findMany({
          where: {
            isDeleted: false,
            OR: [{ name: { contains: query } }, { clientName: { contains: query } }],
          },
          ...
        this.prisma.workPackage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { description: { contains: query } }],
          },
          ...
        this.prisma.wikiPage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { content: { contains: query } }],
          },
          ...
        this.prisma.appUser.findMany({
          where: {
            isActive: true,
            OR: [
              { firstName: { contains: query } },
              { lastName: { contains: query } },
              { email: { contains: query } },
            ],
          },
```
- Impact: The controller only requires `JwtAuthGuard` (no role check, no project-membership filter). `SearchService.search` accepts just `q` + `limit` — the current user's `userId` is never passed in, so results contain work packages, wiki pages, and projects the user has no access to. A low-privilege account (e.g. `Viewer`) can enumerate every project name, every WP title, every wiki page title across the whole tenant by iterating short substrings. Wiki content matching (`content: { contains }` on line 43) also leaks private page body via the `title` response path being populated — but the more dangerous leak is that even WP `description` matches surface the WP id and projectId, enabling targeted privilege-escalation attempts.
- Fix: Accept `userId` (+ role) from `@CurrentUser()` in the controller, scope each query to projects the user is a member of / manager of / admin-on. Admins may legitimately see everything; non-admins must be filtered by a project-membership subquery (reuse whatever pattern the rest of the PM endpoints use).

### [HIGH] `contains` on MySQL with no FULLTEXT index — `O(n)` scan per keystroke → DoS vector
- File: `web/back-nest/src/search/search.service.ts:23-59`
- Category: perf
- Evidence:
```ts
      const [projects, wps, wikis, users] = await Promise.all([
        this.prisma.project.findMany({
          where: {
            isDeleted: false,
            OR: [{ name: { contains: query } }, { clientName: { contains: query } }],
          },
          ...
        this.prisma.wikiPage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { content: { contains: query } }],
          },
```
- Impact: Prisma's `contains` translates to `LIKE '%...%'` which cannot use a B-tree index — every query scans every row in each of the four tables. `wikiPage.content` is likely `TEXT`/`LONGTEXT`, so full-scan LIKE on it is linear in total wiki volume × concurrent requests. The controller has no debounce, no rate limit, minimum query length is only 2 chars (line 20), and `limit` is attacker-controlled up to `Number.MAX_SAFE_INTEGER` (see next finding). A scripted attacker can issue dozens of expensive queries/sec and starve the DB.
- Fix: Add a MySQL `FULLTEXT` index on `(title, content)` for wiki and `(title, description)` for WP, then use `$queryRaw` with `MATCH(...) AGAINST(... IN BOOLEAN MODE)`. Cap `limit` at e.g. 20. Require min query length 3. Apply `@Throttle` from `@nestjs/throttler`.

### [HIGH] `limit` query param is not validated — `parseInt` silently accepts `NaN`, negatives, huge numbers
- File: `web/back-nest/src/search/search.controller.ts:12`
- Category: validation
- Evidence:
```ts
    const r = await this.service.search(q ?? '', limit ? parseInt(limit, 10) : 8);
```
- Impact: `parseInt("-9999")` → `-9999` → Prisma `take: -9999` in `findMany` returns rows *in reverse* (Prisma documented behaviour) with abs length — attacker can flip pagination. `parseInt("9e9")` → `9e9` → Prisma `take: 9000000000` tries to return the whole table. `parseInt("abc")` → `NaN` → Prisma throws, leaking a stack trace through `BadRequestException` (line 13) unless a global exception filter hides it.
- Fix: `Math.max(1, Math.min(50, parseInt(limit ?? '8', 10) || 8))`. Better: class-validator DTO `@IsInt() @Min(1) @Max(50) @Type(() => Number)`.

### [MEDIUM] Wiki `content` and WP `description` are searched but never redacted in results
- File: `web/back-nest/src/search/search.service.ts:40-47, 78-85`
- Category: security
- Evidence:
```ts
        this.prisma.wikiPage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { content: { contains: query } }],
          },
          select: { id: true, title: true, slug: true, projectId: true },
```
- Impact: Low severity on its own (only title/slug are returned), but combined with the cross-project leak above this lets an attacker *detect the presence* of a term inside otherwise-restricted wiki content (oracle attack) by observing whether a page appears in results. E.g. searching for `"password"` or a leaked secret prefix confirms it is stored somewhere. Same for WP descriptions.
- Fix: Non-admins should match against title/slug only, never body content.

### [MEDIUM] User-hit `link` field is empty, implying front-end has to build a URL itself
- File: `web/back-nest/src/search/search.service.ts:86-92`
- Category: logic
- Evidence:
```ts
        ...users.map((u): SearchHit => ({
          type: 'user',
          id: u.id,
          title: `${u.firstName} ${u.lastName}`,
          subtitle: `${u.role} · ${u.email}`,
          link: '',
        })),
```
- Impact: User email is surfaced to every authenticated caller — that is a PII disclosure for any logged-in user. A `Viewer` sees every admin's email + role. Combined with the unrestricted search, this is an internal directory scrape (`a`, `b`, `c`, …).
- Fix: Restrict user search to admins; for non-admins omit `users` from the result set entirely or strip `email` from `subtitle`.

### [LOW] `Result.fail` masks all error causes under one French message — no observability
- File: `web/back-nest/src/search/search.service.ts:96-98`
- Category: logic
- Evidence:
```ts
    } catch {
      return Result.fail('Échec de la recherche.');
    }
```
- Impact: `catch` without binding drops the error entirely — no `logger.error`. Debugging a prod incident becomes impossible.
- Fix: Inject `Logger` and log the error before returning `Result.fail`.

---

## `system-status/`

### [HIGH] `LogController` returns raw `auditLog` rows — includes user email of every actor
- File: `web/back-nest/src/system-status/log.controller.ts:17-34`
- Category: security
- Evidence:
```ts
    const entries = await this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return entries
      .reverse()
      .map((e) => {
        const ts = e.createdAt.toISOString().replace('T', ' ').substring(0, 19);
        const who = e.user
          ? `${e.user.firstName} ${e.user.lastName} <${e.user.email}>`
          : 'system';
        return `[${ts}] [INFO] ${e.action} | ${e.entityType}:${e.entityId} | by ${who}`;
      });
```
- Impact: `@Roles('Admin')` gates access, but the focus brief flags this: `entityType:entityId` pairs trace every object id in the system (projects, WPs, users). If this endpoint is ever accidentally exposed (misconfigured `RolesGuard`, shim fallback below) a caller walks the entire audit trail. The brief specifically calls out "log paths / trace IDs exposed" — the `entityId` values are UUIDs from every model, which are stable references an attacker can replay against the API. Also, there is no pagination cursor: `lines=1000` always starts at the newest row; earlier rows are unreachable (by design but worth noting).
- Fix: Keep admin-only but add `@RequirePermission('audit.read')` per the new permission system (see `require-permission.decorator.ts`). Consider masking `entityId` (or the user email) in responses. Add a `before` / `after` cursor for paging through older logs.

### [HIGH] `@Roles('Admin')` on sensitive endpoints uses the legacy shim — silent fallback path
- File: `web/back-nest/src/system-status/system-status.controller.ts:7-10`, `web/back-nest/src/system-status/log.controller.ts:7-10`
- Category: auth
- Evidence:
```ts
@Controller('admin/SystemStatus')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class SystemStatusController {
```
and from the shim `roles.guard.ts:46-50`:
```ts
    // 1. Legacy path: JWT still carries `role` — accept if any required role
    //    matches, matching the pre-migration behaviour.
    if (user.role && requiredRoles.includes(user.role)) {
      return true;
    }
```
- Impact: The focus brief calls this out explicitly ("System-status legacy `@Roles`"). The shim (its own docstring says "can be deleted once every `@Roles()` site has been rewritten") still trusts the JWT `role` claim at face value. If an admin is demoted but still holds a valid non-expired JWT (no token revocation list is visible), they retain access to the audit log + DB status endpoints for the full `JWT_EXPIRES_IN=7d` window. There is also no `@RequirePermission` here, so the migration has not happened for these routes.
- Fix: Migrate `system-status.controller.ts` and `log.controller.ts` to `@RequirePermission('admin.systemStatus.view')` / `'admin.audit.view'`. Until migration: check DB-side role + `isActive` on every request, not the JWT claim.

### [MEDIUM] `SystemStatusService` exposes counts across every status — internal roadmap leakage
- File: `web/back-nest/src/system-status/system-status.service.ts:30-48`
- Category: security
- Evidence:
```ts
        this.prisma.project.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

    const projectByStatus: Record<string, number> = {};
    for (const row of projectsByStatus) {
      projectByStatus[row.status] = row._count._all;
    }

    return {
      databaseStatus,
      userTotal,
      userActive,
      projectTotal,
      projectByStatus,
    };
```
- Impact: Admin-only, so low to medium. But `databaseStatus: 'Connecté' | 'Erreur'` (line 18, 22) is French-localized — an admin dashboard observer can tell from the outside whether the DB is up by watching error propagation. The bigger issue is the legacy `@Roles('Admin')` gate above — if anyone with a stale token can call this, they learn tenant size (user count, project count, project phase distribution).
- Fix: Treat behind the same `@RequirePermission` migration. Localize `databaseStatus` to a stable enum (`'ok' | 'error'`) so the front-end can translate.

### [MEDIUM] `LogController` `lines` param uses `Number()` then `Math.min/max` — NaN passes silently as 200 default
- File: `web/back-nest/src/system-status/log.controller.ts:14-15`
- Category: validation
- Evidence:
```ts
  async getLogs(@Query('lines') lines = '200'): Promise<string[]> {
    const limit = Math.min(Math.max(Number(lines) || 200, 1), 1000);
```
- Impact: `Number('abc') || 200` → 200, which is fine; `Number('1001')` → clamped to 1000, also fine. But `Number('0.5')` → 0.5 → `Math.max(0.5, 1) = 1` — Prisma `take: 1` is OK. Real concern: memory. `take: 1000` with `include.user` loads up to 1000 `AuditLog` rows + 1000 `AppUser` joins into memory, then builds a string per row. At ~400 bytes/row that is ~400 KB per response, cheap on paper — but the brief flags "Log endpoint tail OOM". There is no streaming: everything is materialized, `.reverse()` allocates a second array, `.map` allocates a third. Under concurrent admin requests that is 3× duplication per caller.
- Fix: Stream to the HTTP response (`res.write(...)` per row) instead of building one array. Cap at 500 by default.

### [LOW] `log.controller.ts` imports `PrismaService` directly instead of going through a service
- File: `web/back-nest/src/system-status/log.controller.ts:2, 11`
- Category: logic
- Evidence:
```ts
import { PrismaService } from '../prisma/prisma.service.js';
...
  constructor(private readonly prisma: PrismaService) {}
```
- Impact: Violates the repo's Result-pattern convention (everywhere else controllers consume a service that returns `Result.ok/fail`). Not a security issue but makes it harder to unit test and to add a permission-scoped query builder later.
- Fix: Extract an `AuditLogService` that returns `Result<string[]>`.

---

## `deadlines/`

### [HIGH] `notify` fire-and-forget swallowed at service layer but `Promise.all` still rejects the outer loop
- File: `web/back-nest/src/deadlines/deadlines.service.ts:87-91, 101-105`
- Category: logic
- Evidence:
```ts
        await Promise.all(
          recipientIds.map((userId) =>
            this.notifications.notify(userId, type, title, message, project.id),
          ),
        );
        ...
        await Promise.all(
          recipientsWithEmail.map((r) =>
            this.mail.send(r.email, emailSubject, emailHtml).catch(() => undefined),
          ),
        );
```
- Impact: `NotificationsService.notify` already swallows its own failures internally (verified at `notifications.service.ts:55-90` — comment "Swallows ALL errors"), so the first `Promise.all` cannot reject in practice. But the implementation relies on *that* service's contract being preserved forever. The second `Promise.all` correctly wraps `.catch()` per call, so a single mail failure no longer aborts the batch. However, between the two `await`s there is no idempotency record: if the email send crashes the process *after* the notification row was persisted but *before* the next project iteration, the scheduler re-runs tomorrow and de-dup works — but if the crash happens *within the same day* and a human reboots, `fetchAlreadyAlertedProjectIds` (lines 154-168) looks at `createdAt >= todayStart`, so already-sent notifications are correctly skipped, but mails that were half-delivered will be re-sent on restart. Not duplicate notifications, but duplicate emails.
- Fix: Persist per-project email-sent flag separately (e.g. a `MailSent` log keyed on `(projectId, day, kind)`) and check it before `mail.send`. Alternatively, enqueue emails to a durable queue (BullMQ) instead of fire-and-forget.

### [HIGH] Scheduler has no distributed lock — multi-instance deployments will duplicate alerts
- File: `web/back-nest/src/deadlines/deadlines.service.ts:47-49`
- Category: logic
- Evidence:
```ts
  /** Runs every day at 08:00. */
  @Cron('0 8 * * *', { name: 'deadline-check' })
  async checkDeadlines(): Promise<void> {
```
- Impact: `@nestjs/schedule` runs the cron in *every* process. If the app is deployed behind PM2 cluster mode or scaled horizontally (documented risk in `CLAUDE.md`: "Collaboration presence is single-instance — the in-process presence Map won't work correctly with multiple NestJS processes"), each worker independently runs `checkDeadlines` at 08:00, each reads the same empty `alreadyAlerted` set, each writes notifications + sends emails. The de-dup at line 67 uses `createdAt >= todayStart` which is process-local timing — between 08:00:00 and 08:00:00 + epsilon, N workers race and all pass the "already alerted" check before any one of them has written a row.
- Fix: Acquire a DB-backed advisory lock at the top of `checkDeadlines` (`SELECT GET_LOCK('deadlines-check', 0)` for MySQL) and release on completion. Or restrict the cron to a single designated worker (e.g. `if (process.env.NODE_APP_INSTANCE !== '0') return;`).

### [MEDIUM] `fetchActiveAdmins` is unbounded — `appUser.findMany` with no `take`
- File: `web/back-nest/src/deadlines/deadlines.service.ts:138-143`
- Category: perf
- Evidence:
```ts
  private async fetchActiveAdmins(): Promise<AdminRow[]> {
    return this.prisma.appUser.findMany({
      where: { isActive: true, role: 'Admin' },
      select: { id: true, email: true },
    }) as Promise<AdminRow[]>;
  }
```
- Impact: The focus brief calls out "users.findMany unbounded". For a tenant with thousands of admins (unlikely but possible in a multi-tenant future), this returns all rows and fans out a notification + email to every admin for every alerting project in the window. No `take`, no batching.
- Fix: Add `take: 500` and log a warning if the row count hits the cap. Longer term: introduce a `deadlineAlertRecipient: true` column or use the permission system to pick recipients explicitly.

### [MEDIUM] `diffInDays` uses `Math.ceil` on a potentially-negative delta when a project already expired
- File: `web/back-nest/src/deadlines/deadlines.service.ts:184-186`
- Category: logic
- Evidence:
```ts
function diffInDays(to: Date, from: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
```
- Impact: Called as `diffInDays(project.endDate, todayStart)` at line 80. The query filter `endDate: { gte: todayStart, lte: windowEnd }` (line 126) already excludes past-due projects, so `to - from >= 0` always holds today. But if someone removes that filter (e.g. to surface overdue projects too), `Math.ceil` on a negative value rounds *toward zero* — a -1.5-day diff becomes -1, not -2 — subtly wrong. Also, `Math.ceil` on an exact boundary (`endDate === todayStart`) yields 0, which then `isCritical = 0 < 2 = true` — correct. Edge cases are OK today but fragile.
- Fix: Clamp to `Math.max(0, Math.ceil(...))` or use `Math.floor` with an explicit "days until" semantics comment.

### [LOW] `SKIPPED_STATUSES` is `as const` but spread with `...SKIPPED_STATUSES` becomes `string[]` — mutable
- File: `web/back-nest/src/deadlines/deadlines.service.ts:30, 125`
- Category: logic
- Evidence:
```ts
const SKIPPED_STATUSES = ['Completed', 'Archived'] as const;
...
        status: { notIn: [...SKIPPED_STATUSES] },
```
- Impact: No functional bug; just loses the readonly tuple type and makes accidental mutation of the spread copy possible (copy is local though). Purely cosmetic.
- Fix: `status: { notIn: SKIPPED_STATUSES as unknown as string[] }` or drop the spread.

### [LOW] `recipientsWithEmail` re-queries the DB for each project even though admins are already in memory
- File: `web/back-nest/src/deadlines/deadlines.service.ts:94, 145-152`
- Category: perf
- Evidence:
```ts
        const recipientsWithEmail = await this.fetchRecipientsWithEmail(recipientIds);
...
  private async fetchRecipientsWithEmail(
    recipientIds: string[],
  ): Promise<RecipientRow[]> {
    return this.prisma.appUser.findMany({
      where: { id: { in: recipientIds }, isActive: true },
      select: { id: true, email: true },
    }) as Promise<RecipientRow[]>;
  }
```
- Impact: `admins` already has `{id, email}`. Only the PM's email is unknown. The code issues a whole extra `findMany` per project just to fetch 0-1 PM emails. With a window of 7 days and active tenants, this is N extra round-trips.
- Fix: Build a local lookup `{[id]: email}` from `admins`, then only fetch the PM row when `projectManagerId` is not already in it.

---

## `templates/`

### [CRITICAL] Mass-assignment on `create` / `createFromProject` — `dto: any` with no validation
- File: `web/back-nest/src/templates/templates.controller.ts:29, 38`, `web/back-nest/src/templates/templates.service.ts:37-56, 66-92`
- Category: validation
- Evidence:
```ts
  async create(@CurrentUser() user: any, @Body() dto: any) {
    const result = await this.service.create(dto, user.userId);
```
and:
```ts
  async create(dto: any, adminId: string) {
    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: (dto.fields ?? []).map((f: any, i: number) => ({
            label: f.label,
            type: f.type ?? 'Text',
            category: f.category ?? 'Custom',
            isRequired: f.isRequired ?? false,
            displayOrder: f.displayOrder ?? i,
            options: f.options ?? null,
          })),
        },
      },
      ...
```
- Impact: `CLAUDE.md` warns "DTOs must be classes, not interfaces, when used with `@Body()`" — here the DTO is straight `any`, which entirely bypasses `ValidationPipe`. An admin can POST arbitrary keys; the service only cherry-picks fields but the `dto.fields` array is unbounded (no `@ArrayMaxSize`). A hostile admin (or a compromised admin token) could POST a 10 000-field template and OOM the DB write. `f.label` is not length-checked yet the DB column is `VARCHAR(200)` → Prisma will throw on overflow with a stack trace. `f.type` / `f.category` accept any string; downstream `applyToProject` then *copies* those free-form strings into `projectField.fieldType` (column is `VARCHAR(50)`), where unvalidated values can break UI rendering or crash downstream consumers that switch on fieldType.
- Fix: Define `CreateTemplateDto` + `CreateTemplateFieldDto` as classes with `class-validator`. Enforce `@IsIn([...FIELD_TYPES])` on `type` and `category`, `@ArrayMaxSize(100)` on `fields`, `@MaxLength(200)` on `label`. Apply global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.

### [HIGH] `createFromProject` deep-copies `options` verbatim — leaks any private per-project data stored there
- File: `web/back-nest/src/templates/templates.service.ts:66-92`
- Category: security
- Evidence:
```ts
  async createFromProject(projectId: string, dto: { name: string; description?: string }, adminId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: { fields: { where: { fieldCategory: { in: ['Dynamic', 'Custom'] } }, orderBy: { orderIndex: 'asc' } } },
    });
    if (!project) return Result.fail<any>('Projet non trouvé.');

    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: project.fields.map((f, i) => ({
            label: f.label,
            type: f.fieldType,
            category: f.fieldCategory,
            isRequired: f.isRequired,
            displayOrder: i,
            options: f.options,
          })),
        },
      },
      include: { fields: { orderBy: { displayOrder: 'asc' } } },
    });
    return Result.ok(template);
  }
```
- Impact: Focus brief calls this out ("Templates create-from-project deep-copy leaks private fields"). `ProjectField.options` is a `TEXT` column (`schema.prisma:205`) — in practice it is used for dropdown choices but nothing in the schema prevents a PM from storing sensitive free-text per-project (default values, internal hints, client secrets used as placeholders). When converted into a `ProjectTemplate`, those `options` are visible to *any other admin* who reads the template (there is no `visibility` flag on templates) and to any project the template is later applied to. There is also no filter on which fields are copied — `fieldCategory in ['Dynamic', 'Custom']` includes custom PM-added fields that may contain sensitive metadata. Labels themselves can include client-specific wording (e.g. `"Contact Acme — Jean's private mobile"`).
- Fix: Whitelist which field attributes get copied. For `options`, explicitly re-parse as JSON and drop any unknown keys (if it is a structured JSON) or require the admin to opt-in per field. Add a `visibility: 'Personal' | 'Shared'` column on `ProjectTemplate` so templates default to the creator-only scope.

### [HIGH] `applyToProject` blindly copies template fields into target project — mass-assigns without checking target ownership or existing fields (duplicate / override risk)
- File: `web/back-nest/src/templates/templates.service.ts:94-122`
- Category: logic
- Evidence:
```ts
  async applyToProject(templateId: string, projectId: string) {
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
      include: { fields: true },
    });
    if (!template) return Result.fail('Modèle non trouvé.');

    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    for (const tf of template.fields) {
      const field = await this.prisma.projectField.create({
        data: {
          projectId,
          label: tf.label,
          fieldType: tf.type,
          fieldCategory: tf.category,
          isRequired: tf.isRequired,
          orderIndex: tf.displayOrder,
          options: tf.options,
        },
      });
      await this.prisma.projectFieldValue.create({
        data: { projectId, projectFieldId: field.id, value: null },
      });
    }

    return Result.ok();
  }
```
- Impact: (a) No dedup — if the template is applied twice, every field is duplicated silently, breaking any UI that keys by label. (b) No transaction: if the 10th insert fails, the first 9 fields + 9 null values are already committed → partial state. (c) N×2 sequential round-trips instead of a single nested create: applying a 50-field template is 100 round-trips (with MariaDB adapter each round-trip is network-bound). (d) The target `projectId` is taken from the URL (`templates.controller.ts:54`) with only `@Roles('Admin')` gating — admins can blast any project with any template's fields, even projects they are not listed on. An admin's mistake (wrong projectId) pollutes the project irreversibly since there is no rollback. (e) No `ProjectFieldValue @@unique([projectId, projectFieldId])` collision handled (the schema has that unique constraint on line 226, so the second insert for a duplicate is OK — but if *any* side effect exists on ProjectFieldValue upsert elsewhere, re-application causes unique-violation exceptions mid-loop).
- Fix: Wrap in `prisma.$transaction`. Skip fields whose `label+fieldType+fieldCategory` already exists on the project. Use nested `create` within the template read-and-create pattern. Consider a soft "preview" step (return planned inserts) before writing. Add an audit-log row.

### [MEDIUM] `TemplatesController.getAll` ignores `Result.isFailure`
- File: `web/back-nest/src/templates/templates.controller.ts:14-18`
- Category: logic
- Evidence:
```ts
  @Get()
  async getAll() {
    const result = await this.service.getAll();
    return result.value;
  }
```
- Impact: `TemplatesService.getAll` never returns a failure today (line 14 `return Result.ok(...)` unconditionally), so `result.value` is always defined. But the pattern is inconsistent with every other handler in the file (`getById`, `create`, `delete`) that checks `isFailure`. If `getAll` ever starts returning `Result.fail`, the controller would silently return `undefined` as `200 OK`.
- Fix: Mirror the convention: `if (result.isFailure) throw new InternalServerErrorException(result.error);`.

### [MEDIUM] `@CurrentUser() user: any` and `@Body() dto: any` defeat runtime type safety
- File: `web/back-nest/src/templates/templates.controller.ts:29, 38`
- Category: validation
- Evidence:
```ts
  async create(@CurrentUser() user: any, @Body() dto: any) {
  ...
  async createFromProject(@Param('projectId') projectId: string, @Body() dto: any, @CurrentUser() user: any) {
```
- Impact: `user: any` loses the `{ userId: string; role: string }` contract — a typo like `user.id` would compile but return `undefined` as the `createdByAdminId`, breaking the FK. `dto: any` trivially allows mass-assignment (see CRITICAL above).
- Fix: Replace `any` with explicit DTO classes and a typed `CurrentUser` interface.

### [LOW] `getAll` loads every template without pagination
- File: `web/back-nest/src/templates/templates.service.ts:9-20`
- Category: perf
- Evidence:
```ts
  async getAll() {
    const templates = await this.prisma.projectTemplate.findMany({
      include: { _count: { select: { fields: true } } },
      orderBy: { createdAt: 'desc' },
    });
```
- Impact: Admin-only, but scales linearly. On a long-running tenant a thousand templates makes the admin UI slow and the payload big.
- Fix: Add `take` / `skip` with a default page size of 50.

### [LOW] `Result.fail<any>` and `Result.fail` used inconsistently
- File: `web/back-nest/src/templates/templates.service.ts:27, 61, 71, 99, 102`
- Category: logic
- Evidence:
```ts
    if (!t) return Result.fail<any>('Modèle non trouvé.');
...
    if (!t) return Result.fail('Modèle non trouvé.');
```
- Impact: Stylistic only. `Result.fail` without a generic infers `<void>` which may surprise the caller. No security impact.
- Fix: Pick one: always `Result.fail<ReturnType>('...')`.

---

## Summary by severity

| Sev | Count | Highlights |
|-----|-------|------------|
| CRITICAL | 2 | Filters `JSON.parse` + unbounded saved-filter payload; Templates mass-assignment with `any` DTOs |
| HIGH | 10 | Filters: prototype-pollution on `filters`, `name.trim()` crash; Health: over-disclosure; Search: cross-project leak, LIKE DoS, `limit` injection; System-status: audit-log id leak + legacy `@Roles` shim; Deadlines: multi-instance duplicate alerts; Templates: private-field leak via create-from-project + blind apply |
| MEDIUM | 10 | Saved-filter race, 404 vs 400 confusion, health `SELECT 1` no timeout, search PII + wiki oracle, system-status enum counts, log `take:1000` memory, deadlines admin unbounded + mail duplication, templates `getAll` return path + `any` DTOs |
| LOW | 8 | Module import omissions, `as const` erasure, `Result.fail` inconsistencies, `getAll` pagination, user-hit link empty string, observability gaps |

Top 3 priorities:
1. `templates.controller.ts` + `templates.service.ts` — replace all `any` with class DTOs; wrap `applyToProject` in a transaction; add allow-list for `createFromProject` option copying.
2. `search.service.ts` / `search.controller.ts` — scope all four queries by user membership, validate `limit`, add rate limit, stop searching wiki `content` for non-admins.
3. `health.controller.ts` — drop `node` + `version` + `uptime_seconds` from the public body; wrap DB check in a 1-2 s timeout.
