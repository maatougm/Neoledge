import { Module } from '@nestjs/common';
import { TeamPlannerService } from './team-planner.service.js';
import { TeamPlannerController } from './team-planner.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [TeamPlannerController],
  providers: [TeamPlannerService],
  exports: [TeamPlannerService],
})
export class TeamPlannerModule {}
