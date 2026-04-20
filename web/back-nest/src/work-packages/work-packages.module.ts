import { Module } from '@nestjs/common';
import { WorkPackagesService } from './work-packages.service.js';
import { WorkPackagesController, WorkPackageCustomFieldsController, MyTasksController } from './work-packages.controller.js';
import { WpCommentsService } from './wp-comments.service.js';
import { WpCommentsController } from './wp-comments.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';

@Module({
  imports: [NotificationsModule, AutomationModule, AnalyticsModule],
  controllers: [WorkPackagesController, WorkPackageCustomFieldsController, WpCommentsController, MyTasksController],
  providers: [WorkPackagesService, WpCommentsService, ProjectAccessGuard],
  exports: [WorkPackagesService],
})
export class WorkPackagesModule {}
