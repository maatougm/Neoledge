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
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { WpAttachmentsService, ALLOWED_ATTACHMENT_MIMES } from './wp-attachments.service.js';
import { promises as fs } from 'fs';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('pm/work-packages/:wpId/attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WpAttachmentsController {
  constructor(private readonly service: WpAttachmentsService) {}

  @Get()
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
  async list(@Param('wpId') wpId: string, @Req() req: Request) {
    const { userId, role } = readUser(req);
    return this.service.list(wpId, userId, role);
  }

  @Post()
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
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
    const { userId, role } = readUser(req);
    if (!file) throw new BadRequestException('Fichier requis.');
    return this.service.upload(wpId, userId, role, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Get(':attachmentId/download')
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
  async download(
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { userId, role } = readUser(req);
    const meta = await this.service.getDownload(attachmentId, userId, role);
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
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam', 'Member')
  async remove(
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId, role } = readUser(req);
    await this.service.softDelete(attachmentId, userId, role);
    return { success: true };
  }
}

function readUser(req: Request): { userId: string; role: string | undefined } {
  const u = (req as unknown as { user?: { userId?: string; role?: string } }).user;
  return { userId: u?.userId ?? '', role: u?.role };
}
