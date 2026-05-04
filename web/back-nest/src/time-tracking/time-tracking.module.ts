import { Module } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service.js';
import { TimeEntriesController, ProjectTimeEntriesController } from './time-tracking.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [TimeEntriesController, ProjectTimeEntriesController],
  providers: [TimeTrackingService, ProjectAccessGuard],
  exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
