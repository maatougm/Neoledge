import { Controller, Get, Post, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, NotFoundException, BadRequestException } from '@nestjs/common';
import { TemplatesService } from './templates.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateTemplateDto, CreateFromProjectDto } from './dto/template.dto.js';

@Controller('admin/projecttemplate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

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
  async create(@CurrentUser() user: { userId: string }, @Body() dto: CreateTemplateDto) {
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
    @CurrentUser() user: { userId: string },
  ) {
    if (!dto?.name?.trim()) throw new BadRequestException('Le nom du modèle est requis.');
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
  async apply(@Param('id') id: string, @Param('projectId') projectId: string) {
    const result = await this.service.applyToProject(id, projectId);
    if (result.isFailure) throw new BadRequestException(result.error);
  }
}
