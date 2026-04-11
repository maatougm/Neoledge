import {
  Controller, Get, Post, Put, Delete, Patch, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException,
} from '@nestjs/common';
import type { FilterCriteria } from '../filters/saved-filters.service.js';
import { ProjectsService } from './projects.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { AssignManagerDto } from './dto/assign-manager.dto.js';

interface JwtUser { userId: string; role: string; }
interface AddFieldDto { label: string; fieldType?: string; isRequired?: boolean; options?: string; }

@Controller('admin/project')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  async getAll(
    @Query('skip') skip = '0',
    @Query('take') take = '50',
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.service.getProjectsPaged(+skip, +take, search, status);
    return result.value;
  }

  @Get('deleted')
  async getDeleted() {
    const result = await this.service.getDeletedProjectsAsync();
    return result.value;
  }

  @Post('search')
  async search(
    @CurrentUser() user: JwtUser,
    @Body() body: FilterCriteria & { skip?: number; take?: number },
  ) {
    const result = await this.service.findWithFilters(user.userId, body);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const result = await this.service.getById(id);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Get('manager/:managerId')
  async getByManager(@Param('managerId') managerId: string) {
    const result = await this.service.getByManager(managerId);
    return result.value;
  }

  @Get('by-status/:status')
  async getByStatus(@Param('status') status: string) {
    const result = await this.service.getByStatus(status);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateProjectDto) {
    const result = await this.service.create(user.userId, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    const result = await this.service.update(id, dto);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const result = await this.service.softDelete(id, user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(@Param('id') id: string) {
    const result = await this.service.restoreProjectAsync(id);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Delete(':id/hard-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param('id') id: string) {
    const result = await this.service.hardDeleteProjectAsync(id);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Post(':id/assign-manager')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assignManager(@Param('id') id: string, @Body() dto: AssignManagerDto) {
    const result = await this.service.assignManager(id, dto.projectManagerId);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const result = await this.service.updateStatus(id, body.status);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Patch(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id') id: string) {
    const result = await this.service.archive(id);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Post(':id/fields')
  @HttpCode(HttpStatus.CREATED)
  async addField(@Param('id') id: string, @Body() dto: AddFieldDto) {
    const result = await this.service.addField(id, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Delete(':id/fields/:fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeField(@Param('id') id: string, @Param('fieldId') fieldId: string) {
    const result = await this.service.removeField(id, fieldId);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Patch(':id/toggle-manager-fields')
  @HttpCode(HttpStatus.NO_CONTENT)
  async toggleManagerFields(@Param('id') id: string, @Body() body: { allow: boolean }) {
    const result = await this.service.toggleManagerFields(id, body.allow);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Param('id') id: string, @Body() body: { name: string }) {
    const result = await this.service.duplicate(id, body.name);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Post('bulk-archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bulkArchive(@Body() body: { projectIds: string[] }) {
    await this.service.bulkArchive(body.projectIds);
  }

  @Post('bulk-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bulkStatus(@Body() body: { projectIds: string[]; status: string }) {
    await this.service.bulkUpdateStatus(body.projectIds, body.status);
  }

  @Post('bulk-assign-manager')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bulkAssignManager(@Body() body: { projectIds: string[]; managerId: string }) {
    await this.service.bulkAssignManager(body.projectIds, body.managerId);
  }

  @Get(':id/activity')
  async getActivity(@Param('id') id: string) {
    const result = await this.service.getActivity(id);
    return result.value;
  }
}
