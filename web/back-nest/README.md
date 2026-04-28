# NeoLeadge Deployment Manager — NestJS Backend

A comprehensive Node.js/NestJS API for the NeoLeadge Deployment Manager platform. This backend orchestrates project management, user authentication, real-time notifications, audit logging, and deployment workflows for enterprise deployment management.

**Last Updated:** April 9, 2026

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- MariaDB 10.5+ (or MySQL 8.0+) on port 3306
- SMTP server configured (for email notifications)

### Installation & Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run Prisma migrations
npx prisma migrate dev

# Start development server (watch mode)
npm run start:dev

# Start production server
npm run start:prod
```

**Development server:** `http://localhost:5122`
**Swagger API docs:** `http://localhost:5122/api`

---

## Architecture Overview

### Tech Stack

| Component | Package | Version |
|-----------|---------|---------|
| **Framework** | @nestjs/core | 11.0.1 |
| **Database ORM** | Prisma | 7.6.0 |
| **Database Driver** | @prisma/adapter-mariadb | 7.7.0 |
| **Authentication** | @nestjs/jwt, passport-jwt | 11.0.2, 4.0.1 |
| **Real-time** | @nestjs/websockets, socket.io | 11.1.18, 4.8.3 |
| **API Docs** | @nestjs/swagger | 11.2.6 |
| **Email** | nodemailer | 8.0.5 |
| **Password Hashing** | bcryptjs | 3.0.3 |
| **2FA/TOTP** | otplib | 13.4.0 |
| **Validation** | class-validator, class-transformer | 0.14.4, 0.5.1 |

### Module Dependency Graph

```
┌─────────────────────────────────────────────────┐
│ AppModule                                       │
├──────────────────────────────────────────────────┤
│  ├─ ConfigModule (global)                      │
│  ├─ PrismaModule ◄── Database provider         │
│  ├─ MailModule ◄── Email service               │
│  ├─ AuditModule (@Global) ◄── Audit logging    │
│  │                                              │
│  ├─ AuthModule ◄── JWT, Passport               │
│  │  └─ depends: JwtModule, PassportModule      │
│  │                                              │
│  ├─ UsersModule                                │
│  │  └─ depends: AuthModule                     │
│  │                                              │
│  ├─ NotificationsModule                        │
│  │  ├─ NotificationsGateway (WebSocket)        │
│  │  ├─ NotificationsService                    │
│  │  └─ depends: MailModule, AuthModule         │
│  │                                              │
│  ├─ ProjectsModule                             │
│  │  ├─ ProjectsService (calls notify, audit)   │
│  │  └─ depends: NotificationsModule, AuditService │
│  │                                              │
│  ├─ ChecklistsModule ◄── Phase checklists      │
│  ├─ MeetingsModule                             │
│  ├─ CommentsModule                             │
│  ├─ AttachmentsModule                          │
│  ├─ DashboardModule                            │
│  ├─ ExportModule                               │
│  ├─ TemplatesModule                            │
│  ├─ ProfileModule                              │
│  ├─ DeadlinesModule                            │
│  └─ SavedFiltersModule                         │
└──────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Real-Time WebSocket Notifications

**Namespace:** `/notifications`

**Authentication:** JWT token passed via `handshake.auth.token`

**Architecture:**
- `src/notifications/notifications.gateway.ts` — Socket.IO WebSocket gateway
  - Validates JWT on connection
  - Auto-joins authenticated users to room `user:<userId>`
  - Emits `notification` events to user rooms

- `src/notifications/notifications.service.ts` — Notification management
  - `notify()` — Fire-and-forget helper called by other services
  - Persists in-app notifications to database
  - Emits WebSocket event immediately after persistence
  - Optionally sends email notification (based on user preferences)
  - Never breaks calling service if notification fails

**Frontend Integration:** `web/Front/customapp/src/composables/useNotificationSocket.ts`
- Connects to `/notifications` namespace on component mount
- Passes JWT via `auth: { token }`
- Listens for `notification` event
- Updates Pinia store and shows toast notification

**Usage in Services:**

```typescript
// Fire-and-forget — never breaks business logic
await this.notificationsService.notify(
  userId,
  'project.updated',
  'Project Updated',
  'Your project has been updated',
  projectId
);
```

---

### 2. Audit Logging (Global Module)

**Module:** `src/audit/` (registered as `@Global()`)

**Features:**
- Fire-and-forget `log()` method — never throws
- Tracks `CREATE | UPDATE | DELETE | LOGIN | LOGOUT | STATUS_CHANGE | ASSIGN | VALIDATE | RESET_PASSWORD | TOTP_ENABLED | TOTP_DISABLED`
- Records user ID, changes (before/after), and custom metadata
- Immutable audit trail for compliance

**Usage in Services:**

```typescript
// Fire-and-forget — never blocks service logic
void this.auditService.log(
  'Project',
  projectId,
  'CREATE',
  userId,
  undefined,
  { clientName: dto.clientName }
);
```

**Audit Controller Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /api/audit` | List recent audit logs (Admin only, limit 50) |
| `GET /api/audit/:entityType/:entityId` | Get all logs for an entity (Admin only, limit 200) |

