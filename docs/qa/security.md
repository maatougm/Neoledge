# NeoLeadge Security Audit — Phase 4

Files opened: `portal.service.ts`, `users.service.ts`, `auth.service.ts`, `auth.module.ts`, `jwt.strategy.ts`, `main.ts`, `collaboration.gateway.ts`, `notifications.gateway.ts`, `MeetingAiPanel.vue`, `WikiView.vue`, `api.ts`, `jwt.ts`, `health.controller.ts`, `system-status.service.ts`, `app.py`, `profile.service.ts`, `meetings.controller.ts`, `portal.controller.ts`. Repo-wide greps executed for `$queryRaw`/`$executeRaw`, `eval(`/`new Function`, `.env` files, `sk-`/`AIza` patterns, rate-limit keywords, `v-html`, `tokenVersion`, `helmet`/CSP, `fileExtension`, `x-forwarded-for`, upload interceptors.

---

## CRITICAL

### [CRITICAL] Hardcoded test credentials reachable when NODE_ENV is absent or any value other than `"production"`
- File: `web/back-nest/src/auth/auth.service.ts:150`
- Category: auth
- Evidence:
```ts
const isProduction =
  this.configService.get<string>('NODE_ENV') === 'production';

if (!isProduction) {
  const testUser = TEST_USERS.find((u) => u.email === email);
  if (testUser && testUser.password === password) {
    ...
    return { jwt, mustChangePassword: testUser.mustChangePassword };
  }
}
```
TEST_USERS (lines 19-119) contains 11 fully-specified accounts incl. Admin (`Admin@123`). Gate is opt-in: any NODE_ENV that is not exactly `"production"` (undefined, staging, test) activates the backdoor; the upsert at line 165 writes those accounts into the live database.
- Impact: Attacker who guesses any test email/password gains a full Admin JWT on every non-production-flagged deploy.
- Fix: Delete TEST_USERS from production source; gate dev fixtures behind `NODE_ENV === 'development'` only and move credentials to `.env`.

### [CRITICAL] No rate limiting on `/auth/login`, TOTP verify, portal signoff, or AI-analyze
- File: `web/back-nest/src/main.ts` (no ThrottlerModule / ThrottlerGuard anywhere)
- Category: rate-limit
- Evidence: repo-wide grep for `rate.?limit`, `throttle`, `ThrottlerModule` returns zero matches under `web/back-nest/src`.
- Impact: Distributed brute-force against login, unlimited TOTP code guessing across sessions, AI-analysis cost flooding.
- Fix: Add `@nestjs/throttler` globally + stricter per-endpoint decorators on login/TOTP/signoff/AI.

### [CRITICAL] Avatar upload — user-controlled `fileExtension` used in filesystem path with no validation
- File: `web/back-nest/src/profile/profile.service.ts:82`
- Category: upload
- Evidence:
```ts
async uploadAvatar(userId: string, base64Image: string, fileExtension: string) {
  const buffer = Buffer.from(base64Image, 'base64');
  if (buffer.length > 2 * 1024 * 1024) return Result.fail<string>('...');
  ...
  const fileName = `${userId}${fileExtension}`;
  const filePath = path.join(AVATAR_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
```
`fileExtension` from body (`profile.controller.ts:34`) with zero validation. Attacker can supply `fileExtension: "/../../../uploads/avatars/../../main.js"` to write arbitrary content (base64-decoded body) to an arbitrary path. No MIME allow-list, no magic-bytes, no extension allow-list, no `path.resolve` containment.
- Impact: Authenticated user can overwrite any writable file in the process's working directory → RCE / credential theft.
- Fix: (1) extension allow-list `['.jpg','.jpeg','.png','.webp']`; (2) magic-bytes check; (3) `crypto.randomUUID() + allowedExt`; (4) `filePath.startsWith(AVATAR_DIR)` containment.

### [CRITICAL] `changePassword` does not bump `tokenVersion` — active sessions remain valid after a password change
- Files: `web/back-nest/src/auth/auth.service.ts:367`, `web/back-nest/src/profile/profile.service.ts:69`, `web/back-nest/src/users/users.service.ts:234` (deactivate)
- Category: auth
- Evidence:
```ts
// auth.service.ts line 367:
await this.prisma.appUser.update({
  where: { id: userId },
  data: { passwordHash: newHash, mustChangePassword: false },
});

// profile.service.ts line 69:
await this.prisma.appUser.update({
  where: { id: userId },
  data: { passwordHash: hash, mustChangePassword: false },
});
```
Neither call increments `tokenVersion`. Only `roles.service.ts:222, 230` do so (on role changes). `users.service.ts:234` deactivate also omits the bump.
- Impact: After admin resets a compromised user's password (or user changes own), every previously-issued JWT stays valid for full TTL (up to 5h).
- Fix: Add `tokenVersion: { increment: 1 }` to every `appUser.update` that changes `passwordHash` or sets `isActive: false`.

