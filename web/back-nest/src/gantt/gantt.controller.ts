import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { GanttService } from './gantt.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId')
@UseGuards(JwtAuthGuard)
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
    @Body() dto: { title: string; date: string; description?: string; color?: string; workPackageId?: string },
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('Titre requis.');
    if (!dto.date) throw new BadRequestException('Date requise.');
    const r = await this.service.createMilestone(projectId, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('milestones/:id')
  async updateMs(@Param('id') id: string, @Body() dto: { title?: string; date?: string; description?: string; color?: string; isReached?: boolean }) {
    const r = await this.service.updateMilestone(id, dto);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('milestones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMs(@Param('id') id: string) {
    const r = await this.service.deleteMilestone(id);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Post('milestones/:id/reach')
  async reachMs(@Param('id') id: string) {
    const r = await this.service.markMilestoneReached(id);
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
    @Body() body: { snapshotName: string },
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
