# Auth Backend QA Review

Files opened:
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/auth.module.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/auth.controller.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/auth.service.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/jwt.strategy.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/totp.service.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/dto/login.dto.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/dto/change-password.dto.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/auth/dto/totp-enable.dto.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/permissions/permission-keys.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/permissions/permissions.service.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/permissions/permissions.module.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/roles/roles.controller.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/roles/roles.service.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/roles/roles.module.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/roles/dto/role.dto.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/guards/jwt-auth.guard.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/guards/roles.guard.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/guards/permissions.guard.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/decorators/roles.decorator.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/decorators/require-permission.decorator.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/common/decorators/current-user.decorator.ts`
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/audit/audit.service.ts` (cross-reference)
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/audit/audit.module.ts` (cross-reference)
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/main.ts` (cross-reference)
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/src/app.module.ts` (cross-reference)
- `C:/Users/BigPoppa/Desktop/neoleadge/web/back-nest/prisma/schema.prisma` (cross-reference)

---

### [CRITICAL] Hardcoded test-user passwords are shipped in production binaries and gated only by `NODE_ENV`
- File: `web/back-nest/src/auth/auth.service.ts:19`
- Category: auth
- Evidence:
```ts
const TEST_USERS: readonly TestUser[] = [
  {
    id: 'test-admin-001',
    email: 'admin@neoleadge.com',
    password: 'Admin@123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'Admin',
    mustChangePassword: false,
  },
```
- Impact: If `NODE_ENV` is ever unset (default is `undefined`, which is not equal to `'production'`), a remote attacker can log in with `admin@neoleadge.com / Admin@123` and obtain an Admin JWT — also exposes plaintext creds in source history & compiled JS bundles.
- Fix: Move test users to a seed script only executed at local dev bootstrap; reject any path that creates AppUser rows with fixed passwords at runtime.

### [CRITICAL] Dev-path login bypass auto-upserts an `Admin`-role AppUser on demand
- File: `web/back-nest/src/auth/auth.service.ts:162`
- Category: auth
- Evidence:
```ts
        await this.prisma.appUser.upsert({
          where: { id: testUser.id },
          update: {},
          create: {
            id: testUser.id,
            email: testUser.email,
            firstName: testUser.firstName,
            lastName: testUser.lastName,
            role: testUser.role,
            passwordHash: await bcrypt.hash(testUser.password, 10),
            isActive: true,
            mustChangePassword: testUser.mustChangePassword,
          },
        });
```
- Impact: A single login call when `NODE_ENV != 'production'` silently materialises an Admin row; once written, it persists forever — even after switching to production — giving a permanent backdoor account.
- Fix: Never write production-persistent rows from the login handler; use seed scripts, and ensure `.env` ships with `NODE_ENV=production` by default in prod builds.

### [CRITICAL] Dev login bypasses lockout, audit log, and `tokenVersion` — forging Admin JWT without the `tokenVersion` field
- File: `web/back-nest/src/auth/auth.service.ts:177`
- Category: auth
- Evidence:
```ts
        const jwt = await this.generateTokenForUser({
          id: testUser.id,
          email: testUser.email,
          role: testUser.role,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
        });

        return { jwt, mustChangePassword: testUser.mustChangePassword };
      }
```
- Impact: `generateTokenForUser` reads `tokenVersion` from the freshly-upserted row; if another admin later bumps it (via role edit) the attacker's legacy hardcoded login still re-issues fresh valid tokens — lockout and 2FA on the same email are silently bypassed because the dev branch never checks `totpEnabled`, `lockedUntil`, or `failedLoginAttempts`.
- Fix: Route all logins — including dev — through `authenticateDbUser` so lockout/2FA/audit checks apply; kill the TEST_USERS in-memory password compare.

### [CRITICAL] Dev-path password comparison uses timing-unsafe `===`
- File: `web/back-nest/src/auth/auth.service.ts:156`
- Category: security
- Evidence:
```ts
      if (testUser && testUser.password === password) {
```
- Impact: Character-at-a-time timing side channel could, in theory, distinguish which test-user email paired with which password; low risk but still a documented anti-pattern in auth code.
- Fix: Use `crypto.timingSafeEqual` or route through bcrypt; better, delete the branch entirely.

### [CRITICAL] `JWT_SECRET` silently falls back to `'dev-secret-change-me'` in three places — production deploys without the env var will sign tokens the whole world can forge
- File: `web/back-nest/src/auth/auth.module.ts:17`
- Category: security
- Evidence:
```ts
        secret: configService.get<string>('JWT_SECRET', 'dev-secret-change-me'),
```
- Impact: A production boot missing `JWT_SECRET` never crashes; it silently issues tokens signed with a public constant, letting anyone forge Admin JWTs.
- Fix: Fail fast at startup if `JWT_SECRET` is missing or shorter than ~32 bytes; remove every default value from `configService.get(..., 'dev-secret-change-me')` call sites.

### [CRITICAL] `JWT_SECRET` fallback duplicated in `auth.service.ts` (loginWithTotp + temp-token signing) and `jwt.strategy.ts` — each independently accepts the default
- File: `web/back-nest/src/auth/auth.service.ts:201`
- Category: security
- Evidence:
```ts
      payload = this.jwtService.verify<{ sub: string; totpPending: boolean }>(
        tempToken,
        { secret: this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me') },
      );
```
- Impact: Three separate fallback sites (lines 201, 435, `jwt.strategy.ts:36`) mean even if one is hardened the others continue signing/verifying with the same default; the temp-token path is particularly bad because it produces a full JWT in step 2 even if the full-token code is later fixed.
- Fix: Centralise secret lookup in a single validated config provider and inject it; never supply a default.

### [HIGH] `login()` returns raw `LoginResult` — password-change flag and 2FA challenge never run through audit logging in the TOTP branch
- File: `web/back-nest/src/auth/auth.service.ts:431`
- Category: auth
- Evidence:
```ts
    if (user.totpEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, totpPending: true },
        {
          secret: this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me'),
          expiresIn: TEMP_TOKEN_EXPIRES_IN,
        },
      );
      return { requiresTotp: true, tempToken };
    }
