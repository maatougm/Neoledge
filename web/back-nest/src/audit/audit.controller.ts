import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('api/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  async getRecent(@Query('limit') limit?: string) {
    const result = await this.service.getRecent(limit ? Math.min(Number(limit), 200) : 50);
    return result.value;
  }

  @Get(':entityType/:entityId')
  async getForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const result = await this.service.getForEntity(entityType, entityId);
    return result.value;
  }
}
