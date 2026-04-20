import { Module } from '@nestjs/common';
import { BudgetingService } from './budgeting.service.js';
import { BudgetingController, AdminBudgetsController } from './budgeting.controller.js';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [TimeTrackingModule],
  controllers: [BudgetingController, AdminBudgetsController],
  providers: [BudgetingService, ProjectAccessGuard],
  exports: [BudgetingService],
})
export class BudgetingModule {}