```
- Impact: Step-1 password success for a 2FA-enabled account is neither audited nor resets `failedLoginAttempts`; an attacker can brute-force passwords indefinitely on 2FA accounts because the counter is only reset after TOTP verification — but the branch never *increments* either once the password is correct, so the failed-attempt lockout never triggers on password re-use if each attempt eventually happens to be the right password but wrong TOTP.
- Fix: Reset `failedLoginAttempts` after password success OR write a distinct TOTP-failure counter; audit-log the "password OK / TOTP pending" state.

### [HIGH] Temp token for 2FA is a full JWT signed with the same secret and verified with `JwtService.verify` — no `aud`/`typ` separation from real access tokens
- File: `web/back-nest/src/auth/auth.service.ts:432`
- Category: auth
- Evidence:
```ts
      const tempToken = this.jwtService.sign(
        { sub: user.id, totpPending: true },
        {
          secret: this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me'),
          expiresIn: TEMP_TOKEN_EXPIRES_IN,
        },
      );
```
- Impact: Because temp tokens are signed with the same secret, any endpoint accepting a normal JWT will also verify a temp token; if the temp token happens to carry `email`/`role` in a future refactor, it could be accepted by `JwtStrategy.validate`. Currently the only guard is `totpPending: true` being missing on real tokens — JwtStrategy does NOT check `totpPending`, so a future regression is one field addition away from auth bypass.
- Fix: Give temp tokens a distinct `aud` claim (e.g. `'totp'`) and reject them in `JwtStrategy.validate`; or use a separate short-lived opaque token table.

### [HIGH] `JwtStrategy.validate` does not reject tokens carrying `totpPending: true`
- File: `web/back-nest/src/auth/jwt.strategy.ts:40`
- Category: auth
- Evidence:
```ts
  async validate(payload: JwtPayload): Promise<AuthedUser> {
    // Reject tokens whose tokenVersion is behind the DB — happens when the
    // user's roles were edited or revoked since the JWT was issued.
    const tokenVersion = payload.tokenVersion ?? 0;
    const currentVersion = await this.permissions.getTokenVersion(payload.sub);
    if (tokenVersion !== currentVersion) {
      throw new UnauthorizedException('Session invalidated — please log in again');
    }
    return {
```
- Impact: The strategy only validates `tokenVersion`. If a temp token ever happens to satisfy the permissions call (e.g. a future payload shape change), the user is granted access despite never completing TOTP.
- Fix: Add explicit check `if ((payload as any).totpPending) throw new UnauthorizedException(...)` or enforce a distinct issuer/audience.

### [HIGH] `ignoreExpiration: false` is good, but temp token uses `expiresIn: '5m'` while `JWT_EXPIRES_IN` default is `8h` — a fallback default of 7d in CLAUDE.md contradicts the code (UNCERTAIN on intent)
- File: `web/back-nest/src/auth/auth.module.ts:19`
- Category: auth
- Evidence:
```ts
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN', '8h') as `${number}${'s' | 'm' | 'h' | 'd'}`),
        },
```
- Impact: Access tokens live 8h by default without any refresh flow — 8h is long for admin tokens that can't be revoked short of bumping `tokenVersion`. [UNCERTAIN] what intended default should be — would be confirmed by the deployment docs stating the lifetime.
- Fix: Reduce default to 30–60 min and add a refresh endpoint, or document why 8h is acceptable.

### [HIGH] `changePassword` ignores password policy of the `ChangePasswordDto` when the endpoint is reused internally, and the policy itself is trivially weak
- File: `web/back-nest/src/auth/dto/change-password.dto.ts:10`
- Category: validation
- Evidence:
```ts
  @ApiProperty({ description: 'Min 8 chars, at least one uppercase letter and one digit' })
  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, { message: 'newPassword must contain at least one uppercase letter' })
  @Matches(/[0-9]/, { message: 'newPassword must contain at least one digit' })
  newPassword: string;
```
- Impact: `Password1` satisfies the rules; no lowercase/symbol requirement, no common-password blacklist, no "different from current password" check. Combined with `passwordHash` rounds = 10, it's weak for admin accounts.
- Fix: Require ≥12 chars, lowercase+uppercase+digit+symbol, reject common passwords (zxcvbn), and in the service verify `newPassword !== currentPassword`.

### [HIGH] `changePassword` service does not invalidate outstanding JWTs after password change
- File: `web/back-nest/src/auth/auth.service.ts:367`
- Category: auth
- Evidence:
```ts
    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });
  }
