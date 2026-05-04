# Phase 9 — Auth Fix Pass

Targeted HIGH/MEDIUM fixes from `docs/qa/backend/auth.md` that were NOT already closed by
Sprints 1b, 1d, 5, or 11. Dev-login (TEST_USERS + NODE_ENV bypass + auto-upsert) was
preserved per explicit instruction — none of the 6 CRITICALs around it were touched.

Build: `cd web/back-nest && npm run build` — green.

---

## Files changed

- `web/back-nest/src/auth/auth.service.ts`
- `web/back-nest/src/auth/jwt.strategy.ts`
- `web/back-nest/src/auth/dto/login.dto.ts`
- `web/back-nest/src/auth/dto/totp-enable.dto.ts`
- `web/back-nest/src/users/users.service.ts`
- `web/back-nest/src/profile/profile.service.ts`

`RolesGuard` left unchanged — verified the shim is still functional
(see `web/back-nest/src/common/guards/roles.guard.ts`).

---

## Issues closed in this pass

### 1. 2FA branch — audit log + reset `failedLoginAttempts`  `[HIGH]`
`auth.service.ts` — `authenticateDbUser` — TOTP-enabled branch.

Before: issued the temp token without resetting the failed-attempt counter and
without auditing the partial success. A user with 4 prior wrong-password hits
could be locked out after just one wrong TOTP. There was also no audit trail
of the "password OK / TOTP pending" state.

After: counter + `lockedUntil` are reset the moment the password validates,
and `audit.log('AppUser', user.id, 'LOGIN', ..., { stage: 'password-ok-totp-pending' })`
is fired-and-forgotten so forensics can see the transition.

### 2. Temp token `aud: 'totp'` + `JwtStrategy` rejection  `[HIGH]`
`auth.service.ts` — temp-token signing.
`jwt.strategy.ts` — `validate()`.
`auth.service.ts` — `loginWithTotp()`.

- The step-1 temp token now carries `aud: 'totp'` in addition to `totpPending: true`.
- `JwtStrategy.validate` rejects any token whose `aud` is set to anything other
  than `'access'`, and explicitly rejects tokens carrying `totpPending`. Both
  checks run before the `tokenVersion` lookup.
- `loginWithTotp` verifies that the presented temp token has `aud === 'totp'`
  AND `totpPending === true` before proceeding — defence-in-depth mirror of
  the strategy check.

Net effect: a temp token cannot be used against any protected endpoint, and an
access token cannot be swapped for a session via the TOTP exchange.

### 3. Access tokens gain `aud: 'access'`  `[HIGH]`
`auth.service.ts` — `generateTokenForUser`.

All full JWTs issued for logged-in sessions now carry `aud: 'access'`. Combined
with the strategy check above, audiences are properly compartmentalised.

### 4. Dummy bcrypt on unknown-email path  `[HIGH]`
`auth.service.ts` — `login()`.

Added a `DUMMY_BCRYPT_HASH` (`$2a$12$...`) and call `bcrypt.compare(password, DUMMY_BCRYPT_HASH)`
immediately before the "Invalid email or password" throw. Kills the
user-enumeration timing side-channel — an unknown email now takes ~the same
wall-clock time as a wrong-password-for-real-user attempt. Dev-login path
short-circuits before the dummy comparison, so it doesn't slow down local login.

### 5. Bcrypt rounds 10 → 12 everywhere  `[MEDIUM]`
Grepped all `bcrypt.hash` and `bcrypt.genSalt` call sites.

| File | Before | After |
|------|--------|-------|
| `auth.service.ts` — dev test user upsert (line 172) | 10 | `BCRYPT_ROUNDS` (= 12) |
| `auth.service.ts` — `changePassword` (`genSalt`) | 10 | `BCRYPT_ROUNDS` (= 12) |
| `users.service.ts` — `BCRYPT_ROUNDS` constant | 10 | 12 |
| `profile.service.ts` — `changePassword` | 10 | 12 |

All four sites now use cost 12.

### 6. `loginWithTotp` honours the lockout window  `[HIGH]`
`auth.service.ts` — `loginWithTotp`.

