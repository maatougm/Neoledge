# NestJS Backend Documentation Index

**Last Updated:** April 9, 2026
**Version:** 2.0.0

Welcome to the NestJS backend documentation for the NeoLeadge Deployment Manager. This index guides you through all available resources.

---

## Quick Links

- **README.md** — Start here! Project overview, quick start, tech stack, endpoints
- **ARCHITECTURE.md** — Deep dive into system design, module hierarchy, data flows
- **DEVELOPMENT.md** — Local setup, development workflow, testing, debugging
- **REALTIME_FEATURES.md** — WebSocket notifications, audit logging, email system

---

## For Different Audiences

### Just Getting Started?
1. Read [README.md](../README.md) — 15 min overview
2. Follow "Quick Start" section to get server running locally
3. Visit Swagger UI at `http://localhost:5122/api` to explore API

### Adding a New Feature?
1. Read [ARCHITECTURE.md](ARCHITECTURE.md) — understand module structure
2. Follow "Adding a New Feature" in [DEVELOPMENT.md](DEVELOPMENT.md) — step-by-step guide
3. Reference existing module as template (e.g., ProjectsModule)
4. Write tests first (TDD approach)

### Integrating WebSocket Notifications?
1. Read [REALTIME_FEATURES.md](REALTIME_FEATURES.md) — complete guide
2. See "Integration with Feature Services" section
3. Call `this.notificationsService.notify()` from your service
4. Frontend automatically receives via `useNotificationSocket()` composable

### Understanding Real-Time System?
1. Read [REALTIME_FEATURES.md](REALTIME_FEATURES.md) — overview of 3 pillars
2. Jump to "WebSocket Notifications" or "Audit Logging" sections
3. See detailed examples with code

### Debugging an Issue?
1. Check [DEVELOPMENT.md](DEVELOPMENT.md) "Troubleshooting Common Issues"
2. Check [REALTIME_FEATURES.md](REALTIME_FEATURES.md) "Troubleshooting" for notifications/audit
3. Enable debug logging: `DEBUG=* npm run start:dev`
4. Check Prisma Studio: `npx prisma studio`

### Setting Up for Deployment?
1. Read "Deployment Checklist" in [README.md](../README.md)
2. Configure `.env` with production values
3. Run database migrations: `npx prisma migrate deploy`
4. Build and test: `npm run build`, `npm run test`

---

## Key Features by Document

### README.md
- Project overview & tech stack
- Quick start (installation, running)
- Architecture overview
- Module dependency graph
- Database schema
- API endpoints reference
- Build & deployment
- Known constraints

### ARCHITECTURE.md
- System architecture (high-level diagram)
- Module hierarchy & dependencies
- Deep dive into each core module:
  - Authentication (JWT, 2FA/TOTP)
  - Notifications (WebSocket + email)
  - Audit Logging (fire-and-forget)
  - Checklists (phase management)
  - Projects (status transitions)
- Data flow examples
- Error handling strategy
- Security considerations
- Performance patterns
- Testing strategy

### DEVELOPMENT.md
- Local setup (prerequisites, environment)
- Common dev tasks (testing, linting, building)
- API testing (Swagger, cURL, Postman, WebSocket)
- Adding a new feature (step-by-step)
- Debugging techniques
- Git workflow & code review checklist
- Performance tips
- Troubleshooting

### REALTIME_FEATURES.md
- Overview of 3 pillars (WebSocket, Audit, Email)
- WebSocket architecture & connection flow
- Event delivery & room isolation
- Audit logging API & fire-and-forget design
- Usage examples (creation, status change, auth)
- Email configuration & templates
- Integration with feature services
- Best practices & troubleshooting

---

## API Endpoints by Module

### Authentication
```
POST   /auth/register               Create new user
POST   /auth/login                  Login → JWT token
POST   /auth/refresh                Refresh token
POST   /auth/2fa/setup              Generate TOTP secret
POST   /auth/2fa/verify             Verify TOTP code
POST   /auth/2fa/disable            Disable 2FA
```

