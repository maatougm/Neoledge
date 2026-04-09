# Real-Time Features Guide

**Last Updated:** April 9, 2026

This document covers the real-time WebSocket notification system and audit logging features.

---

## Overview

### Three Pillars of Real-Time System

1. **WebSocket Notifications** — Real-time in-app event delivery via Socket.IO
2. **Audit Logging** — Immutable audit trail of all actions
3. **Email Notifications** — Optional async email delivery

```
┌─────────────────────────────────────────────────────────────┐
│ When Project Status Changes                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ProjectsService.updateStatus()                         │
│     ↓                                                       │
│  2. Persist to database (Project.status updated)           │
│     ↓                                                       │
│  3. (void) AuditService.log()                              │
│     → INSERT INTO AuditLog with before/after values        │
│     ↓ (async, fire-and-forget)                             │
│                                                             │
│  4. (void) NotificationsService.notify()                   │
│     → INSERT INTO Notification                             │
│     → Emit WebSocket event to user room                    │
│     → Send email (if opted in)                             │
│     ↓ (async, fire-and-forget, any errors silenced)        │
│                                                             │
│  5. Return to controller                                   │
│     ↓                                                       │
│  6. HTTP response 200 OK                                   │
│     (Project updated, notified user in real-time)          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## WebSocket Notifications

### Architecture

**Gateway:** `src/notifications/notifications.gateway.ts`

```typescript
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/notifications'
})
export class NotificationsGateway {
  handleConnection(client: Socket) {
    // 1. Extract JWT from handshake
    const token = client.handshake.auth.token
    
    // 2. Verify JWT
    const payload = this.jwtService.verify(token, { secret })
    
    // 3. Join user's private room
    client.join(`user:${payload.sub}`)
    // client.sub = userId
  }
  
  emitToUser(userId: string, payload: NotificationPayload) {
    // Broadcast to all sockets in room
    this.server.to(`user:${userId}`).emit('notification', payload)
  }
}
```

### Connection Flow

```
Frontend (Vue component)
  │
  ├─► socket = io('http://localhost:5122/notifications', {
  │       auth: { token: jwtToken }  // Pass JWT
  │     })
  │
  └─► NotificationsGateway.handleConnection(socket)
        │
        ├─► Extract token from handshake.auth.token
        │
        ├─► Verify with JwtService
        │   • If invalid → client.disconnect(true)
        │   • If valid → continue
        │
        ├─► Extract userId from payload.sub
        │
        └─► socket.join(`user:${userId}`)
              Frontend socket is now subscribed to events
              sent to that room
```

### Event Delivery

When a notification is created:

```typescript
// NotificationsService.notify()
const notification = await this.prisma.notification.create({
  data: {
    userId: 'user-123',
    type: 'project.assigned',
    title: 'New Project',
    message: 'You have been assigned to Acme Project',
    projectId: 'project-456'
  }
})

// Emit to user's room
this.gateway.emitToUser('user-123', notification)
```

Backend emits:
```
To: room 'user:user-123'
Event: 'notification'
Payload: {
  id: 'notif-789',
  type: 'project.assigned',
  title: 'New Project',
  message: 'You have been assigned to Acme Project',
  projectId: 'project-456',
  isRead: false,
  createdAt: 2026-04-09T...
}
```

Frontend receives:
```typescript
// In useNotificationSocket() composable
socket.on('notification', (payload) => {
  // 1. Add to Pinia store
  const store = useNotificationStore()
  store.addNotification(payload)
  
  // 2. Show toast
  const toast = useNeoToast()
  toast.add({
    severity: 'info',
    summary: payload.title,
    detail: payload.message,
    life: 5000
  })
  
  // 3. Update badge/counter
  store.incrementUnreadCount()
})
```

### Room-Based Isolation

Key security feature: Users only receive their own notifications.

```typescript
// Admin receives notification
this.gateway.emitToUser('admin-123', notificationForAdmin)