Added the same `if (user.lockedUntil && user.lockedUntil > new Date())` guard
that `authenticateDbUser` already has. Without it an attacker who captured a
temp token could brute-force the 6-digit code at will — now the same 5-strike,
15-minute lockout applies.

### 7. `LoginDto.password` bounds  `[HIGH]`
`dto/login.dto.ts`.

- `@MinLength(1)` → `@MinLength(6)` (matches the weakest dev test password
  `Pm@123`, which is still 6 chars — no regression to dev flow).
- Added `@MaxLength(128)` to prevent multi-megabyte-password CPU DoS.

### 8. `TotpLoginDto.tempToken` bound  `[LOW]`
`dto/totp-enable.dto.ts`.

Added `@MaxLength(4096)` — JWTs of that length are far beyond any legitimate
use, but the limit prevents a multi-MB "token" from soaking up CPU in
`jwtService.verify`.

### 9. Strip role-revealing login error messages in production  `[HIGH]`
`auth.service.ts` — added `authFailureMessage(verbose)` helper and wrapped every
`UnauthorizedException` in the `login()` / `authenticateDbUser()` / `loginWithTotp()`
paths.

Behaviour:

- `NODE_ENV === 'production'` → message is always `'Authentication failed'`.
- Anything else → original verbose message preserved (account-locked,
  account-deactivated, "2FA non activée", "Code TOTP invalide", etc.), so local
  dev debugging stays productive.

Touched strings:

- `'Invalid email or password'` (unknown email / wrong password)
- `'Account is deactivated'`
- `'Account is locked. Please try again later.'`
- `'Token expiré ou invalide.'`
- `'Token non valide pour la 2FA.'`
- `'Utilisateur introuvable ou inactif.'`
- `'La 2FA n\'est pas activée pour ce compte.'`
- `'Code TOTP invalide.'`

Internal-only errors on authenticated endpoints (e.g. `enableTotp` /
`disableTotp` / `setupTotp`) are **intentionally** left verbose — they only
fire for the already-authenticated user and carry no enumeration risk.

### 10. `RolesGuard` shim — verified  `[HIGH]`
`common/guards/roles.guard.ts`.

Re-read the guard. It correctly:

1. Short-circuits on JWT `role` match (Sprint 1 back-compat path).
2. Expands required role names into `PRESET_ROLE_PERMISSIONS[role]` keys and
   delegates to `permissions.userHasPermission(...)` — matching the new system
   that keys off DB-backed permissions and the `tokenVersion` bump on role
   changes (Sprint 11).
3. Returns `false` (→ 403) when the user has neither the legacy role nor any
   of the wanted permissions.

No changes required.

---

## Not addressed in this pass (out of scope per user instruction)

The following items from `auth.md` are either already closed by prior sprints or
were flagged in the instructions as DO NOT TOUCH:

- JWT_SECRET defaults — Sprint 1b.
- Force-change-password bcrypt skip — Sprint 1d.
- `tokenVersion` bumps on password change — Sprint 5 (already present in the
  current `auth.service.ts` `changePassword` / `profile.service.ts`).
- Preset-role permission editing, `permissionKeys` whitelist, `assignRole.projectId`
  check, `bumpAssignedUsersTokenVersion` race — Sprint 11.
- The 6 CRITICALs on dev-login / TEST_USERS / JWT_SECRET fallback — preserved
  per explicit user instruction.

Outstanding issues from `auth.md` that remain open but were not in this fix list:

- LOW: PII in JWT (`email`/`firstName`/`lastName`) leaks via token.
- LOW / MEDIUM: `TotpService.verify` has no replay prevention (same 6-digit code
  accepted twice within the 30-s window).
- MEDIUM: `PermissionsService` cache is in-memory only (single-instance).
- MEDIUM: `hookLogout` public no-op endpoint; no real `/auth/logout` that bumps
  `tokenVersion`.
- MEDIUM: `enableTotp` / `setupTotp` / `disableTotp` increment
  `failedLoginAttempts` on bad code — can self-lockout the authenticated user
  (separate `failedTotpAttempts` column would fix).
- LOW: `ChangePasswordDto` does not reject `newPassword === currentPassword`.

These can be picked up in a follow-up phase if desired.