### [CRITICAL] `main.ts` — CORS wildcard with no Helmet, no CSP
- File: `web/back-nest/src/main.ts:24`
- Category: cors / config
- Evidence:
```ts
app.enableCors({ origin: '*' });
// No helmet() call anywhere in the file
```
No Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy.
- Impact: Clickjacking (no frame-ancestors), MIME-sniffing attacks, easier stored/reflected XSS exploitation.
- Fix: `app.use(helmet())` after `NestFactory.create`; restrict CORS to explicit allow-list.

---

## HIGH

### [HIGH] JWT secret default fallback — `"dev-secret-change-me"` used in 6 independent call sites
- Files: `web/back-nest/src/auth/auth.module.ts:17`, `auth.service.ts:201`, `auth.service.ts:435`, `jwt.strategy.ts:36`, `collaboration.gateway.ts:82`, `notifications.gateway.ts:37`
- Category: auth / secret
- Evidence: identical `configService.get<string>('JWT_SECRET', 'dev-secret-change-me')` pattern in all 6.
- Impact: Missing `JWT_SECRET` at boot silently uses a well-known secret embedded in repo history; anyone with repo access can forge admin JWTs.
- Fix: Remove all default fallbacks; replace with `configService.getOrThrow<string>('JWT_SECRET')`; add startup guard enforcing ≥32-char length.

### [HIGH] WebSocket gateways — CORS wildcard (`origin: '*'`)
- Files: `collaboration.gateway.ts:56`, `notifications.gateway.ts:21`
- Category: cors
- Evidence:
```ts
@WebSocketGateway({ namespace: '/collaboration', cors: { origin: '*' } })
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
```
- Fix: Restrict to explicit frontend origin allow-list.

### [HIGH] XSS — `v-html` on wiki content without DOMPurify (`javascript:` URI bypass)
- File: `web/Front/customapp/src/views/WikiView.vue:40`
- Category: xss
- Evidence:
```vue
<div v-if="!editing" class="wiki__content-body" v-html="renderedContent" />
```
```ts
// renderMarkdown line 127 — link regex:
.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
```
Escaping covers `<` / `>` / `&` but NOT attribute injection via URL schemes. `[click me](javascript:alert(1))` produces `<a href="javascript:alert(1)" target="_blank">click me</a>`.
- Impact: Any authenticated user who can create/edit a wiki page injects `javascript:` URI executing in the browser of any reader — XSS with session-token theft scope.
- Fix: Run `DOMPurify.sanitize(renderMarkdown(text))` before `v-html`, or strip `javascript:` schemes via `ALLOW_UNKNOWN_PROTOCOLS: false`.