// User-123 is in room 'user:user-123'
// Admin-123 is in room 'user:admin-123'
// User-123 never receives events sent to admin-123's room
```

### NotificationPayload Interface

```typescript
interface NotificationPayload {
  id: string                // UUID
  type: string              // 'project.assigned', 'project.status_changed', etc.
  title: string             // Display title
  message: string           // Display message
  projectId: string | null  // Related project (nullable)
  isRead: boolean           // Has user read it?
  createdAt: Date           // Timestamp
}
```

### Notification Types

Defined in business logic (not enum, string-based):

| Type | Triggered By | Recipient | Example |
|------|--------------|-----------|---------|
| `project.created` | Admin creates project | Assigned PM | "New Project: Acme" |
| `project.status_changed` | Status transition | PM, stakeholders | "Status: Draft → InProgress" |
| `project.assigned` | PM assigned to project | PM | "You're assigned to Acme Project" |
| `comment.added` | User comments | PM, stakeholders | "New comment on Acme Project" |
| `meeting.scheduled` | Meeting created | Attendees | "Meeting: 2026-04-15 10:00 AM" |
| `deadline.approaching` | Deadline < 7 days | PM | "Deadline in 5 days: Deliverable X" |
| `checklist.completed` | Phase checklist done | PM, admin | "Realization phase checklist complete" |

### HTTP REST API

Complement to WebSocket — get/manage notifications via HTTP:

```
GET    /api/notifications              Get all notifications for user
POST   /api/notifications/:id/read     Mark single as read
POST   /api/notifications/read-all     Mark all as read
DELETE /api/notifications/:id          Delete notification
GET    /api/notifications/unread-count Get count of unread
```

### Database Schema

```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // 'project.assigned', 'comment.added', etc.
  title     String
  message   String
  projectId String?  // Context — which project triggered this?
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
  
  user      AppUser  @relation(fields: [userId], references: [id])
  project   Project? @relation(fields: [projectId], references: [id])
  
  @@index([userId])
  @@index([isRead])
  @@index([createdAt])
}
```

---

## Audit Logging

### Architecture

**Module:** `src/audit/` — Registered as `@Global()` so any service can inject `AuditService` without explicit import.

```typescript
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService]
})
export class AuditModule {}
```

### Fire-and-Forget Design

Unlike notifications (which require real-time delivery), audit logs use true fire-and-forget:

```typescript
// In ProjectsService.updateStatus()
const updated = await this.prisma.project.update({...})

// Fire-and-forget: Log the change
// Do NOT await — let it happen in background
void this.auditService.log(
  'Project',
  projectId,
  'STATUS_CHANGE',
  userId,
  {
    status: {
      before: oldProject.status,
      after: updated.status
    }
  }
)

// Immediately return to caller
// Audit log will be persisted eventually (or silently fail)
```

**Why fire-and-forget?**
- Audit failure must never break business logic
- User shouldn't wait for audit persistence
- Errors are handled internally (logged, not thrown)

### Logging API

```typescript
// Basic log (minimal)
await this.auditService.log(
  entityType: string,
  entityId: string,
  action: AuditAction
)

// With user context
await this.auditService.log(
  entityType: string,
  entityId: string,
  action: AuditAction,
  userId: string
)

// With change tracking (before/after)
await this.auditService.log(
  entityType: string,
  entityId: string,
  action: AuditAction,
  userId: string,
  changes: Record<string, { before: unknown, after: unknown }>
)

