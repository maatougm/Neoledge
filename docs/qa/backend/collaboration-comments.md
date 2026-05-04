# QA Review — Collaboration (WebSocket) & Comments modules

Files opened:
- `web/back-nest/src/collaboration/collaboration.gateway.ts`
- `web/back-nest/src/collaboration/collaboration.service.ts`
- `web/back-nest/src/collaboration/collaboration.module.ts`
- `web/back-nest/src/comments/comments.controller.ts`
- `web/back-nest/src/comments/comments.service.ts`
- `web/back-nest/src/comments/comments.module.ts`

Cross-reference reads (not in scope but needed to confirm impact):
- `web/back-nest/src/common/guards/jwt-auth.guard.ts`
- `web/back-nest/src/common/decorators/current-user.decorator.ts`
- `web/back-nest/prisma/schema.prisma` (ProjectComment model, lines 296–317)
- `web/Front/customapp/src/components/pm/CommentItem.vue` (render path check)

Legend: CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Collaboration gateway findings

### [CRITICAL] `join-project` does not verify the socket's user has access to the project
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:116-136`
- Category: Authorization / IDOR / Information disclosure
- Evidence:
```ts
@SubscribeMessage('join-project')
async handleJoinProject(
  @ConnectedSocket() client: Socket,
  @MessageBody() projectId: string,
): Promise<void> {
  const userId: string = client.data['userId'] as string;
  if (!userId) return;

  const name = await this.resolveUserName(userId, client);

  if (!this.presence.has(projectId)) {
    this.presence.set(projectId, new Map());
  }

  const color = COLOR_PALETTE[userId.charCodeAt(0) % COLOR_PALETTE.length];
  const presenceUser: PresenceUser = { userId, name, color, editingFieldId: null };

  this.presence.get(projectId)!.set(client.id, presenceUser);
  await client.join(`project:${projectId}`);
  this.emitPresenceUpdate(projectId);
}
```
- Impact: Any authenticated user (even `Viewer`, or a user with no relationship to the project) can pass an arbitrary `projectId` string and join the room `project:<projectId>`. Once joined, they will receive every `field-changed`, `card-moved`, `wp-changed`, and `presence-update` broadcast for that project — effectively a live feed of a project they have no permission to see. Their identity (`userId`, full name, color) is also injected into the `presenceList` shown to legitimate members, so they can also announce themselves to other users' UIs.
- Fix: Before `client.join`, call a membership/authorization check (e.g. `this.prisma.project.findFirst({ where: { id: projectId, OR: [{ createdById: userId }, { teamMembers: { some: { userId } } }] } })`, or a dedicated `canAccessProject(userId, projectId)` helper that mirrors the HTTP guard logic used in `ProjectsService`). Reject (emit an error and disconnect or simply return) if the check fails. The same check must also gate `field-update`, `field-focus`, and `field-blur` since the current code never verifies the socket actually joined the room it references in the payload.

---

### [CRITICAL] JWT is only validated once at connect — revoked/expired tokens keep working forever
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:75-94`
- Category: Authentication / token lifecycle
- Evidence:
```ts
handleConnection(client: Socket): void {
  const token: string | undefined = (client.handshake.auth as Record<string, string>)?.token;
  if (!token) {
    client.disconnect(true);
    return;
  }
  try {
    const secret = this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me');
    const payload = this.jwtService.verify<{
      sub: string;
      firstName?: string;
      lastName?: string;
    }>(token, { secret });
    client.data['userId'] = payload.sub;
    client.data['firstName'] = payload.firstName ?? '';
    client.data['lastName'] = payload.lastName ?? '';
  } catch {
    client.disconnect(true);
  }
}
```
- Impact: The JWT is verified only at handshake. After the socket is established, `userId` is cached in `client.data` and used for every subsequent event (`field-update`, `field-focus`, `field-blur`, `join-project`). A long-lived socket will continue to accept events even after the underlying JWT has expired, been rotated, or been explicitly revoked (e.g. user deactivated via `DELETE /admin/users/:id`, or admin rotated `JWT_SECRET`). With `JWT_EXPIRES_IN=7d` in the documented env, that is a 7-day window of stale auth.
- Fix: Either (a) re-verify the token periodically (e.g. every N minutes via a setInterval that calls `jwtService.verify` and disconnects on failure), (b) re-verify on every `@SubscribeMessage` by storing the raw token in `client.data.token` and calling `jwtService.verify` inside each handler, or (c) track a user-revocation version/timestamp in the DB and check it before honoring events. At minimum, check `user.isActive` / `user.deactivatedAt` on every event.

