import { Module } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service.js';
import { TimeEntriesController, ProjectTimeEntriesController, HourlyRatesController } from './time-tracking.controller.js';

@Module({
  controllers: [TimeEntriesController, ProjectTimeEntriesController, HourlyRatesController],
  providers: [TimeTrackingService],
  exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
