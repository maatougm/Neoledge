# Development Guide

**Last Updated:** April 9, 2026

---

## Local Development Setup

### 1. Prerequisites

```bash
# Check versions
node --version        # Should be 18+
npm --version         # Should be 9+
```

Ensure MariaDB is running:
```bash
# macOS (Homebrew)
brew services list | grep mariadb

# Windows (if using WSL)
sudo systemctl status mariadb

# Docker
docker run -d \
  --name neoleadge-db \
  -e MYSQL_ROOT_PASSWORD=dev \
  -e MYSQL_DATABASE=neoleadge \
  -p 3306:3306 \
  mariadb:10.5
```

### 2. Clone & Install

```bash
cd ~/Desktop/neoleadge/web/back-nest

npm install

# Verify build
npm run build
```

### 3. Environment Setup

Create `.env` from `.env.example`:
```bash
cp .env.example .env
```

Edit `.env`:
```bash
# ════ Server ════
PORT=5122
NODE_ENV=development

# ════ Database ════
DATABASE_URL="mysql://root:dev@localhost:3306/neoleadge"

# ════ JWT ════
JWT_SECRET="dev-secret-change-me-in-production"
JWT_EXPIRATION="1d"

# ════ Email (SMTP) ════
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=dev
SMTP_PASSWORD=dev
SMTP_FROM=dev@localhost
SMTP_TLS=false

# ════ Frontend ════
FRONTEND_URL="http://localhost:5173"
```

For development email testing, use **Mailhog**:
```bash
# Docker: spin up Mailhog (SMTP on :1025, UI on :8025)
docker run -d \
  --name mailhog \
  -p 1025:1025 \
  -p 8025:8025 \
  mailhog/mailhog

# View emails sent: http://localhost:8025
```

### 4. Database Migrations

```bash
# Apply all pending migrations
npx prisma migrate deploy

# Or run in dev mode (creates migrations)
npx prisma migrate dev

# Reset database (delete all data, re-seed)
npx prisma migrate reset

# View database GUI
npx prisma studio      # Opens http://localhost:5555
```

### 5. Start Development Server

```bash
npm run start:dev
```

Expected output:
```
[Nest] 1234  - 04/09/2026, 10:00:00 AM   [NestFactory] Starting Nest application...
[Nest] 1234  - 04/09/2026, 10:00:01 AM   [InstanceLoader] PrismaModule dependencies initialized +10ms
[Nest] 1234  - 04/09/2026, 10:00:02 AM   [InstanceLoader] ConfigModule dependencies initialized +10ms
...
[Nest] 1234  - 04/09/2026, 10:00:05 AM   [NestApplication] Nest application successfully started +15ms
Application listening on port 5122

Swagger docs:    http://localhost:5122/api
API:             http://localhost:5122
WebSocket:       ws://localhost:5122/notifications
```

---

## Common Development Tasks

### Running Tests

```bash
# Run all tests once
npm run test

# Watch mode (re-run on file change)
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e
```

### Code Quality

```bash
# Lint check
npm run lint

# Lint + auto-fix
npm run lint            # (configured with --fix)

# Format check
npm run format

# TypeScript compilation check (strict)
npx tsc --noEmit
```

### Database

```bash
# Open Prisma Studio (GUI)
npx prisma studio

# View current schema
cat prisma/schema.prisma

# Create new migration
npx prisma migrate dev --name add_my_feature

# Reset (WARNING: deletes all data)
npx prisma migrate reset

# Inspect database state
npx prisma db execute --stdin < query.sql
```

### Building

```bash
# Development build (watch)
npm run start:dev

# Production build
npm run build

# Start production build
npm run start:prod

# Build output: dist/
```

---

## API Testing

### Using Swagger UI

Navigate to `http://localhost:5122/api` and test endpoints interactively:

1. Authorize: Click "Authorize" button, paste your JWT token
2. Try endpoints: Expand any endpoint, click "Try it out"
3. See responses: Response body, headers, status code

### Using cURL

```bash
# Get auth token
TOKEN=$(curl -s http://localhost:5122/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  | jq -r '.token')

# List projects (requires auth)
curl http://localhost:5122/api/projects \
  -H "Authorization: Bearer $TOKEN"

# Create project
curl -X POST http://localhost:5122/api/admin/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Project",
    "clientName": "Acme Corp",
    "description": "Test project"
  }'
```

### Using Postman/Insomnia

