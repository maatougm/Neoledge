import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
      // Distinguish business-rule rejections (400) from "not found" (404).
      if (result.error?.includes('introuvable')) throw new NotFoundException(result.error)
      throw new BadRequestException(result.error)
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
  async remove(
    @Param('memberId') memberId: string,
    @Query('force') force?: string,
    @Query('reassignTo') reassignTo?: string,
  ) {
    const opts = {
      force: force === 'true' || force === '1',
      reassignTo: reassignTo || undefined,
    }
    const result = await this.service.remove(memberId, opts)
    if (result.isFailure) {
      if (result.error?.startsWith('BLOCKERS:')) {
        const json = result.error.slice('BLOCKERS:'.length)
        let blockers: Record<string, number> = {}
        try { blockers = JSON.parse(json) as Record<string, number> } catch { /* ignore */ }
        throw new ConflictException({
          message: 'Ce membre a encore des références actives sur le projet',
          blockers,
          code: 'MEMBER_HAS_BLOCKERS',
        })
      }
      if (result.error === 'Membre introuvable') throw new NotFoundException(result.error)
      throw new BadRequestException(result.error)
    }
    return { success: true }
  }
}
