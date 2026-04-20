# Phase 9 Fix Pass — Automation & Notifications

**Date:** 2026-04-20  
**Branch:** nest-back  
**Build status after fixes:** GREEN

---

## Pre-existing (already done — verified)

| # | Fix | Status |
|---|-----|--------|
| 1 | `send_notification` IDOR — `assertProjectMember` called at rule creation AND at execution time | Already done |
| 2 | Depth guard — `AsyncLocalStorage<RuleExecutionFrame>` + `MAX_RULE_DEPTH = 3` fully wired in `executeRulesForEvent` | Already done |
| 4 | `updateRule` / `deleteRule` / `toggleRule` — `findFirst({ where: { id: ruleId, projectId } })` before mutation | Already done |
| 10 | `evaluateCondition` unknown operator — `default: return false` + `logger.warn` | Already done |
| 11 | `toRuleDto` JSON parse failure — `logger.warn/error` on both `triggerCondition` and `actionConfig`; `configCorrupted: true` flag returned | Already done |
| 12 | `message.slice(0, 499)` UTF-8 safety — replaced with `safeTruncate()` using `Array.from` | Already done |

---

## Applied in this pass

### Fix 3 — Fire-and-forget `.catch()` on all `executeRulesForEvent` call sites

**Files:** `work-packages.service.ts` (lines 227, 286), `gantt.service.ts` (line 160), `agile.service.ts` (line 38)

`projects.service.ts` call sites were already using `.catch(e => this.logger.error(...))`. The remaining four call sites now follow the same pattern:

```ts
void this.automation.executeRulesForEvent(...).catch((e) => this.logger.error('automation X failed', e));
```

---

### Fix 5 — `AutomationLog` retention cleanup job

**New file:** `src/automation/automation-cleanup.service.ts`

A `@Cron('0 3 * * *')` method deletes `AutomationLog` rows where `executedAt < now - 90 days`. Errors are logged, never thrown.

**`automation.module.ts`:** Added `ScheduleModule.forRoot()` import and `AutomationCleanupService` provider.

---

### Fix 6 — `NotificationsService.notify()` project scope check + self-notify skip

`notify()` now:
1. Returns early when `actorId === userId` (self-notify skip).
2. When `projectId` is provided, verifies the target user is either the project manager (`Project.projectManagerId`) or has a `UserRoleAssignment` for the project (or a global one). Logs a warning and returns if not a member. On check failure (DB error) it fails open and proceeds rather than dropping the notification.

The method signature gained an optional `actorId` parameter (non-breaking — existing callers pass nothing).

---

### Fix 7 — Replace bare `.catch(() => {})` in notifications

**`notifications.service.ts`:**
- Added `private readonly logger = new Logger(NotificationsService.name)`.
- `notify()`: bare `catch {}` blocks replaced with `catch(e) { this.logger.error(..., e) }`.
- `notifyEnhanced()`: bare `catch { return; }` replaced with `catch(e) { this.logger.error(..., e); return; }`.

**`notifications.gateway.ts`:**
- Added `private readonly logger = new Logger(NotificationsGateway.name)`.
- `emitToUser()`: bare `catch { /* best-effort */ }` replaced with `catch(e) { this.logger.error(..., e) }`.

---

### Fix 8 — `notifyEnhanced` fire-and-forget `.catch()` from work-packages

**`work-packages.service.ts`** — three call sites (assignee on create, assignee on reassign, watcher loop) now have `.catch((e) => this.logger.error(..., e))`.

---

### Fix 6b — `notifyEnhanced()` project scope check + self-notify skip

Same self-notify and project-member checks applied to `notifyEnhanced`, mirroring `notify()`.

---

### Fix 9 — HTML escape user-supplied strings in email templates

**`src/mail/mail.templates.ts`:**  
Added local `escapeHtml(text)` helper (`& < > " '` → entities). Applied to all user-controlled parameters in every exported template function:
- `projectAssignedEmail`: `projectName`, `managerName`
- `statusChangedEmail`: `projectName`, `oldStatus`, `newStatus`
- `deadlineWarningEmail`: `projectName`, `endDate`
- `phaseValidationEmail`: `projectName`, `phase`, `approvedBy`
- `commentMentionEmail`: `projectName`, `commenterName`, `commentPreview`
- `passwordResetEmail`: `tempPassword`

**`src/notifications/notifications.service.ts`:**  
Added same `escapeHtml()` helper and applied to `title` / `message` in `buildGenericHtml()`.

---

### Fix 13 — `getForUser` cursor-based pagination

**`notifications.service.ts`:**  
`getForUser(userId, { cursor?, take? })` now returns `{ items, nextCursor }`. Max `take` capped at 100. When `hasMore`, `nextCursor` holds the last item's `id`.

**`notifications.controller.ts`:**  
`GET /notifications` now accepts `?cursor=<id>&take=<n>` query params and forwards them to the service. Old callers that read `result.value` directly receive `{ items: [...], nextCursor: null|string }` — a minor API shape change; frontend stores should destructure `.items`.

---

## Remaining (out of scope for this pass)

- WebSocket CORS wildcard (`*`) → per-env origin list (Sprint 3 websocket hardening already restricts via `CORS_ORIGINS` env var — verified done).
- WS token expiry not enforced mid-session / no revocation list — `sessionCache` with 30 s TTL is in place; full revocation list is a separate feature.
- `NotificationsService.create()` is still public — can be made private in a separate refactor (no controller exposes it; marked in QA for future cleanup).
- `@Throttle()` on notifications controller — requires `ThrottlerModule` wiring; left for a rate-limiting pass.
- Gateway `NotificationPayload` interface does not include v2.0 fields (`reason`, `entityType`, etc.) — type-only drift, no runtime impact; can be updated in a frontend alignment pass.
