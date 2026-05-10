import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const STORAGE_ROOT = path.resolve(process.cwd(), 'uploads', 'wp-attachments');

export const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  uploadedAt: Date;
  uploadedByName: string;
}

@Injectable()
export class WpAttachmentsService {
  private readonly logger = new Logger(WpAttachmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify the caller is allowed to access attachments on a given WP.
   * Admins pass-through; everyone else must be the project's PM or in
   * ProjectMember. Throws NotFoundException to avoid leaking WP/project existence.
   */
  private async assertWpProjectAccess(
    workPackageId: string,
    callerUserId: string,
    callerRole: string | undefined,
  ): Promise<{ projectId: string; projectManagerId: string | null }> {
    const wp = await this.prisma.workPackage.findUnique({
      where: { id: workPackageId },
      select: {
        id: true,
        isDeleted: true,
        projectId: true,
        project: { select: { projectManagerId: true, isDeleted: true } },
      },
    });
    if (!wp || wp.isDeleted || wp.project.isDeleted) {
      throw new NotFoundException('Work package introuvable.');
    }
    if (callerRole === 'Admin') {
      return { projectId: wp.projectId, projectManagerId: wp.project.projectManagerId };
    }
    const isPm = wp.project.projectManagerId === callerUserId;
    if (!isPm) {
      const memberHit = await this.prisma.projectMember.findFirst({
        where: { userId: callerUserId, projectId: wp.projectId },
        select: { id: true },
      });
      if (!memberHit) throw new NotFoundException('Work package introuvable.');
    }
    return { projectId: wp.projectId, projectManagerId: wp.project.projectManagerId };
  }

  async list(
    workPackageId: string,
    callerUserId: string,
    callerRole: string | undefined,
  ): Promise<AttachmentRow[]> {
    await this.assertWpProjectAccess(workPackageId, callerUserId, callerRole);
    const rows = await this.prisma.workPackageAttachment.findMany({
      where: { workPackageId, isDeleted: false },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      contentType: r.contentType,
      fileSize: Number(r.fileSize),
      uploadedAt: r.uploadedAt,
      uploadedByName: `${r.uploadedBy.firstName} ${r.uploadedBy.lastName}`,
    }));
  }

  async upload(
    workPackageId: string,
    uploaderUserId: string,
    callerRole: string | undefined,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<AttachmentRow> {
    if (!file?.buffer?.length) throw new BadRequestException('Fichier requis.');
    if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Type de fichier non autorisé : ${file.mimetype}`);
    }

    await this.assertWpProjectAccess(workPackageId, uploaderUserId, callerRole);
    const wp = await this.prisma.workPackage.findUnique({
      where: { id: workPackageId },
      select: { id: true, isDeleted: true },
    });
    if (!wp || wp.isDeleted) throw new NotFoundException('Work package introuvable.');

    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_').slice(0, 200);
    const stored = `${randomUUID()}__${safeName}`;
    const fullPath = path.join(STORAGE_ROOT, stored);
    await fs.writeFile(fullPath, file.buffer);

    const created = await this.prisma.workPackageAttachment.create({
      data: {
        workPackageId,
        uploadedByUserId: uploaderUserId,
        fileName: safeName,
        contentType: file.mimetype,
        fileSize: BigInt(file.size),
        storagePath: stored,
      },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });

    this.logger.log(`uploaded ${stored} (${file.size} bytes) for WP ${workPackageId}`);
    return {
      id: created.id,
      fileName: created.fileName,
      contentType: created.contentType,
      fileSize: Number(created.fileSize),
      uploadedAt: created.uploadedAt,
      uploadedByName: `${created.uploadedBy.firstName} ${created.uploadedBy.lastName}`,
    };
  }

  /** Returns the absolute path + metadata so the controller can stream it. */
  async getDownload(
    attachmentId: string,
    callerUserId: string,
    callerRole: string | undefined,
  ): Promise<{ absolutePath: string; fileName: string; contentType: string }> {
    const row = await this.prisma.workPackageAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!row || row.isDeleted) throw new NotFoundException('Pièce jointe introuvable.');
    // Project membership check on the parent WP — prevents IDOR by direct attachmentId guess.
    await this.assertWpProjectAccess(row.workPackageId, callerUserId, callerRole);
    const abs = path.join(STORAGE_ROOT, row.storagePath);
    // Defence-in-depth: ensure stored path stays under the storage root.
    if (!abs.startsWith(STORAGE_ROOT + path.sep) && abs !== STORAGE_ROOT) {
      throw new BadRequestException('Chemin de fichier invalide.');
    }
    return { absolutePath: abs, fileName: row.fileName, contentType: row.contentType };
  }

  async softDelete(
    attachmentId: string,
    callerUserId: string,
    callerRole: string | undefined,
  ): Promise<void> {
    const row = await this.prisma.workPackageAttachment.findUnique({
      where: { id: attachmentId },
      include: { workPackage: { select: { project: { select: { projectManagerId: true } } } } },
    });
    if (!row || row.isDeleted) throw new NotFoundException('Pièce jointe introuvable.');
    await this.assertWpProjectAccess(row.workPackageId, callerUserId, callerRole);
    const isUploader = row.uploadedByUserId === callerUserId;
    const isPm = row.workPackage.project.projectManagerId === callerUserId;
    if (!isUploader && !isPm) {
      throw new ForbiddenException('Seul l\'auteur ou le chef de projet peut supprimer cette pièce jointe.');
    }
    await this.prisma.workPackageAttachment.update({
      where: { id: attachmentId },
      data: { isDeleted: true },
    });
  }
}
