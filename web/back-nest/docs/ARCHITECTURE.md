# NestJS Backend Architecture

**Last Updated:** April 9, 2026
**Version:** 2.0.0

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (Vue 3 SPA)                        │
│                  web/Front/customapp                            │
└────────────────────┬──────────────────────────────────────────┘
                     │
                ┌────┴─────────────────────────────────────┐
                │                                          │
         ┌──────▼──────────┐                    ┌──────────▼─────┐
         │  HTTP API       │                    │ WebSocket      │
         │  Port 5122      │                    │ /notifications │
         │  REST Endpoints │                    │ Socket.IO      │
         └────────┬────────┘                    └────────┬───────┘
                  │                                      │
         ┌────────▼──────────────────────────────────────▼────────┐
         │                                                        │
         │          NestJS Application (port 5122)               │
         │                                                        │
         │  ┌────────────────────────────────────────────────┐   │
         │  │ Authentication & Guards                        │   │
         │  │ - JwtAuthGuard on protected routes             │   │
         │  │ - JWT strategy via Passport                    │   │
         │  └────────────────────────────────────────────────┘   │
         │                  ▲                                     │
         │  ┌───────────────┼────────────────────────────────┐   │
         │  │               │                                │   │
         │  │  ┌────────────┴──────────┐   ┌────────────┐   │   │
         │  │  │ API Controllers       │   │ WebSocket  │   │   │
         │  │  │ - Auth                │   │ Gateway    │   │   │
         │  │  │ - Users               │   │ - JWT auth │   │   │
         │  │  │ - Projects            │   │ - Rooms    │   │   │
         │  │  │ - Notifications       │   │ - Emit     │   │   │
         │  │  │ - Checklists          │   │   events   │   │   │
         │  │  │ - Audit               │   └────────────┘   │   │
         │  │  │ - etc.                │                    │   │
         │  │  └────────────┬──────────┘                    │   │
         │  └───────────────┼────────────────────────────────┘   │
         │                  │                                     │
         │  ┌───────────────▼────────────────────────────────┐   │
         │  │ Application Services                           │   │
         │  │ - AuthService         (JWT, 2FA)              │   │
         │  │ - UsersService        (CRUD)                  │   │
         │  │ - ProjectsService     (CRUD + status flow)    │   │
         │  │ - NotificationsService (in-app + email)       │   │
         │  │ - AuditService        (fire-and-forget)       │   │
         │  │ - ChecklistsService   (CRUD + progress)       │   │
         │  │ - MailService         (SMTP wrapper)          │   │
         │  │ - [11 other feature services]                 │   │
         │  └────────────────┬─────────────────────────────┘   │
         │                   │                                   │
         │  ┌────────────────▼──────────────────────────────┐   │
         │  │ Prisma ORM Layer                              │   │
         │  │ - Repository pattern (implicit via Prisma)   │   │
         │  │ - Query builder                              │   │
         │  └────────────────┬──────────────────────────────┘   │
         │                   │                                   │
         └───────────────────┼───────────────────────────────────┘
                             │
         ┌───────────────────▼──────────────────────────┐
         │                                              │
         │        MariaDB 10.5+ (Port 3306)             │
         │                                              │
         │  Tables:                                     │
         │  - AppUsers                                  │
         │  - Projects                                  │
         │  - ProjectFieldValues                        │
         │  - Notifications                             │
         │  - AuditLogs                                 │
         │  - PhaseChecklists                           │
         │  - [+ other entity tables]                   │
         │                                              │
         └──────────────────────────────────────────────┘
