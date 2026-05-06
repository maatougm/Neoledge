import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { AiUsageService } from './ai-usage.service.js'

@Controller('admin/ai-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AiUsageController {
  constructor(private readonly service: AiUsageService) {}

  /**
   * GET /admin/ai-usage/summary?days=30
   *
   * Aggregate AI usage grouped by project + feature for the trailing N days.
   * Admin-only — exposes per-customer token + cost estimates.
   */
  @Get('summary')
  async summary(@Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 30
    const daysBack = Number.isFinite(n) && n > 0 && n <= 365 ? n : 30
    return this.service.summaryByProject(daysBack)
  }
}