---

### 3. Phase Checklists

**Module:** `src/checklists/`

**Features:**
- Per-project checklists for each phase
- Auto-seeded default checklist items for each phase
- Support for custom items
- Progress tracking (completed/total per phase)
- User-attributed check-offs with timestamps

**Default Checklist Items by Phase:**

| Phase | Items |
|-------|-------|
| **Draft** | Cadrage initial validé, Équipe projet identifiée, Budget prévisionnel approuvé |
| **Kickoff** | Kick-off réalisé, Planning de projet communiqué, Interlocuteurs clients identifiés |
| **CadrageTechnique** | Cahier des charges rédigé, Spécifications fonctionnelles validées, Revue technique effectuée |
| **Environnement** | Accès environnements configurés, Infrastructure de recette prête, Comptes de service créés |
| **Parametrage** | Paramétrage application réalisé, Données de référence chargées, Validation paramétrage par équipe spéc. |
| **Integration** | Connecteurs d'intégration développés, Tests d'intégration passés, Recette interne effectuée |
| **Recette** | Plan de recette établi, Tests de recette client OK, PV de recette signé |
| **MEP** | Mise en production réalisée, Tests de smoke post-déploiement OK, Documentation livrée |
| **Cloture** | Formation utilisateurs réalisée, Clôture projet validée, Bilan projet transmis |

**Checklists Controller Endpoints:**

```
GET    /pm/projects/:projectId/checklists/:phase      Get phase checklist (auto-seeds defaults)
POST   /pm/projects/:projectId/checklists/:phase      Add custom item to phase
PATCH  /pm/projects/:projectId/checklists/:itemId    Toggle item check status
DELETE /pm/projects/:projectId/checklists/:itemId    Delete item
GET    /pm/projects/:projectId/checklists/progress   Get progress by phase
```

---

### 4. Authentication & Authorization

**Providers:**
- **JWT** — Bearer token authentication via `@nestjs/jwt`
- **Passport** — JWT strategy via `passport-jwt`
- **2FA/TOTP** — QR code generation via `otplib`

**Key Controllers:**
- `src/auth/auth.controller.ts` — Login, token refresh, 2FA setup
- `src/users/users.controller.ts` — User CRUD (Admin/PM only)

**Protected Routes:** All API endpoints require `@UseGuards(JwtAuthGuard)` decorator

---

## Directory Structure

```
src/
├── app.module.ts                 # Root module, imports all feature modules
├── main.ts                       # Bootstrap; registers IoAdapter for Socket.IO
│
├── auth/                         # Authentication (JWT, Passport, 2FA)
│  ├── auth.controller.ts
│  ├── auth.service.ts
│  ├── jwt.strategy.ts
│  ├── jwt-auth.guard.ts
│  └── auth.module.ts
│
├── users/                        # User management
│  ├── users.controller.ts
│  ├── users.service.ts
│  ├── dto/
│  └── users.module.ts
│
├── projects/                     # Project management + status transitions
│  ├── projects.controller.ts
│  ├── projects.service.ts        # Calls notify() + log()
│  ├── dto/
│  └── projects.module.ts
│
├── notifications/                # Real-time WebSocket notifications
│  ├── notifications.gateway.ts   # Socket.IO @WebSocketGateway
│  ├── notifications.service.ts   # Persists + emits + emails
│  ├── notifications.controller.ts
│  ├── dto/
│  └── notifications.module.ts
│
├── audit/                        # Audit logging (@Global() module)
│  ├── audit.service.ts           # Fire-and-forget log()
│  ├── audit.controller.ts
│  └── audit.module.ts
│
├── checklists/                   # Phase checklists
│  ├── checklists.service.ts      # CRUD, progress tracking, auto-seed defaults
│  ├── checklists.controller.ts
│  ├── dto/
│  └── checklists.module.ts
│
├── meetings/                     # Meeting management
├── comments/                     # Project comments
├── attachments/                  # File attachments
├── dashboard/                    # Dashboard endpoints
├── export/                       # Data export (Excel, PDF)
├── templates/                    # Project templates
├── profile/                      # User profile
├── deadlines/                    # Deadline tracking
├── mail/                         # Email service (@nestjs/mailer wrapper)
├── filters/                      # Saved filters
│
├── prisma/                       # Database (Prisma ORM)
│  ├── prisma.service.ts          # @nestjs/prisma wrapper
│  ├── prisma.module.ts
│  ├── schema.prisma              # Data models
│  └── migrations/
│
└── common/                       # Shared utilities
   ├── result.ts                  # Result<T> pattern for consistent error handling
   ├── decorators/                # Custom decorators (@CurrentUser, etc.)
   └── pipes/                     # Custom pipes
```

