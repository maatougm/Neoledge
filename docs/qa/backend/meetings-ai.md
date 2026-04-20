# QA Review — Meetings & AI Modules

Files opened:
- `web/back-nest/src/meetings/meetings.controller.ts`
- `web/back-nest/src/meetings/meetings.service.ts`
- `web/back-nest/src/meetings/agenda.service.ts`
- `web/back-nest/src/meetings/attendees.service.ts`
- `web/back-nest/src/meetings/outcomes.service.ts`
- `web/back-nest/src/meetings/meeting-extras.controller.ts`
- `web/back-nest/src/meetings/meetings.module.ts`
- `web/back-nest/src/ai/ai.types.ts`
- `web/back-nest/src/ai/ai-provider.factory.ts`
- `web/back-nest/src/ai/ai.service.ts`
- `web/back-nest/src/ai/ai.module.ts`
- `web/back-nest/src/ai/providers/openai.provider.ts`
- `web/back-nest/src/ai/providers/gemini.provider.ts`
- `web/back-nest/src/common/guards/jwt-auth.guard.ts` (context)

Also verified (context, not modified): `src/common/decorators/current-user.decorator.ts`, `src/common/guards/roles.guard.ts` (exists), `src/common/guards/permissions.guard.ts` (exists). Neither of these authorization guards is applied to any meetings/AI controller route.

---

## Summary of findings

- CRITICAL: 3
- HIGH: 7
- MEDIUM: 6
- LOW: 4
- INFO: 2

Recurring theme: the entire Meetings and AI surface only checks that a JWT exists (`JwtAuthGuard`). There is zero authorization enforcement that the authenticated user belongs to the target `projectId`/`meetingId`/`transcriptId`. Any logged-in user (any role, including `Viewer`) can read, rename, delete, and convert data for any project in the database by iterating UUIDs.

---

### [CRITICAL] No project-membership authorization on any meetings endpoint
- File: `web/back-nest/src/meetings/meetings.controller.ts:21-83`
- Category: Broken Access Control (OWASP A01)
- Evidence:
```ts
@Controller('pm/projects/:projectId/meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() audio: Express.Multer.File,
    ...
```
- Impact: Only `JwtAuthGuard` is applied. There is no `RolesGuard`, no project-membership check, and the service never verifies that `req.user.userId` is a PM/admin/member of `projectId`. A user in role `Viewer` with no project assignment can:
  - `POST /pm/projects/<any-uuid>/meetings/upload` — burn transcription service budget + quota under someone else's project,
  - `GET /pm/projects/<any-uuid>/meetings` — read private meeting lists of any project,
  - `GET /pm/projects/<any-uuid>/meetings/:id` — read any transcript (plus AI summary/decisions, which typically contain sensitive client content),
  - `DELETE /pm/projects/<any-uuid>/meetings/:id` — delete any transcript,
  - `PATCH :id/rename-speaker` — mutate any transcript's speaker labels,
  - `POST :id/ai-analyze` — trigger (and pay for) AI runs on arbitrary transcripts.

  Compare with the CLAUDE.md convention for admin routes that explicitly stacks `JwtAuthGuard + RolesGuard`; this controller missed the equivalent PM/member check.
- Fix:
  1. Resolve the authenticated user (`@CurrentUser`) on every route.
  2. Add a `ProjectMemberGuard` (or an in-service check) that loads the `Project` and rejects with `ForbiddenException` unless `user.role === 'Admin'` or the project is owned/assigned-to the user (same check PM routes use elsewhere).
  3. For routes keyed by `:id` (transcript id) or `:outcomeId`, first load the row, then verify `row.projectId` matches the `:projectId` path param AND the user is a member of that project.
  4. Apply the same treatment to `MeetingExtrasController`.

---