### Users (Admin/PM only)
```
GET    /users                       List all users
GET    /users/:id                   Get user details
POST   /users                       Create user
PATCH  /users/:id                   Update user
DELETE /users/:id                   Deactivate user
```

### Projects
```
GET    /admin/projects              List all (Admin)
GET    /pm/projects                 List assigned (PM)
GET    /projects/:id                Get detail
POST   /admin/projects              Create (Admin)
PATCH  /projects/:id                Update
DELETE /admin/projects/:id          Delete (Admin)
POST   /projects/:id/assign-manager Assign PM
PATCH  /projects/:id/status         Change status
```

### Notifications
```
GET    /notifications               Get notifications
POST   /notifications/:id/read      Mark as read
POST   /notifications/read-all      Mark all read
DELETE /notifications/:id           Delete
GET    /notifications/unread-count  Get count
WS     /notifications              WebSocket namespace (JWT auth)
```

### Checklists
```
GET    /pm/projects/:id/checklists/:phase      Get phase checklist
POST   /pm/projects/:id/checklists/:phase      Add item
PATCH  /pm/projects/:id/checklists/:itemId    Toggle item
DELETE /pm/projects/:id/checklists/:itemId    Delete item
GET    /pm/projects/:id/checklists/progress   Get progress
```

### Audit (Admin only)
```
GET    /audit                             Recent logs
GET    /audit/:type/:id                   Entity history
```

### Other Modules
**Meetings, Comments, Attachments, Dashboard, Export, Templates, Profile, Deadlines, Filters** — see [README.md](../README.md) for endpoints

---

## Directory Structure Quick Reference

```
src/
├── main.ts                 # Bootstrap, IoAdapter setup
├── app.module.ts           # Root module, imports
├── common/                 # Shared utilities
│  └── result.ts           # Result<T> pattern
├── auth/                   # JWT, Passport, 2FA
├── notifications/          # WebSocket gateway + service
├── audit/                  # Audit logging (@Global)
├── projects/               # Project management
├── checklists/             # Phase checklists
├── users/                  # User management
├── [other modules]/        # Features
└── prisma/                 # Database (ORM)

docs/
├── INDEX.md               # This file
├── README.md              # See parent directory
├── ARCHITECTURE.md        # System design deep dive
├── DEVELOPMENT.md         # Local development guide
└── REALTIME_FEATURES.md  # WebSocket/Audit guide
```

---

## Common Tasks & Where to Find Them

| Task | Document | Section |
|------|----------|---------|
| Start dev server | DEVELOPMENT | "Start Development Server" |
| Run tests | DEVELOPMENT | "Running Tests" |
| Add new module | DEVELOPMENT | "Adding a New Feature" |
| Understand WebSocket | REALTIME_FEATURES | "WebSocket Notifications" |
| Trigger notification | REALTIME_FEATURES | "Integration with Feature Services" |
| Query audit logs | REALTIME_FEATURES | "Querying Audit Logs" |
| Fix build error | DEVELOPMENT | "Troubleshooting Common Issues" |
| Debug WebSocket | REALTIME_FEATURES | "Troubleshooting" |
| Setup production | README | "Deployment & Environment Variables" |
| Understand JWT flow | ARCHITECTURE | "Authentication Module" |
| Add email template | REALTIME_FEATURES | "Email Notifications" |
| Monitor system | REALTIME_FEATURES | "Monitoring & Alerts" |

---

## Environment Variables Reference

**Core:**
```bash
PORT=5122
NODE_ENV=development
```

**Database:**
```bash
DATABASE_URL="mysql://user:password@localhost:3306/neoleadge"
```

**JWT:**
```bash
JWT_SECRET="change-me-in-production"
JWT_EXPIRATION="1d"
```

