import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';

interface AuthUser { userId: string; role: string }

@Controller('api/time-entries')
@UseGuards(JwtAuthGuard)
export class TimeEntriesController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get()
  async findMy(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId') projectId?: string,
    @Query('workPackageId') workPackageId?: string,
  ) {
    const r = await this.service.findMyEntries(user.userId, { from, to, projectId, workPackageId });
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: { projectId: string; workPackageId?: string; hours: number; spentOn: string; activity?: string; comment?: string; isBillable?: boolean },
  ) {
    const r = await this.service.create(user.userId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: { hours?: number; spentOn?: string; activity?: string; comment?: string; isBillable?: boolean; workPackageId?: string | null },
  ) {
    const r = await this.service.update(id, user.userId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const r = await this.service.delete(id, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Get('week')
  async getWeek(
    @CurrentUser() user: AuthUser,
    @Query('weekStart') weekStart: string,
    @Query('timezone') timezone?: string,
  ) {
    if (!weekStart) throw new BadRequestException('weekStart requis.');
    // [Fix-3] Forward optional timezone (defaults to Europe/Paris in service).
    const r = await this.service.getWeeklyGrid(user.userId, weekStart, timezone);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('lock')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async lock(
    @Body() body: { from: string; to: string; userId?: string },
  ) {
    // [Fix-6] Role check moved to RolesGuard + @Roles decorator so the guard
    // is honoured by internal callers too and returns 403 (not 400) for non-Admin.
    const r = await this.service.lockPeriod(body.from, body.to, body.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('pm/projects/:projectId/time-entries')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class ProjectTimeEntriesController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const r = await this.service.findProjectEntries(projectId, { from, to, userId });
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('summary')
  async getSummary(@Param('projectId') projectId: string) {
    const r = await this.service.getSummary(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('admin/hourly-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class HourlyRatesController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get()
  async list() {
    const r = await this.service.listRates();
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: { userId: string; projectId?: string; rate: number; currency?: string; validFrom: string; validTo?: string }) {
    const r = await this.service.createRate(dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { rate?: number; currency?: string; validTo?: string | null }) {
    const r = await this.service.updateRate(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const r = await this.service.deleteRate(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }
}
