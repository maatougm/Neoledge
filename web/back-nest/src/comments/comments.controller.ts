import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('api/projects/:projectId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get()
  async getAll(@Param('projectId') projectId: string) {
    const result = await this.service.getProjectComments(projectId);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Param('projectId') projectId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
    if (!body.content?.trim()) throw new BadRequestException('Contenu requis.');
    const result = await this.service.create(projectId, user.userId, body.content);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Get(':commentId')
  async getById(@Param('commentId') commentId: string) {
    const result = await this.service.getById(commentId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Put(':commentId')
  async update(@Param('commentId') commentId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
    const result = await this.service.update(commentId, user.userId, user.role === 'Admin', body.content);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('commentId') commentId: string, @CurrentUser() user: any) {
    const result = await this.service.deleteComment(commentId, user.userId, user.role === 'Admin');
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Post(':commentId/replies')
  @HttpCode(HttpStatus.CREATED)
  async reply(@Param('projectId') projectId: string, @Param('commentId') commentId: string, @CurrentUser() user: any, @Body() body: { content: string }) {
    const result = await this.service.create(projectId, user.userId, body.content, commentId);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }
}