// With custom metadata
await this.auditService.log(
  entityType: string,
  entityId: string,
  action: AuditAction,
  userId: string,
  changes: {...},
  metadata: Record<string, unknown>  // max 1000 chars
)
```

### Usage Examples

#### Example 1: Project Creation

```typescript
async create(dto: CreateProjectDto, adminId: string) {
  const project = await this.prisma.project.create({
    data: {
      name: dto.name,
      clientName: dto.clientName,
      description: dto.description,
      status: 'Draft',
      createdByAdminId: adminId
    }
  })
  
  // Log the creation
  void this.auditService.log(
    'Project',
    project.id,
    'CREATE',
    adminId,
    undefined,  // No "before" value for creation
    {
      clientName: dto.clientName,
      initiator: 'API'
    }
  )
  
  return Result.ok(project)
}
```

**Audit record created:**
```
{
  id: 'audit-001',
  entityType: 'Project',
  entityId: 'project-123',
  action: 'CREATE',
  userId: 'admin-456',
  user: 'John Doe (Admin)',
  changes: null,
  metadata: { clientName: 'Acme Corp', initiator: 'API' },
  createdAt: 2026-04-09T10:00:00Z
}
```

#### Example 2: Status Transition

```typescript
async updateStatus(
  projectId: string,
  newStatus: ProjectStatus,
  userId: string
) {
  const old = await this.prisma.project.findUnique({
    where: { id: projectId }
  })
  
  const updated = await this.prisma.project.update({
    where: { id: projectId },
    data: { status: newStatus }
  })
  
  // Log the state change with before/after
  void this.auditService.log(
    'Project',
    projectId,
    'STATUS_CHANGE',
    userId,
    {
      status: {
        before: old.status,
        after: newStatus
      }
    }
  )
  
  return Result.ok(updated)
}
```

**Audit record created:**
```
{
  entityType: 'Project',
  entityId: 'project-123',
  action: 'STATUS_CHANGE',
  userId: 'pm-789',
  user: 'Jane Smith (ProjectManager)',
  changes: {
    status: {
      before: 'Draft',
      after: 'InProgress'
    }
  },
  metadata: null,
  createdAt: 2026-04-09T11:30:00Z
}
```

#### Example 3: User Authentication

```typescript
// In AuthService.login()
async login(email: string, password: string) {
  const user = await this.findByEmail(email)
  const isValid = await bcrypt.compare(password, user.passwordHash)
  
  if (isValid) {
    const token = this.jwtService.sign({sub: user.id})
    
    // Log successful login
    void this.auditService.log(
      'AppUser',
      user.id,
      'LOGIN',
      user.id,
      undefined,
      { ip: request.ip, userAgent: request.get('user-agent') }
    )
    
    return Result.ok({token})
  } else {
    // Log failed attempt
    void this.auditService.log(
      'AppUser',
      email,
      'LOGIN',  // Still log (with email instead of ID)
      undefined,
      undefined,
      { success: false, reason: 'invalid_password' }
    )
    
    return Result.fail('Invalid credentials')
  }
}
```

### AuditAction Types

```typescript
type AuditAction =
  | 'CREATE'              // Entity created
  | 'UPDATE'              // Entity updated
  | 'DELETE'              // Entity deleted
  | 'LOGIN'               // User logged in
  | 'LOGOUT'              // User logged out
  | 'STATUS_CHANGE'       // Project status changed
  | 'ASSIGN'              // Project manager assigned
  | 'VALIDATE'            // Entity validated/approved
  | 'RESET_PASSWORD'      // Password reset
  | 'TOTP_ENABLED'        // 2FA enabled
  | 'TOTP_DISABLED'       // 2FA disabled
```

### Querying Audit Logs

#### Via Service (Internal)

```typescript
// Get all logs for a project
const result = await this.auditService.getForEntity('Project', projectId)
if (result.isSuccess) {
  const logs = result.value
  // logs: Array<AuditDto>
}

// Get all logs by a user
const result = await this.auditService.getForUser(userId)

// Get recent logs (limit 50)
const result = await this.auditService.getRecent(50)
```

#### Via REST API (Admin only)

```
GET /api/audit
  → Returns 50 most recent audit logs
  → Response: { logs: AuditDto[] }

GET /api/audit/Project/project-123
  → Returns all logs for that project
  → Response: { logs: AuditDto[] }