```

---

## Module Hierarchy & Dependencies

### Dependency Flow

**Bottom layer (no dependencies):**
```
PrismaModule      (database)
ConfigModule      (env vars)
MailModule        (SMTP)
```

**Middle layer (depend on bottom):**
```
AuthModule        (depends: PrismaModule, ConfigModule, PassportModule)
NotificationsModule (depends: PrismaModule, MailModule, AuthModule)
AuditModule       (@Global, depends: PrismaModule)
```

**Feature layer (depend on Auth & Notifications):**
```
UsersModule       (depends: AuthModule)
ProjectsModule    (depends: NotificationsModule, AuditModule)
ChecklistsModule  (depends: PrismaModule)
```

**Standalone features:**
```
MeetingsModule    DashboardModule   FiltersModule
CommentsModule    ExportModule      ProfileModule
AttachmentsModule TemplatesModule   DeadlinesModule
```

---

## Core Modules Deep Dive

### 1. Authentication Module

**File:** `src/auth/`

**Components:**
- `auth.controller.ts` — Endpoints for login, token refresh, 2FA
- `auth.service.ts` — JWT creation, TOTP verification
- `jwt.strategy.ts` — Passport JWT strategy
- `jwt-auth.guard.ts` — @UseGuards decorator for protected routes

**JWT Flow:**
1. User calls `POST /auth/login` with email + password
2. `AuthService` verifies password hash (bcryptjs)
3. Returns JWT token (exp: 1 day by default)
4. Frontend stores JWT in Pinia store
5. All requests include `Authorization: Bearer <token>`
6. `JwtAuthGuard` validates on protected routes

**2FA/TOTP Setup:**
1. User calls `POST /auth/2fa/setup`
2. Backend generates secret via `otplib`
3. Returns QR code
4. User scans with authenticator app
5. Calls `POST /auth/2fa/verify` with TOTP code
6. Backend stores secret hash in `AppUser.totpSecret`

**Database Updates:**
```sql
UPDATE AppUser SET totpSecret = '<secret>' WHERE id = '<userId>'
```

---

### 2. Notifications Module

**File:** `src/notifications/`

**Three-part system:**

#### Part 1: WebSocket Gateway (`notifications.gateway.ts`)

```typescript
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
export class NotificationsGateway {
  // Validates JWT on connection
  handleConnection(client: Socket) {
    const token = client.handshake.auth.token
    const payload = jwt.verify(token, secret)
    client.join(`user:${payload.sub}`)
  }
  
  // Broadcast to user's room
  emitToUser(userId: string, payload: NotificationPayload) {
    this.server.to(`user:${userId}`).emit('notification', payload)
  }
}
```

**Room Structure:**
- Each authenticated user joins room `user:<userId>`
- Only users in that room receive notifications for themselves
- No cross-user leakage

#### Part 2: Notification Service (`notifications.service.ts`)

**Public methods:**
- `create(userId, dto)` — Explicit creation (via API)
- `getForUser(userId)` — Fetch all for user
- `markAsRead(id, userId)` — Single notification
- `markAllAsRead(userId)` — Bulk mark read
- `delete(id, userId)` — Delete notification
- `getUnreadCount(userId)` — Unread badge count

**Internal helper (fire-and-forget):**
```typescript
async notify(
  userId: string,
  type: string,
  title: string,
  message: string,
  projectId?: string
): Promise<void> {
  // 1. Persist to database
  const notification = await this.prisma.notification.create({...})
  
  // 2. Emit WebSocket event immediately
  if (this.gateway && notification) {
    this.gateway.emitToUser(userId, notification)
  }
  
  // 3. Optionally send email
  if (user.preferences.emailNotifications !== false) {
    await this.mail.send(user.email, title, html)
  }
  
  // 4. ALL errors are swallowed internally
  // If DB fails, WebSocket still attempts
  // If WebSocket fails, email still attempts
  // If email fails, service continues
}
```

**Key feature:** Fire-and-forget design means no `await` from calling service:
```typescript
// In ProjectsService:
void this.notificationsService.notify(pmId, 'project.assigned', ...)
// Function completes immediately; notification attempt happens in background
```

#### Part 3: Frontend Integration (`useNotificationSocket` composable)

```typescript
export function useNotificationSocket() {
  const store = useNotificationStore()
  
  const socket = io('http://localhost:5122/notifications', {
    auth: { token: jwtToken }
  })
  
  socket.on('notification', (payload) => {
    store.addNotification(payload)
    toast.add({ severity: 'info', detail: payload.message })
  })
  
  return { socket }
}
```

**Usage in Vue components:**
```typescript
// In AdminView.vue, ProjectManagerView.vue, TeamMemberView.vue
const { socket } = useNotificationSocket()

