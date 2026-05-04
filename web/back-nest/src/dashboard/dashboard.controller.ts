import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('api/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'ProjectManager')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  async getStats() {
    const result = await this.service.getStats();
    return result.value;
  }

  @Get('projects-by-status')
  async getByStatus() {
    const result = await this.service.getProjectsByStatus();
    return result.value;
  }

  @Get('pm-workloads')
  async getWorkloads() {
    const result = await this.service.getWorkloads();
    return result.value;
  }

  @Get('recent-activity')
  async getRecentActivity(@Query('count') count = '10') {
    const parsed = parseInt(count, 10);
    const safeCount = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 10;
    const result = await this.service.getRecentActivity(safeCount);
    return result.value;
  }

  @Get('activity-stats')
  async getActivityStats() {
    const result = await this.service.getActivityStats();
    return result.value;
  }

  @Get('overdue-projects')
  async getOverdue() {
    const result = await this.service.getOverdueProjects();
    return result.value;
  }
}
