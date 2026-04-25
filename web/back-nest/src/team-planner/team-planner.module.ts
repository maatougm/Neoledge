import { Module } from '@nestjs/common';
import { TeamPlannerService } from './team-planner.service.js';
import { TeamPlannerController } from './team-planner.controller.js';

@Module({
  controllers: [TeamPlannerController],
  providers: [TeamPlannerService],
  exports: [TeamPlannerService],
})
export class TeamPlannerModule {}
