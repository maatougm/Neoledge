import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { ProjectMembersService } from './project-members.service.js'
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project-member.dto.js'

@Controller('pm/projects/:projectId/members')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class ProjectMembersController {
  constructor(private readonly service: ProjectMembersService) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    const result = await this.service.findAll(projectId)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  @Post()
  async add(
    @Param('projectId') projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    const result = await this.service.add(projectId, dto.userId, dto.label)
    if (result.isFailure) {
      if (result.error?.includes('déjà')) throw new ConflictException(result.error)
      throw new NotFoundException(result.error)
    }
    return result.value
  }

  @Patch(':memberId')
  async updateLabel(
    @Param('memberId') memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    const result = await this.service.updateLabel(memberId, dto.label)
    if (result.isFailure) throw new NotFoundException(result.error)
    return { success: true }
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('memberId') memberId: string) {
    const result = await this.service.remove(memberId)
    if (result.isFailure) throw new NotFoundException(result.error)
  }
}
