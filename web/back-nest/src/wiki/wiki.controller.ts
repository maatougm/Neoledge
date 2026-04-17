import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { WikiService } from './wiki.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId/wiki')
@UseGuards(JwtAuthGuard)
export class WikiController {
  constructor(private readonly service: WikiService) {}

  @Get()
  async tree(@Param('projectId') projectId: string) {
    const r = await this.service.getPageTree(projectId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('search')
  async search(@Param('projectId') projectId: string, @Query('q') q: string) {
    const r = await this.service.search(projectId, q ?? '');
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('pages/:slug')
  async get(@Param('projectId') projectId: string, @Param('slug') slug: string) {
    const r = await this.service.getBySlug(projectId, slug);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('pages')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: { title: string; content: string; parentId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.create(projectId, dto, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Patch('pages/:slug')
  async update(
    @Param('projectId') projectId: string,
    @Param('slug') slug: string,
    @Body() dto: { title?: string; content?: string; comment?: string },
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.update(projectId, slug, dto, user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Delete('pages/:slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('projectId') projectId: string, @Param('slug') slug: string) {
    const r = await this.service.softDelete(projectId, slug);
    if (r.isFailure) throw new BadRequestException(r.error);
  }

  @Patch('pages/:slug/move')
  async move(
    @Param('projectId') projectId: string,
    @Param('slug') slug: string,
    @Body() body: { parentId: string | null },
  ) {
    const r = await this.service.movePage(projectId, slug, body.parentId ?? null);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('pages/:slug/revisions')
  async revisions(@Param('projectId') projectId: string, @Param('slug') slug: string) {
    const r = await this.service.listRevisions(projectId, slug);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Get('pages/:slug/revisions/:version')
  async revision(
    @Param('projectId') projectId: string,
    @Param('slug') slug: string,
    @Param('version') version: string,
  ) {
    const r = await this.service.getRevision(projectId, slug, parseInt(version, 10));
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }

  @Post('pages/:slug/restore/:version')
  async restore(
    @Param('projectId') projectId: string,
    @Param('slug') slug: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthUser,
  ) {
    const r = await this.service.restoreRevision(projectId, slug, parseInt(version, 10), user.userId);
    if (r.isFailure) throw new BadRequestException(r.error);
    return r.value;
  }
}