onMounted(() => socket.connect())
onUnmounted(() => socket.disconnect())
```

---

### 3. Audit Module (Global)

**File:** `src/audit/`

**Unique properties:**
- Registered as `@Global()` — injectable in any service without explicit import
- Fire-and-forget design (never throws)
- Immutable audit trail for compliance

**Fire-and-forget API:**
```typescript
// From ProjectsService:
void this.auditService.log(
  'Project',                    // entityType
  projectId,                    // entityId
  'CREATE',                     // action
  adminId,                      // userId
  { name: { before: null, after: 'Acme Project' } },  // changes
  { source: 'api' }             // metadata
)
// Returns immediately; persist happens in background
// Errors are caught and logged, never thrown
```

**Queryable audit trail:**
```typescript
const result = await this.auditService.getForEntity('Project', projectId)
// Returns all logs for that project

const result = await this.auditService.getForUser(userId)
// Returns all actions by that user

const result = await this.auditService.getRecent(50)
// Returns 50 most recent across all entities
```

**Audit Controller:**
- `GET /api/audit` (Admin only) — Recent logs
- `GET /api/audit/:entityType/:entityId` (Admin only) — Entity history

**Actions tracked:**
```typescript
type AuditAction = 
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'STATUS_CHANGE'
  | 'ASSIGN'
  | 'VALIDATE'
  | 'RESET_PASSWORD'
  | 'TOTP_ENABLED'
  | 'TOTP_DISABLED'
```

---

### 4. Checklists Module

**File:** `src/checklists/`

**Architecture:**
- One checklist per project per phase
- Auto-seed default items on first fetch
- Support custom items
- Track completion + who completed + when

**Default seeding:**
```typescript
const PHASE_DEFAULTS: Record<string, string[]> = {
  'Draft': [
    'Cadrage initial validé',
    'Équipe projet identifiée',
    'Budget prévisionnel approuvé'
  ],
  'InProgress': [
    'Kick-off réalisé',
    ...
  ],
  // ... more phases
}

// On first GET /checklists/:phase
// If no items exist, createMany() with defaults
```

**API:**

```
GET  /pm/projects/:projectId/checklists/:phase
  → Returns items for phase (or auto-seeds + returns)
  
POST /pm/projects/:projectId/checklists/:phase
  { label: 'Custom item' }
  → Add item to phase
  
PATCH /pm/projects/:projectId/checklists/:itemId
  { isChecked: true }
  → Toggle completion (sets checkedBy, checkedAt)
  
DELETE /pm/projects/:projectId/checklists/:itemId
  → Delete item
  
GET /pm/projects/:projectId/checklists/progress
  → Returns { [phase]: { total: N, checked: M } }