---

## Database Schema

**ORM:** Prisma 7 with MariaDB adapter

**Key Entities:**

### AppUser
```
- id: String (UUID)
- email: String (unique)
- firstName: String
- lastName: String
- role: UserRole (enum: Admin, ProjectManager, SpecificationTeam, RealizationTeam, DeploymentTeam, Viewer)
- passwordHash: String (bcryptjs)
- isActive: Boolean (soft-delete)
- preferences: Json (user settings)
- totpSecret: String | null (2FA)
- createdAt: DateTime
- updatedAt: DateTime
```

### Project
```
- id: String (UUID)
- name: String
- description: String | null
- clientName: String
- status: ProjectStatus (enum: Draft, Kickoff, CadrageTechnique, Environnement, Parametrage, Integration, Recette, MEP, Cloture, Archived)
- startDate: DateTime | null
- endDate: DateTime | null
- createdByAdminId: String (FK)
- projectManagerId: String | null (FK)
- createdAt: DateTime
- updatedAt: DateTime

Relations:
- createdByAdmin: AppUser
- projectManager: AppUser | null
- fieldValues: ProjectFieldValue[]
- phaseChecklists: PhaseChecklist[]
- comments: Comment[]
- attachments: Attachment[]
- meetings: Meeting[]
- deadlines: Deadline[]
- notifications: Notification[]
```

### Notification
```
- id: String (UUID)
- userId: String (FK)
- type: String (project.created, project.assigned, project.status_changed, etc.)
- title: String
- message: String
- projectId: String | null (FK)
- isRead: Boolean
- createdAt: DateTime

Emitted via WebSocket to room `user:{userId}` immediately after creation.
```

### AuditLog (Global)
```
- id: String (UUID)
- entityType: String
- entityId: String
- action: AuditAction (CREATE, UPDATE, DELETE, LOGIN, STATUS_CHANGE, etc.)
- userId: String | null (FK)
- changes: Json | null (before/after values)
- metadata: Json | null (custom context, max 1000 chars)
- createdAt: DateTime

Immutable audit trail. Fire-and-forget logging — failures never break business logic.
```

### PhaseChecklist
```
- id: String (UUID)
- projectId: String (FK)
- phase: String (Draft, InProgress, SpecificationValidation, etc.)
- label: String
- isChecked: Boolean
- checkedBy: String | null (FK to AppUser)
- checkedAt: DateTime | null
- orderIndex: Int
- createdAt: DateTime
```

---

## Environment Variables

Required variables in `.env`:

```bash
# Server
PORT=5122
NODE_ENV=development

# Database (MariaDB)
DATABASE_URL="mysql://user:password@localhost:3306/neoleadge"

# JWT
JWT_SECRET="your-secret-key-here"
JWT_EXPIRATION="1d"

# Email (SMTP)
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=sender@example.com
SMTP_PASSWORD=password
SMTP_FROM=noreply@example.com

# Frontend URL (for CORS + email links)
FRONTEND_URL="http://localhost:5173"
```

---

## API Endpoints (by Module)

### Authentication (`/api/auth`)
```
POST   /auth/register               Create new user account
POST   /auth/login                  Login → JWT token
POST   /auth/refresh                Refresh JWT token
POST   /auth/2fa/setup              Generate TOTP secret + QR code
POST   /auth/2fa/verify             Verify TOTP code
POST   /auth/2fa/disable            Disable 2FA for user
```

### Users (`/api/users`) — Admin/PM only
```
GET    /users                       List all active users (paginated)
GET    /users/:id                   Get user details
POST   /users                       Create new user
PATCH  /users/:id                   Update user info
DELETE /users/:id                   Deactivate user
PATCH  /users/:id/role              Change user role
POST   /users/:id/reset-password    Reset password → send email
```

### Projects (`/api/projects`)
```
GET    /admin/projects              List all projects (Admin only)
GET    /pm/projects                 List user's assigned projects (PM only)
GET    /projects/:id                Get project detail
POST   /admin/projects              Create new project (Admin only)
PATCH  /projects/:id                Update project
DELETE /admin/projects/:id          Delete project (Admin only)
POST   /projects/:id/assign-manager Assign PM to project
PATCH  /projects/:id/status         Transition project status (triggers notifications & audit)
```

### Notifications (`/api/notifications`)
```
GET    /notifications               Get user's notifications
POST   /notifications/:id/read      Mark single notification as read
POST   /notifications/read-all      Mark all as read
DELETE /notifications/:id           Delete notification
GET    /notifications/unread-count  Get unread count
```

