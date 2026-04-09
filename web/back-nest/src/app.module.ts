import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    AuditModule,
    AuthModule,
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
  ],
})
export class AppModule {}