---

### [CRITICAL] `field-update` accepts arbitrary `projectId` / `projectFieldId` with zero authorization
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:154-185` and `web/back-nest/src/collaboration/collaboration.service.ts:8-29`
- Category: Authorization / data integrity / IDOR
- Evidence (gateway):
```ts
@SubscribeMessage('field-update')
async handleFieldUpdate(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: FieldUpdatePayload,
): Promise<void> {
  const userId: string = client.data['userId'] as string;
  const firstName: string = client.data['firstName'] as string;
  if (!userId) return;

  const { projectId, projectFieldId, value } = payload;

  try {
    await this.collaborationService.saveField(projectId, projectFieldId, value, userId);
  } catch {
    // Best-effort — do not crash the socket connection on DB errors
  }
  ...
}
```
- Evidence (service):
```ts
async saveField(
  projectId: string,
  projectFieldId: string,
  value: string,
  userId: string,
): Promise<void> {
  const updated = await this.prisma.projectFieldValue.updateMany({
    where: { projectId, projectFieldId },
    data: { value, updatedBy: userId },
  });

  if (updated.count === 0) {
    await this.prisma.projectFieldValue.create({
      data: {
        projectId,
        projectFieldId,
        value,
        updatedBy: userId,
      },
    });
  }
}
```
- Impact: Any authenticated user can overwrite any `ProjectFieldValue` on any project simply by emitting a `field-update` with a guessed/enumerated `projectId` + `projectFieldId`. There is no check that:
  1. The user has access to the project.
  2. The user has write permission (PM/Admin vs Viewer — even `Viewer` role would pass this handler).
  3. The `projectFieldId` actually belongs to `projectId` (so a caller can paste a field id from project A while claiming `projectId` = project B, causing `updateMany` to silently match zero rows and then `create` to insert a new `ProjectFieldValue` linked to a mismatched pair — schema integrity damage).
  4. The field is editable in the current phase (the HTTP `PATCH /pm/projects/:id/field-values` likely enforces this; the WS path bypasses all of it).
  Also note the catch block silently swallows the DB error (`// Best-effort`) so the client can brute-force without any feedback and without any log trail.
