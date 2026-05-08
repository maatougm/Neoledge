import { Controller, Get, Post, Patch, Delete, Put, Param, Body, Query, UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkPackagesService } from './work-packages.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CreateWorkPackageDto, UpdateWorkPackageDto, MoveWorkPackageDto, AddDependencyDto, UpsertCustomValuesDto, BulkAssignDto, SuggestAssignmentsDto } from './dto/work-package.dto.js';

interface AuthUser { userId: string; role: string }

@Controller('pm/my-tasks')
@UseGuards(JwtAuthGuard)
export class MyTasksController {
  constructor(private readonly service: WorkPackagesService) {}

  @Get()
  async myTasks(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('projectId') projectId?: string,
    @Query('sprintId') sprintId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const r = await this.service.findForAssignee(user.userId, {
      status, q, projectId, sprintId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  /** Top-N urgent open tasks for the Member dashboard's "À faire aujourd'hui" widget. */
  @Get('today')
  async myTasksToday(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    const r = await this.service.findTodayForAssignee(
      user.userId,
      limit ? parseInt(limit, 10) : 6,
    );
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('pm/projects/:projectId/work-packages')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
export class WorkPackagesController {
  constructor(private readonly service: WorkPackagesService) {}

  @Get()
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
  async findAll(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('priority') priority?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('sprintId') sprintId?: string,
    @Query('versionId') versionId?: string,
    @Query('parentId') parentId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      status, type, priority, assigneeId, sprintId, versionId,
      parentId: parentId === 'null' ? null : parentId,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };
    const r = await this.service.findAll(projectId, filters);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get(':id')
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
  async findOne(@Param('projectId') projectId: string, @Param('id') id: string) {
    const r = await this.service.findOne(id, projectId);
    if (r.isFailure) throw new NotFoundException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('Admin', 'ProjectManager', 'Member')
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkPackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.create(projectId, dto, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id')
  @Roles('Admin', 'ProjectManager', 'Member')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkPackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.update(id, projectId, dto, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('Admin', 'ProjectManager')
  async remove(@Param('projectId') projectId: string, @Param('id') id: string) {
    const r = await this.service.softDelete(id, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Patch(':id/move')
  async move(@Param('id') id: string, @Body() dto: MoveWorkPackageDto) {
    const r = await this.service.moveCard(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post(':id/watchers')
  @HttpCode(HttpStatus.CREATED)
  async addWatcher(
    @Param('id') id: string,
    @Body() body: { userId: string },
    @CurrentUser() currentUser: AuthUser,
  ) {
    // Only allow self-subscription or Admin/PM roles.
    const targetUserId = body.userId;
    const isSelf = targetUserId === currentUser.userId;
    const isPrivileged = currentUser.role === 'Admin' || currentUser.role === 'ProjectManager';
    if (!isSelf && !isPrivileged) {
      throw new BadRequestException('Vous ne pouvez abonner que vous-même.');
    }
    const r = await this.service.addWatcher(id, targetUserId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id/watchers/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeWatcher(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() currentUser: AuthUser,
  ) {
    // Only allow self-removal or Admin/PM roles.
    const isSelf = userId === currentUser.userId;
    const isPrivileged = currentUser.role === 'Admin' || currentUser.role === 'ProjectManager';
    if (!isSelf && !isPrivileged) {
      throw new BadRequestException('Vous ne pouvez désabonner que vous-même.');
    }
    const r = await this.service.removeWatcher(id, userId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post(':id/dependencies')
  @HttpCode(HttpStatus.CREATED)
  async addDependency(@Param('id') id: string, @Body() dto: AddDependencyDto) {
    const r = await this.service.addDependency(id, dto.toWpId, dto.type ?? 'relates');
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id/dependencies/:depId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDependency(@Param('depId') depId: string) {
    const r = await this.service.removeDependency(depId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Put(':id/custom-values')
  async upsertCustomValues(@Param('id') id: string, @Body() dto: UpsertCustomValuesDto) {
    const r = await this.service.upsertCustomValues(id, dto.values || []);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  @Post('bulk-assign')
  @Roles('Admin', 'ProjectManager', 'Member')
  async bulkAssign(
    @Param('projectId') projectId: string,
    @Body() dto: BulkAssignDto,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.bulkAssign(projectId, dto.assignments, user.userId, dto.sprintId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  /**
   * AI-assisted assignment suggestions. PMs select a sprint + N tasks
   * in the UI, then call this endpoint to get ranked assignee proposals
   * per task with rationale. The PM still confirms via the regular
   * bulk-assign endpoint — this is decision-aid only.
   */
  @Post('suggest-assignments')
  @Roles('Admin', 'ProjectManager')
  async suggestAssignments(
    @Param('projectId') projectId: string,
    @Body() dto: SuggestAssignmentsDto,
  ) {
    const r = await this.service.suggestAssignments(projectId, dto.wpIds);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('pm/projects/:projectId/wp-custom-fields')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class WorkPackageCustomFieldsController {
  constructor(private readonly service: WorkPackagesService) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    const r = await this.service.listCustomFields(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { name: string; fieldType: string; options?: string },
  ) {
    if (!body.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createCustomField(projectId, body.name.trim(), body.fieldType || 'text', body.options);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const r = await this.service.deleteCustomField(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }
}
