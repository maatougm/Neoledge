import { Module } from '@nestjs/common';
import { WorkPackagesService } from './work-packages.service.js';
import { WorkPackagesController, WorkPackageCustomFieldsController, MyTasksController } from './work-packages.controller.js';
import { WpCommentsService } from './wp-comments.service.js';
import { WpCommentsController } from './wp-comments.controller.js';
import { WpAttachmentsService } from './wp-attachments.service.js';
import { WpAttachmentsController } from './wp-attachments.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';

@Module({
  imports: [NotificationsModule, AnalyticsModule],
  controllers: [WorkPackagesController, WorkPackageCustomFieldsController, WpCommentsController, MyTasksController, WpAttachmentsController],
  providers: [WorkPackagesService, WpCommentsService, WpAttachmentsService, ProjectAccessGuard],
  exports: [WorkPackagesService],
})
export class WorkPackagesModule {}