```

**Database:**
```
PhaseChecklist {
  id: UUID
  projectId: UUID (FK)
  phase: String ("Draft", "InProgress", ...)
  label: String
  isChecked: Boolean
  checkedBy: UUID | null (FK to AppUser)
  checkedAt: DateTime | null
  orderIndex: Int (for manual ordering)
  createdAt: DateTime
}
```

---

### 5. Projects Module

**File:** `src/projects/`

**Key Features:**

#### Project Creation
```typescript
async create(dto: CreateProjectDto, adminId: string) {
  const project = await this.prisma.project.create({...})
  
  // Fire-and-forget: Log the creation
  void this.auditService.log('Project', project.id, 'CREATE', adminId)
  
  // Fire-and-forget: Notify PM if assigned
  if (dto.projectManagerId) {
    void this.notificationsService.notify(
      dto.projectManagerId,
      'project.created',
      'New Project',
      `You've been assigned to: ${project.name}`
    )
  }
  
  return project
}
```

#### Project Status Transitions
```typescript
async updateStatus(projectId: string, newStatus: ProjectStatus, userId: string) {
  const old = await this.prisma.project.findUnique({where: {id: projectId}})
  
  const updated = await this.prisma.project.update({
    where: {id: projectId},
    data: {status: newStatus}
  })
  
  // Log state change
  void this.auditService.log(
    'Project', projectId, 'STATUS_CHANGE', userId,
    {status: {before: old.status, after: newStatus}}
  )
  
  // Notify PM
  void this.notificationsService.notify(
    updated.projectManagerId,
    'project.status_changed',
    'Project Status Updated',
    `Status changed from ${old.status} to ${newStatus}`
  )
}
```

---

## Data Flow Examples

### Example 1: Project Creation

```
Frontend (Vue)
  │
  └─► POST /api/admin/projects { name: 'Acme', clientName: '...' }
        │
        └─► ProjectsController.create(dto, currentUser)
              │
              └─► ProjectsService.create(dto, adminId)
                    │
                    ├─► Prisma.project.create(dto)
                    │     └─► MariaDB INSERT
                    │
                    ├─► (void) AuditService.log(
                    │     'Project', id, 'CREATE', adminId
                    │   ) [background]
                    │
                    ├─► (void) NotificationsService.notify(
                    │     pmId, 'project.created', ...
                    │   ) [background: persist DB + emit WebSocket + email]
                    │
                    └─► return Result.ok(project)
              │
              └─► return HttpResponse(200, project)
        │
        └─── (Vue receives project, shows success toast)
              + WebSocket event arrives in background (via Socket.IO)
              + Email is sent (async)
              + Audit log is created (async)