### [CRITICAL] No project-scope check on meeting-extras (agenda/attendees/outcomes)
- File: `web/back-nest/src/meetings/meeting-extras.controller.ts:10-17`
- Category: Broken Access Control / IDOR
- Evidence:
```ts
@Controller('pm/projects/:projectId/meetings/:meetingId')
@UseGuards(JwtAuthGuard)
export class MeetingExtrasController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly attendees: AttendeesService,
    private readonly outcomes: OutcomesService,
  ) {}
```
- Impact: Same class of IDOR — any authenticated user can CRUD agenda items, attendees, and outcomes for any meeting in any project. Notably:
  - `updateAgenda(@Param('itemId') itemId, dto)` and `deleteAgenda` take only `itemId` with no check that it belongs to `:meetingId` or `:projectId`.
  - `updateAttendee(@Param('attendeeId') id)` / `removeAttendee` / `updateOutcome(@Param('outcomeId') id)` / `removeOutcome` have the same flaw.
- Fix: Before any mutation, `findUnique` the entity and assert `entity.meetingId === :meetingId` and `meeting.projectId === :projectId`, plus project-membership.

---

### [CRITICAL] Outcome → WorkPackage conversion trusts client-supplied `projectId`
- File: `web/back-nest/src/meetings/meeting-extras.controller.ts:144-153` and `web/back-nest/src/meetings/outcomes.service.ts:67-95`
- Category: Broken Access Control / Privilege escalation via path injection
- Evidence (controller):
```ts
@Post('outcomes/:outcomeId/convert-to-wp')
async convertToWp(
  @Param('projectId') projectId: string,
  @Param('outcomeId') outcomeId: string,
  @CurrentUser() user: AuthUser,
) {
  const r = await this.outcomes.convertToWorkPackage(outcomeId, projectId, user.userId);
```
Evidence (service):
```ts
async convertToWorkPackage(outcomeId: string, projectId: string, authorId: string) {
  try {
    const outcome = await this.prisma.meetingOutcome.findUnique({ where: { id: outcomeId } });
    if (!outcome) return Result.fail('Issue introuvable.');

    const wp = await this.prisma.workPackage.create({
      data: {
        projectId,                   // ← taken from URL, not from outcome.meeting.projectId
        title: outcome.description.slice(0, 255),
        ...
```
- Impact: An attacker can `POST /pm/projects/<victim-project-id>/meetings/<any-meeting>/outcomes/<any-outcome-from-another-project>/convert-to-wp` and the service will happily create a WorkPackage in `<victim-project-id>` from an outcome belonging to a totally different project/meeting. This:
  1. Plants arbitrary (attacker-controlled) WP content in projects they have no access to,
  2. Auto-assigns it to `outcome.ownerId`, who may not even be a member of `<victim-project-id>`,
  3. Leaks existence of foreign outcomes via the echoed description,
  4. Corrupts the `meetingOutcome.workPackageId` FK to point across project boundaries.
- Fix: Derive `projectId` from `outcome.meeting.projectId` after loading the outcome, ignore the URL path param (or validate equality). Also block `outcome.ownerId` if that user is not a member of the derived project, and validate that `user` can write to that project.

---

