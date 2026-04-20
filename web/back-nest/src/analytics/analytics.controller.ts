import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('api/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('analytics.view')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('phase-velocity')
  async getPhaseVelocity() {
    const result = await this.service.getPhaseVelocity();
    return result.value;
  }

  @Get('bottleneck')
  async getBottleneck() {
    const result = await this.service.getBottleneckHeatmap();
    return result.value;
  }

  @Get('deadline-risk')
  async getDeadlineRisk() {
    const result = await this.service.getDeadlineRisk();
    return result.value;
  }

  @Get('team-workload')
  async getTeamWorkload() {
    const result = await this.service.getTeamWorkload();
    return result.value;
  }
}