```
- Impact: If a user's password was compromised and they rotate it, all previously-issued tokens remain valid for their full `JWT_EXPIRES_IN` lifetime because `tokenVersion` is never bumped here.
- Fix: `data: { passwordHash: newHash, mustChangePassword: false, tokenVersion: { increment: 1 } }` and `permissions.invalidate(userId)`.

### [HIGH] `enableTotp` / `disableTotp` / password change: no re-auth or bcrypt current-password check before toggling 2FA
- File: `web/back-nest/src/auth/auth.service.ts:301`
- Category: auth
- Evidence:
```ts
  async disableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });

    if (!user || !user.totpSecret || !user.totpEnabled) {
      throw new UnauthorizedException('La 2FA n\'est pas activée pour ce compte.');
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);
```
- Impact: An attacker with a stolen session cookie/JWT can disable 2FA by providing the current TOTP code — but the expected secondary defence is password re-auth. `enableTotp` likewise never re-verifies the password, so session hijack = 2FA disable.
- Fix: Require `currentPassword` in the DTO and bcrypt-compare before toggling TOTP or enabling it.

### [HIGH] Dev test users bypass any attempt to enable TOTP — no path exists to enforce 2FA for them
- File: `web/back-nest/src/auth/auth.service.ts:146`
- Category: auth
- Evidence:
```ts
    if (dbUser) {
      return this.authenticateDbUser(dbUser, password);
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    if (!isProduction) {
      const testUser = TEST_USERS.find((u) => u.email === email);

      if (testUser && testUser.password === password) {
```
- Impact: Once the test-admin row exists (from a prior dev login), an Admin could enable TOTP on it — but a subsequent dev login with the hardcoded password still returns a full JWT without TOTP because the first branch takes precedence only when `dbUser` is returned. Actually it does — but the check ordering means a DB row with TOTP enabled short-circuits. [UNCERTAIN] effect depends on DB state; a missing row + hardcoded password gives a full bypass.
- Fix: Remove hardcoded password path entirely.

### [HIGH] `UnauthorizedException` messages include hardcoded business strings — no generic "try again" — enabling enumeration of 2FA-enabled vs password-locked users
- File: `web/back-nest/src/auth/auth.service.ts:397`
- Category: auth
- Evidence:
```ts
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is locked. Please try again later.',
      );
    }
```
- Impact: An attacker can learn which emails exist (they return "locked" after 5 attempts) vs which do not ("Invalid email or password"). Classic user-enumeration vulnerability.
- Fix: Always return the same error message regardless of account state; timing-equalise via constant-time lookup (dummy bcrypt compare when user not found).

### [HIGH] User enumeration via response timing — missing "dummy bcrypt" on `dbUser === null`
- File: `web/back-nest/src/auth/auth.service.ts:142`
- Category: auth
- Evidence:
```ts
    const dbUser = await this.prisma.appUser.findUnique({
      where: { email },
    });

    if (dbUser) {
      return this.authenticateDbUser(dbUser, password);
    }
```
- Impact: When `dbUser` is null we skip `bcrypt.compare`, so the total request time is measurably shorter than a wrong-password path — attacker trivially enumerates valid emails.
- Fix: Always run `bcrypt.compare(password, DUMMY_HASH)` on the unknown-user path to equalise wall-clock time.

### [HIGH] `login()` never audits failed login attempts
- File: `web/back-nest/src/auth/auth.service.ts:405`
- Category: auth
- Evidence:
```ts
    if (!isPasswordValid) {
      const updatedAttempts = user.failedLoginAttempts + 1;

      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: updatedAttempts,
      };

      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCK_DURATION_MINUTES);
        updateData.lockedUntil = lockUntil;
```
- Impact: Successful logins call `audit.log('AppUser', user.id, 'LOGIN', user.id)` (line 460) but failed attempts, lockouts, password changes, TOTP enable/disable, TOTP failures are never audit-logged. Security forensics impossible.
- Fix: Call `this.audit.log` (fire-and-forget) in every failure/lockout/TOTP toggle branch with meaningful actions.

### [HIGH] Lockout counter race — multiple simultaneous failed logins under-count attempts
- File: `web/back-nest/src/auth/auth.service.ts:406`
- Category: race
- Evidence:
```ts
      const updatedAttempts = user.failedLoginAttempts + 1;

      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: updatedAttempts,
      };
```
- Impact: Read-then-write pattern: two concurrent failed attempts both read `failedLoginAttempts = 4`, both compute `updatedAttempts = 5`, both write `5` — lockout triggers once, but an attacker running 100 parallel attempts effectively gets >> MAX_FAILED_ATTEMPTS tries before the row is written.
- Fix: Use `{ failedLoginAttempts: { increment: 1 } }`, then re-read and lock in a separate transaction, OR use a Prisma transaction with `SELECT ... FOR UPDATE`.

### [HIGH] `authenticateDbUser` never clears `lockedUntil` after the lock window expires — a past lockout is re-applied if the failed counter was not reset
- File: `web/back-nest/src/auth/auth.service.ts:397`
- Category: logic
- Evidence:
```ts
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is locked. Please try again later.',
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
```
- Impact: After the 15-min lock expires, `failedLoginAttempts` is still 5. The user logs in with a wrong password → `updatedAttempts = 6`, branch `>= MAX_FAILED_ATTEMPTS` still runs, locking the account again immediately after one new wrong attempt. Counter never rolls over.
- Fix: When lock has expired (i.e. `lockedUntil <= now`), reset both counters before evaluating password.

### [HIGH] `getMe` double-queries the DB: runs `loadUserPermissions` even though `PermissionsService.listPermissions` already caches the same lookup
- File: `web/back-nest/src/auth/auth.service.ts:487`
- Category: perf
- Evidence:
```ts
    const [assignments, permissionsSet] = await Promise.all([
      this.prisma.userRoleAssignment.findMany({
        where: { userId },
        select: {
          projectId: true,
          role: { select: { id: true, name: true } },
        },
      }),
      this.loadUserPermissions(userId),
    ]);
```
- Impact: Each `/auth/me` call issues two DB queries that can be served from `PermissionsService` cache; in addition `loadUserPermissions` has a near-duplicate implementation to `PermissionsService.load`, meaning two sources of truth for permission loading.
- Fix: Inject `PermissionsService`, use `permissions.listPermissions(userId)`; remove `loadUserPermissions` private method.

### [HIGH] `RolesGuard` grants access on JWT `role` claim ALONE without checking the user's current DB state
- File: `web/back-nest/src/common/guards/roles.guard.ts:47`
- Category: auth
- Evidence:
```ts
    // 1. Legacy path: JWT still carries `role` — accept if any required role
    //    matches, matching the pre-migration behaviour.
    if (user.role && requiredRoles.includes(user.role)) {
      return true;
    }
```
- Impact: `tokenVersion` check in `JwtStrategy` catches role revocations for *permissions* — but `RolesGuard` short-circuits BEFORE checking anything else once the JWT `role` string matches; combined with 8h-default JWT, an Admin who was demoted still retains every `@Roles('Admin')` endpoint for up to 8h unless `tokenVersion` was also bumped. The `tokenVersion` IS bumped for role assignments, but the legacy `AppUser.role` column is independent — if an admin flips `AppUser.role` directly (via `/admin/users/:id`), tokenVersion may not be bumped.
- Fix: In `RolesGuard` resolve the current `AppUser.role` from DB rather than trusting the JWT claim; or bump `tokenVersion` in `UsersService.updateUser` whenever the role changes.

### [HIGH] `JwtAuthGuard` has no explicit `handleRequest` override — default passport behaviour silently swallows non-Unauthorized errors
- File: `web/back-nest/src/common/guards/jwt-auth.guard.ts:1`
- Category: error-handling
- Evidence:
```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```
- Impact: If `PermissionsService.getTokenVersion` throws (DB down), `JwtStrategy.validate` rejects the promise; default `AuthGuard` translates the error into a generic 401. No logging path — transient DB errors look indistinguishable from bad tokens.
- Fix: Override `handleRequest(err, user, info, context)` to log + rethrow 503 on infra errors, 401 on auth errors.

### [HIGH] `roles.controller.ts` role-management endpoints: attacker with `role.manage` permission can self-elevate to Admin
- File: `web/back-nest/src/roles/roles.controller.ts:75`
- Category: auth
- Evidence:
```ts
  @Post('assignments')
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Assign a role to a user (global or per-project)' })
  assign(@Body() dto: AssignRoleDto) {
    return this.rolesService.assignRole(dto);
  }
