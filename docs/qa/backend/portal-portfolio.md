# Portal + Portfolio — Backend QA (line-by-line)

Files opened:
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portal\portal.controller.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portal\portal.service.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portal\portal.module.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portal\dto\portal.dto.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portfolio\portfolio.controller.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portfolio\portfolio.service.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\portfolio\portfolio.module.ts`

Cross-referenced for context (not modified, not part of the scope):
- `web\back-nest\src\common\guards\jwt-auth.guard.ts`
- `web\back-nest\src\common\guards\roles.guard.ts`
- `web\back-nest\src\common\result.ts`
- `web\back-nest\src\main.ts` (global `ValidationPipe { whitelist: true, transform: true }`)
- `web\back-nest\prisma\schema.prisma` (PortalToken / PortalSignoff / Portfolio / PortfolioProject / Version)
- `web\back-nest\src\notifications\notifications.service.ts` (`notify` signature)

---

## PORTAL MODULE

### [CRITICAL] Public portal endpoints have no rate limiting or brute-force protection
- File: `web/back-nest/src/portal/portal.controller.ts:72-102`
- Category: security
- Evidence:
```ts
// ─── Public portal routes (NO guard) ─────────────────────────────────────────

@Controller('api/portal')
export class PortalPublicController {
  constructor(private readonly portalService: PortalService) {}

