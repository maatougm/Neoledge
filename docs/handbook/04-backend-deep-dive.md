# 4 — Backend Deep Dive (NestJS)

> Goal: after this, you can open any backend folder and know what you're looking at, even if you've never used NestJS.

## The shape of every feature: the module

The backend lives in `web/back-nest/src/`. It's split into ~35 **modules**, one per feature. Each module folder looks the same:

```
projects/
  projects.module.ts        ← registration ("this feature exists, here are its parts")
  projects.controller.ts    ← the URLs (routes) for this feature
  projects.service.ts       ← the actual logic
  projects.service.spec.ts  ← unit tests
  dto/                       ← "Data Transfer Objects": shapes of request bodies
```

Modules you'll see: `auth`, `users`, `projects`, `project-members`, `work-packages`, `agile` (boards/sprints), `gantt`, `meetings`, `cahier-des-charges`, `ai`, `ai-usage`, `notifications`, `collaboration`, `analytics`, `system-status`, `audit`, and more. Every module is registered in `app.module.ts`.

**Why this matters:** learn one module and you understand all of them. They all follow Controller → Service → Prisma.

---

## The three layers (and the strict rule between them)

### 1. Controller — routing only, no logic
A controller maps a URL to a method and immediately delegates to a service. Example mental model:
```ts
@Controller('pm/projects/:id')
class ... {
  @Get('cahier-des-charges/preview')
  preview(@Param('id') id) { return this.service.preview(id) }  // delegate, nothing else
}
```
Controllers also translate the service's outcome into HTTP status codes (200, 400, 404).

### 2. Service — ALL business logic
Everything meaningful happens here: reading/writing the database, calling the AI, enforcing rules. Services are where you go to understand *what the app does*.

### 3. Prisma — database access
Services call Prisma to read/write Postgres with typed queries.

---

## The most important convention: the **Result pattern**

This is the #1 thing a newcomer must understand about our backend.

**The rule:** services **never `throw`** for business problems. They **return** a `Result` — either `Result.ok(data)` (success) or `Result.fail(message)` (a known failure like "not found" or "not allowed"). The controller inspects the Result and maps it to the right HTTP error.

```ts
// in a service
if (!project) return Result.fail('Projet non trouvé.')
return Result.ok(project)

// in the controller
const r = await this.service.getById(id)
if (r.isFailure) throw new NotFoundException(r.error)
return r.value
```

**Why we do this:**
- **Predictable error handling** — business failures are *values*, not exceptions, so they can't be silently swallowed.
- **Clean controllers** — the controller decides the HTTP mapping in one place.
- *Exceptions are reserved for truly exceptional/unexpected situations* (a crash, a bug), which the global exception filter catches and logs.

If you remember one thing about the backend: **services return `Result.ok` / `Result.fail`, never throw.**

---

## Security: the guard stack

Before a request reaches a controller, **guards** run in order. They are the security gates:

| Guard | Question it answers | Failure |
|-------|---------------------|---------|
| `JwtAuthGuard` | Is the login token valid? | 401 Unauthorized |
| `ProjectAccessGuard` | Can *this user* access *this specific project*? | 403 Forbidden |
| `PermissionsGuard` | Does the role have permission for this action? | 403 Forbidden |
| `RolesGuard` | Is the user one of the allowed roles? | 403 Forbidden |

**Critical detail — `ProjectAccessGuard`:** for non-Admins it does **not** accept a global role as proof of access. A user must be the project's PM, be in the project's member list, or have a project-scoped assignment. This closes a security hole (called an **IDOR**) where someone with a leaked global role could read *every* project. Any project-scoped route uses `@ProjectAccess('paramName')` to name which URL parameter is the project id.

---

## DTOs are **classes**, never interfaces (a real gotcha)

A **DTO** (Data Transfer Object) defines the shape of an incoming request body, with validation rules:
```ts
class CreateProjectDto {
  @IsString() name!: string
  @IsString() clientName!: string
}
```
**The rule:** DTOs used with `@Body()` must be **classes** (not TypeScript `interface` or `type`). Reason: the validation system (`ValidationPipe`) reads the validation rules at *runtime* via class metadata. TypeScript `interface`s vanish when compiled, so an interface-DTO would have its fields silently stripped. This is a subtle bug-source the team explicitly guards against.

---

## Real-time: gateways

For WebSocket features, NestJS uses **gateways** (the WebSocket equivalent of controllers). There are gateways for `/notifications`, `/collaboration`, and `/copilot`. They authenticate the socket using the same JWT (passed in the connection handshake).

> **Caveat to know:** the collaboration presence (who's online, who's editing) is held *in memory* in the backend process. That means it works for a single backend instance but would need a shared store (like Redis) to scale to multiple instances. It's a known, documented limitation.

---

## Cross-cutting pieces worth naming

- **`common/`** — shared helpers: the `Result` class, guards, decorators, the PII-redaction utility, the in-memory error tracker (feeds the admin system dashboard).
- **`prisma/`** — the global database client module (marked `@Global()` so every module can inject it without re-importing).
- **`ai-usage/`** — logs every LLM call (tokens, cost, duration) and enforces a per-project daily token budget.
- **`audit/`** — writes an `AuditLog` row for security-relevant actions (logins, creates, deletes, status changes) with before→after diffs.
- **Logging** — uses `nestjs-pino` (structured JSON logs). In non-production it pretty-prints; in production it emits JSON.

---

## How the backend boots (production)

1. The Docker container starts.
2. It runs `prisma migrate deploy` — applies any new database migrations safely.
3. It starts the NestJS server on port 5122.
4. On startup it logs the resolved AI config (provider/model/key-present) so misconfiguration is caught immediately.

---

## Cheat-sheet: "where do I look for X?"

| I want to understand… | Open… |
|------------------------|-------|
| login / tokens / 2FA | `src/auth/` |
| project CRUD + access rules | `src/projects/` |
| the cahier des charges generation | `src/cahier-des-charges/` |
| the AI agent + backlog + suggestions | `src/ai/` |
| meetings + live transcription | `src/meetings/` |
| tasks / Kanban / sprints | `src/work-packages/`, `src/agile/` |
| the database shape | `prisma/schema.prisma` |
| global rules + gotchas | `CLAUDE.md` (repo root) |

Next: **[05-frontend-deep-dive.md](./05-frontend-deep-dive.md)**.
