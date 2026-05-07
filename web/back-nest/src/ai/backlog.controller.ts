import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { BacklogService } from './backlog.service.js';
import type { ProposedBacklog } from './backlog.service.js';

@Controller('pm/projects/:projectId/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BacklogController {
  constructor(private readonly service: BacklogService) {}

  /**
   * POST /pm/projects/:projectId/ai/generate-backlog
   * Returns a proposed backlog — does NOT write to the DB.
   */
  @Post('generate-backlog')
  @Roles('Admin', 'ProjectManager')
  async preview(@Param('projectId') projectId: string): Promise<ProposedBacklog> {
    return this.service.preview(projectId);
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