```

### Database Schema

```prisma
model AuditLog {
  id        String    @id @default(cuid())
  entityType String   // 'Project', 'AppUser', 'Meeting', etc.
  entityId  String    // UUID or identifier of the entity
  action    String    // 'CREATE', 'STATUS_CHANGE', etc.
  userId    String?   // Who performed action (nullable)
  changes   Json?     // {fieldName: {before, after}, ...}
  metadata  String?   // Custom context (max 1000 chars)
  createdAt DateTime  @default(now())
  
  user      AppUser?  @relation(fields: [userId], references: [id])
  
  @@index([entityType, entityId])
  @@index([userId])
  @@index([action])
  @@index([createdAt])
}
```

### DTO Output Format

```typescript
interface AuditDto {
  id: string
  entityType: string
  entityId: string
  action: string
  userId: string | null
  user: string | null                          // "John Doe"
  userRole: 'Admin' | 'ProjectManager' | null
  changes: Record<string, {before; after}> | null
  metadata: Record<string, unknown> | null
  createdAt: Date
}
```

---

## Email Notifications

### Configuration

Add SMTP settings to `.env`:

```bash
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=noreply@example.com
SMTP_TLS=true
```

For development, use **Mailhog**:

```bash
docker run -d \
  --name mailhog \
  -p 1025:1025 \
  -p 8025:8025 \
  mailhog/mailhog

# View emails in UI: http://localhost:8025
```

Then use in `.env`:

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=dev@localhost
SMTP_TLS=false
```

### User Preferences

Users can opt in/out of email notifications:

```typescript
// AppUser schema
model AppUser {
  id String @id
  preferences Json?  // {emailNotifications: true/false}
}

// Example preferences JSON:
{
  "emailNotifications": true,
  "theme": "dark",
  "language": "fr"
}
```

### Default Behavior

If `preferences.emailNotifications` is not set, default is `true` (opt-in by default).

```typescript
// In NotificationsService.notify()
const user = await this.prisma.appUser.findUnique({...})
const prefs = parsePreferences(user.preferences)
const wantsEmail = prefs.emailNotifications !== false  // Default true

if (wantsEmail) {
  await this.mail.send(user.email, title, html)
}
```

### HTML Email Template

Built-in generic template:

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>{{title}}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="560" style="background:#ffffff;border-radius:6px;">
        <tr><td style="background:#0d9488;padding:20px 28px;">
          <span style="color:#fff;font-size:20px;font-weight:700;">
            NeoLeadge
          </span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h2 style="margin:0 0 12px 0;">{{title}}</h2>
          <p style="margin:0;color:#374151;line-height:1.6;">
            {{message}}
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
            Email automatique — merci de ne pas y répondre.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

### Custom Email Sender

Services can send custom emails via `MailService`:

```typescript
// In any service
constructor(private readonly mail: MailService) {}

async sendCustomEmail(userEmail: string) {
  const html = `
    <h1>Custom Title</h1>
    <p>Custom HTML content</p>
  `
  await this.mail.send(userEmail, 'Subject', html)
}
```

---

## Integration with Feature Services

### How Other Services Trigger Notifications

Example: `ProjectsService.assignProjectManager()`

```typescript
async assignProjectManager(projectId: string, pmId: string, adminId: string) {
  const project = await this.prisma.project.update({
    where: { id: projectId },
    data: { projectManagerId: pmId },
    include: { projectManager: true }
  })
  
  // 1. Notify the PM they're assigned
  void this.notificationsService.notify(
    pmId,
    'project.assigned',
    'New Project Assignment',
    `You have been assigned to: ${project.name}`,
    projectId
  )
  
  // 2. Notify admin of the assignment
  void this.notificationsService.notify(
    adminId,
    'project.manager_assigned',
    'Manager Assigned',
    `${project.projectManager.firstName} assigned to ${project.name}`,
    projectId
  )
  
  // 3. Log the action
  void this.auditService.log(
    'Project',
    projectId,
    'ASSIGN',
    adminId,
    { projectManagerId: { before: null, after: pmId } }
  )
  
  return Result.ok(project)
}
```

**Flow:**
1. Database updated (immediate)
2. Return HTTP 200 (immediate)
3. WebSocket event delivered (within seconds)
4. Email sent (within minutes, if configured)
5. Audit log created (within seconds)

All notifications and logs are fire-and-forget — user sees result immediately.