```

### Example 2: Real-Time Notification Delivery

```
Service A calls:
  notify(userId, 'project.updated', 'Project Updated', 'Details', projectId)
    │
    └─► NotificationsService.notify()
          │
          ├─► 1. Persist: await this.prisma.notification.create({...})
          │     └─► INSERT INTO Notifications ... → notification object
          │
          ├─► 2. Emit: this.gateway.emitToUser(userId, notification)
          │     └─► Find all sockets in room "user:{userId}"
          │     └─► Emit "notification" event to those sockets
          │     └─► (Frontend's socket.on('notification', ...) fires)
          │
          └─► 3. Email: await this.mail.send(...) [if opted in]
                └─► SMTP send to user.email
                └─► (Async, fire-and-forget)

Frontend (already connected to /notifications namespace):
  │
  socket.on('notification', (payload) => {
    store.addNotification(payload)  // Update Pinia
    toast.show(payload.message)     // Visual feedback
  })
```

### Example 3: Status Transition with Audit Trail

```
PM calls:
  PATCH /api/projects/{id}/status { status: 'InProgress' }
    │
    └─► ProjectsController.updateStatus(id, status, pmId)
          │
          └─► ProjectsService.updateStatus(id, status, pmId)
                │
                ├─► Get old project state
                │
                ├─► await prisma.project.update({ status: 'InProgress' })
                │
                ├─► (void) auditService.log(
                │     'Project', id, 'STATUS_CHANGE', pmId,
                │     { status: { before: 'Draft', after: 'InProgress' } }
                │   )
                │     └─► [Background] INSERT INTO AuditLogs
                │
                ├─► (void) notificationsService.notify(
                │     adminId, 'project.status_changed', ..., projectId
                │   )
                │     └─► [Background] INSERT INTO Notifications + emit WebSocket + email
                │
                └─► return Result.ok(updated)

Result for PM:
  ✓ Project status changed immediately (API response)
  ✓ Audit log created asynchronously
  ✓ Admin receives WebSocket event in real-time
  ✓ Admin receives email notification (if enabled)

All async operations are fire-and-forget — PM's request completes immediately.
```

---

## Error Handling Strategy

### Service Layer: Result<T> Pattern

All service methods return `Result<T>` which is either success or failure:

```typescript
interface Result<T> {
  isSuccess: boolean
  value?: T
  error?: string
}

// In service:
async getProject(id: string): Promise<Result<Project>> {
  try {
    const project = await this.prisma.project.findUnique({where: {id}})
    return project ? Result.ok(project) : Result.fail('Project not found')
  } catch (error) {
    return Result.fail('Database error')
  }
}
```

### Controller Layer: NestJS HTTP Exceptions

Controllers check result and throw HTTP exceptions:

```typescript
@Get(':id')
async getProject(@Param('id') id: string) {
  const result = await this.projectsService.getProject(id)
  
  if (!result.isSuccess) {
    throw new BadRequestException(result.error)
  }
  
  return result.value
}
```

NestJS catches and converts to HTTP response:
```
BadRequestException → 400 Bad Request
NotFoundException → 404 Not Found
ForbiddenException → 403 Forbidden
UnauthorizedException → 401 Unauthorized
```

### Fire-and-Forget Services: Silent Failures

Notification & audit services never throw:

```typescript
async notify(...): Promise<void> {
  try {
    // 1. Persist
    const notification = await this.prisma.notification.create({...})
  } catch {
    // Silently fail — notification failure must never break main operation
  }
  
  try {
    // 2. Emit WebSocket
    if (this.gateway && notification) {
      this.gateway.emitToUser(userId, notification)
    }
  } catch {
    // Silently fail
  }
  
  try {
    // 3. Send email
    await this.mail.send(...)
  } catch {
    // Silently fail
  }
}
```

**Why?** These services are called via `void` (fire-and-forget) from critical business operations. Errors must never propagate to the caller.

---

## Security Considerations

### 1. JWT Authentication

- `JwtAuthGuard` validates every protected route
- Token includes user ID (`sub` claim)
- Guard injects user via `@CurrentUser()` decorator
- Token expiration: 1 day (configurable via `JWT_EXPIRATION`)

### 2. Password Hashing

- `bcryptjs` with 10 rounds (slow hash)
- Never stored plain text
- Reset flow generates temporary password

### 3. 2FA/TOTP

- Secret stored in `AppUser.totpSecret`
- QR code generated server-side (`otplib`)
- Verification happens on `POST /auth/2fa/verify`

### 4. WebSocket Authentication

- JWT required for `handleConnection`
- Invalid token → immediate disconnect
- Rooms prevent cross-user message leakage

### 5. Role-Based Access Control

- Roles: Admin, ProjectManager, SpecificationTeam, RealizationTeam, DeploymentTeam, Viewer
- Controllers use `@UseGuards(RoleGuard)` with role restrictions
- Admin-only endpoints: user CRUD, project creation/deletion, audit access

### 6. Sensitive Data

- Passwords never logged
- JWT secrets in `.env` (not in code)
- Email addresses validated
- Audit changes (before/after) can be sensitive — reviewed before querying

---

## Performance Patterns

### 1. Pagination

All list endpoints support pagination:
```typescript
GET /api/projects?page=1&limit=20

// Service:
async findAll(page: number, limit: number) {
  const skip = (page - 1) * limit
  const items = await this.prisma.project.findMany({skip, take: limit})
  const total = await this.prisma.project.count()
  return {items, total, page, limit}
}
```

### 2. Eager Loading

Use Prisma `include()` to load relations in single query:
```typescript
const project = await this.prisma.project.findUnique({
  where: {id: projectId},
  include: {
    createdByAdmin: {select: {id: true, firstName: true, lastName: true}},
    projectManager: true,
    phaseChecklists: true
  }
})
```

### 3. Async Operations

Long-running operations (email, file export) are queued/backgrounded:
- Notifications: sent asynchronously via `notify()`
- Exports: generated async, user polls for completion
- Audit logs: persisted async (fire-and-forget)

### 4. Database Indexing

Prisma schema defines indexes for common queries:
```prisma
model Notification {
  id String @id @default(cuid())
  userId String
  
  @@index([userId])
  @@index([projectId])
  @@index([isRead])
}
```

---

## Testing Strategy

### Unit Tests (Jest)

- Service layer: test business logic in isolation
- Mock Prisma via `@nestjs/testing`
- Test both success and error paths

```typescript
describe('ProjectsService', () => {
  it('should create project and log audit', async () => {
    const project = await service.create(dto, adminId)
    
    expect(project.isSuccess).toBe(true)
    expect(auditService.log).toHaveBeenCalledWith(
      'Project', project.value.id, 'CREATE', adminId
    )
  })
})
```

### E2E Tests (Supertest)

- Test full HTTP request/response cycles
- Use test database with fresh migrations
- Test authentication, authorization, validation

```typescript
it('POST /projects should create project', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send(dto)
    .expect(201)
  
  expect(response.body).toHaveProperty('id')
})
```

### Integration Tests

- Start Prisma client
- Run migrations
- Call service methods
- Verify database state

---

## Deployment Checklist

Before deploying to production:

- [ ] All `.env` variables configured (JWT_SECRET, DATABASE_URL, SMTP_*, etc.)
- [ ] Database migrations applied (`npx prisma migrate deploy`)
- [ ] TypeScript compilation succeeds (`npx tsc --noEmit`)
- [ ] Tests pass (`npm run test`, `npm run test:e2e`)
- [ ] Build succeeds (`npm run build`)
- [ ] Swagger docs accessible at `/api`
- [ ] WebSocket gateway running (check console logs)
- [ ] SMTP connectivity verified
- [ ] Database backups configured
- [ ] Logs configured (environment-specific)
- [ ] CORS origins configured (`FRONTEND_URL`)
- [ ] JWT secret rotated (different from dev)
- [ ] 2FA enabled for admin accounts
- [ ] Audit logs being persisted

---

## Troubleshooting

### WebSocket Connection Fails

**Symptom:** Notifications not received; browser console shows WebSocket error

**Diagnosis:**
```bash
# Check gateway is registered
curl http://localhost:5122/socket.io/?transport=websocket