1. Import Swagger spec: `http://localhost:5122/api-json` (or use Swagger UI directly)
2. Create environment:
   ```json
   {
     "apiUrl": "http://localhost:5122",
     "token": "your-jwt-token-here"
   }
   ```
3. Set Authorization header: `Bearer {{token}}`
4. Test endpoints

### Using WebSocket (Node.js example)

```javascript
const { io } = require('socket.io-client');

const token = 'your-jwt-token-here';
const socket = io('http://localhost:5122/notifications', {
  auth: { token }
});

socket.on('connect', () => {
  console.log('Connected to notifications');
});

socket.on('notification', (data) => {
  console.log('Notification received:', data);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});
```

---

## Adding a New Feature

### Example: Add "ProjectTemplate" Module

#### Step 1: Generate Module Files

```bash
nest generate module features/project-templates
nest generate service features/project-templates
nest generate controller features/project-templates
```

Generated:
```
src/features/project-templates/
├── project-templates.module.ts
├── project-templates.service.ts
├── project-templates.controller.ts
└── dto/
    ├── create-project-template.dto.ts
    └── update-project-template.dto.ts
```

#### Step 2: Update Prisma Schema

Edit `prisma/schema.prisma`:
```prisma
model ProjectTemplate {
  id        String @id @default(cuid())
  name      String
  description String?
  createdByAdminId String
  createdByAdmin AppUser @relation(fields: [createdByAdminId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([createdByAdminId])
}
```

#### Step 3: Create Migration

```bash
npx prisma migrate dev --name add_project_templates
```

#### Step 4: Implement Service

```typescript
// src/features/project-templates/project-templates.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Result } from '../../common/result.js';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto.js';
import { AuditService } from '../../audit/audit.service.js';

@Injectable()
export class ProjectTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateProjectTemplateDto, adminId: string) {
    try {
      const template = await this.prisma.projectTemplate.create({
        data: {
          ...dto,
          createdByAdminId: adminId,
        },
      });

      // Fire-and-forget: Log creation
      void this.audit.log('ProjectTemplate', template.id, 'CREATE', adminId);

      return Result.ok(template);
    } catch (error) {
      return Result.fail('Failed to create template');
    }
  }

  async findAll() {
    try {
      const templates = await this.prisma.projectTemplate.findMany({
        include: { createdByAdmin: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return Result.ok(templates);
    } catch {
      return Result.fail('Failed to fetch templates');
    }
  }
}
```

#### Step 5: Implement Controller

```typescript
// src/features/project-templates/project-templates.controller.ts

import { Controller, Get, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ProjectTemplatesService } from './project-templates.service.js';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Project Templates')
@Controller('templates')
@UseGuards(JwtAuthGuard)
@ApiBearer.Auth()
export class ProjectTemplatesController {
  constructor(private readonly service: ProjectTemplatesService) {}

  @Post()
  async create(
    @Body() dto: CreateProjectTemplateDto,
    @CurrentUser() user: { id: string }
  ) {
    const result = await this.service.create(dto, user.id);
    if (!result.isSuccess) {
      throw new BadRequestException(result.error);
    }
    return result.value;
  }

  @Get()
  async findAll() {
    const result = await this.service.findAll();
    if (!result.isSuccess) {
      throw new BadRequestException(result.error);
    }
    return result.value;
  }
}
```

#### Step 6: Add Module to AppModule

```typescript
// src/app.module.ts

import { ProjectTemplatesModule } from './features/project-templates/project-templates.module.js';

@Module({
  imports: [
    // ... existing imports
    ProjectTemplatesModule,
  ],
})
export class AppModule {}
```

#### Step 7: Write Tests

```typescript
// src/features/project-templates/project-templates.service.spec.ts

describe('ProjectTemplatesService', () => {
  let service: ProjectTemplatesService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProjectTemplatesService,
        { provide: PrismaService, useValue: { projectTemplate: { create: jest.fn() } } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProjectTemplatesService>(ProjectTemplatesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create template', async () => {
    const dto = { name: 'Test', description: 'Test template' };
    const adminId = 'admin-123';

    jest.spyOn(prisma.projectTemplate, 'create').mockResolvedValueOnce({
      id: 'template-123',
      ...dto,
      createdByAdminId: adminId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create(dto, adminId);

    expect(result.isSuccess).toBe(true);
    expect(result.value.id).toBe('template-123');
  });
});
```

---

## Debugging

### Debug Mode

