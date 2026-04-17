import { Controller, Get, Patch, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { TeamPlannerService } from './team-planner.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

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
  ) {
    const r = await this.service.reassign(wpId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('admin/team-planner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AdminTeamPlannerController {
  constructor(private readonly service: TeamPlannerService) {}

  @Get('utilization')
  async utilization(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new BadRequestException('from et to requis.');
    const r = await this.service.getUtilization(from, to);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