# Check token is valid
# (decode JWT at jwt.io, verify 'sub' claim matches user ID)
```

**Solution:**
1. Verify `JwtAuthGuard` is not blocking `/notifications` namespace
2. Ensure `IoAdapter` registered in `main.ts`
3. Check frontend token is not expired
4. Verify CORS settings allow origin

### Notifications Not Sent (But API Succeeds)

**Symptom:** `POST /api/projects` returns 201, but no email or WebSocket event

**Diagnosis:** Fire-and-forget errors are silently swallowed

**Solution:**
1. Check database has Notification row: `SELECT * FROM Notification WHERE userId = '...'`
2. Check email service is configured: check SMTP_* env vars
3. Enable debug logging in `NotificationsService.notify()`
4. Check user.preferences.emailNotifications is not `false`

### Audit Logs Not Appearing

**Symptom:** Action completes, but no AuditLog row in database

**Diagnosis:** Fire-and-forget means async, might not complete before app restart

**Solution:**
1. Verify `AuditModule` is imported in `AppModule`
2. Check database has AuditLog rows: `SELECT COUNT(*) FROM AuditLog`
3. Increase timeout before app shutdown
4. Check for errors in application logs

### JWT Token Expired

**Symptom:** API returns 401 Unauthorized; WebSocket disconnects

**Solution:**
1. Frontend should call `POST /auth/refresh` to get new token
2. If refresh fails, redirect to login
3. Check `JWT_EXPIRATION` env var is reasonable (e.g., "1d")

---

## Next Steps

### Short Term
- Add rate limiting (express-rate-limit)
- Implement request logging middleware
- Add Stripe/payment integration module
- Add document versioning

### Medium Term
- Add GraphQL resolver layer
- Implement caching (Redis)
- Add full-text search (Elasticsearch)
- Add document storage (S3/MinIO)

### Long Term
- Migrate to microservices (Projects, Notifications, Audit as separate services)
- Add event sourcing for audit trail
- Add CQRS pattern for complex queries
- Add distributed tracing (Jaeger)

---
