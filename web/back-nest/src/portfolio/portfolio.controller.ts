import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { PortfolioService } from './portfolio.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';

interface AuthUser { userId: string }

@Controller('admin/portfolios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  @Get()
  async list() {
    const r = await this.service.listPortfolios();
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: { name: string; description?: string }, @CurrentUser() user: AuthUser) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createPortfolio(dto, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const r = await this.service.getPortfolio(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { name?: string; description?: string }) {
    const r = await this.service.updatePortfolio(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const r = await this.service.deletePortfolio(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post(':id/projects')
  async addProject(@Param('id') id: string, @Body() body: { projectId: string; position?: number }) {
    const r = await this.service.addProject(id, body.projectId, body.position);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id/projects/reorder')
  async reorder(@Param('id') id: string, @Body() body: { order: string[] }) {
    const r = await this.service.reorderProjects(id, body.order);
    if (r.isFailure) throw new BadRequestException(r.error);
    return { success: true };
  }

  @Delete(':id/projects/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProject(@Param('id') id: string, @Param('projectId') projectId: string) {
    const r = await this.service.removeProject(id, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Get(':id/roadmap')
  async roadmap(@Param('id') id: string) {
    const r = await this.service.getRoadmap(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}

@Controller('pm/projects/:projectId/versions')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class VersionsController {
  constructor(private readonly service: PortfolioService) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    const r = await this.service.listVersions(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: { name: string; description?: string; startDate?: string; endDate?: string },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom requis.');
    const r = await this.service.createVersion(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: { name?: string; description?: string; startDate?: string; endDate?: string; status?: string }) {
    const r = await this.service.updateVersion(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const r = await this.service.deleteVersion(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post(':id/lock')
  async lock(@Param('id') id: string) {
    const r = await this.service.lockVersion(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post(':id/close')
  async close(@Param('id') id: string) {
    const r = await this.service.closeVersion(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get(':id/progress')
  async progress(@Param('id') id: string) {
    const r = await this.service.getVersionProgress(id);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