### [HIGH] XSS — `v-html` on AI summary with partial escaping bypass potential
- File: `web/Front/customapp/src/components/pm/MeetingAiPanel.vue:85`
- Category: xss
- Evidence:
```vue
<div v-if="results.aiSummary" class="ai-summary-prose" v-html="renderSummary(results.aiSummary)" />
```
```ts
function renderSummary(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split('\n')
    .map((line) => {
      if (/^## (.+)/.test(line)) return `<h2 class="prose-h2">${line.replace(/^## /, '')}</h2>`
```
Per-line regex splices content back into HTML tag bodies after whole-string escaping. AI model output is external data — prompt-injected responses can produce unexpected HTML.
- Impact: Prompt-injected AI response can inject DOM content.
- Fix: `DOMPurify.sanitize(renderSummary(text))` before `v-html`.

### [HIGH] Transcription service — exception message leaked verbatim in HTTP 500
- File: `web/Transcription/app.py:131`
- Category: logging
- Evidence:
```python
except Exception as e:
    logger.error(f"Transcription failed: {e}", exc_info=True)
    raise HTTPException(500, f"Erreur de transcription : {str(e)}")
```
- Impact: `str(e)` exposes internal file paths, library names, memory addresses, ML framework error strings.
- Fix: Return generic message; log `str(e)` server-side only.

### [HIGH] Meeting audio upload — no MIME allow-list or magic-bytes check
- File: `web/back-nest/src/meetings/meetings.controller.ts:27`
- Category: upload
- Evidence:
```ts
@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
```
No `fileFilter`. NestJS accepts any binary, forwards with `.mp3` extension spoof.
- Fix: Add `fileFilter` validating `file.mimetype` against audio allow-list + magic-bytes check in service layer.

### [HIGH] `resetPassword` returns `tempPassword` in the API response body
- File: `web/back-nest/src/users/users.service.ts:217`
- Category: auth
- Evidence:
```ts
return Result.ok({ tempPassword });
```
Intermediaries (proxy logs, devtools network tab, API-gateway logs) record it.
- Impact: Plaintext temp password leaks to any HTTP-logging layer.
- Fix: Return only `{ success: true }`; rely on email delivery.

---

## MEDIUM

### [MEDIUM] `.env` file present in `web/back-nest/` with live `JWT_SECRET`
- File: `web/back-nest/.env`
- Category: secret
- Evidence: File exists and was readable. `.gitignore` at `web/.gitignore:452` excludes `.env*` but rule scope is `web/` subtree; `web/back-nest/.env` status in git history is `[UNCERTAIN]` — verify with `git ls-files web/back-nest/.env`.
- Fix: `git rm --cached web/back-nest/.env`, add to root `.gitignore`, **rotate JWT_SECRET immediately**.

### [MEDIUM] TOTP verify — `lockedUntil` not enforced in TOTP path
- File: `web/back-nest/src/auth/auth.service.ts:224`
- Category: auth / rate-limit
- Evidence: `loginWithTotp` increments `failedLoginAttempts` but never re-checks `lockedUntil`; the lock is only consulted during password authentication.
- Impact: Attacker who has password can brute-force the 6-digit TOTP (≤10^6 tries) without lockout.
- Fix: Re-check `lockedUntil` inside `loginWithTotp`; add TOTP-specific attempt counter; apply global rate-limiter.

### [MEDIUM] `ValidationPipe` missing `forbidNonWhitelisted: true`
- File: `web/back-nest/src/main.ts:17`
- Category: config
- Evidence:
```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
);
```
- Impact: Extra properties silently dropped, hiding mass-assignment probing feedback.
- Fix: Add `forbidNonWhitelisted: true`.

### [MEDIUM] Portal signoff — no rate limiting
- File: `web/back-nest/src/portal/portal.controller.ts:86`
- Category: rate-limit
- Fix: Global ThrottlerGuard + per-token cap (e.g. 10/hour).

### [MEDIUM] `x-forwarded-for` accepted without proxy trust
- File: `web/back-nest/src/portal/portal.controller.ts:93`
- Category: config
- Evidence:
```ts
const ipAddress =
  (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
  req.socket.remoteAddress;
```
No `app.set('trust proxy', ...)` configured in main.ts.
- Impact: `ipAddress` in PortalSignoff is user-spoofable, defeating IP audit.
- Fix: `app.set('trust proxy', 1)` (if behind one known proxy) or drop X-F-F entirely.

### [MEDIUM] Health + system-status endpoints unauthenticated, leak Node.js version
- Files: `web/back-nest/src/health/health.controller.ts:14`, `web/back-nest/src/system-status/system-status.service.ts:16`
- Category: config
- Fix: Require auth for anything beyond `{ status: 'ok' }`, or strip `node`/`version` fields.

### [MEDIUM] `$queryRaw` pattern fragility
- Files: `health.controller.ts:21`, `system-status.service.ts:20`
- Category: injection (risk only, not current)
- Evidence: Both call sites use Prisma tagged template with no user input — safe today.
- Fix: Lint rule prohibiting new `$queryRaw`/`$executeRaw` without explicit review.

### [MEDIUM] Transcription service CORS wildcard
- File: `web/Transcription/app.py:59`
- Category: cors
- Fix: Restrict `allow_origins` to `["http://localhost:5122"]`.

---

## LOW

### [LOW] Temp password modulo bias (70-char charset)
- File: `web/back-nest/src/users/users.service.ts:59`
- Category: auth
- Evidence: `256 % 70 = 46` → first 46 chars appear ~33% more often than others.
- Fix: Rejection sampling — regenerate bytes `>= 210`.

### [LOW] `decodeJwt` client-side only, no signature verification (by design)
- File: `web/Front/customapp/src/lib/jwt.ts:21`
- Category: auth
- Fix: Document as UI-display only; no code change.

### [LOW] `forbidUnknownValues` not set on ValidationPipe
- File: `web/back-nest/src/main.ts:17`
- Category: config
- Fix: Add alongside `forbidNonWhitelisted: true`.