```
- Impact: `role.manage` is granted to Admin preset only today — but if *any* custom role ever gets `role.manage`, that user can POST `assignments` with `userId: <self>` and `roleId: <Admin-role-id>` to become Admin. The service does no "actor vs target" check.
- Fix: In `RolesService.assignRole`, verify the acting user holds ≥ the permission-set of the role being assigned (or restrict Admin-role assignment to existing Admins only).

### [HIGH] `createRole` / `updateRole` accept arbitrary `permissionKeys` — no validation that keys exist in catalog; invalid keys silently drop
- File: `web/back-nest/src/roles/roles.service.ts:64`
- Category: validation
- Evidence:
```ts
    const perms = await this.prisma.permission.findMany({
      where: { key: { in: input.permissionKeys } },
      select: { id: true, key: true },
    });
```
- Impact: `permissionKeys: ['wp.ed1t', 'dashboard.view']` creates a role with `dashboard.view` only — no 400 response, so admin UI silently persists the typo'd empty permission. Worse, an attacker could probe for "secret" permission keys (e.g. `system.logs`) without ever learning which exist — all pass validation silently.
- Fix: Compute `missing = input.permissionKeys.filter(k => !perms.map(p => p.key).includes(k))` and return `BadRequestException` if non-empty.

### [HIGH] `updateRole` allows editing preset roles' permission set (only name is preset-protected)
- File: `web/back-nest/src/roles/roles.service.ts:89`
- Category: data-integrity
- Evidence:
```ts
    if (input.name && input.name !== role.name && role.isPreset) {
      throw new BadRequestException('Preset roles cannot be renamed');
    }

    if (input.permissionKeys) {
      const perms = await this.prisma.permission.findMany({
```
- Impact: An admin can mutate the preset `Viewer` role to have `role.manage`, creating a silent privilege escalation for anyone holding `Viewer`. Preset definitions in `permission-keys.ts` are not re-asserted on save.
- Fix: Reject `permissionKeys` edits when `role.isPreset === true`, or re-seed presets from the static map on every update.

### [HIGH] `assignRole` does not validate that `projectId` corresponds to an existing Project row
- File: `web/back-nest/src/roles/roles.service.ts:154`
- Category: validation
- Evidence:
```ts
  async assignRole(input: {
    userId: string;
    roleId: string;
    projectId?: string | null;
  }): Promise<void> {
    const projectId = input.projectId ?? null;
    const existing = await this.prisma.userRoleAssignment.findFirst({
      where: { userId: input.userId, roleId: input.roleId, projectId },
      select: { id: true },
    });
```
- Impact: Silent creation of assignments for non-existent projects (until FK fires). [UNCERTAIN] — depends on whether Prisma schema defines the FK, but validation is still absent at the app layer.
- Fix: Pre-validate `userId`, `roleId`, and `projectId` (if not null) exist; throw `BadRequestException` otherwise.

### [HIGH] `bumpAssignedUsersTokenVersion` runs BEFORE the role delete → race window where JWTs are already invalidated but role still exists
- File: `web/back-nest/src/roles/roles.service.ts:127`
- Category: race
- Evidence:
```ts
    if (role.isPreset) {
      throw new BadRequestException('Preset roles cannot be deleted');
    }
    await this.bumpAssignedUsersTokenVersion(roleId);
    await this.prisma.role.delete({ where: { id: roleId } });
    this.permissions.invalidate();
  }
```
- Impact: If `role.delete` fails (FK cascade error), users are already logged out despite the role still existing. Minor UX issue, but audit trails are broken.
- Fix: Wrap both operations in `prisma.$transaction` and bump/invalidate only after the delete succeeds.

### [HIGH] `deleteRole` does not bump token version of users who had this role assigned through a *parent* role hierarchy — plus `bumpAssignedUsersTokenVersion` uses `distinct: ['userId']` which Prisma does not guarantee for `findMany` (UNCERTAIN)
- File: `web/back-nest/src/roles/roles.service.ts:213`
- Category: logic
- Evidence:
```ts
  private async bumpAssignedUsersTokenVersion(roleId: string): Promise<void> {
    const users = await this.prisma.userRoleAssignment.findMany({
      where: { roleId },
      select: { userId: true },
      distinct: ['userId'],
    });
```
- Impact: [UNCERTAIN] — Prisma `distinct` with MySQL/MariaDB adapter may not deduplicate correctly in all versions. If it fails silently, `updateMany` with `id: { in: users.map(...) }` still works, but the returned array length is logged. Would be confirmed by running the seeded role deletion with multiple assignments and inspecting audit.
- Fix: Replace `distinct` with an in-memory `Set<string>` dedupe before calling `updateMany`.

### [HIGH] `listUserAssignments` exposes full project details (name, id) to anyone with `role.view` — including projects the caller cannot view
- File: `web/back-nest/src/roles/roles.controller.ts:90`
- Category: auth
- Evidence:
```ts
  @Get('users/:userId/assignments')
  @RequirePermission('role.view')
  @ApiOperation({ summary: 'List a user’s role assignments' })
  listUserAssignments(@Param('userId') userId: string) {
    return this.rolesService.listUserAssignments(userId);
  }
```
- Impact: `role.view` is granted to preset Admin only today. But any role with `role.view` can enumerate all projects another user is attached to without `project.view_all`.
- Fix: Filter the project join to include only projects the caller can view, or require `role.manage` here.

### [HIGH] `ChangePasswordDto` uses `@Body()` DTO but `currentPassword` has no length/type constraint beyond `@IsString`
- File: `web/back-nest/src/auth/dto/change-password.dto.ts:5`
- Category: validation
- Evidence:
```ts
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;
```
- Impact: Empty string passes validation → is sent to `bcrypt.compare('', user.passwordHash)` → returns false, so it fails closed, but leaks timing info through `bcrypt.compare` always executing.
- Fix: Add `@IsNotEmpty()` + `@MinLength(1)` to `currentPassword`.

### [HIGH] `LoginDto` allows passwords as short as 1 char (`@MinLength(1)`) — dev test users rely on `Temp@123` bypass, but a real user could be created with a 1-char password via `UsersService`
- File: `web/back-nest/src/auth/dto/login.dto.ts:13`
- Category: validation
- Evidence:
```ts
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password: string;
```
- Impact: Login itself just accepts whatever the hash matches; the real issue is that no policy is enforced on the LOGIN side — this is arguably fine — but combined with the weak `ChangePasswordDto` policy means the whole system allows short-password accounts created via admin-reset endpoints to keep using them.
- Fix: Delete the `@MinLength(1)` (it's a no-op beyond `@IsNotEmpty`); enforce the password-strength requirements in `UsersService.resetPassword` and user creation.

### [MEDIUM] Controller path is `@Controller('')` — empty-prefix controllers are anti-pattern, fragile against prefix changes
- File: `web/back-nest/src/auth/auth.controller.ts:20`
- Category: code-style
- Evidence:
```ts
@ApiTags('Auth')
@Controller('')
export class AuthController {
```
- Impact: Mixing `auth/*` and `hook/logout` routes under an empty controller prefix makes it hard to locate the auth surface; also prevents attaching a global guard at controller scope.
- Fix: Use `@Controller('auth')` and move `/hook/logout` to its own controller or rename the route.

### [MEDIUM] `hookLogout` endpoint is publicly accessible without `JwtAuthGuard` — may accept arbitrary GET requests
- File: `web/back-nest/src/auth/auth.controller.ts:146`
- Category: auth
- Evidence:
```ts
  /** No-op logout endpoint — JWT is stateless; client already cleared the token. */
  @Get('hook/logout')
  @HttpCode(HttpStatus.OK)
  hookLogout() {
    return { ok: true };
  }
```
- Impact: Endpoint is effectively dead; worse, because it's public and returns `200`, it can be used as a hidden pingback endpoint for SSRF amplification in some environments. Also doesn't perform server-side session/tokenVersion bump, so "logout" leaves tokens valid.
- Fix: Either delete it, or add `@UseGuards(JwtAuthGuard)` and bump `tokenVersion` on the calling user to truly invalidate their session.

### [MEDIUM] `bcrypt.hash(..., 10)` — rounds = 10 is below the 2026 recommended minimum of 12 for admin-grade accounts
- File: `web/back-nest/src/auth/auth.service.ts:171`
- Category: security
- Evidence:
```ts
            passwordHash: await bcrypt.hash(testUser.password, 10),
```
- Impact: Same `10` rounds used on line 364 for real user password changes. On modern hardware, 10 rounds is ~80ms — halve attack cost vs 12 rounds.
- Fix: Bump to 12 (or argon2id via `@node-rs/argon2`).

### [MEDIUM] `generateTokenForUser` issues a fresh DB round-trip on every login for `tokenVersion`
- File: `web/back-nest/src/auth/auth.service.ts:552`
- Category: perf
- Evidence:
```ts
    const { tokenVersion } = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
```
- Impact: In `authenticateDbUser` the caller already has the full user row including `tokenVersion` (if it were in the select). Extra query wastes time on every successful login.
- Fix: Add `tokenVersion: true` to the login-time `findUnique` select and pass it through.

### [MEDIUM] `generateToken` (line 566) is dead code — nothing invokes it
- File: `web/back-nest/src/auth/auth.service.ts:566`
- Category: dead-code
- Evidence:
```ts
  private generateToken(payload: {
    sub: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
    tokenVersion?: number;
  }): string {
    return this.jwtService.sign(payload);
  }
```
- Impact: Unused; if someone re-uses it they bypass the `tokenVersion` fetch in `generateTokenForUser`, issuing tokens with `tokenVersion: undefined` → `JwtStrategy.validate` coerces to 0 → validates if DB is also 0.
- Fix: Delete it.

### [MEDIUM] `loadUserPermissions` (`auth.service.ts:509`) duplicates `PermissionsService.load` logic — two sources of truth
- File: `web/back-nest/src/auth/auth.service.ts:509`
- Category: dead-code
- Evidence:
```ts
  private async loadUserPermissions(
    userId: string,
  ): Promise<{ global: string[]; perProject: Record<string, string[]> }> {
    const rows = await this.prisma.userRoleAssignment.findMany({
```
- Impact: If the permission model changes (e.g. role inheritance added), one copy might be updated and not the other.
- Fix: Delete it; reuse `PermissionsService.listPermissions`.

### [MEDIUM] `TotpService.verify` does not constrain `window` — default otplib window is ±1 (accepts last code), which also silently accepts replay within 30s
- File: `web/back-nest/src/auth/totp.service.ts:36`
- Category: auth
- Evidence:
```ts
  async verify(token: string, secret: string): Promise<boolean> {
    const result = await otpVerify({ token, secret });
    return result.valid;
  }
```
- Impact: No replay prevention — the same 6-digit TOTP can be accepted twice within the verification window.
- Fix: Persist `lastUsedTotpStep` per user and reject if incoming step ≤ stored; alternatively track a short-lived seen-tokens LRU.

### [MEDIUM] `TotpService.generateSecret` is unsalted — default otplib entropy is 20 bytes base32 (~32 chars). [UNCERTAIN] what options are passed
- File: `web/back-nest/src/auth/totp.service.ts:12`
- Category: security
- Evidence:
```ts
  generateSecret(email: string): { secret: string; otpauthUrl: string } {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
```
- Impact: Defaults to 20-byte entropy; RFC 6238 minimum is 16 bytes, so current value is acceptable but [UNCERTAIN] whether otplib 13.x default hasn't regressed. Would be confirmed by reading `generateSecret` source in `node_modules/otplib/dist/functional.js`.
- Fix: Pass explicit `generateSecret({ size: 32 })` to make the intent locked against future lib changes.

### [MEDIUM] `setupTotp` overwrites any previously-pending secret without confirmation — denies service to the previous pending setup
- File: `web/back-nest/src/auth/auth.service.ts:266`
- Category: UX
- Evidence:
```ts
    // Store pending secret (totpEnabled remains false until confirmed)
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });
```
- Impact: If user A is enabling TOTP and accidentally clicks "Setup" twice, the first secret (already in their authenticator app) is discarded, making the code they just saved invalid. Worse, if the user already has `totpEnabled: true`, `setupTotp` silently overwrites their working secret (the `enableTotp` branch never compares `totpEnabled`). Effectively a 2FA bypass by the account owner or a stolen-session attacker.
- Fix: In `setupTotp`, reject if `totpEnabled === true` (require `disableTotp` first).

### [MEDIUM] `setupTotp` does not re-authenticate with password before issuing a fresh secret
- File: `web/back-nest/src/auth/auth.service.ts:255`
- Category: auth
- Evidence:
```ts
  async setupTotp(userId: string): Promise<{ secret: string; qrCode: string }> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    const { secret, otpauthUrl } = this.totpService.generateSecret(user.email);
```
- Impact: Same as `disableTotp` — any stolen JWT can re-initialise TOTP, then call `enableTotp` with the new code they control, effectively hijacking the 2FA.
- Fix: Add `currentPassword` to the setup DTO and verify with bcrypt.

### [MEDIUM] `enableTotp` / `disableTotp` / `loginWithTotp` increment `failedLoginAttempts` on bad TOTP but never trigger account lockout
- File: `web/back-nest/src/auth/auth.service.ts:226`
- Category: auth
- Evidence:
```ts
    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
        },
      });
      throw new UnauthorizedException('Code TOTP invalide.');
    }
```
- Impact: Counter goes up but the branch never checks `>= MAX_FAILED_ATTEMPTS` → TOTP is effectively brute-forceable (1 in 1M per attempt, no rate limit at application level).
- Fix: Add the same lockout check that exists for failed passwords.

### [MEDIUM] `TOTP enable`/`disable` increments `failedLoginAttempts` even on authenticated user — legitimate user typos now lock them out of login
- File: `web/back-nest/src/auth/auth.service.ts:284`
- Category: UX
- Evidence:
```ts
    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code TOTP invalide.');
    }
```
- Impact: User is logged in (has valid JWT) trying to enable 2FA, types 123456 wrong twice → increments `failedLoginAttempts` against their OWN account. If the counter was already at 4 (from prior failed logins), this locks them out. Counters should be separate.
- Fix: Use a distinct `failedTotpAttempts` column or only touch `failedLoginAttempts` during login.

### [MEDIUM] `loginWithTotp` never re-audits via `audit.log` — successful TOTP completions are invisible in audit trail
- File: `web/back-nest/src/auth/auth.service.ts:252`
- Category: error-handling
- Evidence:
```ts
    return { jwt, mustChangePassword: user.mustChangePassword };
  }
```
- Impact: Successful 2FA logins are not audited (password-only logins ARE via line 460). Auditor cannot distinguish "Admin logged in with 2FA" from "Admin logged in without 2FA" — significant compliance gap for admin accounts.
- Fix: `void this.audit.log('AppUser', user.id, 'LOGIN', user.id, undefined, { method: 'totp' });` after successful verification.

### [MEDIUM] `AuthController.getMe` return type not declared at the controller level — relies on service signature
- File: `web/back-nest/src/auth/auth.controller.ts:68`
- Category: types
- Evidence:
```ts
  async getMe(@CurrentUser() user: { userId: string }) {
    return this.authService.getMe(user.userId);
  }
```
- Impact: If service return type changes, Swagger and clients silently drift. Per user's coding-style rules, public API methods need explicit return types.
- Fix: Annotate return type; or use `@ApiResponse({ type: GetMeDto })`.

### [MEDIUM] `CurrentUser` decorator has no type constraint — `request.user` typed as `any` at call sites
- File: `web/back-nest/src/common/decorators/current-user.decorator.ts:4`
- Category: types
- Evidence:
```ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```
- Impact: Callers must duplicate the `{ userId: string }` type every time; refactoring the JWT payload is hard because call sites aren't locked to an interface.
- Fix: Export a strongly-typed `CurrentUser` that returns `AuthedUser` from `jwt.strategy.ts`.

### [MEDIUM] `RolesGuard` fallbacks to "deny" when JWT role is unknown but user has no userId — ambiguous vs missing auth
- File: `web/back-nest/src/common/guards/roles.guard.ts:42`
- Category: error-handling
- Evidence:
```ts
    if (!user?.userId) {
      return false;
    }
```
- Impact: Returning `false` yields a generic 403 with no indication that the real problem is missing auth. Should throw `UnauthorizedException` so the client knows to re-login.
- Fix: `throw new ForbiddenException('Not authenticated')` or `UnauthorizedException`.

### [MEDIUM] `PermissionsGuard` throws `ForbiddenException` with the full permission list — potential info leak of the permission taxonomy
- File: `web/back-nest/src/common/guards/permissions.guard.ts:54`
- Category: security
- Evidence:
```ts
    throw new ForbiddenException(
      `Missing permission (requires: ${meta.anyOf.join(' | ')})`,
    );
```
- Impact: An anonymous probe learns which permissions gate each route (e.g. `role.manage`, `analytics.view`) — helps an attacker craft targeted privilege-escalation queries.
- Fix: Return a generic `'Forbidden'` in production; log the detail server-side.

### [MEDIUM] `PermissionsService.cache` is in-memory only — no cross-process invalidation on PM2 cluster / horizontal scale
- File: `web/back-nest/src/permissions/permissions.service.ts:16`
- Category: perf
- Evidence:
```ts
  private readonly cache = new Map<string, CachedUserPermissions>();
```
- Impact: With 2+ NestJS processes, bumping a role on process A doesn't invalidate process B's cache; for up to 60s a user may retain revoked permissions. Already noted in CLAUDE.md for collaboration, but also applies here.
- Fix: Either document single-instance-only, use Redis pub/sub to broadcast invalidations, or drop TTL to 5s.

### [MEDIUM] `PermissionsService.invalidate()` without argument clears the ENTIRE cache — O(users) cache thundering-herd on next request
- File: `web/back-nest/src/permissions/permissions.service.ts:98`
- Category: perf
- Evidence:
```ts
  invalidate(userId?: string): void {
    if (userId) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }
```
- Impact: `RolesService.createRole` and `updateRole` both call `invalidate()` with no arg (roles.service.ts lines 79, 117, 129), meaning every active user suddenly triggers a DB lookup on next permission check. Under load this is a DoS vector on any role save.
- Fix: `invalidate` should only flush users assigned to the mutated role (already computed by `bumpAssignedUsersTokenVersion`).

### [MEDIUM] `permissions.service.ts` — cache entry is mutable (`Set<string>`) shared by reference — any caller could mutate it
- File: `web/back-nest/src/permissions/permissions.service.ts:65`
- Category: data-integrity
- Evidence:
```ts
    const entry: CachedUserPermissions = {
      global,
      perProject,
      tokenVersion: user?.tokenVersion ?? 0,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(userId, entry);
    return entry;
```
- Impact: `load(userId)` returns `entry` directly. If any caller mutates `entry.global` (e.g. `entry.global.add('debug')`), the cache is poisoned until TTL expires → runtime privilege escalation possible via a sibling bug.
- Fix: Freeze the sets with `Object.freeze` or return copies from `userHasPermission` / `listPermissions` (the public API already copies in `listPermissions`).

### [MEDIUM] `PermissionsService` uses `Date.now() + CACHE_TTL_MS` but never rejects tokens with `tokenVersion` drift inside the cache window
- File: `web/back-nest/src/permissions/permissions.service.ts:63`
- Category: auth
- Evidence:
```ts
    const entry: CachedUserPermissions = {
      global,
      perProject,
      tokenVersion: user?.tokenVersion ?? 0,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
```
- Impact: When `invalidate(userId)` is called on role change, the cache is purged, so next request re-reads `tokenVersion`. But if TOKEN bump happens right after a fresh `load` (outside RolesService paths — e.g. via `bumpUserTokenVersion` in some future call site that forgets to invalidate), JwtStrategy still returns the stale `tokenVersion` from cache for up to 60s.
- Fix: Read `tokenVersion` from DB in `getTokenVersion`, skip the cache layer — it's a hot path per request but cheap (single int fetch).

### [LOW] `LoginDto.email` → `@IsEmail()` rejects emails with leading/trailing spaces but does not normalise case
- File: `web/back-nest/src/auth/dto/login.dto.ts:6`
- Category: validation
- Evidence:
```ts
  @ApiProperty({ example: 'admin@neoleadge.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
```
- Impact: `Admin@NeoLeadge.com` vs `admin@neoleadge.com` are different strings — `prisma.appUser.findUnique({where: { email }})` is case-sensitive in MySQL by default (depends on collation). Users may unintentionally fail to log in.
- Fix: Add `@Transform(({ value }) => String(value).trim().toLowerCase())` to the DTO + ensure DB collation is `_ci`.

### [LOW] `TotpLoginDto.tempToken` has no length constraint — could DoS with a 1MB "token"
- File: `web/back-nest/src/auth/dto/totp-enable.dto.ts:13`
- Category: validation
- Evidence:
```ts
export class TotpLoginDto {
  @ApiProperty({ description: 'Short-lived temp token returned by login step 1' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;
```
- Impact: `jwtService.verify` rejects it quickly but still spends CPU; combined with the 100MB JSON limit in `main.ts`, attacker could send a multi-megabyte "token" for CPU-bound JWT parsing.
- Fix: `@Length(20, 4096)` or whatever the real JWT ceiling is.

### [LOW] `CreateRoleDto.permissionKeys` accepts arbitrary strings, not enum of `ALL_PERMISSION_KEYS`
- File: `web/back-nest/src/roles/dto/role.dto.ts:22`
- Category: validation
- Evidence:
```ts
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];
```
- Impact: Combined with the silent-drop bug in RolesService, typos aren't caught. Using `@IsIn(ALL_PERMISSION_KEYS, { each: true })` would fail-fast at the DTO layer.
- Fix: Import `ALL_PERMISSION_KEYS` and add `@IsIn(ALL_PERMISSION_KEYS, { each: true })`.

### [LOW] `AssignRoleDto.projectId` is `@IsOptional() @IsUUID()` but accepts `null` explicitly — class-validator treats `null` as present and runs `@IsUUID` → validation error
- File: `web/back-nest/src/roles/dto/role.dto.ts:59`
- Category: validation
- Evidence:
```ts
  @IsOptional()
  @IsUUID()
  projectId?: string | null;
```
- Impact: [UNCERTAIN] — `@IsOptional` skips validation for `null` and `undefined` only in recent class-validator; older versions treat `null` as "present". If frontend sends `projectId: null` to mean "global assignment", it might 400 instead of assigning globally.
- Fix: Add `@ValidateIf((o) => o.projectId != null)` explicitly.

### [LOW] `roles.controller.ts` uses a curly apostrophe in summary text — may break Swagger UI in some locales
- File: `web/back-nest/src/roles/roles.controller.ts:92`
- Category: UX
- Evidence:
```ts
  @ApiOperation({ summary: 'List a user’s role assignments' })
```
- Impact: Cosmetic; only an issue if the file encoding changes.
- Fix: Use ASCII apostrophe.

### [LOW] `audit.service.ts:28` truncates metadata to 1000 chars via `JSON.stringify().slice(0, 1000)` — produces invalid JSON on truncation
- File: `web/back-nest/src/audit/audit.service.ts:28`
- Category: data-integrity
- Evidence:
```ts
          metadata: metadata ? JSON.stringify(metadata).slice(0, 1000) : null,
```
- Impact: `toDto` later tries `JSON.parse(log.metadata)`; truncated JSON fails the parse but is swallowed by the try-catch returning `null`. Net effect: any metadata >1000 chars is silently lost from the audit viewer.
- Fix: Either store the truncation as an explicit marker, or enforce maxlen at the source before stringifying.

### [LOW] Audit LOGIN never persists source IP, user-agent, or TOTP usage flag
- File: `web/back-nest/src/auth/auth.service.ts:460`
- Category: error-handling
- Evidence:
```ts
    void this.audit.log('AppUser', user.id, 'LOGIN', user.id);
```
- Impact: Forensic reconstruction of account compromise is impossible without source IP.
- Fix: Pass IP + user-agent in the metadata param.

### [LOW] `TotpService.generateQrCode` exposes the otpauth URL directly — if served over an insecure channel, secret leaks
- File: `web/back-nest/src/auth/totp.service.ts:28`
- Category: security
- Evidence:
```ts
  async generateQrCode(otpauthUrl: string): Promise<string> {
    return qrcode.toDataURL(otpauthUrl);
  }
```
- Impact: Per CLAUDE.md "Known Issues: HTTPS disabled in dev" — setupTotp responses are plaintext-transmitted, meaning anyone on the network can capture the secret during enrolment. In prod, depends on deployment TLS.
- Fix: Document the TLS requirement for `/auth/2fa/setup`; add a startup warning if `app.use(helmet())` is missing.

### [LOW] `AuthModule` exports `TotpService` but no other module imports `AuthModule` — export is dead
- File: `web/back-nest/src/auth/auth.module.ts:26`
- Category: dead-code
- Evidence:
```ts
  exports: [JwtModule, TotpService],
})
export class AuthModule {}
```
- Impact: `JwtModule` export is used by other modules (collaboration, notifications via their own gateway JWT verification). `TotpService` is not re-used elsewhere.
- Fix: Remove the `TotpService` export, or document its intended consumers.

### [LOW] `JwtPayload` interface declares `firstName`/`lastName` but JwtStrategy copies them into the user object unused — stale PII in the JWT
- File: `web/back-nest/src/auth/jwt.strategy.ts:48`
- Category: security
- Evidence:
```ts
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      firstName: payload.firstName,
      lastName: payload.lastName,
      tokenVersion,
    };
```
- Impact: Storing PII (name + email) in the JWT means if the token leaks (logs, browser history), so does identity info. Also, when user renames themselves, the JWT still carries the stale value for the 8h lifetime.
- Fix: Remove `email`/`firstName`/`lastName` from the JWT; resolve them per-request from a cached AppUser lookup.

### [LOW] No `@MaxLength` on `LoginDto.password` — allows arbitrarily long bcrypt inputs; bcrypt silently truncates at 72 bytes
- File: `web/back-nest/src/auth/dto/login.dto.ts:11`
- Category: validation
- Evidence:
```ts
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password: string;
```
- Impact: If a user sets a 150-char password, bcrypt truncates to 72 bytes silently — users think they're secure but aren't. Also lets an attacker submit multi-megabyte passwords as a CPU-bound DoS.
- Fix: `@MaxLength(72)` on all password DTO fields; reject with a clear error.

### [LOW] `RolesService.clonePreset` does not bump token version even though it indirectly affects the role catalog — irrelevant for clone but inconsistent with other mutations
- File: `web/back-nest/src/roles/roles.service.ts:132`
- Category: logic
- Evidence:
```ts
    if (!preset.isPreset) {
      throw new BadRequestException('Source role is not a preset');
    }
    const clone = await this.prisma.role.create({
      data: {
        name: newName,
```
- Impact: Cosmetic — clone has zero assignments so no tokens need bumping. But the function also forgets to call `this.permissions.invalidate()`, so if invocation path is refactored to assign on clone, cache would be stale.
- Fix: Call `this.permissions.invalidate()` anyway for future-proofing.

### [LOW] `AuthController` does not expose a `/auth/logout` endpoint that bumps `tokenVersion` — only `/hook/logout` which is a no-op
- File: `web/back-nest/src/auth/auth.controller.ts:146`
- Category: auth
- Evidence:
```ts
  /** No-op logout endpoint — JWT is stateless; client already cleared the token. */
  @Get('hook/logout')
  @HttpCode(HttpStatus.OK)
  hookLogout() {
    return { ok: true };
  }
```
- Impact: User cannot actually invalidate their JWT server-side; if a laptop is stolen after logout, the token is still valid for the remaining lifetime.
- Fix: Add `POST /auth/logout` that bumps `tokenVersion` for the caller.

### [UNCERTAIN] `authenticateDbUser` reads `totpSecret` but never checks it matches format — a corrupted secret silently fails TOTP
- File: `web/back-nest/src/auth/auth.service.ts:389`
- Category: validation
- Evidence:
```ts
      totpEnabled: boolean;
      totpSecret: string | null;
    },
```
- Impact: [UNCERTAIN] — otplib's `verify` likely throws on malformed base32; depends on version behaviour. Would be confirmed by running the flow with `totpSecret = 'abc'`.
- Fix: Validate secret format during enable; log+reset on corrupt state.

### [UNCERTAIN] `NODE_ENV` comparison uses string literal `'production'` — if the deployment accidentally sets `NODE_ENV=Production` (capital P), the dev-bypass activates
- File: `web/back-nest/src/auth/auth.service.ts:151`
- Category: security
- Evidence:
```ts
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
```
- Impact: Case-sensitive string compare; typos = dev-bypass enabled in prod. [UNCERTAIN] — depends on deployment conventions.
- Fix: `.toLowerCase() === 'production'` or better, require a distinct `APP_ENV=prod` flag.

### [UNCERTAIN] `ChangePasswordDto` allows `newPassword === currentPassword`
- File: `web/back-nest/src/auth/dto/change-password.dto.ts:10`
- Category: validation
- Evidence:
```ts
  @ApiProperty({ description: 'Min 8 chars, at least one uppercase letter and one digit' })
  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, { message: 'newPassword must contain at least one uppercase letter' })
  @Matches(/[0-9]/, { message: 'newPassword must contain at least one digit' })
  newPassword: string;
```
- Impact: Service never compares the two; a user can "rotate" their password to the same value. Weak compliance but no direct security impact.
- Fix: In `AuthService.changePassword`, add `if (currentPassword === newPassword) throw new BadRequestException(...)`.
