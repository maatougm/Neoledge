import { Module } from '@nestjs/common';
import { TeamPlannerService } from './team-planner.service.js';
import { TeamPlannerController, AdminTeamPlannerController } from './team-planner.controller.js';

@Module({
  controllers: [TeamPlannerController, AdminTeamPlannerController],
  providers: [TeamPlannerService],
  exports: [TeamPlannerService],
})
export class TeamPlannerModule {}
