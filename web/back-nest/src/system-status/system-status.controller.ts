import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemStatusService } from './system-status.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('admin/SystemStatus')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  async getStatus() {
    return this.service.getStatus();
  }
}