---

## Best Practices

### 1. Always Fire-and-Forget

```typescript
// ✓ Correct
void this.auditService.log(...)
void this.notificationsService.notify(...)

// ✗ Wrong
await this.auditService.log(...)  // Blocks user waiting for audit
await this.notificationsService.notify(...)  // Blocks user waiting for notification
```

### 2. Meaningful Notification Types

```typescript
// ✓ Good
'project.assigned'
'project.status_changed'
'deadline.approaching'
'checklist.completed'

// ✗ Generic
'update'
'event'
'action'
```

### 3. Contextual Metadata

```typescript
// ✓ Include context
void this.auditService.log(
  'Project',
  projectId,
  'STATUS_CHANGE',
  userId,
  {status: {before: 'Draft', after: 'InProgress'}},
  {source: 'mobile_app', ip: request.ip}
)

// ✗ Missing context
void this.auditService.log('Project', projectId, 'UPDATE')
```

### 4. User-Friendly Messages

```typescript
// ✓ Descriptive
title: 'Project Status Updated',
message: 'Acme Project has moved from Draft to InProgress'

// ✗ Technical
title: 'Status',
message: 'DRAFT → INPROGRESS'
```

### 5. Handle Notification Failures Gracefully

Since services call notify() without awaiting, service code must be robust:

```typescript
// In service
async create(dto: CreateProjectDto, adminId: string) {
  // Create always succeeds regardless of notification outcome
  const project = await this.prisma.project.create({...})
  
  // Notify — but don't block on error
  void this.notificationsService.notify(...)
  
  // Always return success to caller
  return Result.ok(project)
}
```

---

## Troubleshooting

### Notifications Not Appearing

**Check 1:** Is WebSocket connected?
```javascript
// In browser console
socket.connected  // Should be true
socket.id         // Should show socket ID
```

**Check 2:** Is JWT valid?
```javascript
// Decode your token at jwt.io
// Check 'sub' claim matches your user ID
```

**Check 3:** Is event being emitted?
```typescript
// Add logging in NotificationsService.notify()
this.logger.log(`Emitting to user:${userId}`)
```

**Check 4:** Check database
```sql
SELECT * FROM Notification WHERE userId = 'your-id' ORDER BY createdAt DESC LIMIT 5
```

### Emails Not Sending

**Check 1:** SMTP configured?
```bash
echo $SMTP_HOST
echo $SMTP_PORT
echo $SMTP_FROM
```

**Check 2:** User opted in?
```sql
SELECT preferences FROM AppUser WHERE id = 'user-id'
-- Should include: {"emailNotifications": true}
```

**Check 3:** Check application logs
```bash
npm run start:dev 2>&1 | grep -i "email\|mail\|smtp"
```

### Audit Logs Not Recording

**Check 1:** Is AuditModule imported?
```typescript
// In app.module.ts
imports: [AuditModule, ...]
```

**Check 2:** Check database
```sql
SELECT COUNT(*) FROM AuditLog
SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT 5
```

**Check 3:** Enable debug logging
```typescript
// In audit.service.ts
this.logger.debug(`Logging: ${action} on ${entityType}:${entityId}`)
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Notification Delivery Rate**
   - Query: `SELECT COUNT(*) FROM Notification WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)`
   - Alert: If < expected volume

2. **Email Send Rate**
   - Monitor SMTP logs
   - Alert: If send failures > 5% of attempts

3. **Audit Log Lag**
   - Query: `SELECT MAX(createdAt) FROM AuditLog`
   - Should be within seconds of current time

4. **WebSocket Connection Count**
   - Check NotificationsGateway metrics
   - Monitor for unexplained disconnects

---

## Security Considerations

1. **WebSocket Auth:** JWT must be verified before room assignment
2. **Room Isolation:** Users only receive events for `user:{their-id}` room
3. **Audit Trail:** Immutable record of all sensitive actions
4. **Email Verification:** Email addresses validated before sending
5. **Sensitive Data:** Passwords/tokens never logged in audit

---