  @Get(':token')
  async getPortalView(@Param('token') token: string) {
    try {
      return await this.portalService.validateAndFetchProject(token);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      throw new HttpException('Erreur interne.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':token/signoff')
  async submitSignoff(
    @Param('token') token: string,
    @Body() dto: SubmitSignoffDto,
    @Req() req: Request,
  ) {
```
- Impact: No `@Throttle` / `@nestjs/throttler` / reverse-proxy rate limit is attached. An attacker can:
  1. Enumerate/guess 32-byte hex tokens indefinitely (64-char search space is astronomically large, but there is no lockout on repeated `404 Ce lien est invalide` responses — useful as an oracle if token generator is ever weakened or if `createdAt`/`id` leaks guide guesses).
  2. Flood `POST /api/portal/:token/signoff` for a known token to spam signoffs, generate notification/email storms on the PM, and inflate `ipAddress` audit noise.
  3. Flood `GET /api/portal/:token` to drive up `accessCount` and spam DB writes on the counter (amplification: 1 GET = 1 SELECT + 1 UPDATE).
- Fix: Attach `@nestjs/throttler`'s `ThrottlerGuard` (or an upstream proxy rule) with tight limits (e.g. 10 req/min/IP on GET, 3 req/min/IP on POST signoff). Separately, consider short-circuiting the `accessCount` update behind debouncing or skipping it when the same token+IP hits within N seconds.

---

### [CRITICAL] Signoff replay — unlimited signoffs per token, no idempotency
- File: `web/back-nest/src/portal/portal.service.ts:188-234`
- Category: logic
- Evidence:
```ts
  async submitSignoff(
    token: string,
    dto: SubmitSignoffDto,
    ipAddress: string | undefined,
  ): Promise<Result<{ id: string }>> {
    if (!dto.clientName?.trim()) return Result.fail('Le nom est requis.');

    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      include: {
        project: {
          select: { id: true, name: true, projectManagerId: true, isDeleted: true },
        },
      },
    });

    if (!record) return Result.fail('Lien invalide.');
    if (record.isRevoked) return Result.fail('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) return Result.fail('Ce lien a expiré.');
    if (record.project.isDeleted) return Result.fail('Le projet associé n\'existe plus.');

    const signoff = await this.prisma.portalSignoff.create({
      data: {
        id: crypto.randomUUID(),
        portalTokenId: record.id,
        clientName: dto.clientName.trim(),
        clientEmail: dto.clientEmail?.trim() || null,
        comment: dto.comment?.trim() || null,
        isApproved: dto.isApproved,
        ipAddress: ipAddress ?? null,
      },
    });

    // Notify the project manager if assigned
    if (record.project.projectManagerId) {
      const decision = dto.isApproved ? 'approuvé' : 'refusé';
      void this.notifications.notify(
        record.project.projectManagerId,
        'portal_signoff',
        'Avis client reçu',
        `${dto.clientName} a ${decision} le projet "${record.project.name}" via le portail client.`,
        record.project.id,
      );
    }

    return Result.ok({ id: signoff.id });
  }
```
And schema (`prisma/schema.prisma:484-498`) has no unique constraint:
```ts
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
  @@map("PortalSignoffs")
}
```
- Impact: Anyone with a valid token can POST signoffs an unlimited number of times. Concretely:
  1. A malicious client (or anyone who intercepts the public URL) can flip the signoff decision indefinitely — "approved" → "refused" → "approved"... Whichever entry a PM reads last wins. There is no "latest wins" vs "first wins" documented policy either.
  2. Each signoff calls `notifications.notify(...)` unconditionally → notification + email spam on the PM, drowning real sign-offs.
  3. Storage DoS (every submit writes a new `PortalSignoff` row).
  4. `ClientPortalView.vue:379` only uses `localStorage.setItem(getSignedKey(token), '1')` as the "already signed" check — trivially bypassable by opening a private window, clearing storage, or curl.
- Fix: Enforce idempotency at the DB level AND at the service level:
  - Add `@@unique([portalTokenId, clientEmail])` (or `@@unique([portalTokenId])` for one-signoff-per-token semantics) to `PortalSignoff` in Prisma and apply via raw SQL per project rules.
  - Before `create`, query `portalSignoff.count({ where: { portalTokenId: record.id } })` and return `Result.fail('Ce lien a déjà été utilisé.')` if >0 (or if the same email already signed).
  - Optionally auto-revoke the token (`isRevoked: true`) inside the same transaction as the first signoff so any subsequent GET/POST is rejected.

---

### [HIGH] `ipAddress` is trusted from `X-Forwarded-For` without any proxy allowlist
- File: `web/back-nest/src/portal/portal.controller.ts:91-96`
- Category: security
- Evidence:
```ts
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress;

    const result = await this.portalService.submitSignoff(token, dto, ipAddress);
```
- Impact: `X-Forwarded-For` is user-supplied. Any client can send `X-Forwarded-For: 8.8.8.8` and the audit/signoff row will log that fake IP. For a legally-meaningful "client sign-off" record (which is the stated purpose — see `PortalSignoff.ipAddress` and notifications like "avis client reçu"), the recorded IP is forensically worthless. Also, `req.socket.remoteAddress` is only used as a fallback when `x-forwarded-for` is missing — present-but-forged wins.
- Fix: Enable Express's `trust proxy` in `main.ts` (`app.set('trust proxy', 'loopback, linklocal, uniquelocal')` or a specific proxy IP) and use `req.ip` instead of reading the header manually. Only trust `X-Forwarded-For` when the request arrived from a known proxy.

---

### [HIGH] `GenerateTokenDto.expiresInDays` has no upper bound via validators; clamp is silent
- File: `web/back-nest/src/portal/dto/portal.dto.ts:3-6` and `portal.service.ts:69-71`
- Category: validation
- Evidence:
```ts
// dto/portal.dto.ts
export class GenerateTokenDto {
  @IsOptional() @IsString() label?: string;
  @IsInt() @Min(1) expiresInDays!: number;
}
```
```ts
// portal.service.ts:69
    const daysValid = Math.min(Math.max(dto.expiresInDays, 1), 365);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysValid);
```
- Impact:
  1. DTO accepts any positive integer (e.g. `Number.MAX_SAFE_INTEGER`). Combined with `Math.max(..., 1)` the clamp works, but there's no `@Max(365)` so client-side gets a 201 with a *silently shortened* expiry, violating "fail fast with clear error messages" (coding-style.md).
  2. `label` has no `@MaxLength`. DB column is `VarChar(200)` (schema.prisma:468) so MySQL STRICT mode will error with an opaque 500 for strings >200 chars — potential info disclosure via the 500 path (the controller maps unknown errors to generic `Erreur interne.` in `portal.controller.ts:40-41`, which is fine, but a clean 400 is better).
- Fix:
  ```ts
  @IsInt() @Min(1) @Max(365) expiresInDays!: number;
  @IsOptional() @IsString() @MaxLength(200) label?: string;
  ```

---

### [HIGH] No `@MaxLength` on signoff fields → storage abuse + MySQL truncation errors
- File: `web/back-nest/src/portal/dto/portal.dto.ts:8-13`
- Category: validation
- Evidence:
```ts
export class SubmitSignoffDto {
  @IsString() clientName!: string;
  @IsOptional() @IsEmail() clientEmail?: string;
  @IsOptional() @IsString() comment?: string;
  @IsBoolean() isApproved!: boolean;
}
```
Schema (`prisma/schema.prisma:484-498`):
- `clientName` VarChar(200)
- `clientEmail` VarChar(256)
- `comment` TEXT (64 KB)
- Impact: Without `@MaxLength`, an unauthenticated attacker can post:
  - `clientName` of 10,000 chars → MySQL VarChar(200) will either truncate (if not STRICT) or emit a DB error surfacing as `Erreur interne.` 500. Combined with absence of rate limiting, this is a storage/DoS vector on the TEXT `comment` column (64 KB per request × unlimited requests due to [CRITICAL]#2).
  - The `main.ts` JSON body limit is `100mb` (`main.ts:14`) which makes the abuse surface much wider.
- Fix: Add `@MaxLength(200)` on `clientName`, `@MaxLength(256)` on `clientEmail`, and a sensible `@MaxLength(2000)` on `comment`. Also consider a lower per-route body limit for `POST /api/portal/:token/signoff`.

---

### [HIGH] `accessCount` increment is fire-and-forget inside request handler — silent failures, no atomicity
- File: `web/back-nest/src/portal/portal.service.ts:154-161`
- Category: data-integrity
- Evidence:
```ts
    // Track access
    await this.prisma.portalToken.update({
      where: { id: record.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
```
- Impact:
  1. The update happens AFTER the `findUnique`, outside any transaction. Two concurrent GETs can race; Prisma's `increment` is atomic at the SQL level (`SET accessCount = accessCount + 1`) so the count is fine, but the returned `project` view was computed on a **stale** snapshot read before the update. Minor consistency issue, not a security bug.
  2. If the update throws (FK, DB down), the whole request returns 500 even though the user's actual request (read the portal) already has its data. This is a poor UX / availability issue for a public page.
  3. There is no short-circuit for the case where the access-count update fails — it shouldn't block read.
- Fix: Run the increment with `.catch((err) => this.logger.warn(...))` or move it to a queue. Alternatively, wrap the read + increment in a single transaction with `SELECT ... FOR UPDATE` so callers always see an up-to-date `lastAccessedAt`.

---

### [HIGH] No tenant/ownership check on `generateToken` / `listTokens` / `revokeToken`
- File: `web/back-nest/src/portal/portal.controller.ts:25-67`, `portal.service.ts:59-132`
- Category: auth
- Evidence:
```ts
@Controller('admin/projects/:projectId/portal-tokens')
@UseGuards(JwtAuthGuard)
export class PortalTokensAdminController {
  ...
  @Post()
  async generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateTokenDto,
    @Req() req: Request & { user?: { userId?: string } },
  ) {
    const userId = req.user?.userId ?? '';
    if (!userId) {
      throw new HttpException('Authenticated user id missing.', HttpStatus.UNAUTHORIZED);
    }
    const result = await this.portalService.generateToken(projectId, userId, dto);
```
And revoke:
```ts
@Controller('admin/portal-tokens')
@UseGuards(JwtAuthGuard)
export class PortalTokenRevokeController {
  ...
  @Delete(':id')
  async revoke(@Param('id') id: string) {
    const result = await this.portalService.revokeToken(id);
```
- Impact: The guard chain is only `JwtAuthGuard`. There is no `RolesGuard` + `@Roles('Admin')` on this controller (compare with `portfolio.controller.ts:10-13` which uses both). Any authenticated user (e.g. `Viewer`, `SpecificationTeam`, or another PM) with a valid JWT can:
  1. Generate a public portal token for ANY projectId, exposing project data (name, client name, status, dates, field values, signoffs) to anyone they share the link with. This is an authorization bypass that exfiltrates project data publicly.
  2. List all tokens on any project (`GET /admin/projects/:projectId/portal-tokens`) — URL disclosure.
  3. Revoke any portal token by `id` (`DELETE /admin/portal-tokens/:id`) — DoS against legitimate client sign-off flow. The service does not verify that the caller owns the project tied to `tokenId` (`portal.service.ts:122-132`).
  
  Despite the URL prefix `admin/...`, the CLAUDE.md convention requires `@Roles('Admin')` + `RolesGuard`:
  > Admin routes on new modules use `@Roles('Admin')` — apply `JwtAuthGuard + RolesGuard` stack for any `/admin/*` endpoint
  
  This module predates or violates that rule.
- Fix: Apply `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('Admin')` on both `PortalTokensAdminController` and `PortalTokenRevokeController`. Additionally, in `generateToken`, verify the project belongs to the same tenant / is managed by the caller, and in `revokeToken`, load the token, check `token.project.projectManagerId === userId` or caller is Admin before revoking.

---

### [MEDIUM] `validateAndFetchProject` throws raw `NotFoundException`/`ForbiddenException` but `submitSignoff` uses Result.fail — inconsistent + response-envelope drift
- File: `web/back-nest/src/portal/portal.service.ts:134-186` vs `188-234`
- Category: logic
- Evidence:
```ts
  async validateAndFetchProject(token: string): Promise<PortalProjectView> {
    ...
    if (!record) throw new NotFoundException('Ce lien est invalide ou n\'existe pas.');
    if (record.isRevoked) throw new ForbiddenException('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) throw new ForbiddenException('Ce lien a expiré.');
    if (record.project.isDeleted) throw new NotFoundException('Le projet associé n\'existe plus.');
```
vs.
```ts
  async submitSignoff(
    ...
    if (!record) return Result.fail('Lien invalide.');
    if (record.isRevoked) return Result.fail('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) return Result.fail('Ce lien a expiré.');
    if (record.project.isDeleted) return Result.fail('Le projet associé n\'existe plus.');
```
- Impact: GET returns 404/403 with detailed French messages; POST returns 400 `{ statusCode, message }` via the controller's `HttpException`. Clients can infer portal lifecycle state (revoked vs expired vs invalid) via different status codes for GET vs body strings for POST. Minor info disclosure (revoked-vs-expired is useful to an attacker correlating pentest signals) and a clear consistency issue vs the codebase's documented Result-pattern convention.
- Fix: Pick one pattern. CLAUDE.md says "all service methods return `Result.ok(data)` / `Result.fail(message)`" — migrate `validateAndFetchProject` to return a `Result<PortalProjectView>` and let the controller map it to `HttpException`. Also collapse "invalid / revoked / expired" to a single generic "Ce lien n'est plus accessible." to reduce enumeration.

---

### [MEDIUM] Public GET leaks `clientName`, `clientEmail`, per-signoff `isApproved` and `comment` to anyone with the token
- File: `web/back-nest/src/portal/portal.service.ts:166-185`
- Category: security
- Evidence:
```ts
    // Build safe read-only shape — no user IDs or internal emails
    return {
      projectName: project.name,
      clientName: project.clientName,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      fieldValues: project.fieldValues
        .filter((fv) => fv.value !== null && fv.value !== '')
        .map((fv) => ({
          label: fv.field.label,
          value: fv.value,
        })),
      signoffs: record.signoffs.map((s) => ({
        id: s.id,
        clientName: s.clientName,
        isApproved: s.isApproved,
        comment: s.comment,
        signedAt: s.signedAt,
      })),
    };
```
- Impact:
  1. The comment banner says "no user IDs or internal emails" but every signoff's `clientName` and free-form `comment` is returned to every viewer of the token. If multiple distinct clients are sharing one token (or the token is circulated internally), this leaks each signer's comment (which can contain internal contract language, names of other approvers, or refusal reasons) to whoever loads the portal next. This is a confidentiality leak between concurrent consumers of the same public URL.
  2. Every `fieldValue` with a non-empty value is exposed regardless of whether it is operationally sensitive (e.g. budget, contract numbers, contact phones, internal deadlines). There is no "public-safe" flag on `ProjectField`.
  3. Portal consumers can enumerate all previously-posted comments after a single valid signoff — useful for reconnaissance.
- Fix:
  - Add a `isPublic: Boolean` (or `visibility` enum) column to `ProjectField` / `ProjectFieldValue` and only return fields explicitly flagged public.
  - Only return `signoffs` belonging to the current `clientEmail` (require `clientEmail` at GET time via a query string, or strip comments entirely from the public view).
  - Consider removing `signoffs[*].comment` from the public view — the sign-off decision is legitimate to show but free-form comments are not.

---

### [MEDIUM] No guard against bulk-creating tokens — one-project → many tokens spam
- File: `web/back-nest/src/portal/portal.service.ts:59-92`
- Category: logic
- Evidence:
```ts
  async generateToken(
    projectId: string,
    createdById: string,
    dto: GenerateTokenDto,
  ): Promise<Result<{ id: string; token: string; url: string; expiresAt: Date }>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
    });
    if (!project) return Result.fail('Projet non trouvé.');

    const daysValid = Math.min(Math.max(dto.expiresInDays, 1), 365);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysValid);

    const token = crypto.randomBytes(32).toString('hex');

    const record = await this.prisma.portalToken.create({
      data: {
        id: crypto.randomUUID(),
        projectId,
        token,
        createdById,
        label: dto.label ?? null,
        expiresAt,
      },
    });
```
- Impact: Combined with [HIGH] auth-bypass above, any authed user can mint unlimited tokens. Even with the auth fix, an admin can accidentally create hundreds of tokens. There is no per-project cap, no revoke-older-on-create mechanism, and no audit log entry. The PortalToken table's `@@index([projectId])` means lookups stay fast, but `listTokens` returns all of them unpaginated.
- Fix: Add a per-project cap (e.g. 10 active non-revoked tokens) and/or an audit log entry. Paginate `listTokens`.

---

### [MEDIUM] Controller's `GenerateTokenDto` / `SubmitSignoffDto` classes live in `dto/portal.dto.ts`; service re-declares interface DTOs with the same name — confusing and brittle
- File: `web/back-nest/src/portal/portal.service.ts:9-19` vs `web/back-nest/src/portal/dto/portal.dto.ts:3-13`
- Category: logic
- Evidence:
```ts
// portal.service.ts:9-19
export interface GenerateTokenDto {
  label?: string;
  expiresInDays: number;
}

export interface SubmitSignoffDto {
  clientName: string;
  clientEmail?: string;
  comment?: string;
  isApproved: boolean;
}
```
vs.
```ts
// dto/portal.dto.ts
export class GenerateTokenDto {
  @IsOptional() @IsString() label?: string;
  @IsInt() @Min(1) expiresInDays!: number;
}

export class SubmitSignoffDto {
  @IsString() clientName!: string;
  ...
}
```
- Impact: Two identically-named symbols exported from different modules. The controller imports the *class* (required by ValidationPipe per CLAUDE.md: "DTOs must be classes, not interfaces"). The service's own interface exports are dead code that will confuse anyone attempting to import the "canonical" DTO. A future maintainer who imports `GenerateTokenDto` from `portal.service.js` (the interface) and hands it to `@Body()` will silently have ALL fields stripped by `whitelist: true` because the metatype is `Object`.
- Fix: Remove the interface redeclarations from `portal.service.ts` and import the classes from `./dto/portal.dto.js` instead (or at least type the method parameter as `Pick<GenerateTokenDto, 'label' | 'expiresInDays'>` from the canonical class).

---

### [LOW] Frontend posts to `/portal/:token/signoff` but controller is at `/api/portal/:token/signoff`
- File: `web/back-nest/src/portal/portal.controller.ts:72,86` vs `web/Front/customapp/src/views/ClientPortalView.vue:371`
- Category: data-integrity
- Evidence:
```ts
// backend
@Controller('api/portal')
export class PortalPublicController {
  ...
  @Post(':token/signoff')
```
```ts
// frontend (ClientPortalView.vue:371)
    await axios.post(`${configStore.apiUrl}/portal/${token}/signoff`, {
```
vs. frontend GET at `ClientPortalView.vue:338`:
```ts
      `${configStore.apiUrl}/api/portal/${token}`,
```
- Impact: GET uses `/api/portal/...` (correct). POST signoff uses `/portal/...` (wrong — will 404 unless a proxy rewrites). End-to-end signoff is broken in the deployed config. Out of QA scope strictly, but symptomatic of the absence of an e2e test for the public portal.
- Fix: Align frontend to `${configStore.apiUrl}/api/portal/${token}/signoff` OR change the controller prefix to `portal` (and also update CLAUDE.md, which documents `POST /portal/:token/signoff`).

---

### [LOW] `api/portal` vs CLAUDE.md-documented `/portal` — documentation drift
- File: `web/back-nest/src/portal/portal.controller.ts:72`
- Category: logic
- Evidence:
```ts
@Controller('api/portal')
```
CLAUDE.md:
> - `GET /portal/:token` — public project view (no auth)
> - `POST /portal/:token/signoff` — client sign-off (no auth)
- Impact: Docs lie. New contributors will integrate with the wrong URL. See [LOW] above.
- Fix: Either rename the controller prefix to `portal` (and keep FE code) or update CLAUDE.md.

---

### [LOW] `try/catch` in `PortalPublicController.getPortalView` swallows error detail
- File: `web/back-nest/src/portal/portal.controller.ts:76-84`
- Category: logic
- Evidence:
```ts
  @Get(':token')
  async getPortalView(@Param('token') token: string) {
    try {
      return await this.portalService.validateAndFetchProject(token);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      throw new HttpException('Erreur interne.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
```
- Impact: OK behavior (does not leak DB errors), but the thrown generic `Erreur interne.` is never logged — debugging a 500 in production is guessing. Compare with `submitSignoff` which returns `Result.fail` (logged by Pino at the warn level via the 4xx route) but also doesn't log the *cause*.
- Fix: Inject `Logger` and `logger.error('Portal view failed', err)` before re-throwing.

---

### [LOW] Module comment hint about `<meta name="robots" content="noindex">` is not enforced
- File: `web/back-nest/src/portal/portal.controller.ts:1-2`
- Category: security
- Evidence:
```ts
// Note: Add <meta name="robots" content="noindex"> to the frontend ClientPortalView.vue
// to prevent search engines from indexing client portal pages.
```
- Impact: `X-Robots-Tag` is a server-side control that can also (and should) be emitted from the API on public portal responses so that search engines / archivers that stumble on the raw JSON don't index it. Relying only on a frontend meta tag is weak.
- Fix: Return `X-Robots-Tag: noindex, nofollow, noarchive` from `getPortalView` via an interceptor or `@Header` decorator. Same for the signoff POST.

---

### [LOW] `record.expiresAt < new Date()` is evaluated twice — lightly racy with the access-count update
- File: `web/back-nest/src/portal/portal.service.ts:151,206`
- Category: logic
- Evidence:
```ts
    if (record.expiresAt < new Date()) throw new ForbiddenException('Ce lien a expiré.');
```
- Impact: Between the expiry check and `portalToken.update(...)`, a concurrent revoke/expiry job could land. Tiny window, low harm — the access is already authorized.
- Fix: Do the expiry + revoke check and the increment in a single `prisma.$transaction` with `update({ where: { id, isRevoked: false, expiresAt: { gt: now } } })`. If `update` returns `{ count: 0 }` (using `updateMany`), reject.

---

### [LOW] `validateAndFetchProject` pulls ALL field values even when empty-filtered later
- File: `web/back-nest/src/portal/portal.service.ts:134-173`
- Category: logic
- Evidence:
```ts
    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            fieldValues: { include: { field: true } },
          },
        },
        signoffs: {
          orderBy: { signedAt: 'desc' },
        },
      },
    });
    ...
      fieldValues: project.fieldValues
        .filter((fv) => fv.value !== null && fv.value !== '')
```
- Impact: Over-fetching (minor). Also related to [MEDIUM] info-disclosure above — the filter is trying to hide blanks but does nothing to hide fields marked internal.
- Fix: Push the `value !== null` filter down to Prisma (`where: { value: { not: null } }`) inside the `include`.

---

## PORTFOLIO MODULE

### [CRITICAL] Portfolio endpoints are Admin-only but per-project `versions` endpoints have no ownership/PM check
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:82-140`, `portfolio.service.ts:144-224`
- Category: auth|idor
- Evidence:
```ts
@Controller('pm/projects/:projectId/versions')
@UseGuards(JwtAuthGuard)
export class VersionsController {
  constructor(private readonly service: PortfolioService) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    const r = await this.service.listVersions(projectId);
    ...

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: { name: string; description?: string; startDate?: string; endDate?: string },
  ) {
    ...
    const r = await this.service.createVersion(projectId, dto);

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { name?: string; ... }) {
    ...
    const r = await this.service.updateVersion(id, dto);
```
And service:
```ts
  async createVersion(projectId: string, dto: {...}) {
    try {
      const max = await this.prisma.version.aggregate({ where: { projectId }, _max: { position: true } });
      const v = await this.prisma.version.create({
        data: {
          projectId,
          ...
```
- Impact:
  1. The controller trusts `projectId` from the path but NEVER verifies that `req.user.userId` is the `projectManagerId` (or Admin). Any authenticated user — including `Viewer`, `SpecificationTeam` on other projects, or a rogue PM — can list/create/update/delete/lock/close **versions on any project in the system** by guessing `projectId`. Classic IDOR.
  2. `updateVersion(id, dto)` and `deleteVersion(id)` take a version ID with no project context at all (controller routes them under `/pm/projects/:projectId/versions/:id` but the service never validates `version.projectId === projectId`). An attacker sending `PATCH /pm/projects/<any>/versions/<targetVersionId>` can mutate any version in any project by guessing the version's UUID.
  3. `getVersionProgress` (`:id/progress`) does the same — reads WP counts / hours for any version by ID, leaking estimated vs spent hours across projects.
  4. Status field is free-form string (`if (dto.status !== undefined) data.status = dto.status;` — service.ts:184). No allowlist: `"DROP TABLE"`, `"deleted"`, anything goes. Combined with the schema's `VarChar(20)` default 'Open' — values are truncated silently or blow up with a DB error.
  5. The controller declares `interface AuthUser { userId: string }` (line 8) but **never injects `@CurrentUser()` into any of the `VersionsController` handlers**. No authorization decision is made at all.
- Fix:
  - Add a per-request check in a `ProjectAccessGuard` or in each handler: `project.projectManagerId === userId || user.role === 'Admin'`.
  - In `updateVersion` / `deleteVersion` / `lockVersion` / `closeVersion` / `getVersionProgress`, first load the Version, assert `version.projectId === projectId` from the path and the caller has access to that project.
  - Validate `dto.status` against an enum `['Open', 'Locked', 'Closed']` and reject everything else with 400.

---

### [HIGH] Portfolio-project add has no project-level authorization — Admin can attach any project, but worse: no tenant separation
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:53-57`, `portfolio.service.ts:83-95`
- Category: auth|idor
- Evidence:
```ts
  @Post(':id/projects')
  async addProject(@Param('id') id: string, @Body() body: { projectId: string; position?: number }) {
    const r = await this.service.addProject(id, body.projectId, body.position);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
```
```ts
  async addProject(portfolioId: string, projectId: string, position?: number) {
    try {
      const max = await this.prisma.portfolioProject.aggregate({
        where: { portfolioId }, _max: { position: true },
      });
      const pp = await this.prisma.portfolioProject.create({
        data: { portfolioId, projectId, position: position ?? (max._max.position ?? -1) + 1 },
      });
      return Result.ok(pp);
    } catch {
      return Result.fail('Échec.');
    }
  }
```
- Impact:
  1. The endpoint is guarded by `@Roles('Admin')` at the class level (`portfolio.controller.ts:10-13`), so non-admins are blocked — good. BUT the service does not verify:
     - That `projectId` points to an existing, non-deleted project (schema has `isDeleted`; missing check).
     - That `portfolioId` exists (yes, Prisma will FK-error, but caught `.catch {}` returns `Échec.` with no clue).
  2. The user task description explicitly flags: "portfolio attach/detach authz (PM can only add managed projects)". Because the whole portfolio surface is `@Roles('Admin')`, this constraint isn't enforceable at all — there is no PM-level attach path. Admins can attach *any* project to *any* portfolio, but the stated requirement of "PM can only add managed projects" cannot be met in the current design.
  3. `position` is accepted unvalidated from the request body. Attacker/admin can set a huge Int and then the next auto-increment `+1` is fine, but negatives or duplicates are allowed — causes `reorderProjects` sort to display the same project twice at different positions. Also `@@unique([portfolioId, projectId])` (schema.prisma:931) will block dup, but the catch block returns a generic "Échec." instead of a meaningful "project already in this portfolio".
- Fix:
  - Preflight-check `prisma.project.findFirst({ where: { id: projectId, isDeleted: false } })` and return `Result.fail('Projet introuvable ou supprimé.')`.
  - Catch `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` (unique constraint) and return `Result.fail('Projet déjà attaché.')`.
  - Validate `position` is a non-negative integer; optionally ignore caller-provided position entirely and always append to tail.
  - If PM-level portfolio management is desired, open a separate `/pm/portfolios` route guarded by "caller is PM of attached project".

---

### [HIGH] `reorderProjects` — race condition + unvalidated input + partial-update silent failure
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:60-65`, `portfolio.service.ts:106-115`
- Category: data-integrity|validation
- Evidence:
```ts
  @Patch(':id/projects/reorder')
  async reorder(@Param('id') id: string, @Body() body: { order: string[] }) {
    const r = await this.service.reorderProjects(id, body.order);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }
```
```ts
  async reorderProjects(portfolioId: string, order: string[]) {
    try {
      await Promise.all(order.map((projectId, idx) =>
        this.prisma.portfolioProject.updateMany({ where: { portfolioId, projectId }, data: { position: idx } })
      ));
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }
```
- Impact:
  1. `Promise.all` fires N independent `UPDATE`s in parallel, no transaction. Two concurrent reorder requests on the same portfolio interleave updates → final positions can be a non-monotonic mix of both intended orders. The `@@index([portfolioId, position])` (schema.prisma:932) makes this more visible but does not prevent it.
  2. No validation on `body.order`:
     - `order` can be `undefined` / `null` → `.map` throws TypeError caught by `catch {}` → returns generic "Échec.".
     - `order` can contain arbitrary project IDs that don't belong to this portfolio. `updateMany` with `where: { portfolioId, projectId }` silently matches 0 rows and moves on. Request succeeds with `{ success: true }` even if the caller sent garbage. Violates "fail fast with clear error messages".
     - `order` can be shorter than the actual portfolio size — leftover projects retain their old positions and collide with the new ones (two projects with `position: 5`).
     - `order` can be arbitrarily huge (no length cap) → unbounded parallel UPDATE fanout, DB DoS.
  3. There is no ownership check on the referenced projects — but this controller is Admin-only, so the impact is "Admin can corrupt portfolio order via malformed body" rather than cross-tenant.
- Fix:
  - Wrap in `prisma.$transaction(order.map((pid, i) => prisma.portfolioProject.update({ where: { portfolioId_projectId: { portfolioId, projectId: pid } }, data: { position: i } })))` so the whole reorder is atomic. Requires the `@@unique([portfolioId, projectId])` to be exposed as a compound unique (already is — line 931).
  - Validate: `Array.isArray(order)`, length equals current `count` for that portfolio, all IDs are currently attached to the portfolio, no duplicates (`new Set(order).size === order.length`). Return specific errors.

---

### [HIGH] `deletePortfolio` uses a bare `try/catch` that swallows Prisma errors — no FK cascade check
- File: `web/back-nest/src/portfolio/portfolio.service.ts:74-81`
- Category: logic|data-integrity
- Evidence:
```ts
  async deletePortfolio(id: string) {
    try {
      await this.prisma.portfolio.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }
```
- Impact:
  1. Generic catch. If the portfolio doesn't exist, returns "Échec." instead of 404. If a DB connectivity issue occurs, returns "Échec." indistinguishable from not-found.
  2. Prisma `portfolio.delete` with `PortfolioProject { onDelete: Cascade }` (schema.prisma:928) will cascade-delete all associations. That is probably intentional, but it is not documented and not logged. Accidental deletion of an Admin-managed portfolio nukes N associations with no audit trail.
- Fix:
  - Check existence first: `const p = await this.prisma.portfolio.findUnique({ where: { id } }); if (!p) return Result.fail('Portfolio introuvable.');`.
  - Typed `Prisma.PrismaClientKnownRequestError` branches.
  - Emit an `AuditLog` row for deletion (see AuditModule in app.module.ts).

---

### [MEDIUM] `createPortfolio` / `updatePortfolio` / `createVersion` / `updateVersion` accept unbounded `name` / `description`
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:25, 40, 94-99, 106-107`, `portfolio.service.ts:53-71, 157-175`
- Category: validation
- Evidence:
```ts
  @Post()
  async create(@Body() dto: { name: string; description?: string }, @CurrentUser() user: AuthUser) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createPortfolio(dto, user.userId);
```
```ts
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { name?: string; description?: string }) {
    const r = await this.service.updatePortfolio(id, dto);
```
```ts
  async createPortfolio(dto: { name: string; description?: string }, userId: string) {
    try {
      const p = await this.prisma.portfolio.create({
        data: { name: dto.name, description: dto.description ?? null, createdById: userId },
      });
```
- Impact:
  1. No DTO class. Bodies are typed as inline interfaces. `ValidationPipe { whitelist: true }` has **no class metadata to whitelist** — so arbitrary extra fields are accepted into `updatePortfolio` → passed through to `prisma.portfolio.update({ where: { id }, data: dto })` which is a full-mass-assignment bug. An admin crafting `{ id: "other-id", createdAt: "...", createdById: "..." }` will be silently ignored by Prisma (unknown keys error in Prisma 7), but ANY future added column that matches a legitimate `Portfolio` field is writable without being listed in DTO.
  2. Schema `name VarChar(200)` (schema.prisma:909) and `description Text` — no length caps on input, truncation risk or STRICT-mode DB error.
  3. `createdById: userId` is correct (from `@CurrentUser()`), but on `update`, the mass-assignment `data: dto` could allow an admin to change arbitrary fields the service author never reviewed.
- Fix: Replace inline interfaces with class-validator DTO classes (`CreatePortfolioDto`, `UpdatePortfolioDto`) with `@IsString()`, `@MaxLength(200)` on `name`, `@MaxLength(2000)` on `description`. Explicitly `pick` fields before passing to Prisma: `data: { name: dto.name, description: dto.description }`.

---

### [MEDIUM] `getRoadmap` leaks all versions + milestones regardless of version `status` or project visibility
- File: `web/back-nest/src/portfolio/portfolio.service.ts:117-141`
- Category: security|logic
- Evidence:
```ts
  async getRoadmap(portfolioId: string) {
    try {
      const pf = await this.prisma.portfolio.findUnique({
        where: { id: portfolioId },
        include: {
          projects: {
            orderBy: { position: 'asc' },
            include: {
              project: {
                select: {
                  id: true, name: true, status: true, startDate: true, endDate: true,
                  versions: true,
                  milestones: true,
                },
              },
            },
          },
        },
      });
      if (!pf) return Result.fail('Portfolio introuvable.');
      return Result.ok(pf);
    } catch {
      return Result.fail('Échec.');
    }
  }
```
- Impact:
  1. `versions: true` and `milestones: true` return every row, including `Closed` / `Locked` versions the portfolio manager may have deliberately hidden. There's no visibility filter.
  2. `isDeleted` on the parent Project is not filtered — a soft-deleted project attached to the portfolio will still appear with all its milestones. Inconsistent with the rest of the codebase (`Project.findFirst({ isDeleted: false })` pattern is used everywhere — see `portal.service.ts:64, 96`).
  3. Admin-only endpoint so impact is limited to "admin sees stale data", but it's still a data-hygiene + authorization-model issue when a non-admin PM surface is eventually added.
- Fix: Filter: `projects: { where: { project: { isDeleted: false } }, ... include: { versions: { where: { status: { not: 'Closed' } } }, milestones: { where: { isReached: false } } } }` (or expose query params to toggle).

---

### [MEDIUM] `interface AuthUser { userId: string }` defined locally — drift from the canonical JWT payload shape
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:8`
- Category: logic
- Evidence:
```ts
interface AuthUser { userId: string }
```
- Impact: Local re-declaration of what should be a shared type. If the JWT payload changes (e.g., `userId` renamed to `sub`), this file silently compiles but breaks at runtime. Not a security issue per se, but a maintainability red flag.
- Fix: Import a central `AuthenticatedUser` type from `src/common/decorators/current-user.decorator.ts` or wherever the passport strategy defines it.

---

### [MEDIUM] Service-wide `catch {}` hides all Prisma errors, degrading observability
- File: `web/back-nest/src/portfolio/portfolio.service.ts:21-23, 48-50, 69-71, 78-80, 92-94, 100-103, 111-114, 138-140, 152-154, 172-174, 187-189, 196-198, 221-223`
- Category: logic|security
- Evidence:
```ts
    } catch {
      return Result.fail('Échec.');
    }
```
(repeated across every service method)
- Impact:
  1. Zero logging of the caught error (the class has `private readonly logger = new Logger(PortfolioService.name);` on line 7 but only uses it in `createPortfolio` on line 60). Any Prisma constraint violation, query timeout, or DB connectivity issue presents to the admin as `"Échec."` with no stack, no code, no timestamp correlation.
  2. This violates the global rule "Never silently swallow errors" (common/coding-style.md). Production incident diagnosis on this module is effectively blind.
  3. Security-wise, this obscures attack signals. If someone is hammering `updateVersion` to probe whether version IDs from other projects exist, there's no log of `P2025` (record not found) vs `P2002` (unique violation).
- Fix: Log in every catch: `catch (e) { this.logger.error('<operation> failed', e); return Result.fail(...); }`. Differentiate common Prisma error codes where user-facing messages would help (e.g. `P2002` → "Nom en double.", `P2025` → "Introuvable.").

---

### [LOW] `VersionsController.create` strips `projectId` from DTO but mandatory fields aren't validated
- File: `web/back-nest/src/portfolio/portfolio.controller.ts:94-104`
- Category: validation
- Evidence:
```ts
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: { name: string; description?: string; startDate?: string; endDate?: string },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createVersion(projectId, dto);
```
- Impact: `startDate` / `endDate` are typed as strings but not validated as ISO dates. The service passes them to `new Date(dto.startDate)` (service.ts:165) which yields `Invalid Date` on bad input and Prisma then errors with a confusing "Value cannot be null" message. Also no check that `endDate >= startDate`.
- Fix: Adopt class-validator DTOs with `@IsISO8601()` / `@IsDateString()` and a cross-field validator `@ValidateIf((o) => o.endDate).@IsAfter('startDate')` (custom).

---

### [LOW] `updateVersion` allows status → arbitrary string, no transition enforcement
- File: `web/back-nest/src/portfolio/portfolio.service.ts:177-190`
- Category: logic
- Evidence:
```ts
  async updateVersion(id: string, dto: { name?: string; description?: string; startDate?: string; endDate?: string; status?: string }) {
    try {
      const data: Record<string, unknown> = {};
      ...
      if (dto.status !== undefined) data.status = dto.status;
      const v = await this.prisma.version.update({ where: { id }, data });
```
- Impact: Status lifecycle `Open → Locked → Closed` (implied by `lockVersion` / `closeVersion` wrappers at lines 201-207) is not enforced. A direct PATCH with `{ status: 'Open' }` can un-lock a Locked version and un-close a Closed version. No audit trail.
- Fix: Enforce a finite-state machine:
  ```ts
  const transitions: Record<string, string[]> = { Open: ['Locked'], Locked: ['Closed', 'Open'], Closed: [] };
  if (dto.status && !transitions[existing.status]?.includes(dto.status)) return Result.fail(...);
  ```

---

### [LOW] `lockVersion` / `closeVersion` delegate to `updateVersion` without any project-scope check
- File: `web/back-nest/src/portfolio/portfolio.service.ts:201-207`
- Category: logic
- Evidence:
```ts
  async lockVersion(id: string) {
    return this.updateVersion(id, { status: 'Locked' });
  }

  async closeVersion(id: string) {
    return this.updateVersion(id, { status: 'Closed' });
  }
```
- Impact: Inherits the IDOR from [CRITICAL] #1 — by ID alone, any authed user can lock/close any version. Also, closing a version doesn't affect attached WorkPackages (no cascade, no archival). "Closed" becomes a label with no enforcement.
- Fix: Per [CRITICAL] #1 fix, add project-scope assertion. Consider side-effects: when closing, flip all remaining non-Closed WorkPackages to something sensible or refuse close until all WPs are resolved.

---

### [LOW] `getVersionProgress` uses `Number(wp.spentHours)` and `Number(wp.estimatedHours ?? 0)` — precision loss on Decimal(8,2)
- File: `web/back-nest/src/portfolio/portfolio.service.ts:209-224`
- Category: data-integrity
- Evidence:
```ts
      const spentHours = v.workPackages.reduce((s, wp) => s + Number(wp.spentHours), 0);
      const estimatedHours = v.workPackages.reduce((s, wp) => s + Number(wp.estimatedHours ?? 0), 0);
      return Result.ok({ total, done, spentHours, estimatedHours, percent: total ? Math.round((done / total) * 100) : 0 });
```
- Impact: `Decimal(8,2)` → JS `Number` loses precision at >2^53 (won't hit here) but floating-point sum drift is real (e.g. `0.1 + 0.2 = 0.30000000000000004`) — the returned hours are reported to the user with trailing ugly digits unless the frontend rounds. Minor, but prevents exact accounting.
- Fix: Use `Prisma.Decimal` arithmetic or keep as string with fixed precision: `spentHours: spentHours.toFixed(2)`.

---

### [LOW] `listPortfolios` / `listVersions` / `getPortfolio` are unpaginated
- File: `web/back-nest/src/portfolio/portfolio.service.ts:11-24, 26-51, 144-155`
- Category: logic
- Evidence:
```ts
  async listPortfolios() {
    try {
      const items = await this.prisma.portfolio.findMany({
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { projects: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return Result.ok(items);
```
- Impact: At scale (e.g. hundreds of portfolios / versions / attached projects), response size balloons and page-load time degrades. Not a security issue but a latent performance bug.
- Fix: Add `page` / `limit` query params per the codebase convention (see `workPackages` in CLAUDE.md: "filters: ... page, limit").

---

### [LOW] `createPortfolio` does not enforce unique `name`
- File: `web/back-nest/src/portfolio/portfolio.service.ts:53-63`
- Category: logic
- Evidence:
```ts
  async createPortfolio(dto: { name: string; description?: string }, userId: string) {
    try {
      const p = await this.prisma.portfolio.create({
        data: { name: dto.name, description: dto.description ?? null, createdById: userId },
      });
```
Schema (`prisma/schema.prisma:907-919`) has no `@unique` on `Portfolio.name`.
- Impact: Admins can create duplicate portfolios with the same name, causing UX confusion and making "getRoadmap" results ambiguous in any UI that displays by name.
- Fix: Either add `@unique` to the `name` column and apply via raw SQL, or add a service-level precheck `findFirst({ where: { name: dto.name } })`.

---

### [UNCERTAIN] `onDelete: NoAction, onUpdate: NoAction` on `Portfolio.createdBy` / `PortalToken.createdBy`
- File: `prisma/schema.prisma:476, 915` (not in scope, referenced for context only)
- Category: data-integrity
- Evidence:
```ts
// PortalToken
  createdBy AppUser         @relation(fields: [createdById], references: [id], onDelete: NoAction, onUpdate: NoAction)
// Portfolio
  createdBy AppUser            @relation("PortfolioCreator", fields: [createdById], references: [id], onDelete: NoAction, onUpdate: NoAction)
```
- Impact: [UNCERTAIN] — depends on the product decision. If the creating user is deleted (or soft-deleted), the `PortalToken.createdBy` FK will block user deletion entirely (NoAction). For Portal tokens this may be desired (audit retention). For Portfolio, it might block the user cleanup flow. Not verified — requires a policy decision.
- Fix: Decide whether `createdById` should be `SetNull` (and add `createdById String?`) or kept `NoAction` for audit retention; document the choice.

---

## Summary

| Severity  | Count | Modules                                                                 |
|-----------|-------|-------------------------------------------------------------------------|
| CRITICAL  | 3     | Portal (rate-limit, signoff replay), Portfolio (versions IDOR)          |
| HIGH      | 7     | Portal (IP spoof, DTO bounds, missing Admin guard, access-count) + Portfolio (reorder race, delete, attach) |
| MEDIUM    | 7     | Portal (consistency, info-disclosure, token spam, dup DTO) + Portfolio (DTOs, roadmap leak, error-swallow, auth drift) |
| LOW       | 10    | Various validation, docs drift, precision, pagination, logging          |
| UNCERTAIN | 1     | FK cascade policy                                                       |

**Top 3 to fix immediately**:
1. Add `RolesGuard + @Roles('Admin')` to both portal admin controllers AND add a project-access check to the entire `VersionsController` (IDOR fix).
2. Enforce signoff idempotency at the DB level (`@@unique([portalTokenId])` or application-level "first signoff locks token").
3. Add `@nestjs/throttler` to the public portal controller with tight per-IP limits.
