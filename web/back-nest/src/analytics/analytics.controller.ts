import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('api/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
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