```bash
npm run start:debug

# Then attach debugger in VSCode
# .vscode/launch.json:
{
  "type": "node",
  "request": "attach",
  "name": "Attach",
  "port": 9229,
  "skipFiles": ["<node_internals>/**"]
}
```

### Logging

Add debug statements:
```typescript
import { Logger } from '@nestjs/common';

export class MyService {
  private readonly logger = new Logger('MyService');

  async create(dto) {
    this.logger.debug(`Creating with: ${JSON.stringify(dto)}`);
    // ... logic
    this.logger.log(`Created successfully: ${id}`);
  }
}
```

Run with debug logging:
```bash
DEBUG=* npm run start:dev
```

### Database Debugging

```bash
# View all queries in real-time
npx prisma studio

# Or enable Prisma logging in .env
DATABASE_LOG=query,error,warn,info

# Or in code:
const prisma = new PrismaClient({
  log: ['query', 'error', 'warn', 'info'],
});
```

### WebSocket Debugging

Check Socket.IO namespace:
```javascript
// In browser console
io('http://localhost:5122/notifications', { auth: { token: 'YOUR_TOKEN' } })
  .on('connect', () => console.log('Connected'))
  .on('notification', (data) => console.log('Notification:', data))
```

---

## Git Workflow

### Creating a Feature Branch

```bash
git checkout -b feat/project-templates

# Make changes, commit frequently
git add .
git commit -m "feat: add project templates module"

# Push to origin
git push -u origin feat/project-templates

# Create pull request
gh pr create --title "Add project templates" --body "..."
```

### Code Review Checklist

Before submitting PR:
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (80%+ coverage)
- [ ] `npx tsc --noEmit` passes
- [ ] New endpoints documented in controller JSDoc
- [ ] Sensitive operations logged to audit
- [ ] Error messages are user-friendly
- [ ] No hardcoded secrets
- [ ] Database migrations included
- [ ] API response format consistent (Result<T> pattern)

---

## Performance Tips

### 1. Database Queries

**Bad:**
```typescript
const projects = await this.prisma.project.findMany();
for (const p of projects) {
  const pm = await this.prisma.appUser.findUnique({where: {id: p.projectManagerId}});
  // N+1 query problem!
}
```

**Good:**
```typescript
const projects = await this.prisma.project.findMany({
  include: { projectManager: true }
});
// Single query with join
```

### 2. Pagination

```typescript
// Limit results
const projects = await this.prisma.project.findMany({
  take: 20,
  skip: (page - 1) * 20,
  orderBy: { createdAt: 'desc' }
});
```

### 3. Selecting Fields

```typescript
// Don't fetch unnecessary fields
const users = await this.prisma.appUser.findMany({
  select: { id: true, firstName: true, lastName: true, email: true }
  // Omit passwordHash, preferences, etc. unless needed
});
```

### 4. Indexing

Add indexes in Prisma schema:
```prisma
model Project {
  id String @id @default(cuid())
  projectManagerId String?
  status String
  
  @@index([projectManagerId])
  @@index([status])
}
```

---

## Troubleshooting Common Issues

### Build Fails with Module Not Found

```
Error: Cannot find module 'src/app.module.js'
```

**Solution:**
```bash
# Ensure imports have .js extensions
import { AppModule } from './app.module.js'

# Rebuild
npm run build
```

### Prisma Client Not Generating

```bash
# Regenerate Prisma Client
npx prisma generate

# Verify schema
npx prisma validate

# Format schema
npx prisma format
```

### Database Connection Refused

```bash
# Check MariaDB is running
mysql -h localhost -u root -p -e "SELECT 1"

# Check connection string in .env
DATABASE_URL="mysql://root:password@localhost:3306/neoleadge"

# Verify database exists
mysql -e "SHOW DATABASES" | grep neoleadge
```

### JWT Token Invalid

```bash
# Verify token expiration
# Decode at https://jwt.io

# Check JWT_SECRET matches between backend and frontend
echo $JWT_SECRET

# Reset token by calling /auth/login again
```

### WebSocket Not Connecting

```bash
# Check namespace is correct
io('http://localhost:5122/notifications')

# Check token is valid
auth: { token: 'your-jwt-here' }

# Check CORS settings
# Should allow origin: '*' in @WebSocketGateway

# Verify IoAdapter registered in main.ts
app.useWebSocketAdapter(new IoAdapter(app))
```

---

## Resources

- [NestJS Docs](https://docs.nestjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Socket.IO Docs](https://socket.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Jest Testing Docs](https://jestjs.io/docs/getting-started)

---
