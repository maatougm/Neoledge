import { Controller, Get, Patch, Param, Body, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { TeamPlannerService } from './team-planner.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

interface AuthenticatedRequest extends Request {
  user?: { userId: string };
}

@Controller('pm/team-planner')
@UseGuards(JwtAuthGuard)
export class TeamPlannerController {
  constructor(private readonly service: TeamPlannerService) {}

  @Get()
  async getAssignments(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('userIds') userIds?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    if (!from || !to) throw new BadRequestException('from et to requis.');
    const r = await this.service.getAssignments({
      from, to,
      userIds: userIds ? userIds.split(',').filter(Boolean) : undefined,
      projectIds: projectIds ? projectIds.split(',').filter(Boolean) : undefined,
    });
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('capacity')
  async getCapacity(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new BadRequestException('from et to requis.');
    const r = await this.service.getCapacity(from, to);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('conflicts')
  async getConflicts(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new BadRequestException('from et to requis.');
    const r = await this.service.getConflicts(from, to);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('work-packages/:wpId/reassign')
  async reassign(
    @Param('wpId') wpId: string,
    @Body() dto: { assigneeId: string; startDate?: string; dueDate?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.service.reassign(wpId, dto, req.user?.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

// AdminTeamPlannerController removed in Sprint Transformation 6:
// the /admin/team-planner/utilization endpoint had no remaining UI consumer
// (PM-only view since Sprint 2). The service.getUtilization() method is
// kept in case a future cross-project admin dashboard wants to reuse it.
