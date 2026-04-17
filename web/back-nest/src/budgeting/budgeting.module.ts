import { Module } from '@nestjs/common';
import { BudgetingService } from './budgeting.service.js';
import { BudgetingController, AdminBudgetsController } from './budgeting.controller.js';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module.js';

@Module({
  imports: [TimeTrackingModule],
  controllers: [BudgetingController, AdminBudgetsController],
  providers: [BudgetingService],
  exports: [BudgetingService],
})
export class BudgetingModule {}
