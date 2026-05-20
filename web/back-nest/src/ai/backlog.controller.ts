import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { BacklogService } from './backlog.service.js';
import type { ProposedBacklog } from './backlog.service.js';
import { AiJobService } from './ai-job.service.js';

@Controller('pm/projects/:projectId/ai')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
export class BacklogController {
  constructor(
    private readonly service: BacklogService,
    private readonly jobs: AiJobService,
  ) {}

  /**
   * POST /pm/projects/:projectId/ai/generate-backlog
   * Returns a proposed backlog — does NOT write to the DB. (Synchronous; kept
   * for API clients. The UI uses the async variant below.)
   */
  @Post('generate-backlog')
  @Roles('Admin', 'ProjectManager')
  async preview(@Param('projectId') projectId: string): Promise<ProposedBacklog> {
    return this.service.preview(projectId);
  }

  /**
   * POST /pm/projects/:projectId/ai/generate-backlog-async
   * Starts generation in the background and returns a jobId immediately.
   * Poll GET .../backlog-jobs/:jobId for the result — avoids a ~90s blocking
   * request (and the timeout/"feels broken" UX that comes with it).
   */
  @Post('generate-backlog-async')
  @Roles('Admin', 'ProjectManager')
  generateAsync(@Param('projectId') projectId: string): { jobId: string } {
    const jobId = this.jobs.start(() => this.service.preview(projectId));
    return { jobId };
  }

  /**
   * GET /pm/projects/:projectId/ai/backlog-jobs/:jobId
   * { status: 'pending' | 'done' | 'error', result?, error? }
   */
  @Get('backlog-jobs/:jobId')
  @Roles('Admin', 'ProjectManager')
  jobStatus(@Param('jobId') jobId: string): { status: string; result?: unknown; error?: string } {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException('Tâche de génération introuvable ou expirée.');
    return job;
  }

  /**
   * POST /pm/projects/:projectId/ai/accept-backlog
   * Body: ProposedBacklog (the PM-reviewed + edited version).
   * Writes Epics + Tasks as WorkPackages in one transaction.
   */
  @Post('accept-backlog')
  @Roles('Admin', 'ProjectManager')
  async accept(
    @Param('projectId') projectId: string,
    @Body() backlog: unknown,
    @Req() req: Request,
  ): Promise<{ created: number }> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? '';
    // sanitizeBacklog() inside the service is the single trust boundary —
    // accept() can take `unknown` so NestJS ValidationPipe (whitelist:true)
    // doesn't strip the body when no class-validator DTO is declared.
    return this.service.accept(projectId, userId, backlog as ProposedBacklog);
  }
}