### [HIGH] `renameSpeaker` — any authenticated user can rewrite any transcript
- File: `web/back-nest/src/meetings/meetings.service.ts:131-141` and `meetings.controller.ts:60-68`
- Category: Broken Access Control / Data Integrity
- Evidence:
```ts
async renameSpeaker(id: string, oldName: string, newName: string) {
  const t = await this.prisma.meetingTranscript.findUnique({ where: { id } })
  if (!t) return Result.fail('Transcription non trouvée.')

  await this.prisma.transcriptSegment.updateMany({
    where: { transcriptId: id, speaker: oldName },
    data: { speaker: newName },
  })

  return Result.ok()
}
```
- Impact: The question "can one user rename another user's segments?" — yes. There is no check that the caller authored the transcript, manages the project, or is the speaker being renamed. Additionally there is no length cap on `newName`, no unicode/control-character filter, no audit log, and no debounce/rate limit — an attacker can mass-rewrite speakers across every transcript in the database.
- Fix: Add project-membership gate (as per CRITICAL #1), cap `newName` length (e.g., 120 chars), strip control characters, and emit an `AuditLog` row (`entityType: 'TranscriptSegment', action: 'rename_speaker'`).

---

### [HIGH] AI polling endpoint has no authorization — cross-tenant data leak
- File: `web/back-nest/src/meetings/meetings.controller.ts:77-82` + `meetings.service.ts:155-185`
- Category: IDOR / Sensitive Data Exposure
- Evidence:
```ts
@Get(':id/ai-results')
async getAiResults(@Param('id') id: string) {
  const result = await this.service.getAiResults(id)
  if (result.isFailure) throw new NotFoundException(result.error)
  return result.value
}
```
- Impact: `getAiResults` only checks existence, not ownership. Any JWT holder that guesses or enumerates a transcript id retrieves `aiSummary` (potentially very sensitive), `actionItems`, `decisions`, and `aiError`. `aiError` is particularly dangerous because it is populated from raw provider error text (see HIGH #7) and may embed request metadata.
- Fix: Require the caller to be a member of the transcript's parent project (verify `transcript.project.ownerId === user.userId` OR user is assigned as PM/team OR `Admin`).

---

### [HIGH] Audio upload: no MIME sniffing / extension allow-list, original filename stored raw
- File: `web/back-nest/src/meetings/meetings.controller.ts:26-38` + `meetings.service.ts:17-43`
- Category: File-Upload Validation / Stored data-quality
- Evidence:
```ts
@Post('upload')
@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
async upload(
  @Param('projectId') projectId: string,
  @UploadedFile() audio: Express.Multer.File,
  @Body('title') title: string,
  @Body('speakerMap') speakerMap?: string,
) {
  if (!audio || !audio.buffer.length) throw new BadRequestException('Fichier audio requis.')
  const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title, speakerMap)
```
and
```ts
const transcript = await this.prisma.meetingTranscript.create({
  data: {
    projectId,
    title,
    originalFileName: fileName,                         // ← raw user input
    durationSeconds: Math.round(data.duration_seconds ?? 0),
    detectedLanguages: (data.detected_languages ?? []).join(','),
    recordedAt: new Date(),
  },
})
```
- Impact:
  1. No `fileFilter` in `FileInterceptor` — Multer accepts `.exe`, `.html`, `.svg`, etc. The backend sends whatever bytes arrive to the Python service, which can crash or waste GPU cycles.
  2. `audio.originalname` is persisted verbatim as `originalFileName`. An attacker can supply `../../etc/passwd`, `<script>alert(1)</script>`, a 4 KB unicode blob, or null bytes. There is no path-traversal stripping, length cap, or sanitization. Although the file is not written to disk by name today, a future download/export feature that reuses `originalFileName` as a Content-Disposition or filesystem path would inherit a critical bug.
  3. `title` and `speakerMap` have no length validation; `title` is written as `@Body('title')` with no `class-validator` guard, bypassing the guidance in CLAUDE.md about DTO classes.
  4. `speakerMap` is accepted as a parameter but is never actually used by `transcribe` (dead parameter).
- Fix:
  - Add a `fileFilter` restricting to `audio/*` MIME + extension allow-list (`.mp3, .wav, .m4a, .webm, .ogg, .flac`).
  - Sniff magic bytes (e.g. `file-type` npm) rather than trusting the client's `mimetype`.
  - Normalize and truncate `fileName` via `path.basename()` and a 255-char cap; reject non-printable / path-traversal characters.
  - Promote the body to a real DTO class with `@IsString()`, `@MaxLength(…)`.

---

### [HIGH] Transcription service URL — SSRF via env var, no allow-list
- File: `web/back-nest/src/meetings/meetings.service.ts:17-24`
- Category: SSRF / Configuration Hardening
- Evidence:
```ts
const serviceUrl = this.config.get<string>('TRANSCRIPTION_URL', 'http://localhost:8000')

try {
  const formData = new FormData()
  formData.append('audio', new Blob([audioBuffer as unknown as BlobPart]), fileName)

  const response = await fetch(`${serviceUrl}/transcribe`, { method: 'POST', body: formData })
```
- Impact:
  1. The URL is taken straight from `TRANSCRIPTION_URL` without scheme/host allow-listing. If the env is ever populated from a less-trusted source (helm values, secret sync, Docker compose interpolation of `$SOMETHING`), the backend will POST multipart bodies anywhere (e.g., `http://169.254.169.254/…`, internal RDS, an attacker's webhook that logs the audio). This is a textbook SSRF primitive.
  2. No timeout on the fetch (contrast with AI providers which use `AbortSignal.timeout(60_000)`). A slow or hung transcription endpoint will pin a request thread until the process is recycled.
  3. No response size limit — a malicious/misbehaving endpoint could return a 1 GB JSON, exhausting memory.
  4. `response.json()` is cast to `any` and fields are taken without runtime validation — see MEDIUM #1.
- Fix:
  - Validate `TRANSCRIPTION_URL` at startup against a regex / URL parse, reject non-`http(s)` schemes, optionally require `localhost`/known hostnames, and fail fast if misconfigured.
  - Add `signal: AbortSignal.timeout(120_000)` on the fetch.
  - Read `response.body` with a size cap (e.g. stream into a buffer up to 50 MB).

---

### [HIGH] `aiError` persists raw provider text — potential API-key or PII leak
- File: `web/back-nest/src/ai/ai.service.ts:87-98` + `openai.provider.ts:43-47` + `gemini.provider.ts:25,45-49`
- Category: Information Disclosure
- Evidence:
```ts
// openai.provider.ts
throw new Error(`OpenAI API error ${response.status}: ${text}`)
```
```ts
// gemini.provider.ts — URL with key in querystring
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
...
throw new Error(`Gemini API error ${response.status}: ${text}`)
```
```ts
// ai.service.ts
await this.prisma.meetingTranscript.update({
  where: { id: transcriptId },
  data: {
    aiStatus: 'failed',
    aiError: message.substring(0, 500),
  },
})
```
- Impact: The error string is stored in `aiError` and returned over `GET :id/ai-results` (which itself has no authz — HIGH #3). If the provider echoes the request URL (Gemini sometimes does in 400-class errors and in fetch-level errors like `TypeError: fetch failed -> https://…?key=SECRET`), or if Node's native fetch logs the URL in the error message, the API key can leak to any JWT holder. Even without the key, provider errors routinely contain request IDs, rate-limit tokens, org IDs, and request fragments useful to an attacker.
- Fix:
  - Gemini: send the key in an `x-goog-api-key` header instead of querystring; the documented header form avoids this class of leak.
  - Sanitize `aiError` before persisting: strip any substring matching `sk-[A-Za-z0-9-_]{20,}`, `AIza[0-9A-Za-z-_]{35}`, `key=…`, and Bearer headers. Better, store only a stable short code (`provider_rate_limited`, `provider_invalid_request`, `invalid_json`) and log the detail server-side only.

---

### [HIGH] AI status can get stuck in `processing` forever (no TTL / worker crash recovery)
- File: `web/back-nest/src/ai/ai.service.ts:14-99` + `meetings.service.ts:143-153`
- Category: State-Machine / Reliability
- Evidence:
```ts
async analyzeTranscript(transcriptId: string): Promise<void> {
  // 1. Mark as processing
  await this.prisma.meetingTranscript.update({
    where: { id: transcriptId },
    data: { aiStatus: 'processing', aiError: null },
  })

  try {
    ...
  } catch (err: unknown) {
    ...
    await this.prisma.meetingTranscript.update({
      where: { id: transcriptId },
      data: {
        aiStatus: 'failed',
        aiError: message.substring(0, 500),
      },
    })
  }
}
```
and the fire-and-forget caller:
```ts
void this.aiService.analyzeTranscript(transcriptId).catch((e: unknown) =>
  this.logger.error(`Unhandled AI error for transcript ${transcriptId}: ${e instanceof Error ? e.message : String(e)}`)
)
```
- Impact:
  1. If the Node process crashes, is SIGKILLed, or restarts (PM2/k8s rollout) between the `processing` mark and the try/catch completion, the row is stuck in `processing` forever. `GET :id/ai-results` will report processing indefinitely and the UI will spin.
  2. `analyzeTranscript` is fire-and-forget with no concurrency guard — two near-simultaneous `POST :id/ai-analyze` requests will both flip to `processing`, both hit the provider (double-spend), and race on the `$transaction` `deleteMany`/`createMany` — the loser's data can end up partially persisted.
  3. There is no retry, no queue, no idempotency key.
  4. There is also no minimum interval between re-analyses — an attacker can spam the endpoint and burn provider quota (see HIGH #1 for the authz side).
- Fix:
  - Add a `aiStartedAt` column and a startup sweep that flips any `processing` row older than e.g. 5 minutes to `failed` with `aiError='abandoned_on_restart'`.
  - Before setting `processing`, assert the current status is not already `processing` (optimistic update: `updateMany({ where: { id, aiStatus: { not: 'processing' } }, data: { aiStatus: 'processing' } })` and bail if `count === 0`).
  - Long-term, move AI analysis to a durable queue (BullMQ) with retries and exponential backoff.

---

### [HIGH] AI parse failure can silently destroy previous results
- File: `web/back-nest/src/ai/ai.service.ts:42-84`
- Category: Data Integrity
- Evidence:
```ts
await this.prisma.$transaction(async (tx) => {
  // Clear previous results
  await tx.meetingActionItem.deleteMany({ where: { transcriptId } })
  await tx.meetingDecision.deleteMany({ where: { transcriptId } })

  // Update transcript
  await tx.meetingTranscript.update({ ... })
  ...
})
```
- Impact: The delete-before-insert is inside the transaction, so a failure inside the `createMany` does roll back — good. HOWEVER, the more insidious failure mode is *partial* AI output. If the model returns `{ "summary": "...", "actionItems": [], "decisions": [] }` (e.g., rate-limited truncation falling through the `Array.isArray` defaults in `parseResult`), the transaction commits and overwrites previous `actionItems`/`decisions` with empty sets with no warning to the user. The UI can't tell the difference between "model found nothing this time" and "model was truncated and returned nothing".
- Fix:
  - Treat an entirely empty `actionItems + decisions` response as suspicious — either keep prior results, or at least surface `aiStatus: 'completed_empty'`.
  - Validate with Zod before persisting; reject and set `failed` instead of silently overwriting.

---

### [MEDIUM] Transcription response never validated — parse corruption possible
- File: `web/back-nest/src/meetings/meetings.service.ts:32-57`
- Category: Input Validation (trust boundary)
- Evidence:
```ts
const data: any = await response.json()

const transcript = await this.prisma.meetingTranscript.create({
  data: {
    projectId,
    title,
    originalFileName: fileName,
    durationSeconds: Math.round(data.duration_seconds ?? 0),
    detectedLanguages: (data.detected_languages ?? []).join(','),
    recordedAt: new Date(),
  },
})

const segments = (data.segments ?? []).map((s: any) => ({
  transcriptId: transcript.id,
  speaker: s.speaker ?? 'Unknown',
  text: s.text ?? '',
  startTime: s.start_time ?? 0,
  endTime: s.end_time ?? 0,
  language: s.language ?? '',
  confidence: s.confidence ?? 0,
}))
```
- Impact: `data: any` plus no Zod/class-validator gate means a malicious or buggy transcription service can:
  - Return `segments: "ALL"` — the `.map` would throw at runtime, caller reports 500.
  - Return `segments: [{text: <10 MB string>}]` — unbounded DB growth.
  - Return `detected_languages: [{toString: () => <evil>}]` — coerced via `.join(',')`.
  - Return `duration_seconds: NaN` — `Math.round(NaN) = NaN`, persisted as `null`/`0` depending on column type, silently dropping metadata.
  - Return `segments: [{start_time: -Infinity}]` — persisted unchecked.

  Also violates CLAUDE.md's typescript guidance against `any` in application code.
- Fix: Define a Zod schema for the transcription response, `parse()` it, enforce per-field limits (`text.max(10_000)`, `segments.max(10_000)`), reject and error-out on mismatch.

---

### [MEDIUM] `title` in `meetingTranscript.create` can be null / too long / unvalidated
- File: `web/back-nest/src/meetings/meetings.controller.ts:31,35` + `meetings.service.ts:34-43`
- Category: Input Validation
- Evidence:
```ts
@Body('title') title: string,
...
const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title, speakerMap)
```
- Impact: No `@IsString`, `@IsNotEmpty`, or `@MaxLength` decorator (DTO is an inline literal — CLAUDE.md calls this out as a footgun). If the client omits `title`, `undefined` flows to Prisma and fails with a DB-level error leaking schema details. If a 10 MB `title` is submitted, it's passed through until MySQL rejects it.
- Fix: Convert to a proper `CreateMeetingDto` class with validators; apply `ValidationPipe({whitelist: true})` (already global per CLAUDE.md).

---

### [MEDIUM] `FileInterceptor` has no `fileFilter` or disk-storage config — implicit in-memory buffer
- File: `web/back-nest/src/meetings/meetings.controller.ts:27`
- Category: DoS / Resource Hygiene
- Evidence:
```ts
@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
```
- Impact: Default storage is in-memory. Ten concurrent 100 MB uploads = 1 GB of heap. The NestJS process has no back-pressure and no rate-limiting per user. Combined with the no-authz issue (CRITICAL #1), any logged-in user can OOM the service.
- Fix: Add IP/user-level rate limiting (`@nestjs/throttler` — seen elsewhere in the project), consider streaming the body directly to the transcription service, and add a `fileFilter`.

---

### [MEDIUM] `speakerMap` parameter is accepted but never used — silent API mismatch
- File: `web/back-nest/src/meetings/meetings.controller.ts:32,35` + `meetings.service.ts:17`
- Category: API Contract / Dead Code
- Evidence:
```ts
// controller
@Body('speakerMap') speakerMap?: string,
...
const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title, speakerMap)

// service signature — speakerMap declared, never referenced after
async transcribe(projectId: string, audioBuffer: Buffer, fileName: string, title: string, speakerMap?: string) {
```
- Impact: Frontend may be shipping a speaker map that is silently dropped. False positive from the user's perspective. Also a maintenance smell: the parameter will trigger lint warnings and confuses future readers.
- Fix: Either implement (pass to transcription service or write into initial `TranscriptSegment.speaker` overrides) or remove the parameter.

---

### [MEDIUM] `reorderAgenda` does N updates instead of one batch — not atomic
- File: `web/back-nest/src/meetings/agenda.service.ts:59-68`
- Category: Data Consistency
- Evidence:
```ts
async reorder(meetingId: string, order: string[]) {
  try {
    await Promise.all(order.map((id, idx) =>
      this.prisma.meetingAgendaItem.update({ where: { id }, data: { position: idx } })
    ));
    return Result.ok<void>();
  } catch {
    return Result.fail<void>('Échec.');
  }
}
```
- Impact:
  1. Not wrapped in a transaction — if the 3rd update fails, the first two are persisted, leaving positions inconsistent (two items at position 0 or 1, one skipped).
  2. No verification that the supplied `id`s belong to `meetingId` — a caller with any agenda item ID (from any meeting) can slot them into positions `0..N` of the target meeting, effectively moving them across meetings silently.
- Fix: `this.prisma.$transaction(order.map((id, idx) => this.prisma.meetingAgendaItem.update({ where: { id, meetingId }, data: { position: idx } })))`. Using the compound where-clause (`id` + `meetingId`) via a middleware or a prior `findMany({ where: { id: {in: order}, meetingId }})` guard.

---

### [MEDIUM] `bulkMarkPresent` does not validate `ids` belong to `meetingId`
- File: `web/back-nest/src/meetings/attendees.service.ts:58-68`
- Category: Input Validation (good) but controller lets callers pass any ids
- Evidence:
```ts
async bulkMarkPresent(meetingId: string, ids: string[], isPresent: boolean) {
  try {
    await this.prisma.meetingAttendee.updateMany({
      where: { meetingId, id: { in: ids } },
      data: { isPresent },
    });
    return Result.ok<void>();
  } catch {
    return Result.fail<void>('Échec.');
  }
}
```
- Impact: The compound `where` (`meetingId` + `id in ids`) does scope correctly — this is the right pattern. The residual risks are: (a) no length cap on `ids` (1 M-element payload possible), (b) no JSON validation that `ids` is an array of strings. Combine with CRITICAL #2 (no project-membership check) and this becomes exploitable.
- Fix: Add `@Body` DTO with `@ArrayMaxSize(200)` and `@IsUUID('all', { each: true })`. Also add project-scope guard.

---

### [LOW] Controller catches all errors with `catch {}` — swallows root causes
- File: `web/back-nest/src/meetings/agenda.service.ts:17-19, 36-38, 45-47, 54-56, 65-67`; `attendees.service.ts:17-19, 35-37, 44-46, 53-55, 65-67`; `outcomes.service.ts:22-24, 39-41, 53-55, 62-64, 92-94`
- Category: Observability / Error Handling
- Evidence:
```ts
async list(meetingId: string) {
  try {
    const items = await this.prisma.meetingAgendaItem.findMany({ ... });
    return Result.ok(items);
  } catch {
    return Result.fail('Échec.');
  }
}
```
- Impact: Every failure is rewritten to `'Échec.'` with no context. No `Logger`, no stack trace, no correlation ID. Debugging production issues is impossible. Also violates CLAUDE.md common rule "Never silently swallow errors".
- Fix: `catch (err) { this.logger.error('...', err instanceof Error ? err.stack : err); return Result.fail('Échec.'); }`.

---

### [LOW] `Outcome.convertToWorkPackage` does mass-assignment of dueDate/ownerId without bounds
- File: `web/back-nest/src/meetings/outcomes.service.ts:72-84`
- Category: Mass-Assignment / Input Validation
- Evidence:
```ts
const wp = await this.prisma.workPackage.create({
  data: {
    projectId,
    title: outcome.description.slice(0, 255),
    description: outcome.description,
    type: outcome.type === 'Risk' ? 'Bug' : 'Task',
    status: 'New',
    priority: outcome.type === 'Risk' ? 'High' : 'Normal',
    authorId,
    assigneeId: outcome.ownerId,
    dueDate: outcome.dueDate,
  },
})
```
- Impact:
  1. `outcome.ownerId` is written to `assigneeId` without checking that the user is still active, still in the project, or still exists. If the user has been soft-deleted, the WP is still assigned to them and any later notification dispatch may fail.
  2. `outcome.dueDate` can be in the distant past (the model's date parsing is permissive — Gemini sometimes returns 1899 dates) or very far future.
  3. `title` is truncated to 255 but `description` has no cap — a malicious outcome authored via another attack path can plant a multi-MB description into a WP.
  4. There is no check that an outcome hasn't already been converted — re-calling creates duplicate WPs linked to the same outcome via a newly overwritten `workPackageId`.
- Fix: Validate `ownerId` is still a project member, cap `description` length, and reject if `outcome.workPackageId` is already set (or return the existing WP idempotently).

---

### [LOW] Gemini API key passed in querystring
- File: `web/back-nest/src/ai/providers/gemini.provider.ts:25`
- Category: Secret Hygiene
- Evidence:
```ts
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
```
- Impact: Keys in querystrings are routinely logged by intermediate proxies, Cloudflare access logs, and the host's own `net.http_client_debug` instrumentation. Google's own docs recommend the `x-goog-api-key` header form.
- Fix:
```ts
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`
...
headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
```

---

### [LOW] `AbortSignal.timeout` only attached to AI provider fetches, not the transcription fetch
- File: Audit note on user's focus item
- Evidence (OpenAI — present): `web/back-nest/src/ai/providers/openai.provider.ts:27` → `signal: AbortSignal.timeout(60_000)`
- Evidence (Gemini — present): `web/back-nest/src/ai/providers/gemini.provider.ts:29` → `signal: AbortSignal.timeout(60_000)`
- Evidence (Transcription service — MISSING): `web/back-nest/src/meetings/meetings.service.ts:24` → `await fetch(\`${serviceUrl}/transcribe\`, { method: 'POST', body: formData })` — no signal.
- Impact: The AI providers are correctly timed out (covers user's focus question). The transcription call is not — a hung Python service hangs the request until the client disconnects. See HIGH #6.
- Fix: Add `signal: AbortSignal.timeout(120_000)` to the transcription fetch.

---

### [INFO] Fire-and-forget `analyzeTranscript` — rejection handling is correct but logs only
- File: `web/back-nest/src/meetings/meetings.service.ts:62-64, 148-150`
- Evidence:
```ts
void this.aiService.analyzeTranscript(transcript.id).catch((e: unknown) =>
  this.logger.error(`Unhandled AI error for transcript ${transcript.id}: ${e instanceof Error ? e.message : String(e)}`)
)
```
- Status: `.catch` is correctly attached in both locations, so there is no unhandledRejection. However, this is belt-only, not belt-and-braces: `analyzeTranscript` already has a try/catch that persists `aiStatus: 'failed'`, so the outer `.catch` is only reached for truly unexpected thrown paths (e.g., the initial `meetingTranscript.update` throwing). In those cases we log but do NOT flip `aiStatus` back out of `'processing'` — feeds into HIGH #5 (stuck-in-processing).
- Fix: In the outer `.catch`, also `await this.prisma.meetingTranscript.update({ where:{id}, data:{aiStatus:'failed', aiError:'bootstrap_error'} }).catch(()=>{})`.

---

### [INFO] `AiProviderFactory` defaults to OpenAI on unknown `AI_PROVIDER`
- File: `web/back-nest/src/ai/ai-provider.factory.ts:20-24`
- Evidence:
```ts
getProvider(): IAiProvider {
  const providerName = this.config.get<string>('AI_PROVIDER', 'openai').toLowerCase()
  if (providerName === 'gemini') return this.gemini
  return this.openAi
}
```
- Status: A typo in `AI_PROVIDER` (e.g., `openai ` with trailing space — already handled by `toLowerCase` not `trim`, see below) silently falls back to OpenAI. In particular `'openai '` (with space) does NOT equal `'gemini'` after `toLowerCase`, so it falls through to OpenAI — which is probably the intended fallback, but no warning is logged, so an operator who thinks they've switched to Gemini is still burning OpenAI credits.
- Fix: `this.config.get<string>('AI_PROVIDER', 'openai').trim().toLowerCase()`; if the value matches neither `'openai'` nor `'gemini'`, log a warning naming the effective fallback.

---

## Checklist of user's focus items

| Focus item | Status |
|---|---|
| Audio upload size cap | Present (100 MB) — see LOW note on no per-user rate limit |
| Audio upload MIME check | **Missing** — HIGH #5 |
| Filename sanitization | **Missing** — HIGH #5 |
| Path traversal on storage | N/A (file is in-memory, not written to disk) — but `originalFileName` is persisted raw (HIGH #5) |
| Transcription URL SSRF / allow-list | **Missing** — HIGH #6 |
| AI polling endpoint authz | **Missing** — HIGH #3 + CRITICAL #1 |
| AI provider env handling | Present but non-trimmed, silent fallback — INFO #2 |
| API key leak via error | **Possible** — HIGH #7 (both providers) |
| `AbortSignal.timeout` attached on every fetch | AI fetches yes, transcription fetch **missing** — LOW #3 |
| Fire-and-forget `.catch` | Present — INFO #1 (but does not reset `aiStatus`) |
| AI status state machine stuck in `processing` | **Yes** — HIGH #8 |
| Parse failure corrupts DB | Partial: hard failure rolls back (transaction); soft/empty output silently overwrites — HIGH #9 |
| Speaker rename authz | **Missing** — HIGH #2 |
| Agenda/attendees/outcomes authz | **Missing** — CRITICAL #2 |
| Outcome → WorkPackage mass-assignment | **Present** — CRITICAL #3 + LOW #2 |

---

## Recommended remediation order

1. Fix all three CRITICALs (project-membership guard + cross-project WP conversion) — one guard class + per-route validation unlocks most of these.
2. HIGH #5 (upload hardening), HIGH #6 (SSRF + timeout on transcription).
3. HIGH #7 (Gemini key-in-header, sanitize `aiError`).
4. HIGH #8 + INFO #1 (aiStatus state-machine + startup sweep).
5. HIGH #9, MEDIUM #1 (Zod validation at both trust boundaries: transcription response + AI response).
6. MEDIUMs on DTO classes + rate-limiting.
7. LOWs and INFOs opportunistically.
