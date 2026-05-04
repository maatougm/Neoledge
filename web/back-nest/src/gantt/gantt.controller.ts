import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { GanttService } from './gantt.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { CreateMilestoneDto } from './dto/create-milestone.dto.js';
import { UpdateMilestoneDto } from './dto/update-milestone.dto.js';
import { CaptureBaselineDto } from './dto/capture-baseline.dto.js';

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class GanttController {
  constructor(private readonly service: GanttService) {}

  @Get('gantt')
  async getGantt(@Param('projectId') projectId: string) {
    const r = await this.service.getGanttPayload(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('milestones')
  async listMs(@Param('projectId') projectId: string) {
    const r = await this.service.listMilestones(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('milestones')
  @HttpCode(HttpStatus.CREATED)
  async createMs(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('Titre requis.');
    if (!dto.date) throw new BadRequestException('Date requise.');
    const r = await this.service.createMilestone(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('milestones/:id')
  async updateMs(@Param('id') id: string, @Body() dto: UpdateMilestoneDto) {
    const r = await this.service.updateMilestone(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('milestones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMs(@Param('projectId') projectId: string, @Param('id') id: string) {
    const r = await this.service.deleteMilestone(id, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('milestones/:id/reach')
  async reachMs(@Param('projectId') projectId: string, @Param('id') id: string) {
    const r = await this.service.markMilestoneReached(id, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('baselines')
  async listBaselines(@Param('projectId') projectId: string) {
    const r = await this.service.listBaselines(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('baselines')
  @HttpCode(HttpStatus.CREATED)
  async captureBaseline(
    @Param('projectId') projectId: string,
    @Body() body: CaptureBaselineDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!body.snapshotName?.trim()) throw new BadRequestException('Nom de snapshot requis.');
    const r = await this.service.captureBaseline(projectId, body.snapshotName.trim(), user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('baselines/:snapshotName')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBaseline(@Param('projectId') projectId: string, @Param('snapshotName') snapshotName: string) {
    const r = await this.service.deleteBaseline(projectId, snapshotName);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Get('baselines/:snapshotName/compare')
  async compareBaseline(@Param('projectId') projectId: string, @Param('snapshotName') snapshotName: string) {
    const r = await this.service.compareBaseline(projectId, snapshotName);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
