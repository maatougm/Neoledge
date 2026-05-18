import { Module } from '@nestjs/common';
import { AgileService } from './agile.service.js';
import { AgileController } from './agile.controller.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [CollaborationModule, NotificationsModule],
  controllers: [AgileController],
  providers: [AgileService, ProjectAccessGuard],
  exports: [AgileService],
})
export class AgileModule {}
