# Sprint 11 — Role-management hardening (finishes Phase 1)

Date: 2026-04-20
Branch: `nest-back`
Build: `npx tsc --noEmit` (back-nest) — **PASS**

## Scope

Four items from `findings.md:280-281`:

1. Forbid editing preset-role permissions.
2. Validate `CreateRoleDto.permissionKeys` against `ALL_PERMISSION_KEYS`.
3. Validate `assignRole.projectId` exists in DB.
4. Close the `bumpAssignedUsersTokenVersion` race.

## Audit — items 1–3 already in place

Verified in `src/roles/roles.service.ts` and `src/roles/dto/role.dto.ts`:

- **Preset edit block** — `updateRole()` throws `BadRequestException` when `role.isPreset && input.permissionKeys`. Rename also blocked.
- **Permission key whitelist** — DTO uses `@IsIn(ALL_PERMISSION_KEYS, { each: true })`; service additionally runs `assertKnownPermissionKeys()` defensively in `createRole` / `updateRole`.
- **`assignRole.projectId` DB check** — `assignRole()` looks up the project and rejects missing or soft-deleted projects with `NotFoundException`.

No changes needed for items 1–3.

## Fix — item 4: tokenVersion race

### The race

Previously, each of `updateRole`, `assignRole`, and `unassign` mutated role/assignment state in one statement (or a partial `$transaction`), then bumped `AppUser.tokenVersion` in a **separate** statement afterwards. Two failure modes:

1. State mutation commits, tokenVersion bump fails / is delayed → stale JWTs keep acting with the old permission set against the new state.
2. TokenVersion bump commits first (not the case here, but symmetric) → valid JWTs rejected before the permission change lands.

### The fix

All three methods now wrap the state mutation **and** the `tokenVersion` bump in a single `prisma.$transaction([...])`. Affected user IDs are collected before the tx so the tx body is deterministic and short.

- `updateRole()` — single tx now contains: `rolePermission.deleteMany` + `rolePermission.createMany` (when permissions change) + `role.update` + `appUser.updateMany { tokenVersion: { increment: 1 } }`.
- `assignRole()` — single tx contains: `userRoleAssignment.create` + `appUser.update { tokenVersion: { increment: 1 } }`.
- `unassign()` — single tx contains: `userRoleAssignment.delete` + `appUser.update { tokenVersion: { increment: 1 } }`.

`PermissionsService.invalidate()` calls remain outside the tx — they are process-local caches, not persistent state, and firing them on commit is sufficient.

### Dead code removed

`bumpAssignedUsersTokenVersion()` and `bumpUserTokenVersion()` private helpers are deleted — their bodies are now inlined into the transactions.

### Bonus — `clonePreset` duplicate-name check

Added an explicit `findUnique({ name })` check before `role.create` so a name clash returns a clean `400 BadRequestException` instead of a Prisma P2002.

## Files changed

- `web/back-nest/src/roles/roles.service.ts` — `updateRole`, `assignRole`, `unassign`, `clonePreset` rewritten; two private helpers removed.

## Remaining follow-ups (out of scope)

Listed in `phase9-auth.md:162-175`:

- LOW: PII in JWT payload (email/firstName/lastName).
- LOW/MEDIUM: TOTP replay within the 30-s window.
- MEDIUM: `PermissionsService` cache is in-memory only (single-instance).
- MEDIUM: no real `/auth/logout` that bumps `tokenVersion` (only a public no-op `hookLogout`).
- MEDIUM: `enableTotp` / `disableTotp` / `setupTotp` count bad codes against `failedLoginAttempts` and can self-lockout the authenticated user.
- LOW: `ChangePasswordDto` does not reject `newPassword === currentPassword`.

These close Phase 1 and can be picked up in a follow-up sprint.
