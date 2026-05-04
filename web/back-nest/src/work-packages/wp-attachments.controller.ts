import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { WpAttachmentsService, ALLOWED_ATTACHMENT_MIMES } from './wp-attachments.service.js';
import { promises as fs } from 'fs';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('pm/work-packages/:wpId/attachments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WpAttachmentsController {
  constructor(private readonly service: WpAttachmentsService) {}

  @Get()
  @RequirePermission('wp.view')
  async list(@Param('wpId') wpId: string) {
    return this.service.list(wpId);
  }

  @Post()
  @RequirePermission('attachment.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype)) {
          return cb(new BadRequestException(`Type de fichier non autorisé : ${file.mimetype}`), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('wpId') wpId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? '';
    if (!file) throw new BadRequestException('Fichier requis.');
    return this.service.upload(wpId, userId, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Get(':attachmentId/download')
  @RequirePermission('wp.view')
  async download(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const meta = await this.service.getDownload(attachmentId);
    const data = await fs.readFile(meta.absolutePath);
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
    );
    res.setHeader('Content-Length', String(data.length));
    res.end(data);
  }

  @Delete(':attachmentId')
  // attachment.upload (not wp.edit) — Spec/Member/Deploy all have it.
  // Ownership is enforced inside the service: only uploader or project PM
  // may delete; otherwise a 403 ForbiddenException is thrown.
  @RequirePermission('attachment.upload')
  async remove(
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? '';
    await this.service.softDelete(attachmentId, userId);
    return { success: true };
  }
}
