import { Module } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service.js';
import { TimeEntriesController, ProjectTimeEntriesController, HourlyRatesController } from './time-tracking.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [TimeEntriesController, ProjectTimeEntriesController, HourlyRatesController],
  providers: [TimeTrackingService, ProjectAccessGuard],
  exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
