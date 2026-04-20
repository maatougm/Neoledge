# Automation & Notifications — Line-by-line QA

Files opened:
- `web/back-nest/src/automation/automation.service.ts`
- `web/back-nest/src/automation/automation.controller.ts`
- `web/back-nest/src/automation/automation.module.ts`
- `web/back-nest/src/automation/dto/automation.dto.ts`
- `web/back-nest/src/notifications/notifications.service.ts`
- `web/back-nest/src/notifications/notifications.controller.ts`
- `web/back-nest/src/notifications/notifications.gateway.ts`
- `web/back-nest/src/notifications/notifications.module.ts`
- `web/back-nest/src/notifications/dto/create-notification.dto.ts`
- `web/back-nest/src/notifications/notifications.service.spec.ts`

Cross-reference files read for caller context (not in primary scope, referenced as evidence only):
- `web/back-nest/src/projects/projects.service.ts` (lines 286, 452 — `executeRulesForEvent` call sites)
- `web/back-nest/src/work-packages/work-packages.service.ts` (lines 227, 286 — caller)
- `web/back-nest/src/agile/agile.service.ts` (line 27 — caller)
- `web/back-nest/src/gantt/gantt.service.ts` (line 97 — caller)
- `web/back-nest/prisma/schema.prisma` (lines 417–438 Notification, 527–546 AutomationRule, 548–561 AutomationLog)

---

## 1. AUTOMATION MODULE

