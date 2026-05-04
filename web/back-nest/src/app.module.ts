import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
// ThrottlerModule removed — was causing stale 429s due to DI complications
import { randomUUID } from 'node:crypto';
import { PrismaModule } from './prisma/prisma.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { RolesModule } from './roles/roles.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { ExportModule } from './export/export.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { DeadlinesModule } from './deadlines/deadlines.module.js';
import { MailModule } from './mail/mail.module.js';
import { SavedFiltersModule } from './filters/saved-filters.module.js';
import { ChecklistsModule } from './checklists/checklists.module.js';
import { AuditModule } from './audit/audit.module.js';
import { SystemStatusModule } from './system-status/system-status.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AiModule } from './ai/ai.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { WorkPackagesModule } from './work-packages/work-packages.module.js';
import { GanttModule } from './gantt/gantt.module.js';
import { AgileModule } from './agile/agile.module.js';
import { TimeTrackingModule } from './time-tracking/time-tracking.module.js';
import { WikiModule } from './wiki/wiki.module.js';
import { TeamPlannerModule } from './team-planner/team-planner.module.js';
import { SearchModule } from './search/search.module.js';
import { HealthModule } from './health/health.module.js';
import { TeamsModule } from './teams/teams.module.js';
import { CahierDesChargesModule } from './cahier-des-charges/cahier-des-charges.module.js';
import { ProjectMembersModule } from './project-members/project-members.module.js';

@Module({
  providers: [],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate(config: Record<string, unknown>) {
        const errors: string[] = [];

        // Required variables
        const required: Array<{ key: string; minLen?: number }> = [
          { key: 'JWT_SECRET', minLen: 32 },
          { key: 'DATABASE_URL' },
          { key: 'TRANSCRIPTION_URL' },
          { key: 'TRANSCRIPTION_SECRET' },
        ];
        for (const { key, minLen } of required) {
          const val = config[key];
          if (!val || String(val).trim() === '') {
            errors.push(`${key} is required`);
          } else if (minLen !== undefined && String(val).length < minLen) {
            errors.push(`${key} must be at least ${minLen} characters`);
          }
        }

        // CORS_ORIGINS — warn but allow default in dev
        if (!config['CORS_ORIGINS'] && config['NODE_ENV'] === 'production') {
          errors.push('CORS_ORIGINS is required in production');
        }

        if (errors.length > 0) {
          throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
        }
        return config;
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Generate / propagate a request ID per HTTP call so every log line
        // emitted while handling that request can be grouped together.
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customProps: (req) => ({ reqId: (req as { id?: string }).id }),
        // Quiet routine traffic; surface anything 4xx+ at warn/error.
        customLogLevel: (_req, res, err) => {
          if (err) return 'error';
          if (res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        // Drop /health spam from production logs.
        autoLogging: { ignore: (req) => req.url === '/health' },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-transcription-secret"]',
            'req.headers["x-api-key"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.tempPassword',
            'req.body.token',
            'req.body.tempToken',
            'req.body.jwt',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        transport: process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname,req,res,responseTime',
                messageFormat: '{msg} [{reqId}] {method} {url} {statusCode} ({responseTime}ms)',
              },
            },
      },
    }),
    PrismaModule,
    PermissionsModule,
    MailModule,
    AuditModule,
    AuthModule,
    RolesModule,
    UsersModule,
    ProjectsModule,
    MeetingsModule,
    CommentsModule,
    AttachmentsModule,
    DashboardModule,
    ExportModule,
    TemplatesModule,
    ProfileModule,
    NotificationsModule,
    DeadlinesModule,
    SavedFiltersModule,
    ChecklistsModule,
    SystemStatusModule,
    AnalyticsModule,
    AiModule,
    CollaborationModule,
    AutomationModule,
    WorkPackagesModule,
    GanttModule,
    AgileModule,
    TimeTrackingModule,
    WikiModule,
    TeamPlannerModule,
    SearchModule,
    HealthModule,
    TeamsModule,
    CahierDesChargesModule,
    ProjectMembersModule,
  ],
})
export class AppModule {}
