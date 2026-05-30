import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { WpCommentsService } from './wp-comments.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId/work-packages/:wpId/comments')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class WpCommentsController {
  constructor(private readonly service: WpCommentsService) {}

  @Get()
  async list(@Param('projectId') projectId: string, @Param('wpId') wpId: string) {
    const r = await this.service.list(wpId, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Param('wpId') wpId: string,
    @Body() body: { content: string },
    @CurrentUser() user: AuthUser,
  ) {
    if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');
    const r = await this.service.create(wpId, user.userId, body.content, projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch(':commentId')
  async update(@Param('commentId') id: string, @Body() body: { content: string }, @CurrentUser() user: AuthUser) {
    if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');
    const r = await this.service.update(id, user.userId, body.content);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('commentId') id: string, @CurrentUser() user: AuthUser) {
    const r = await this.service.delete(id, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
  }
}
