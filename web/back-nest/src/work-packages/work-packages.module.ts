import { Module } from '@nestjs/common';
import { WorkPackagesService } from './work-packages.service.js';
import { WorkPackagesController, WorkPackageCustomFieldsController, MyTasksController } from './work-packages.controller.js';
import { WpCommentsService } from './wp-comments.service.js';
import { WpCommentsController } from './wp-comments.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AutomationModule } from '../automation/automation.module.js';

@Module({
  imports: [NotificationsModule, AutomationModule],
  controllers: [WorkPackagesController, WorkPackageCustomFieldsController, WpCommentsController, MyTasksController],
  providers: [WorkPackagesService, WpCommentsService],
  exports: [WorkPackagesService],
})
export class WorkPackagesModule {}
