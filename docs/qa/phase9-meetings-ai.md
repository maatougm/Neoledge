# Phase 9 — Meetings & AI QA Fix Summary

**Branch:** `nest-back`  
**Date:** 2026-04-20  
**Build:** green (no TypeScript errors)

---

## Already in place (verified, not touched)

| Item | Location | Status |
|---|---|---|
| Project-scope auth on meetings + extras (Sprint 2) | `MeetingsController`, `MeetingExtrasController` — `ProjectAccessGuard` + `@ProjectAccess('projectId')` | Confirmed present |
| Audio upload `fileFilter` restricting MIME types (Sprint 5+12) | `meetings.controller.ts` `FileInterceptor` | Confirmed present |
| Transcription shared-secret + SSRF mitigation (Sprint 7) | `meetings.service.ts` URL validation | Confirmed present |

---

## Fixes applied in this session

### Fix 1 — `convertToWorkPackage`: use server-side `projectId` (HIGH — CRITICAL)

**File:** `src/meetings/outcomes.service.ts`

- `convertToWorkPackage` now loads the outcome with `include: { meeting: { select: { projectId: true } } }` and uses `outcome.meeting.projectId` as the target project.
- The URL `projectId` parameter is renamed `_urlProjectId` and ignored.
- Added idempotency guard: returns an error if `outcome.workPackageId` is already set.
- Capped `description` at 10 000 chars.

### Fix 2 — `renameSpeaker`: permission gate + MaxLength + audit log (HIGH)

**Files:** `src/meetings/meetings.controller.ts`, `src/meetings/meetings.service.ts`

- Controller now imports and stacks `PermissionsGuard` alongside `JwtAuthGuard` / `ProjectAccessGuard`.
- `@RequirePermission('meeting.manage', { projectParam: 'projectId' })` added to `PATCH :id/rename-speaker`.
- `@MaxLength(100)` enforced inline — rejects `newName` > 100 chars with `BadRequestException`.
- `userId` passed to `renameSpeaker()` service method.
- Service writes an `AuditLog` row (`entityType: 'TranscriptSegment'`, `action: 'rename_speaker'`, `changes: { oldName, newName }`). Audit write failure is logged but does not fail the rename.

### Fix 3 — `aiError` persistence: strip API-key patterns before saving (HIGH)

**File:** `src/ai/ai.service.ts`

Added `sanitizeAiError()` helper that strips:
- `sk-...` (OpenAI keys)
- `AIza...` (Gemini keys)
- `key=<value>` query-string form
- `Bearer <token>` headers

Applied to every `aiError` persistence path in `AiService`.

### Fix 4 — AI status TTL: `aiStartedAt` + startup sweep + re-trigger guard (HIGH)

**Files:** `src/ai/ai.service.ts`, `prisma/schema.prisma`, `prisma/migration-meeting-ai-started.sql`, `src/meetings/meetings.service.ts`

- Added `aiStartedAt DateTime?` to `MeetingTranscript` in schema.
- Created `prisma/migration-meeting-ai-started.sql` with the `ALTER TABLE` statement.
- `AiService` now implements `OnModuleInit`; on startup it marks any `aiStatus='processing'` row with `aiStartedAt < now - 10min` as `aiStatus='failed'` with `aiError='Timed out (abandoned on restart)'`.
- `analyzeTranscript` uses `updateMany({ where: { id, aiStatus: { not: 'processing' } } })` — returns early (no-op) if count is 0, preventing double-spend when two requests race.
- `triggerAiAnalysis` in `MeetingsService` checks `t.aiStatus === 'processing'` and returns a 400 error before firing the async task.

### Fix 5 — AI parse failure: transaction protects prior results (HIGH)

**File:** `src/ai/ai.service.ts`

The `provider.analyze()` call (including `parseResult`) runs *before* the `$transaction` block that deletes prior action items / decisions. If parsing throws, the transaction never starts and prior results are preserved. This was already structurally correct; verified and kept.

### Fix 6 — Transcription response: validate shape before persisting (MEDIUM)

**File:** `src/meetings/meetings.service.ts`

Added `validateTranscriptionResponse(raw: unknown): TranscriptionResponse` that:
- Asserts the root is a plain object.
- Rejects `segments` that is not an array or exceeds 10 000 items.
- Clamps per-field lengths: `speaker` ≤ 200, `text` ≤ 10 000, `language` ≤ 10.
- Rejects non-finite numbers for `start_time`, `end_time`, `duration_seconds`.
- Returns a fully typed `TranscriptionResponse` — no more `any`.

If validation fails, the service logs the shape error and returns `Result.fail` without touching the database.

### Fix 7 — `title` validation: `@IsString` + `@MaxLength(200)` (MEDIUM)

**File:** `src/meetings/meetings.controller.ts`

- Inline validation added to `upload` handler: rejects missing / empty / > 200-char titles with `BadRequestException`.
- `title.trim()` passed to service.

### Fix 8 — Remove unused `speakerMap` parameter (MEDIUM)

**Files:** `src/meetings/meetings.controller.ts`, `src/meetings/meetings.service.ts`

- `@Body('speakerMap') speakerMap?: string` removed from the `upload` handler.
- `speakerMap?: string` removed from `MeetingsService.transcribe()` signature.

### Fix 9 — `reorderAgenda`: atomic transaction + cross-meeting id guard (MEDIUM)

**File:** `src/meetings/agenda.service.ts`

- Pre-flight `findMany({ where: { id: { in: order }, meetingId } })` to reject any item IDs that don't belong to this meeting.
- `Promise.all(map(update))` replaced with `prisma.$transaction([...update ops])` so all position changes commit atomically or not at all.
- Each `update` uses compound `where: { id, meetingId }` for belt-and-braces.

### Fix 10 — `bulkMarkPresent`: scoped `updateMany` (MEDIUM — already correct)

**File:** `src/meetings/attendees.service.ts`

Verified that `bulkMarkPresent` already uses `updateMany({ where: { meetingId, id: { in: ids } } })` — the correct scoped pattern. No code change required.

---

## Migration to apply

```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment \
  < web/back-nest/prisma/migration-meeting-ai-started.sql
cd web/back-nest && npx prisma generate
```

---

## Remaining open items (out of scope for this session)

| Finding | Severity | Notes |
|---|---|---|
| `meeting.manage` permission needs to be registered in `PermissionsService` seed | HIGH | Required for Fix 2 to gate correctly in production |
| Gemini API key should move from querystring to `x-goog-api-key` header | LOW | Reduces key leakage in proxy logs |
| Per-user rate limiting on audio upload | MEDIUM | Needs `@nestjs/throttler` applied to upload route |
| `AbortSignal.timeout` missing on transcription fetch | LOW | Add `signal: AbortSignal.timeout(120_000)` |
| `agenda.service.ts` / `attendees.service.ts` bare `catch {}` blocks | LOW | Should log error before returning `Result.fail` |
