# Sprint 3 — WebSocket Gateways Hardening

## Scope

Harden the two Socket.IO gateways against unauthorized access, replay attacks, CORS abuse, payload tampering, and DoS via high-frequency events.

Files modified:
- `web/back-nest/src/collaboration/collaboration.gateway.ts`
- `web/back-nest/src/notifications/notifications.gateway.ts`

Files intentionally untouched (no changes needed):
- `web/back-nest/src/collaboration/collaboration.module.ts` — already imports `PrismaModule` + `AuthModule`.
- `web/back-nest/src/notifications/notifications.module.ts` — `PrismaService` reachable via `@Global() PrismaModule`; `JwtService` via `AuthModule` (already imported).

Also untouched: test-login, TEST_USERS, quickAccounts, dev auto-login — no modifications per constraint.

## Fixes Applied

### 1. CORS allow-list
Both gateways — replaced `cors: { origin: '*' }` with:

```ts
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
@WebSocketGateway({ ..., cors: { origin: CORS_ORIGINS, credentials: true } })
```

Default still works for local dev; production sets `CORS_ORIGINS` to the public origins.

### 2. Cross-check `payload.sub` against AppUser on connect
Both gateways — after `jwtService.verify(...)`:

```ts
const user = await this.prisma.appUser.findUnique({
  where: { id: payload.sub, isActive: true },
  select: { id: true, tokenVersion: true },
});
if (!user) { client.disconnect(true); return; }
client.data['userId'] = payload.sub;
client.data['tokenVersion'] = user.tokenVersion;
```

This blocks tokens for deleted/deactivated users and tokens issued for user IDs that no longer exist.

### 3. Re-validate on every event (with 30 s cache)
Added `requireValidSession(client)` to `CollaborationGateway`:

- Reads `client.handshake.auth.token` fresh each time.
- `jwtService.verify({ secret: getJwtSecret(config) })`.
- 30-second `sessionCache: Map<userId, { tokenVersion, expiresAt }>` avoids DB hits on hot paths.
- Compares cached `tokenVersion` to `client.data.tokenVersion`. Mismatch (token revoked via password change / forced logout) → `client.disconnect(true)` and return `null`.
- Cache miss / expired → hit `prisma.appUser.findUnique({ where: { id, isActive: true } })` and refresh cache.
- Called at the top of every `@SubscribeMessage` handler (`join-project`, `leave-project`, `field-update`, `field-focus`, `field-blur`).
- `handleDisconnect` evicts the user's cache entry and the socket's rate bucket.

`NotificationsGateway` has no subscribe handlers (server-only `emitToUser`), so it only validates on connect and evicts its cache on disconnect.

### 4. Project-membership check on `handleJoinProject`
Inlined until Sprint 2 ships a dedicated service:

```ts
const hasAccess = await this.prisma.userRoleAssignment.findFirst({
  where: { userId, OR: [{ projectId }, { projectId: null }] },
  select: { id: true },
});
if (!hasAccess) { client.emit('error', { message: 'Not a member of this project' }); return; }
```

Users with a global (`projectId: null`) role assignment pass; otherwise they must have a project-scoped assignment. If neither — an `error` event is emitted and the socket does **not** join the room.

### 5. Room + userId tamper-proofing on `field-update` / `field-focus` / `field-blur`

```ts
if (!client.rooms.has(`project:${projectId}`)) return;
if (payload.userId !== undefined && payload.userId !== userId) return;
```

- The socket must have passed `join-project` (which already did the membership check) before it can broadcast.
- Any client-supplied `userId` field must match the authenticated `client.data.userId`; the broadcast always uses the server-authenticated `userId`, never the payload's.

### 6. Payload validation
Inline guards (no DTO classes — gateway-level `ValidationPipe` config added friction against minimal-diff constraint):

- `projectId` — must be a string matching RFC-4122 UUID regex.
- `projectFieldId` — non-empty string, length ≤ 128.
- `value` — string, length ≤ 100 000 chars.
- `payload` itself — must be a non-null object.

Invalid payloads are dropped silently (no ack) to avoid leaking schema hints.

### 7. Per-socket rate limit (token bucket, 30 msg/s)

```ts
const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_REFILL_PER_SEC = 30;
private readonly rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
```

- Each socket gets 30 tokens, refilled at 30/sec (burst-friendly, sustained-limiting).
- Over-quota events are silently ignored (no ack).
- Bucket evicted on disconnect.
- Called first in every `@SubscribeMessage` handler before session validation to short-circuit flood attempts.

## Build Status

```
cd web/back-nest && npm run build
> back-nest@0.0.1 build
> nest build
```

**PASSED** — no TypeScript errors, no Nest compilation warnings.

## Notes / Follow-ups

- `getJwtSecret(config)` reused per the constraint; single source of truth for the JWT secret.
- `CORS_ORIGINS` is read at module load time (class-decorator evaluation). A process restart is required to pick up env-var changes — acceptable for a deploy-time allow-list.
- The session cache is process-local. If the backend is ever clustered (PM2 cluster / multiple pods), a logout / token-rotation event on instance A will not invalidate sessions cached on instance B until the 30 s TTL expires. Acceptable short-term; future work: switch to a Redis-backed token-version store or shorten the TTL.
- `NotificationsGateway` currently has no `@SubscribeMessage` handlers — rate limit + per-event re-validation are therefore not needed there. Added only connect-time AppUser cross-check + CORS allow-list + cache cleanup.
- Membership query uses the existing `UserRoleAssignment` model (`user_role_project_uq` unique + indexed on `projectId`). No new indexes required.
- `client.emit('error', { message: 'Not a member of this project' })` uses the Socket.IO built-in `error` event which clients can listen for; front-end can surface a toast via `useCollaborationSocket`.