**WebSocket Namespace:** `/notifications`
- Event: `notification` (emitted to authenticated users)

### Checklists (`/pm/projects/:projectId/checklists`)
```
GET    /:phase                      Get checklist for phase
POST   /:phase                      Add custom item
PATCH  /:itemId                     Toggle item completion
DELETE /:itemId                     Delete item
GET    /progress                    Get progress by phase
```

### Audit (`/api/audit`) — Admin only
```
GET    /audit                       List recent audit logs
GET    /audit/:entityType/:entityId Get logs for specific entity
```

### Other Modules
- **Comments** — CRUD on project comments
- **Meetings** — Schedule & manage meetings
- **Attachments** — Upload/download project files
- **Deadlines** — Track project deadlines
- **Dashboard** — Analytics & metrics
- **Export** — Export project data (Excel, PDF)
- **Profile** — User profile & preferences

---

## Build & Deployment

### Development
```bash
npm run start:dev       # Watch mode with hot reload
npm run lint            # ESLint check + fix
npm run format          # Prettier format
```

### Testing
```bash
npm run test            # Unit tests (Jest)
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # E2E tests
```

### Production Build
```bash
# Build to dist/
npm run build

# Start server
npm run start:prod

# Or use your deployment method (Docker, systemd, PM2, etc.)
```

---

## Best Practices Applied

### 1. Error Handling

All controllers throw proper NestJS HTTP exceptions:
```typescript
// Instead of returning { statusCode: 400, message: '...' }
if (!user) {
  throw new BadRequestException('User not found');
}
```

### 2. Fire-and-Forget Patterns

Critical services use fire-and-forget for notification & audit:
```typescript
// Never await — let errors be swallowed internally
void this.auditService.log(entity, action);
await this.notificationsService.notify(userId, type, title, message);
```

### 3. Module Imports

All imports use `.js` extensions (required by `module: "nodenext"` in tsconfig):
```typescript
import { AppModule } from './app.module.js';
import { result } from '../common/result.js';
```

### 4. Immutable State

Pinia stores on frontend use immutable updates (never mutate direct).

### 5. Comprehensive Validation

All DTOs use `class-validator` with decorators:
```typescript
class CreateProjectDto {
  @IsString() @MinLength(3) name: string;
  @IsEnum(ProjectStatus) status: ProjectStatus;
}
```

---

## TypeScript Configuration

**Target:** `ES2020`
**Module:** `nodenext` (requires `.js` extensions on imports)
**StrictMode:** Enabled

Compile check without errors:
```bash
npx tsc --noEmit
```

---

## Known Constraints & Workarounds

### 1. Socket.IO JWT Authentication
The gateway validates JWT during `handleConnection`. If token is invalid or missing, the client is immediately disconnected.

### 2. Notification Fire-and-Forget
`NotificationsService.notify()` and `AuditService.log()` never throw. Errors are logged silently. This is intentional — notification failure must never break project creation, status transitions, or other core operations.

### 3. Email Fallback
If an SMTP server is not configured, the `MailService` will not send emails but will not crash either. Configure `SMTP_*` environment variables to enable email.

### 4. Soft Deletes
Users are soft-deleted (marked inactive). Hard deletes are not supported for audit trail completeness.

---

## Monitoring & Logging

**Logger:** NestJS built-in logger (configurable via environment)

**Log Locations:**
- Console (development)
- Application logs (production)

**Key Loggable Events:**
- User authentication (login/logout)
- Project creation/status changes
- Notification emission (success/failure)
- Audit log writes
- Email sends
- WebSocket connect/disconnect

---

## Contributing

### Code Style
- ESLint + Prettier enforce formatting
- No `console.log` in production code
- All public functions must have JSDoc
- Services must handle errors gracefully

### Adding a New Module

1. Generate with NestJS CLI:
   ```bash
   nest generate module features/my-feature
   nest generate service features/my-feature
   nest generate controller features/my-feature
   ```

2. Define Prisma schema in `prisma/schema.prisma`

3. Run migration:
   ```bash
   npx prisma migrate dev --name add_my_feature
   ```

4. Implement service with result pattern:
   ```typescript
   async getAll(): Promise<Result<MyEntity[]>> {
     try { return Result.ok(await this.prisma.myEntity.findMany()); }
     catch { return Result.fail('Error message'); }
   }
   ```

5. Add to `AppModule` imports

6. Write tests in `.spec.ts` files

---

## Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Socket.IO Documentation](https://socket.io/docs)
- [JWT Handbook](https://auth0.com/resources/jwt)
- [Project CLAUDE.md](../../../CLAUDE.md) — Full integration context

---

## License

UNLICENSED — NeoLeadge proprietary

---

**Contact:** NeoLeadge Dev Team