### [CRITICAL] IDOR: `send_notification` action targets arbitrary user IDs
- File: `web/back-nest/src/automation/automation.service.ts:191-218`
- Category: Authorization / IDOR
- Evidence:
```ts
    if (actionType === 'send_notification') {
      let userId = actionConfig['userId'] as string | undefined;
      const message = (actionConfig['message'] as string | undefined) ?? ruleName;

      // Fallback to the project's assigned project manager when userId is not set
      if (!userId) {
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { projectManagerId: true },
        });
        userId = project?.projectManagerId ?? undefined;
      }

      if (!userId) {
        this.logger.debug(`send_notification: no userId and no PM assigned for project ${projectId}; skipping.`);
        return;
      }

      await this.prisma.notification.create({
        data: {
          userId,
          type: 'automation',
          title: ruleName,
          message: message.slice(0, 499),
          projectId,
        },
      });
      return;
    }
```
- Impact: The `userId` in `actionConfig` is never validated as a project member, team member, or even a real user. A PM (or any Admin) can craft a rule whose action notifies any arbitrary `userId` in the database — e.g. another tenant's admin, a disabled user, or an attacker-controlled UUID. Worse, the notification is permanently visible to that target user and inherits the rule's `name` and `message` without sanitization (risk of phishing / spoofed-looking messages from the system's `automation` type).
- Fix: Validate target `userId` exists AND has a legitimate relationship to `projectId` (project manager, team member, watcher of a relevant entity). Reject rules at creation time where `actionConfig.userId` does not belong to the project scope. Also strip HTML / escape the message before storing.

### [CRITICAL] Unbounded / untyped `actionConfig` JSON accepted — prototype-pollution surface
- File: `web/back-nest/src/automation/dto/automation.dto.ts:3-17` + `automation.service.ts:32-48`
- Category: Input validation / deserialization
- Evidence (DTO):
```ts
export class CreateRuleDto {
  @IsString() name!: string;
  @IsString() triggerEvent!: string;
  @IsOptional() @IsObject() triggerCondition?: Record<string, unknown> | null;
  @IsString() actionType!: string;
  @IsObject() actionConfig!: Record<string, unknown>;
}
```
- Evidence (service stores raw):
```ts
    const rule = await this.prisma.automationRule.create({
      data: {
        projectId,
        name: dto.name,
        triggerEvent: dto.triggerEvent,
        triggerCondition: dto.triggerCondition ? JSON.stringify(dto.triggerCondition) : null,
        actionType: dto.actionType,
        actionConfig: JSON.stringify(dto.actionConfig),
      },
    });
```
- Impact: `@IsObject()` accepts any object shape. Neither `triggerEvent` nor `actionType` is validated against an enum of known values, and `actionConfig` has no schema. Callers can store arbitrary keys (including `__proto__`, `constructor`, `prototype`) inside `actionConfig`. The object is later read back via `JSON.parse` (line 142, 263) and handed directly to `executeAction` with `actionConfig[...]` index reads and to `this.prisma.notification.create(...)` / `this.prisma.projectFieldValue.upsert(...)` — Prisma will refuse unknown keys at the DB layer, but downstream consumers of the DTO (frontend, serializers, etc.) see raw unvalidated keys. This also bypasses the Result pattern's error plumbing (malformed JSON silently returns `{}`/`null` in `toRuleDto`).
- Fix: Replace `@IsObject()` with a Zod/class-validator schema whose shape is driven by `actionType` discriminator: `{ actionType: 'send_notification', userId: uuid, message: string<500> }` or `{ actionType: 'update_field', fieldId: uuid, value: string }`. Reject anything else. Reject `triggerEvent` values not in the known enum (`status_changed`, `validation_submitted`, `work_package_created`, `work_package_status_changed`, `milestone_reached`, etc.). `JSON.parse` defaults that silently swallow errors should surface a `failed` log entry at minimum.

### [HIGH] Infinite rule-loop possible: `update_field` action can re-fire rules that trigger on the field change
- File: `web/back-nest/src/automation/automation.service.ts:98-106` + `automation.service.ts:221-236`
- Category: Logic / DoS
- Evidence (dispatcher — no loop guard, no depth budget):
```ts
  async executeRulesForEvent(projectId: string, event: string, context: EventContext) {
    const rules = await this.prisma.automationRule.findMany({
      where: { projectId, triggerEvent: event, isActive: true },
    });

    for (const rule of rules) {
      await this.executeRule(rule, projectId, context);
    }
  }
```
- Evidence (`update_field` upsert):
```ts
    if (actionType === 'update_field') {
      const fieldId = actionConfig['fieldId'] as string | undefined;
      const value = actionConfig['value'] as string | undefined;

      if (!fieldId) {
        this.logger.warn(`update_field: missing fieldId in actionConfig`);
        return;
      }

      await this.prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fieldId } },
        update: { value: value ?? null },
        create: { projectId, projectFieldId: fieldId, value: value ?? null },
      });
      return;
    }
```
- Impact: There is no depth counter, no per-event dedup, and no cycle detection. If a future `triggerEvent` such as `field_updated` is added and a rule responds by calling `update_field` on the same field, the rule will loop until the DB or event loop dies. Even today, two rules on the same event can fire symmetrically: rule A (`status_changed`) sets status, rule B (`status_changed`) observes the new status; if `ProjectsService.changeStatus` emits the event on every update, this cascades.
- Fix: Add a per-invocation `ruleDepth` counter passed through `context`, reject `executeRule` when depth > N (e.g. 5). Maintain a Set of `ruleId`s already fired in this chain. Emit a `failed`/`skipped` log with `loop_detected` detail.

### [HIGH] `executeRulesForEvent` is fire-and-forget (`void` prefix) everywhere — silent failures
- File: `web/back-nest/src/automation/automation.service.ts:98-106`
- Category: Error propagation
- Evidence (caller pattern seen in projects/work-packages/agile/gantt services):
```ts
    void this.automation.executeRulesForEvent(projectId, 'status_changed', { newStatus: status, oldStatus: project.status });
```
(`projects.service.ts:286`, also `projects.service.ts:452`, `work-packages.service.ts:227`, `work-packages.service.ts:286`, `agile.service.ts:27`, `gantt.service.ts:97`)
- Evidence (service itself does not wrap its own exceptions):
```ts
  async executeRulesForEvent(projectId: string, event: string, context: EventContext) {
    const rules = await this.prisma.automationRule.findMany({
      where: { projectId, triggerEvent: event, isActive: true },
    });

    for (const rule of rules) {
      await this.executeRule(rule, projectId, context);
    }
  }
```
- Impact: `void` discards the returned Promise. If `prisma.automationRule.findMany` rejects (DB timeout, connection dropped) the rejection becomes an **unhandled promise rejection** and may crash the Node process under strict flags, or is silently swallowed. Individual `executeRule` calls are wrapped in try/catch, but the outer `findMany` is not. Every call site should use `.catch(err => logger.error(...))`.
- Fix: Either return `Result` and have the caller handle it, or wrap the entire body in a try/catch that logs. Do NOT rely on `void` — use `.catch()` at every call site (consistent with the `AiModule` pattern documented in `CLAUDE.md`).

### [HIGH] PM can create rule on a project they don't manage — controller relies on stale claim
- File: `web/back-nest/src/automation/automation.controller.ts:26-31` + `automation.service.ts:119-125`
- Category: Authorization
- Evidence:
```ts
  private async assertAccess(projectId: string, req: { user: { userId: string; role: string } }) {
    const { userId, role } = req.user;
    if (role === 'Admin') return;
    const allowed = await this.automationService.isProjectManager(projectId, userId);
    if (!allowed) throw new ForbiddenException('Accès refusé à ce projet.');
  }
```
- Evidence (`isProjectManager` checks ONLY `projectManagerId`):
```ts
  async isProjectManager(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false, projectManagerId: userId },
      select: { id: true },
    });
    return project !== null;
  }
```
- Impact: The check passes only if `AppUser.id === Project.projectManagerId`. A user whose JWT claim `role === 'ProjectManager'` but who is not assigned to this specific project will be correctly rejected — good. However, `updateRule`, `deleteRule`, and `toggleRule` call `assertAccess(projectId, ...)` but then call `automationService.updateRule(ruleId, dto)` which **never verifies `ruleId` belongs to `projectId`** (`automation.service.ts:58-76`, `78-84`, `86-96`). An Admin or PM of project A can pass `projectId=A` but `ruleId=<rule-from-project-B>` and freely mutate/delete a foreign rule.
- Fix: `updateRule`, `deleteRule`, `toggleRule` must accept (and verify) `projectId` in the query: `findFirst({ where: { id: ruleId, projectId } })` before mutation.

### [HIGH] `getLogs` does not verify log ownership — any PM can read logs for the project, but the `limit` cap is permissive
- File: `web/back-nest/src/automation/automation.controller.ts:94-104`
- Category: Resource / pagination
- Evidence:
```ts
  @Get('logs')
  async getLogs(
    @Param('projectId') projectId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    await this.assertAccess(projectId, req);
    const result = await this.automationService.getLogs(projectId, Math.min(limit, 200));
    ...
```
- Impact: Access control is correct here (scoped by projectId), but `limit` is clamped to 200 per request. Combined with no offset/cursor, a caller can page only the most recent 200; older logs become unreachable via API — minor UX bug, but operationally there is no purge/retention. See next finding.
- Fix: Offer cursor-based pagination; also add a `from`/`to` date filter for audit purposes.

### [HIGH] `AutomationLog` is unbounded — no retention / cleanup job
- File: `web/back-nest/src/automation/automation.service.ts:242-251` + `schema.prisma:548-561`
- Category: Storage / DoS
- Evidence (service writes one row per rule invocation):
```ts
  private async logExecution(
    ruleId: string,
    projectId: string,
    status: 'success' | 'failed' | 'skipped',
    detail: string | null,
  ) {
    await this.prisma.automationLog.create({
      data: { ruleId, projectId, status, detail },
    });
  }
```
- Evidence (schema — no TTL, no retention):
```prisma
model AutomationLog {
  id         String   @id @default(uuid())
  ruleId     String
  projectId  String
  status     String   @db.VarChar(20)
  detail     String?  @db.VarChar(500)
  executedAt DateTime @default(now())
  ...
}
```
- Impact: Every rule execution writes a log, and combined with the infinite-loop risk above, an attacker (or misconfigured rule) can fill the `AutomationLog` table. Even in normal operation, a PM project with a chatty `work_package_status_changed` rule will accrue thousands of rows/day with no pruning.
- Fix: Add a scheduled job (NestJS `@Cron`) that deletes `AutomationLog` rows older than N days (e.g. 30). Optionally cap total rows per rule.

### [MEDIUM] `evaluateCondition` only supports three operators — `default: return true` silently passes unknown operators
- File: `web/back-nest/src/automation/automation.service.ts:167-183`
- Category: Logic bug
- Evidence:
```ts
  private evaluateCondition(condition: Record<string, unknown>, context: EventContext): boolean {
    const { field, operator, value } = condition as {
      field?: string;
      operator?: string;
      value?: unknown;
    };
    if (!field || !operator) return true;

    const contextValue = context[field];
    switch (operator) {
      case 'equals': return contextValue === value;
      case 'not_equals': return contextValue !== value;
      case 'contains':
        return typeof contextValue === 'string' && contextValue.includes(String(value));
      default: return true;
    }
  }
```
- Impact: A user-supplied operator like `"never"` or a typo like `"equal"` falls into `default: return true`, meaning the condition **always passes** and the rule fires for every event. This is a fail-open posture — the operator should default to FALSE (or the rule should be marked failed) when the operator is unknown.
- Fix: `default: this.logger.warn(...); return false;` — fail-closed. Also reject unknown operators at rule-creation time via DTO validation.

### [MEDIUM] `context[field]` access enables prototype-key lookup (`__proto__`, `constructor`)
- File: `web/back-nest/src/automation/automation.service.ts:175`
- Category: Prototype pollution (read-side)
- Evidence:
```ts
    const contextValue = context[field];
```
- Impact: `field` comes straight from `triggerCondition` JSON stored on the rule. A malicious rule author can set `field: "__proto__"` and `value: "[object Object]"` — `context["__proto__"]` returns `Object.prototype`, which triggers `equals` to compare against strings, generally returning false. The exploit is low because `contextValue` is only compared (not written back), but combined with the unchecked `value` in the `update_field` action, a malicious `actionConfig.fieldId` with a prototype-like string will become the DB key — Prisma prevents this at the query layer (`projectFieldId` is a FK), but robustness requires explicit allow-listing.
- Fix: Use `Object.hasOwn(context, field)` before accessing, or switch to `Map<string, unknown>` for the context, and validate `field` against `/^[a-zA-Z0-9_]+$/`.

### [MEDIUM] `toRuleDto` returns parsed JSON silently — invalid JSON becomes `null`/`{}` without logs
- File: `web/back-nest/src/automation/automation.service.ts:253-269`
- Category: Data integrity
- Evidence:
```ts
  private toRuleDto(rule: AutomationRule) {
    return {
      id: rule.id,
      ...
      triggerCondition: rule.triggerCondition
        ? (() => { try { return JSON.parse(rule.triggerCondition); } catch { return null; } })()
        : null,
      actionType: rule.actionType,
      actionConfig: (() => { try { return JSON.parse(rule.actionConfig); } catch { return {}; } })(),
      ...
    };
  }
```
- Impact: If a rule's JSON is corrupted in the DB (schema migration, manual SQL edit), the frontend sees an empty `{}` actionConfig with no error surfaced. Operator has no idea the rule is broken. This hides the infinite-loop sibling bug where `actionConfig` silently becomes `{}` in `executeRule` line 143 as well.
- Fix: Log a warning whenever JSON.parse fails on a stored rule; return a flag like `configCorrupted: true` in the DTO.

### [LOW] `message.slice(0, 499)` is mid-UTF8 — can break emoji
- File: `web/back-nest/src/automation/automation.service.ts:214`
- Category: Encoding
- Evidence:
```ts
          message: message.slice(0, 499),
```
- Impact: `String.prototype.slice` cuts UTF-16 code units; a trailing emoji can become a lone surrogate. The DB column is `VARCHAR(500)` so this is purely cosmetic, but it can break mobile rendering.
- Fix: Truncate on grapheme boundary using `Intl.Segmenter` or simpler: slice to 490 chars then trim trailing surrogate half if `charCodeAt` is in the high-surrogate range.

### [LOW] `createRule` does not validate `triggerEvent` or `actionType` against known values
- File: `web/back-nest/src/automation/automation.service.ts:32-48`
- Category: Data integrity
- Evidence: already quoted above. `dto.triggerEvent` and `dto.actionType` are plain strings.
- Impact: A rule can be created with `triggerEvent: "nonsense_event"` that will never match any emission — the user sees a rule in the list that never fires, no warning. Equally, `actionType: "exec_ssh"` is stored and later causes `executeAction` line 238-239 to throw, which is logged — but the rule persists forever.
- Fix: Add `@IsIn([...])` class-validator on both fields listing the canonical set.

---

## 2. NOTIFICATIONS MODULE

### [CRITICAL] `NotificationsService.create()` trusts caller-supplied `userId` with no scope check
- File: `web/back-nest/src/notifications/notifications.service.ts:32-47`
- Category: Authorization / IDOR
- Evidence:
```ts
  async create(userId: string, dto: CreateNotificationDto): Promise<Result<NotificationRecord>> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: dto.type,
          title: dto.title,
          message: dto.message,
          projectId: dto.projectId ?? null,
        },
      });
      return Result.ok(notification);
    } catch {
      return Result.fail('Impossible de créer la notification.');
    }
  }
```
- Impact: The `create()` method accepts any `userId` and any `projectId`. There is no HTTP route that calls this method (it's only invoked internally), but **any future caller** — or a code path that accidentally exposes it — will bypass project scope: the caller can inject notifications into any user's inbox citing any project. `notifyEnhanced` (line 104-136) has the same issue. The internal `notify` (line 55-97) is called from work-packages service (`work-packages.service.ts:67,213,263`) with untrusted `userId` derived from `assigneeId`/`watcherId` with no verification those users are project members.
- Fix: Either remove the public `create()` method (it isn't exposed via controller), or require a `projectMemberCheck(userId, projectId)` inside both `create` and `notifyEnhanced`. In `notify`, verify the target user has a legitimate relationship (assignee, watcher, PM) to `projectId` before creating.

### [CRITICAL] WebSocket auth is verified on CONNECT only — token never re-validated on events
- File: `web/back-nest/src/notifications/notifications.gateway.ts:30-45`
- Category: Auth / session
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
      const payload = this.jwtService.verify<{ sub: string }>(token, { secret });
      void client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {}
```
- Impact:
  1. **No token expiry enforcement during session.** If the JWT expires mid-session (JWT_EXPIRES_IN=7d per CLAUDE.md), the user remains subscribed to their notification room forever. Logout on one device does not stop notifications being pushed to other sockets holding a now-expired token.
  2. **`jwtService.verify` uses fallback secret `'dev-secret-change-me'`** if `JWT_SECRET` env var is missing. In dev/staging where env is incomplete this accepts tokens signed with the fallback secret.
  3. **No revocation list.** A leaked token grants permanent WS access until natural expiry.
- Fix: Remove the fallback secret (let startup fail loud if `JWT_SECRET` absent — the `auth.module.ts` already reads the same secret; reuse that config). Add a periodic check, or re-verify the token on each sensitive subscription. Maintain a revocation list keyed on `jti` and check on every event.

### [CRITICAL] Room name equals `user:${payload.sub}` — no cross-check that `sub` is an actual AppUser
- File: `web/back-nest/src/notifications/notifications.gateway.ts:38-39`
- Category: Auth
- Evidence:
```ts
      const payload = this.jwtService.verify<{ sub: string }>(token, { secret });
      void client.join(`user:${payload.sub}`);
```
- Impact: Whatever the `sub` claim contains becomes the room name. If an attacker gets a signed token (e.g. stolen, or during earlier session-fixation attack), they can subscribe to the room for user B and receive user B's notifications — the server does not verify `sub` maps to an existing, active AppUser. Combined with the 7-day JWT lifetime in CLAUDE.md and the fallback-secret issue above, this is a session-hijack amplifier. Also, because the server emits to `user:${userId}` everywhere it **trusts the `userId` string in the emit** — see `emitToUser` line 47. If an attacker can guess/know another user's UUID, just having a token for `sub=<any-valid-value-they-signed>` lets them join that user's room **if** they can pass JWT verification (which requires the real secret, mitigating but not eliminating).
- Fix: In `handleConnection`, after verifying the token, fetch `AppUser` by `payload.sub` and confirm it exists and is active; disconnect otherwise. Consider binding each socket to a short-lived per-session token rather than the long-lived JWT.

### [HIGH] Socket.IO CORS origin is a wildcard `*`
- File: `web/back-nest/src/notifications/notifications.gateway.ts:21`
- Category: CSRF / CORS
- Evidence:
```ts
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
```
- Impact: Any origin can open a WebSocket to the notifications gateway. The JWT check blocks unauthenticated access, but a malicious site in the victim's browser can attempt to connect with a stolen token (e.g. from localStorage via XSS) and stream notifications. Stricter CORS is a defense-in-depth layer.
- Fix: Read allowed origins from `ConfigService` (the same list the REST API enforces) and echo them here.

### [HIGH] `notify()` and `notifyEnhanced()` swallow all errors silently, including email failures — no visibility
- File: `web/back-nest/src/notifications/notifications.service.ts:55-97` + `104-136`
- Category: Observability / error handling
- Evidence:
```ts
    // 1. Persist in-app notification
    let created: NotificationPayload | null = null;
    try {
      created = await this.prisma.notification.create({
        data: { userId, type, title, message, projectId: projectId ?? null },
      }) as NotificationPayload;
    } catch {
      // Intentionally swallowed — notification failure must never break business logic
    }
    ...
    try {
      ...
      if (wantsEmail) {
        const html = buildGenericHtml(title, message);
        await this.mail.send(user.email, title, html);
      }
    } catch {
      // Intentionally swallowed — email failure must never break business logic
    }
```
- Impact: Failures (DB, SMTP) are completely invisible. Ops has no signal that notifications are failing. The `common/coding-style.md` rule `Never silently swallow errors` is violated — the comment acknowledges this but there's no `logger.error(...)` call. Also, if `prisma.notification.create` fails, `created` stays null so `this.gateway.emitToUser` is skipped — that is correct — but the user in `notifyEnhanced` line 132-133 returns early, skipping the gateway emit even when the in-app row already exists in a partial-failure scenario (`created` is null because the cast threw after the row was written). Extremely narrow, but represents state drift.
- Fix: `catch (err) { this.logger.error('notify failed', err); }`. Inject `Logger`. Add a Prometheus counter if observability exists.

### [HIGH] `notifyEnhanced` is called fire-and-forget (`void`) from work-packages — unhandled rejections
- File: `web/back-nest/src/work-packages/work-packages.service.ts:67,213,263`
- Category: Error propagation (same class as automation fire-and-forget)
- Evidence (sampled):
```ts
        void this.notifications.notifyEnhanced({
```
- Impact: Same class of issue as `executeRulesForEvent` — the Promise is discarded. `notifyEnhanced` swallows its own errors (see previous finding) so nothing leaks, but if the method is ever refactored to throw, every call site will leak unhandled rejections. Defensive coding: caller should use `.catch(err => logger.error(...))` or the method should make its swallow guarantee explicit in the type system (e.g. never reject).
- Fix: Annotate `notifyEnhanced` return as `Promise<void>` with a JSDoc contract `@throws Never` and have ESLint enforce. Or, standardize on `.catch()` at every call site.

### [HIGH] `message` / `title` not HTML-escaped before insertion into the email template
- File: `web/back-nest/src/notifications/notifications.service.ts:212-236`
- Category: XSS (email)
- Evidence:
```ts
function buildGenericHtml(title: string, message: string): string {
  const BRAND = '#0d9488';
  return `<!DOCTYPE html>
...
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#111827;">${title}</h2>
          <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${message}</p>
...
```
- Impact: `title` and `message` are injected into HTML via template literals with NO escaping. If `title` comes from a rule name (PM-editable) or from a WP summary (untrusted), an attacker can embed `<img onerror=...>` or `<script>` (most modern email clients strip scripts, but many render `<img onerror>` silently hitting tracker URLs). With `automation send_notification`, a malicious rule author sets `name: "Alert <img src=x onerror='fetch(...)'>"` and the target receives an email with an exfiltration vector.
- Fix: HTML-escape both `title` and `message` before substitution: replace `&<>"'` with entity equivalents. Use a battle-tested function like `escape-html` from npm.

### [HIGH] `emitToUser` swallows errors — gateway failures are invisible
- File: `web/back-nest/src/notifications/notifications.gateway.ts:47-53`
- Category: Observability
- Evidence:
```ts
  emitToUser(userId: string, payload: NotificationPayload): void {
    try {
      this.server.to(`user:${userId}`).emit('notification', payload);
    } catch {
      /* best-effort */
    }
  }
```
- Impact: If `this.server` is undefined (gateway not yet initialized) or emit fails, it's silent. In the fire-and-forget code path, the caller never knows the notification failed to deliver in real-time.
- Fix: Log the failure with `this.logger?.warn(...)`. Add a metric. Consider re-emit / retry.

### [MEDIUM] `NotificationsService.create` is not exposed via controller but is still public API
- File: `web/back-nest/src/notifications/notifications.service.ts:32-47` + `notifications.controller.ts:22-61`
- Category: API surface hygiene
- Evidence: Controller has no `POST /notifications` route; only internal callers use `create`. But the method is `public`, called nowhere via Grep outside the module itself. [UNCERTAIN — dead-code check not exhaustive across entire repo, but no controller wires it.]
- Impact: Dead / semi-dead surface is a maintenance hazard — future devs may wire it to a route without realizing no authorization wrapper exists. It accepts any `userId` and trusts the caller.
- Fix: Either delete `create()` (replace callers with `notify` / `notifyEnhanced`), or make it `private`.

### [MEDIUM] `getForUser` returns max 50 with no pagination — older notifications inaccessible
- File: `web/back-nest/src/notifications/notifications.service.ts:138-149`
- Category: API completeness
- Evidence:
```ts
  async getForUser(userId: string): Promise<Result<NotificationRecord[]>> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        take: 50,
      });
      return Result.ok(notifications);
    } catch {
      return Result.fail('Impossible de récupérer les notifications.');
    }
  }
```
- Impact: User sees only the 50 most-recent-unread-then-recent-read notifications. There's no way to page further; history is effectively capped from the UI's perspective. No cleanup job, so old notifications accumulate in DB but are unreachable.
- Fix: Add `cursor`/`skip`/`take` pagination parameters.

### [MEDIUM] `NotificationPayload` interface on gateway does not include `reason`, `entityType`, `entityId`, `actorId`, `link`
- File: `web/back-nest/src/notifications/notifications.gateway.ts:11-19`
- Category: Type drift / functionality loss
- Evidence (gateway type):
```ts
export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: Date;
}
```
- Evidence (schema has these fields — `schema.prisma:417-438`):
```prisma
  reason     String   @default("system") @db.VarChar(40)
  entityType String?  @db.VarChar(40)
  entityId   String?
  actorId    String?
  link       String?  @db.VarChar(500)
```
- Impact: When `notifyEnhanced` casts the created Prisma row via `as NotificationPayload` (`notifications.service.ts:131`), the extra fields `reason`/`entityType`/`entityId`/`actorId`/`link` ARE included in the object Prisma returned, but TypeScript drops them from the declared payload type. Receivers of the socket event see partial data in the type, and any frontend code relying on `reason` etc. to render a contextual notification has to duplicate the shape definition — drift risk. The `as` cast also silences TS.
- Fix: Extend `NotificationPayload` to match the schema; remove the `as` cast in favor of proper typing.

### [MEDIUM] `notifications.controller.ts` has no rate limit — enumeration attack vector on `markAsRead`/`delete`
- File: `web/back-nest/src/notifications/notifications.controller.ts:41-60`
- Category: Enumeration / abuse
- Evidence:
```ts
  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const result = await this.service.markAsRead(id, user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const result = await this.service.delete(id, user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }
```
- Impact: Service correctly scopes by userId (returns `Notification non trouvée` when mismatch — spec test `delete belongs to attacker` confirms). Good. However, there's no throttling on the route — a malicious user could enumerate their own notification ids in bulk, or brute-force UUIDs trying to trigger different behavior. Low real-world impact because of the scope check, but add a throttle.
- Fix: Apply NestJS `@Throttle()` via `@nestjs/throttler`.

### [LOW] Email template uses unsanitized `BRAND` as CSS property — const string, currently safe
- File: `web/back-nest/src/notifications/notifications.service.ts:213`
- Category: XSS (theoretical)
- Evidence:
```ts
  const BRAND = '#0d9488';
```
- Impact: Hard-coded constant, no injection possible today. Noting only because if this ever becomes a runtime-configurable value, CSS-injection becomes a concern.
- Fix: Keep as `const`; do not expose to runtime config without sanitization.

### [LOW] `parsePreferences` casts `parsed as UserPreferences` without field-level validation
- File: `web/back-nest/src/notifications/notifications.service.ts:199-210`
- Category: Type safety
- Evidence:
```ts
function parsePreferences(raw: string | null | undefined): UserPreferences {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as UserPreferences;
    }
  } catch {
    // Malformed JSON — treat as empty preferences
  }
  return {};
}
```
- Impact: `emailNotifications` is expected to be boolean, but `parsed as UserPreferences` trusts the cast. If a malformed row stores `emailNotifications: "yes"` (string), the check `prefs.emailNotifications !== false` passes as truthy, which is probably the desired behavior — low impact — but strictly this is unchecked.
- Fix: Use Zod to parse the preferences JSON; default emailNotifications to `true` on any parse failure.

### [LOW] Spec file uses `jest.Mock` but tests are not run against the gateway (coverage gap)
- File: `web/back-nest/src/notifications/notifications.service.spec.ts:47-60`
- Category: Test coverage
- Evidence: Module `TestingModule` does not provide `NotificationsGateway`. Since the constructor uses `@Optional()`, the service gets `null` and `emitToUser` is never exercised in tests.
- Impact: Real-time gateway emit path has zero unit test coverage. [UNCERTAIN — no gateway-specific spec file found in the directory listing.]
- Fix: Add a spec that provides a mock `NotificationsGateway` and asserts `emitToUser` is called on successful persist.

---

## 3. MODULE WIRING

### [LOW] `NotificationsGateway` is a provider but not exported — services in other modules cannot inject it directly, must go through `NotificationsService`
- File: `web/back-nest/src/notifications/notifications.module.ts:8-13`
- Category: Architecture
- Evidence:
```ts
@Module({
  imports: [MailModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
```
- Impact: Correct encapsulation. Gateway is private to module — other modules must funnel through the service. [UNCERTAIN — if any future module wants to emit raw events (e.g. typing indicators), this gateway can't be reached directly.]
- Fix: None needed unless new requirements appear.

### [LOW] `AutomationModule` does not import `NotificationsModule` — creates notifications via raw Prisma
- File: `web/back-nest/src/automation/automation.module.ts:5-10` + `automation.service.ts:209-217`
- Category: Architecture
- Evidence (module wiring):
```ts
@Module({
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
```
- Evidence (service bypasses NotificationsService):
```ts
      await this.prisma.notification.create({
        data: {
          userId,
          type: 'automation',
          title: ruleName,
          message: message.slice(0, 499),
          projectId,
        },
      });
```
- Impact: `send_notification` action writes to the `Notification` table directly instead of calling `NotificationsService.notifyEnhanced()`. Consequence: real-time Socket.IO emit via `emitToUser` is **skipped**, and the recipient gets the notification only on next REST refresh. Also bypasses email delivery — recipients of automation notifications never get an email even if they've opted in. This violates the documented `send_notification` contract ("creates Notification row" — from `CLAUDE.md`: correct — but the socket/email side effect is lost).
- Fix: Import `NotificationsModule` into `AutomationModule`, inject `NotificationsService`, and call `notifications.notifyEnhanced({...})` with `reason: 'System'`.

---

## Summary of Highest-Priority Fixes

1. **CRITICAL — `actionConfig.userId` IDOR**: validate target user belongs to project scope before sending notification (line 191-217).
2. **CRITICAL — WebSocket auth**: remove fallback JWT secret, verify `sub` corresponds to active AppUser on connect, consider per-event re-check (gateway line 30-43).
3. **CRITICAL — `NotificationsService.create` trusts caller-supplied userId**: enforce project scope OR remove the unused public method (service line 32-47).
4. **HIGH — Rule-loop protection**: add depth counter + cycle detection to `executeRulesForEvent` (service line 98-106).
5. **HIGH — Fire-and-forget `executeRulesForEvent`/`notifyEnhanced`**: replace `void` with `.catch(err => logger.error(...))` at all 6 call sites.
6. **HIGH — `updateRule`/`deleteRule`/`toggleRule` don't verify `ruleId ∈ projectId`**: add cross-check.
7. **HIGH — HTML escaping in email template**: escape `title`/`message` in `buildGenericHtml`.
8. **HIGH — `AutomationLog` unbounded**: add retention job.
9. **HIGH — `AutomationModule` bypasses `NotificationsService`**: route `send_notification` through `notifyEnhanced` to restore WS + email side effects.
10. **MEDIUM — `evaluateCondition` fail-open on unknown operator**: flip default to `false`.
