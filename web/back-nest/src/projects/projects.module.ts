import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { PmController } from './pm.controller.js';
import { SpecReviewsController } from './spec-reviews.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PhaseGateService } from './phase-gate.service.js';
import { AutomationModule } from '../automation/automation.module.js';
import { UsersModule } from '../users/users.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';

@Module({
  imports: [NotificationsModule, AutomationModule, UsersModule, AnalyticsModule],
  controllers: [ProjectsController, PmController, SpecReviewsController],
  providers: [ProjectsService, PhaseGateService, ProjectAccessGuard],
  exports: [ProjectsService, PhaseGateService],
})
export class ProjectsModule {}