- Fix: Gate the handler with a membership/role check for `projectId`, resolve the field via `prisma.projectField.findFirst({ where: { id: projectFieldId, projectId } })` to confirm the pair, mirror whatever phase/role rules the HTTP endpoint applies, and log (don't swallow) DB errors. Also add `@UsePipes(new ValidationPipe(...))` with a class DTO so `projectId`/`projectFieldId`/`value` are validated as strings and length-capped.

---

### [HIGH] `field-update`, `field-focus`, `field-blur` broadcast without checking that socket joined the room
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:154-213`
- Category: Authorization / information disclosure
- Evidence:
```ts
client.to(`project:${projectId}`).emit('field-changed', {
  projectFieldId,
  value,
  updatedBy: userId,
  updatedByName: firstName,
});
```
- Impact: An attacker can skip `join-project` entirely and emit a `field-update` directly. The gateway happily broadcasts `field-changed` to `project:<attacker-supplied-id>`, which is a room the legitimate members of that project are in. This lets an attacker inject fake field changes (wrong value) to every member's UI in real time, with an `updatedByName` of the attacker's own `firstName` — usable for social-engineering / phishing inside the app ("your PM just set this field to X, please approve").
- Fix: Before emitting, verify that `client.rooms.has(\`project:${projectId}\`)` (i.e. the socket has explicitly joined) AND re-verify authorization as in the CRITICAL above. Reject otherwise.

---

### [HIGH] `field-focus` / `field-blur` payloads are not validated; presence can be arbitrarily altered
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:187-213`
- Category: Input validation / presence poisoning
- Evidence:
```ts
@SubscribeMessage('field-focus')
handleFieldFocus(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: FieldFocusPayload,
): void {
  const { projectId, projectFieldId } = payload;
  const socketMap = this.presence.get(projectId);
  if (socketMap?.has(client.id)) {
    const existing = socketMap.get(client.id)!;
    socketMap.set(client.id, { ...existing, editingFieldId: projectFieldId });
  }
  this.emitPresenceUpdate(projectId);
}
```
- Impact: There is no Zod / class-validator pipe on the payload. A client can send `projectFieldId = "<script>…</script>"` or a 10 MB string, and it will be stored in memory and broadcast to every subscriber's UI. If the frontend later uses this string in any unsafe context, it becomes stored-XSS via presence. It also allows presence poisoning: sending a valid `projectId` that the user's socket is joined to (see spoofing above), plus any `projectFieldId`, will make other users' UIs show "User is editing field X" even if user is not. `userId` cannot be directly spoofed (it comes from `client.data`, not the payload), but any other field can.
- Fix: Add a `ValidationPipe` with class-DTOs; cap `projectFieldId` length; verify the field belongs to the project.

---

### [HIGH] No event-level rate limiting — DoS / presence flood
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts` (entire gateway)
- Category: DoS / resource abuse
- Evidence: No `ThrottlerGuard`, no per-socket counters, no debouncing. `grep` over `src/` for `ThrottlerGuard|@Throttle|rateLimit` returns zero matches.
- Impact: A malicious client can emit thousands of `field-focus` / `field-blur` per second. Each event (a) mutates the presence Map, (b) calls `emitPresenceUpdate` which allocates an array and emits to every socket in the room. `field-update` is worse — every event hits Prisma (`updateMany` + possibly `create`). This is both an amplification attack against other clients and a DB hammer.
- Fix: Throttle per-socket (e.g. 10 events/sec for presence, 2/sec for `field-update`). Debounce presence emits (coalesce within 100 ms). Cap `value` string length server-side.

---

### [HIGH] Presence Map is not thread-safe across multiple instances and has stale-entry paths
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:62, 96-112, 138-152`
- Category: Concurrency / correctness (distributed deployment)
- Evidence:
```ts
private readonly presence = new Map<string, Map<string, PresenceUser>>();
...
handleDisconnect(client: Socket): void {
  const affectedProjects: string[] = [];

  for (const [projectId, socketMap] of this.presence) {
    if (socketMap.has(client.id)) {
      socketMap.delete(client.id);
      affectedProjects.push(projectId);
      if (socketMap.size === 0) {
        this.presence.delete(projectId);
      }
    }
  }

  for (const projectId of affectedProjects) {
    this.emitPresenceUpdate(projectId);
  }
}
```
- Impact:
  1. `CLAUDE.md` itself warns the presence Map is single-instance — behind PM2 cluster / multiple NestJS processes a user will appear to be in the project from one node's perspective but not others. Broadcasts only reach sockets on the same node (Socket.IO is not configured with a Redis adapter that would fix this).
  2. `leave-project` (lines 138-152) does NOT check whether the socket was in the room before calling `client.leave` + `emitPresenceUpdate`. A client can spam `leave-project` with arbitrary project ids and trigger `presence-update` broadcasts to every project room in memory — presence flood / info-leak about which projects currently have active sessions (empty `list` still confirms "no one is editing this project right now").
  3. `join-project` (line 126) does not check whether the socket already joined the project. Re-joining simply overwrites the existing presence entry, which silently discards the current `editingFieldId` (minor UX issue) but more importantly allows a client to inflate the presence emit rate.
- Fix:
  - Add a Redis adapter (`@socket.io/redis-adapter`) for multi-instance correctness.
  - In `leave-project`, early-return if `socketMap` is undefined or `!socketMap.has(client.id)`.
  - In `join-project`, short-circuit if the socket is already registered to that project.
  - Remove the project's room from the presence Map inside `leave-project` when empty (matches disconnect behavior).

---

### [MEDIUM] `userNameCache` grows unbounded and never invalidates on user profile change
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:64, 236-263`
- Category: Memory / data staleness
- Evidence:
```ts
private readonly userNameCache = new Map<string, string>();
...
private async resolveUserName(userId: string, client: Socket): Promise<string> {
  if (this.userNameCache.has(userId)) {
    return this.userNameCache.get(userId)!;
  }
  ...
  this.userNameCache.set(userId, name);
  return name;
}
```
- Impact: Lives for the lifetime of the process, never evicts. In a long-running deployment with many users, the Map accumulates permanently. Also, if a user changes their name via `PUT /admin/users/:id`, the cached name stays stale forever until restart. Not critical but worth fixing with an LRU cap (e.g. 1000 entries) and TTL (e.g. 10 min).
- Fix: Use an LRU with TTL, or at minimum expose an invalidation hook called by `UsersService.update`.

---

### [MEDIUM] `emitPresenceUpdate` can be called before `this.server` is assigned
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:231-234`
- Category: Null-safety / robustness
- Evidence:
```ts
private emitPresenceUpdate(projectId: string): void {
  const list = Array.from(this.presence.get(projectId)?.values() ?? []);
  this.server.to(`project:${projectId}`).emit('presence-update', list);
}
```
- Impact: The two public broadcast helpers (`broadcastCardMoved`, `broadcastWpChanged`) defensively check `if (!this.server) return;` (lines 219, 225), but `emitPresenceUpdate` does not. If an early handler fires before `WebSocketServer` has finished injecting `this.server`, this crashes the whole gateway with `Cannot read properties of undefined`. In practice unlikely, but the inconsistency indicates a real edge case the author was aware of.
- Fix: Add the same `if (!this.server) return;` guard.

---

### [MEDIUM] CORS is wide open on the WebSocket namespace
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:56`
- Category: CSRF-like / CORS
- Evidence:
```ts
@WebSocketGateway({ namespace: '/collaboration', cors: { origin: '*' } })
```
- Impact: `origin: '*'` means any browser from any origin can connect. Because the JWT is passed via `handshake.auth.token` (not cookies) this is not a classic CSRF, but it still enables embedding in third-party pages and, combined with the leaky `join-project` above, simplifies exfiltration of real-time project data. Should mirror the HTTP CORS allowlist.
- Fix: Restrict `origin` to the frontend origin(s) loaded from config.

---

### [LOW] `color` derivation is deterministic and uses only first char of userId
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:130`
- Category: UX / information leakage
- Evidence:
```ts
const color = COLOR_PALETTE[userId.charCodeAt(0) % COLOR_PALETTE.length];
```
- Impact: UUID v4 ids starting with the same hex nibble collide. Also deterministic color on a public `userId` leaks a tiny amount of identity. Minor.
- Fix: Hash the full userId (e.g. simple 32-bit hash) before modulo.

---

### [LOW] Logger is declared but unused
- File: `web/back-nest/src/collaboration/collaboration.gateway.ts:58`
- Category: Observability / dead code
- Evidence:
```ts
private readonly logger = new Logger(CollaborationGateway.name);
```
- Impact: No logging on failed auth, failed save, join/leave, or abusive patterns. Combined with the silently-swallowed catch in `handleFieldUpdate` (line 167-169), abuse/exploitation would be invisible to ops.
- Fix: Log: failed JWT verify (WARN), unauthorized access attempts (WARN), DB save errors (ERROR), unusual event rates (WARN).

---

## Comments module findings

### [CRITICAL] Comments controller never verifies the caller has access to `projectId`
- File: `web/back-nest/src/comments/comments.controller.ts:6, 11-24, 47-53` and `comments.service.ts:9-23, 40-53`
- Category: Authorization / IDOR
- Evidence (controller):
```ts
@Controller('api/projects/:projectId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get()
  async getAll(@Param('projectId') projectId: string) {
    const result = await this.service.getProjectComments(projectId);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Param('projectId') projectId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
    if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');
    const result = await this.service.create(projectId, user.userId, body.content);
    ...
  }
```
- Evidence (service `create`):
```ts
async create(projectId: string, userId: string, content: string, parentCommentId?: string) {
  const mentions = this.extractMentions(content);
  const comment = await this.prisma.projectComment.create({
    data: {
      projectId,
      userId,
      content,
      parentCommentId: parentCommentId ?? null,
      mentions: mentions.length ? JSON.stringify(mentions) : null,
    },
    ...
  });
```
- Impact: Any authenticated user can (a) read all comments on any project by enumerating `projectId` via `GET /api/projects/:projectId/comments`, (b) post comments to any project via `POST /api/projects/:projectId/comments`, (c) reply to any thread. The only check is `JwtAuthGuard` (valid JWT); there is no `RolesGuard`, no `canAccessProject(userId, projectId)`. This is a textbook IDOR — full read/write on project discussion streams for users who should not see them.
- Fix: Add a membership check in `CommentsService.getProjectComments` and `CommentsService.create`: `await this.prisma.project.findFirst({ where: { id: projectId, ...accessConditions(userId) } })` → `Result.fail('Not found')` on no match. Apply the same pattern used by `ProjectsService.getProjectDetail`.

---

### [HIGH] Reply endpoint trusts `projectId` param; parent comment's project is never cross-checked
- File: `web/back-nest/src/comments/comments.controller.ts:47-53` and `comments.service.ts:40-53`
- Category: Authorization / data integrity
- Evidence:
```ts
@Post(':commentId/replies')
@HttpCode(HttpStatus.CREATED)
async reply(@Param('projectId') projectId: string, @Param('commentId') commentId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
  const result = await this.service.create(projectId, user.userId, body.content, commentId);
  ...
}
```
And inside `create`, `parentCommentId` is blindly written without confirming that the parent belongs to `projectId`:
```ts
const comment = await this.prisma.projectComment.create({
  data: {
    projectId,
    userId,
    content,
    parentCommentId: parentCommentId ?? null,
    ...
  },
});
```
- Impact: Caller can post a reply to comment X (from project A) while passing `projectId = B`. The resulting comment row has `projectId = B` but `parentCommentId` pointing into project A's thread. This pollutes both projects' comment trees and, combined with the IDOR above, gives a simple way to inject comments that appear as "replies to a project-A thread" in project-B's list (or vice-versa).
- Fix: Before insert, `findFirst({ where: { id: parentCommentId, projectId, isDeleted: false } })` and `Result.fail` if it doesn't match. Also verify `parentCommentId` itself is not already a reply (prevent deep nesting) — the model comment says "two levels max" (see `replies` in `getProjectComments` with `parentCommentId: null` filter), but the service does not enforce it.

---

### [HIGH] `reply` endpoint does not validate empty content
- File: `web/back-nest/src/comments/comments.controller.ts:47-53`
- Category: Input validation
- Evidence:
```ts
@Post(':commentId/replies')
@HttpCode(HttpStatus.CREATED)
async reply(@Param('projectId') projectId: string, @Param('commentId') commentId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
  const result = await this.service.create(projectId, user.userId, body.content, commentId);
  if (result.isFailure) throw new BadRequestException(result.error);
  return result.value;
}
```
The main `create` handler at line 19-24 has `if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');` but the reply handler does not.
- Impact: Empty/whitespace-only replies can be posted, and `body.content` is not guarded against `undefined` — if a client omits `content` entirely, `extractMentions(undefined)` would throw (`.match` on undefined) and return a 500 instead of a clean 400.
- Fix: Move the validation into the service (`create` should reject empty/missing content). Or duplicate the check in the reply handler. Also add a DTO class with `@IsString() @IsNotEmpty() @MaxLength(...)` and a `ValidationPipe` — right now `@Body() body: { content: string }` is just a TypeScript interface and provides zero runtime protection (this is explicitly warned against in `CLAUDE.md`: "DTOs must be classes, not interfaces…").

---

### [HIGH] `@mentions` are stored but do NOT generate notifications; `CommentsModule` has no notification wiring
- File: `web/back-nest/src/comments/comments.service.ts:40-53, 83-86` and `web/back-nest/src/comments/comments.module.ts:1-9`
- Category: Feature correctness / expected behavior
- Evidence:
```ts
async create(projectId: string, userId: string, content: string, parentCommentId?: string) {
  const mentions = this.extractMentions(content);
  const comment = await this.prisma.projectComment.create({
    data: {
      ...
      mentions: mentions.length ? JSON.stringify(mentions) : null,
    },
    ...
  });
  return Result.ok(this.toDto({ ...comment, replies: [] }));
}
...
private extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g);
  return matches ? matches.map((m) => m.slice(1)) : [];
}
```
- Evidence (module, no NotificationsService):
```ts
@Module({
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
```
- Impact: The review prompt explicitly asks whether mention parsing could notify arbitrary userIds. Current code parses mentions (as plain words, not as user IDs — `@\w+` matches `@bob` or `@dead-beef-uuid` partially) but never calls the `NotificationsService`. So the immediate security concern (mention → unauthorized notification) is not exploitable today. However:
  1. If a notification is wired in the future, the regex `/@(\w+)/g` will NOT match UUIDs (hyphens are not `\w`), so the feature will break silently for the real userId format used everywhere else.
  2. Nothing validates that a mentioned username/id actually corresponds to a project member, so when notifications are wired, an attacker will be able to notify any user in the system by mentioning them. Flagging now so the fix is planned before the feature ships.
  3. `mentions: VarChar(500)` can overflow silently — `JSON.stringify(mentions)` is not length-checked before writing; Prisma will throw a 500, but only because of schema constraints, not validation.
- Fix: When wiring notifications, resolve each mention against `AppUser` and against project membership; drop mentions that don't match; cap to a sane limit (e.g. 10 per comment); add a DB-side `@db.VarChar(500)`-aware truncation before write.

---

### [HIGH] No length limit on `content` — large comments hit Prisma/DB
- File: `web/back-nest/src/comments/comments.service.ts:40-72` and schema `ProjectComment.content  String  @db.Text`
- Category: Resource abuse / DoS
- Evidence:
```ts
// comments.controller.ts
async create(@Param('projectId') projectId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
  if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');
  const result = await this.service.create(projectId, user.userId, body.content);
  ...
}
```
- Impact: MySQL `TEXT` column ≈ 65 KB. No server-side cap is applied. A caller can POST a 64 KB body per comment, repeatedly, to inflate the database. Combined with the IDOR above, any user can do this on any project.
- Fix: Reject `content.length > 4000` (or whatever the product limit is) in the DTO via `@MaxLength`, plus server-side trimming. Also consider per-user / per-project rate limit.

---

### [MEDIUM] `user: any` leaks all request-user fields into controller handlers
- File: `web/back-nest/src/comments/comments.controller.ts:19, 34, 42, 49`
- Category: Type safety
- Evidence:
```ts
async create(@Param('projectId') projectId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
```
- Impact: `user.userId` and `user.role === 'Admin'` are accessed on an `any`. A JWT payload change (field renamed `sub` → `id`, or `role` → `roles`) would not produce a compile error and could silently either (a) block all users by making `user.userId` undefined or (b) escalate everyone by always returning `false` for the admin check when the real field is `roles: string[]`. Both are silent failures.
- Fix: Type `@CurrentUser()` with a proper `JwtUser` interface (`{ userId: string; role: Role; email: string; ... }`), align with whatever `JwtStrategy.validate` returns.

---

### [MEDIUM] Admin override on update/delete is based on a JWT-claim string compare
- File: `web/back-nest/src/comments/comments.controller.ts:34-35, 42-43` and `comments.service.ts:55-80`
- Category: Authorization
- Evidence:
```ts
async update(@Param('commentId') commentId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
  const result = await this.service.update(commentId, user.userId, user.role === 'Admin', body.content);
```
```ts
async update(commentId: string, userId: string, isAdmin: boolean, content: string) {
  const c = await this.prisma.projectComment.findFirst({ where: { id: commentId, isDeleted: false } });
  if (!c) return Result.fail<any>('Commentaire non trouvé.');
  if (c.userId !== userId && !isAdmin) return Result.fail<any>('Non autorisé.');
  ...
}
```
- Impact: Admin check goes through the JWT claim `role`. If that claim drifts away from the source-of-truth DB (`AppUser.role`) — e.g. admin gets demoted but still holds a valid JWT — the demoted admin continues to edit/delete other users' comments for up to the JWT lifetime (documented as 7 days). Ownership check (`c.userId !== userId`) is correct; the admin-override check is weak.
- Fix: For sensitive actions, resolve the current role from DB (`AppUser.findUnique` + `role`) rather than trusting the stale JWT claim. Alternatively, shorten JWT lifetime and add proper revocation.

---

### [MEDIUM] `isDeleted` filter on `GET` is not enforced when fetching a single comment's parent in `update`/`delete`
- File: `web/back-nest/src/comments/comments.service.ts:55-81`
- Category: Logic correctness
- Evidence:
```ts
async update(commentId: string, userId: string, isAdmin: boolean, content: string) {
  const c = await this.prisma.projectComment.findFirst({ where: { id: commentId, isDeleted: false } });
  ...
}
```
- Impact: This is correct for the target comment. But when creating a reply (`parentCommentId` passed in), the service never checks that the parent exists, belongs to the same project, or is not soft-deleted. Caller can reply to a deleted comment.
- Fix: Before insert with a non-null `parentCommentId`, load and verify parent.

---

### [MEDIUM] `toDto` / `replies` recursion has no depth bound; data-returned from DB drives recursion
- File: `web/back-nest/src/comments/comments.service.ts:88-102`
- Category: Robustness / DoS
- Evidence:
```ts
private toDto(c: any): any {
  return {
    ...
    replies: (c.replies ?? []).map((r: any) => this.toDto(r)),
    mentions: c.mentions ? JSON.parse(c.mentions) : [],
  };
}
```
- Impact: If a reply ever has replies (nested replies) — which the schema allows (`parentComment ProjectComment?` relation, no depth constraint) — and such rows exist, `toDto` recurses until the fetched tree ends. Prisma includes fetch only one level deep (`replies.include.user`), so in practice `r.replies` will be `undefined` and `(undefined ?? [])` becomes `[]`. But if someone ever extends the include chain, this silently stops at one level. Additionally, `JSON.parse(c.mentions)` throws on malformed JSON — and because `mentions` is stored as a raw `VarChar(500)` written by `JSON.stringify`, if anyone ever writes to the column directly (SQL, seeds, imports) a malformed value, every fetch for that project 500s.
- Fix: `try { JSON.parse(c.mentions) } catch { return [] }`. Enforce depth=1 in both directions (prevent reply-to-reply at insert time).

---

### [MEDIUM] No rate limiting on comment create/update/delete
- File: `web/back-nest/src/comments/comments.controller.ts`
- Category: DoS / abuse
- Evidence: No `@Throttle` decorator, no `ThrottlerGuard`. See earlier grep result confirming zero throttling anywhere in the project.
- Impact: Combined with `GET` IDOR and write IDOR, a single user can spam any project's comment thread. Notification volume (once wired) would amplify.
- Fix: Apply `ThrottlerGuard` at app root with sensible defaults, then tighter per-controller limits on write endpoints.

---

### [LOW] Comments are rendered safely on the frontend (no XSS via `v-html`)
- File: `web/Front/customapp/src/components/pm/CommentItem.vue:12`
- Category: XSS (defensive finding — no bug)
- Evidence:
```html
<!-- View mode -->
<p v-if="!editing" class="comment-text">{{ comment.content }}</p>
```
- Impact: None. `{{ }}` escapes HTML. The grep for `v-html` across the frontend found only `WikiView.vue:40` and `MeetingAiPanel.vue:85` — neither renders comments. So even though the backend stores raw content with no sanitization, the current render path is safe. [INFO] Flagging because the review brief asked us to verify this explicitly. Caveat: if future code adds a markdown renderer with `v-html` for comments, raw stored content becomes stored-XSS — at that point server-side sanitization (e.g. `DOMPurify` or `sanitize-html`) becomes mandatory.
- Fix: None required today. Document in `CLAUDE.md` that comment content is stored raw and must be piped through a sanitizer if ever rendered with `v-html`.

---

### [LOW] `getById` does not scope to projectId even though the route has `:projectId`
- File: `web/back-nest/src/comments/comments.controller.ts:26-31` and `comments.service.ts:25-38`
- Category: Authorization / routing consistency
- Evidence:
```ts
@Get(':commentId')
async getById(@Param('commentId') commentId: string) {
  const result = await this.service.getById(commentId);
  if (result.isFailure) throw new NotFoundException(result.error);
  return result.value;
}
```
```ts
async getById(commentId: string) {
  const c = await this.prisma.projectComment.findFirst({
    where: { id: commentId, isDeleted: false },
    ...
  });
```
- Impact: Route is `GET /api/projects/:projectId/comments/:commentId` but `projectId` is never used. A user can pass any projectId (even a non-existent one) and fetch any comment if they know its UUID. Combined with the IDOR above this doesn't expand access (they could also just `GET /api/projects/<comment's-project>/comments`), but it means the URL shape lies.
- Fix: `findFirst({ where: { id: commentId, projectId, isDeleted: false } })` after validating project access.

---

## Summary matrix

| # | Severity | File | One-liner |
|---|----------|------|-----------|
| 1 | CRITICAL | `collaboration.gateway.ts:116-136` | `join-project` has no project-access check — any JWT can join any room. |
| 2 | CRITICAL | `collaboration.gateway.ts:75-94` | JWT is verified only at connect — revoked tokens keep working. |
| 3 | CRITICAL | `collaboration.gateway.ts:154-185` / `collaboration.service.ts:8-29` | `field-update` writes any project's field values with no authorization. |
| 4 | CRITICAL | `comments.controller.ts:6-53` / `comments.service.ts:9-53` | No project-membership check on any comment endpoint. |
| 5 | HIGH | `collaboration.gateway.ts:154-213` | `field-*` events broadcast without verifying socket joined the room. |
| 6 | HIGH | `collaboration.gateway.ts:187-213` | `field-focus/blur` payloads unvalidated → presence poisoning, stored-XSS precursor. |
| 7 | HIGH | `collaboration.gateway.ts` (global) | No WebSocket rate limiting. |
| 8 | HIGH | `collaboration.gateway.ts:62,96-152` | Presence Map single-instance + can be enumerated/spammed via unchecked `leave-project`. |
| 9 | HIGH | `comments.controller.ts:47-53` / `comments.service.ts:40-53` | Reply endpoint does not confirm `parentCommentId` belongs to `projectId`. |
| 10 | HIGH | `comments.controller.ts:47-53` | Reply endpoint skips empty-content validation and `content` is an interface DTO. |
| 11 | HIGH | `comments.service.ts:40-53,83-86` | Mentions stored but not notified (flag now so future wiring doesn't notify arbitrary users). |
| 12 | HIGH | `comments.service.ts:40-72` + schema | No max-length on `content` → unbounded writes to `TEXT` column. |
| 13 | MEDIUM | `collaboration.gateway.ts:64,236-263` | `userNameCache` unbounded, never invalidated. |
| 14 | MEDIUM | `collaboration.gateway.ts:231-234` | `emitPresenceUpdate` missing null-guard on `this.server`. |
| 15 | MEDIUM | `collaboration.gateway.ts:56` | `cors: { origin: '*' }` on the WS namespace. |
| 16 | MEDIUM | `comments.controller.ts:19-49` | `@CurrentUser() user: any` — JWT shape is not type-checked. |
| 17 | MEDIUM | `comments.controller.ts:34-43` / `comments.service.ts:55-80` | Admin override uses stale JWT claim rather than DB role. |
| 18 | MEDIUM | `comments.service.ts:55-81` | Reply does not verify parent existence / same-project / not-deleted. |
| 19 | MEDIUM | `comments.service.ts:88-102` | `JSON.parse(c.mentions)` can throw; recursion unbounded by design. |
| 20 | MEDIUM | `comments.controller.ts` | No rate limiting on comment writes. |
| 21 | LOW | `collaboration.gateway.ts:130` | Presence color uses only first char of userId. |
| 22 | LOW | `collaboration.gateway.ts:58` | `Logger` declared but never used — abuse invisible. |
| 23 | LOW | `CommentItem.vue:12` | [INFO] Frontend renders via `{{ }}` — not an XSS today but backend stores raw. |
| 24 | LOW | `comments.controller.ts:26-31` / `comments.service.ts:25-38` | `getById` ignores `:projectId` param. |

## Answers to the focus questions (explicit)

1. **Is JWT re-validated on every event, or only once at connect? Can a user whose token was revoked keep sending events?**
   Only once at connect (lines 75-94). [CRITICAL] Revoked/expired tokens keep working for the lifetime of the socket. See finding #2.

2. **`join-project` event: does server verify the user actually has access to that project, or just trust client's `projectId`?**
   Trusts the client entirely. [CRITICAL] Finding #1.

3. **`leave-project`: side-channel info leak via presence map enumeration?**
   Yes — caller can spam `leave-project` with arbitrary `projectId`s, trigger `emitPresenceUpdate` regardless of membership, and observe the emitted list. Finding #8.

4. **In-process presence Map concurrency: can a room be joined twice, or left without joining?**
   Both. `join-project` silently overwrites. `leave-project` runs without checking membership. Finding #8.

5. **Field-update broadcast: does server validate that the editor has write access to the field (not just the project)?**
   Neither project access nor field-level access is validated. Finding #3.

6. **`field-focus` / `field-blur`: can they be spoofed with arbitrary `userId`?**
   `userId` cannot be spoofed (comes from `client.data`, set at connect). But `projectFieldId` can be any string, so the *field being edited* — which is what other users see — can be spoofed. Finding #6.

7. **Disconnect handling: stale presence entries?**
   `handleDisconnect` (lines 96-112) does walk every project and clean up — correct. But: if the server crashes or the socket becomes a zombie and Socket.IO's ping/pong fails to fire `disconnect`, entries will persist until ping timeout. In a multi-instance setup there's no shared state, so entries on a dead instance never get reaped by other instances. Finding #8.

8. **Comments module: markdown render path (server or client?)**
   Backend stores raw content and does NOT sanitize. Frontend renders via `{{ }}` which escapes — so safe today. Finding #23. [UNCERTAIN] if a future markdown/richtext renderer is added, backend sanitization becomes mandatory.

9. **Mention parsing → notifications with arbitrary userId?**
   Mentions are parsed and stored (`comments.service.ts:83-86`) but NO notification is created (module does not import `NotificationsModule`). So not exploitable today — but future wiring would be, as mentions are not validated against project membership. Finding #11.

10. **IDOR on comment update/delete (can user A edit user B's comment?)**
    Update/delete correctly checks `c.userId !== userId && !isAdmin` (finding #17 caveat on admin role freshness). BUT [CRITICAL] *create*, *reply*, and *list* have no project-access check at all, so user A can post/read on any project they're not a member of. Finding #4.

11. **XSS in comment body persisted → rendered via `v-html` on client (flag if raw markdown stored without sanitisation)?**
    Not exploitable today (`{{ }}` render). Raw content IS stored without sanitization. Finding #23.