**Email (SMTP):**
```bash
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=sender@example.com
SMTP_PASSWORD=password
SMTP_FROM=noreply@example.com
SMTP_TLS=true
```

**Frontend:**
```bash
FRONTEND_URL="http://localhost:5173"
```

See [README.md](../README.md) "Environment Variables" for full reference.

---

## Technology Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 18+ |
| **Framework** | NestJS | 11.0.1 |
| **Language** | TypeScript | 5.7.3 |
| **Database** | MariaDB | 10.5+ |
| **ORM** | Prisma | 7.6.0 |
| **Authentication** | JWT + Passport | 11.0.2, 4.0.1 |
| **Real-time** | Socket.IO | 4.8.3 |
| **API Docs** | Swagger | 11.2.6 |
| **Validation** | class-validator | 0.14.4 |
| **Testing** | Jest | 30.0.0 |
| **Email** | Nodemailer | 8.0.5 |

---

## Getting Help

### Documentation First
1. Search this index for your topic
2. Check the relevant document (README, ARCHITECTURE, DEVELOPMENT, REALTIME_FEATURES)
3. Look for Troubleshooting sections

### Code Examples
- Check existing modules: `src/projects/`, `src/notifications/`, `src/audit/`
- Study service tests: `*.spec.ts` files
- Review controllers for endpoint patterns

### Resources
- [NestJS Docs](https://docs.nestjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Socket.IO Docs](https://socket.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

---

## Document Versions

| Document | Last Updated | Covers Version |
|----------|--------------|-----------------|
| README.md | April 9, 2026 | 2.0.0 |
| ARCHITECTURE.md | April 9, 2026 | 2.0.0 |
| DEVELOPMENT.md | April 9, 2026 | 2.0.0 |
| REALTIME_FEATURES.md | April 9, 2026 | 2.0.0 |

**Version 2.0.0 includes:**
- Real-time WebSocket notifications
- Global audit logging module
- Phase checklists with auto-seeding
- Fire-and-forget notification/audit patterns
- Comprehensive TypeScript with `.js` extensions
- Socket.IO integration
- Email notifications

---

## Making Contributions

Before contributing:

1. **Read relevant documentation** — understand existing patterns
2. **Follow code style** — use existing modules as templates
3. **Test thoroughly** — TDD approach (write tests first)
4. **Update docs** — add/update docs for new features
5. **Check security** — no hardcoded secrets, validate inputs
6. **Get code reviewed** — use PR workflow, address feedback

See [DEVELOPMENT.md](DEVELOPMENT.md) "Git Workflow" for detailed process.

---

## Quick Reference: Module Imports

```typescript
// Services can inject:
constructor(
  private readonly prisma: PrismaService,        // Database
  private readonly mail: MailService,            // Email
  private readonly audit: AuditService,          // Audit (@Global, no import needed)
  private readonly notifications: NotificationsService,
  private readonly jwtService: JwtService        // From AuthModule
) {}

// Controllers use guards:
@UseGuards(JwtAuthGuard)              // Require valid JWT
@UseGuards(RoleGuard)                 // Require specific role
@CurrentUser() user: {id: string}     // Inject authenticated user
```

---

## Version Roadmap

### Current (2.0.0)
- WebSocket notifications ✓
- Audit logging ✓
- Phase checklists ✓
- 2FA/TOTP ✓
- Email notifications ✓

### Planned (2.1.0)
- Rate limiting
- Request logging middleware
- Stripe payment integration
- Document versioning

### Future (3.0.0)
- GraphQL resolver layer
- Redis caching
- Elasticsearch full-text search
- S3/MinIO file storage
- Microservices (Projects, Notifications services separate)

---

## Contact & Support

For questions or issues:
1. Check documentation (this index)
2. Search codebase for similar patterns
3. Create GitHub issue with details
4. Contact: NeoLeadge Dev Team

---

**Happy coding! Feel free to reference any document as you develop.**
