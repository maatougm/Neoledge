import { Controller, Get, Post, Patch, Delete, Param, Body, Res, UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentsService } from './attachments.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { UploadAttachmentDto } from './dto/upload-attachment.dto.js';
import { UpdateAttachmentDto } from './dto/update-attachment.dto.js';

@Controller('api/projects/:projectId/attachments')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectAccess('projectId')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @Get()
  async getAll(@Param('projectId') projectId: string) {
    const result = await this.service.getProjectAttachments(projectId);
    return result.value;
  }

  @Get(':attachmentId')
  async getById(@Param('attachmentId') attachmentId: string) {
    const result = await this.service.getById(attachmentId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async upload(@Param('projectId') projectId: string, @CurrentUser() user: { userId: string }, @Body() dto: UploadAttachmentDto) {
    const result = await this.service.upload(projectId, user.userId, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Patch(':attachmentId')
  async update(@Param('attachmentId') attachmentId: string, @Body() dto: UpdateAttachmentDto) {
    const result = await this.service.updateMetadata(attachmentId, dto);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('attachmentId') attachmentId: string) {
    const result = await this.service.deleteAttachment(attachmentId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Get(':attachmentId/download')
  async download(@Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const result = await this.service.download(attachmentId);
    if (result.isFailure) throw new NotFoundException(result.error);
    const { content, fileName, contentType } = result.value!;
    // RFC 6266: provide an ASCII fallback (strip control chars and quotes) plus
    // a UTF-8 encoded filename* parameter so non-ASCII names are preserved.
    const asciiFallback = fileName.replace(/[\x00-\x1f\x7f"]/g, '_');
    const encoded = encodeURIComponent(fileName);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    });
    res.send(content);
  }
}

@Controller('api/attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AttachmentAdminController {
  constructor(private readonly service: AttachmentsService) {}

  @Get('storage')
  async getStorage() {
    const result = await this.service.getTotalStorage();
    return result.value;
  }
}
