import { Controller, Get, Post, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { TemplatesService } from './templates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateTemplateDto, CreateFromProjectDto } from './dto/template.dto.js';

interface JwtUser {
  userId: string;
  role: string;
}

/**
 * Questionnaire templates are now PM-owned. Admins no longer manage them —
 * any ProjectManager can list, create, delete, clone-from-project, and
 * apply templates. The legacy `/admin/projecttemplate` URL has moved to
 * `/pm/templates`.
 */
@Controller('pm/templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ProjectManager')
export class TemplatesController {
  constructor(
    private readonly service: TemplatesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getAll() {
    const result = await this.service.getAll();
    return result.value;
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const result = await this.service.getById(id);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateTemplateDto) {
    const result = await this.service.create(dto, user.userId);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  // Specific static-prefix routes must come before dynamic :id routes
  @Post('from-project/:projectId')
  @HttpCode(HttpStatus.CREATED)
  async createFromProject(
    @Param('projectId') projectId: string,
    @Body() dto: CreateFromProjectDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!dto?.name?.trim()) throw new BadRequestException('Le nom du modèle est requis.');
    // Cloning a project's questionnaire into a template is only allowed
    // for the project's owning PM. Without this check any PM could harvest
    // any project's question structure.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { projectManagerId: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé.');
    if (project.projectManagerId !== user.userId) {
      throw new ForbiddenException('Seul le chef de projet peut créer un modèle à partir de ce projet.');
    }

    const result = await this.service.createFromProject(projectId, dto, user.userId);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    const result = await this.service.deleteTemplate(id);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Post(':id/apply/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async apply(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtUser,
  ) {
    // Applying a template to a project mutates the questionnaire — only
    // the project's PM may do this.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { projectManagerId: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé.');
    if (project.projectManagerId !== user.userId) {
      throw new ForbiddenException("Seul le chef de projet peut appliquer un modèle à ce projet.");
    }

    const result = await this.service.applyToProject(id, projectId);
    if (result.isFailure) throw new BadRequestException(result.error);
  }
}
