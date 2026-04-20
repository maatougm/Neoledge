# Sprint 5 + Sprint 12 — Combined Patch Report

Branch: `nest-back`
Scope: tokenVersion lifecycle (Sprint 5) + file-upload hardening (Sprint 12)
Build: `npm run build` (NestJS) — **PASS**

## Summary of changes

All edits limited to the six files specified in the plan. `TEST_USERS`,
`auth.service.login()`, `quickAccounts`, and the dev auto-login flow were
left untouched as required.

Several of the Sprint 5 changes were already applied in prior commits and
have been verified in-place rather than re-applied. The two net-new edits
in this patch are the attachments path-traversal containment and the
meetings audio `fileFilter`.

---

## Sprint 5 — tokenVersion lifecycle

### 1. `web/back-nest/src/users/users.controller.ts`
- **Lines 106-118** — `deactivate` already uses
  `@CurrentUser() user: { userId: string }` and calls
  `this.usersService.deactivate(id, user.userId)`. The earlier `user.id`
  (undefined) bug is fixed. **No new edit required — verified in place.**

### 2. `web/back-nest/src/users/users.service.ts`
- **Lines 247-253** — `deactivate` already passes
  `{ isActive: false, tokenVersion: { increment: 1 } }` to
  `appUser.update`. **Verified in place.**
- **Lines 191-231** — `resetPassword` already writes
  `tokenVersion: { increment: 1 }` alongside the new password hash,
  returns `Result.ok({ success: true })`, and sends the temp password
  via `MailService` (with a dev-only `console.warn` fallback). No
  plaintext password leaves the server in the HTTP response body.
  **Verified in place.**

### 3. `web/back-nest/src/auth/auth.service.ts`
- **Lines 343-382** — `changePassword` already increments `tokenVersion`
  on password rotation **and** skips the `bcrypt.compare(currentPassword, …)`
  check when `user.mustChangePassword === true` (needed for force-change
  accounts). **Verified in place — TEST_USERS / `login()` untouched.**

### 4. `web/back-nest/src/profile/profile.service.ts`
- **Lines 88-112** — `changePassword` increments `tokenVersion` and
  mirrors the `mustChangePassword` skip fix from `auth.service`.
  **Verified in place.**

---

## Sprint 12 — File-upload hardening

### 5. `web/back-nest/src/profile/profile.service.ts` (`uploadAvatar`)
- **Lines 1-41, 114-154** — Previously patched to:
  - Import `randomUUID` from `node:crypto` (line 5).
  - Allow-list extension set `ALLOWED_AVATAR_EXT` (line 10) — `.jpg`,
    `.jpeg`, `.png`, `.webp`.
  - Lowercase + allow-list reject returning
    `Result.fail('Extension non autorisée …')`.
  - `sniffImageMime()` magic-byte validator (lines 12-41) — PNG
    `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF…WEBP` at offsets 0/8.
  - Content/extension cross-check (ext must match sniffed type).
  - Random filename `${userId}-${randomUUID()}${ext}` (line 139).
  - `path.resolve` containment check vs. `AVATAR_DIR` root (lines
    143-147) — rejects traversal with `Result.fail('Invalid path')`.
  **Verified in place.**

### 6. `web/back-nest/src/attachments/attachments.service.ts` *(NEW EDIT)*
- **Line 6** — added `import { randomUUID } from 'node:crypto'`.
- **Lines 10-26** — added `ALLOWED_EXT` set (pdf, office, txt, csv,
  common images, zip).
- **`upload()` method, ~lines 45-70** — changes:
  - Reads `path.extname(dto.fileName ?? '').toLowerCase()` and rejects
    extensions not in `ALLOWED_EXT`.
  - Uses imported `randomUUID()` instead of the undeclared `crypto`
    global (fixes a latent ReferenceError when `crypto` isn’t on
    `globalThis`).
  - Adds `path.resolve` containment check against `UPLOAD_DIR` root;
    returns `Result.fail('Invalid path')` on mismatch before writing.

### 7. `web/back-nest/src/meetings/meetings.controller.ts` *(NEW EDIT)*
- **Lines 26-46** — `@UseInterceptors(FileInterceptor('audio', …))` now
  carries a `fileFilter` that only admits a fixed set of audio MIME
  types and rejects everything else with a `BadRequestException(
  'Unsupported audio format')`. Allow-list:
  `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/ogg`,
  `audio/mp4`, `audio/flac`, `audio/x-m4a`. `fileSize: 100 MB` limit
  preserved.

---

## Build status

```
> back-nest@0.0.1 build
> nest build
```

Exit 0 — clean build, no TypeScript errors, no warnings surfaced by
`nest build`. `TEST_USERS`, `quickAccounts`, the dev auto-login branch
in `authenticateDbUser`, and `auth.service.login()` were not modified.

## Residual risks / notes

- Avatar upload currently uses the same random filename strategy as the
  plan, but older avatars on disk are not migrated — any pre-patch
  avatars whose filenames contained user-controlled extensions remain on
  disk until overwritten.
- `attachments.service.upload()` trusts the client-supplied
  `contentType` field for persisted metadata; the extension allow-list
  is now authoritative for storage safety, but a follow-up could add
  magic-byte sniffing for the most common document types (PDF `%PDF-`,
  ZIP `PK\x03\x04`) for defense in depth.
- `meetings.controller.ts` `fileFilter` enforces MIME type only; it does
  not sniff magic bytes. A malicious client that sets `audio/mpeg` on a
  non-audio payload will still be accepted at the HTTP layer and fail
  downstream in the transcription service. Consider adding ffprobe /
  `fluent-ffmpeg` validation if stricter enforcement is needed.
