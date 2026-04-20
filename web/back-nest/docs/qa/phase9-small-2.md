# QA Phase 9 — small-2 fixes

Build: green (`npm run build` passes after stale-dist cleanup).

## Verified already-in-place (Sprint 10)

- `ensureSafeFilters` in `saved-filters.service.ts` fully rejects `__proto__` / `constructor` / `prototype` keys, caps at 16 KB, and rejects depth > 6. No changes needed.
- Template DTOs (`CreateTemplateDto`, `CreateFromProjectDto`, `TemplateFieldDto`) were already present in `src/templates/dto/template.dto.ts`.

## Fixes applied

### 1 & 2 — `SavedFilterDto.name` constraints
File: `src/filters/dto/saved-filter.dto.ts`
- Changed `@MaxLength(120)` → `@MaxLength(100)` on both `CreateSavedFilterDto.name` and `UpdateSavedFilterDto.name`.
- Added `@Matches(/^[a-zA-Z0-9 \-_]+$/)` to both classes.

### 3 — `health.controller.ts` — production info leak
File: `src/health/health.controller.ts`
- When `NODE_ENV === 'production'`, returns only `{ status }`.
- Dev/staging still returns full payload (`version`, `uptime_seconds`, `node`, `checks`, `timestamp`).

### 4 — `search.service.ts` — scoped search + input caps
File: `src/search/search.service.ts`
- Added `callerId: string` parameter.
- Fetches caller's `UserRoleAssignment` rows first; filters `project`, `workPackage`, and `wikiPage` queries to `projectId IN accessibleProjectIds`.
- Capped `q` at 200 chars (`.substring(0, MAX_QUERY_LENGTH)`).
- Max `take` capped at 50 (`MAX_TAKE`).
- All queries ordered by `updatedAt DESC`.
- User `subtitle` no longer exposes email to the caller.

File: `src/search/search.controller.ts`
- Injects `@CurrentUser()` and passes `user.userId` to `SearchService.search`.

### 5 & 6 — `log.controller.ts` — limit validation + email stripping
File: `src/system-status/log.controller.ts`
- `limit = Math.min(parseInt(lines ?? '100', 10) || 100, 500)` — rejects negatives/NaN, caps at 500, default 100.
- `user.email` only included in log lines when `user.role === 'Admin'`; non-Admin callers see name only.

### 7 — `system-status.controller.ts` + `log.controller.ts` — migrate to `@RequirePermission`
- `SystemStatusController`: removed `@Roles('Admin')` + `RolesGuard`; replaced with `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermission('system.view')`.
- `LogController`: same migration with `@RequirePermission('system.logs')`.
- `SystemStatusModule`: added `PermissionsGuard` to `providers`.

### 8 — `deadlines.service.ts` — re-entrance guard + allSettled
File: `src/deadlines/deadlines.service.ts`
- Added `private running = false` instance flag.
- `checkDeadlines` returns early (with a warn log) if already running.
- `finally { this.running = false }` ensures flag is always released.
- Both `Promise.all` fan-outs replaced with `Promise.allSettled`.

### 9 — `templates.service.ts createFromProject` — strip private fields
File: `src/templates/templates.service.ts`
- Filters out fields where `label.startsWith('_')` or `fieldCategory === 'Private'` before deep-copy into template.

### 10 — `templates.service.ts applyToProject` — skip duplicates
File: `src/templates/templates.service.ts`
- Fetches existing field labels for the target project before applying.
- Case-insensitive label comparison (`.toLowerCase()`).
- Skips duplicate labels and collects them in a `skipped[]` array returned in the result value.

### 11 — `notifications.controller.ts` — `@Throttle` on write endpoints
File: `src/notifications/notifications.controller.ts`
- Installed `@nestjs/throttler` (added to `package.json` dependencies).
- `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` registered globally in `app.module.ts`.
- `APP_GUARD` with `ThrottlerGuard` registered as global provider.
- `markAsRead` (`PATCH :id/read`) and `delete` (`DELETE :id`) decorated with `@Throttle({ default: { ttl: 60_000, limit: 30 } })` (max 30/min per IP).

## Files changed

- `src/filters/dto/saved-filter.dto.ts`
- `src/health/health.controller.ts`
- `src/search/search.service.ts`
- `src/search/search.controller.ts`
- `src/system-status/log.controller.ts`
- `src/system-status/system-status.controller.ts`
- `src/system-status/system-status.module.ts`
- `src/deadlines/deadlines.service.ts`
- `src/templates/templates.service.ts`
- `src/notifications/notifications.controller.ts`
- `src/app.module.ts`
- `package.json` (added `@nestjs/throttler`)
