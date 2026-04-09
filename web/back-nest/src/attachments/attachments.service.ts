import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import * as fs from 'fs';
import * as path from 'path';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'attachments');

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjectAttachments(projectId: string) {
    const attachments = await this.prisma.projectAttachment.findMany({
      where: { projectId, isDeleted: false },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
    return Result.ok(attachments.map((a) => this.toDto(a)));
  }

  async getById(attachmentId: string) {
    const a = await this.prisma.projectAttachment.findFirst({
      where: { id: attachmentId, isDeleted: false },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });
    if (!a) return Result.fail<any>('Pièce jointe non trouvée.');
    return Result.ok(this.toDto(a));
  }

  async upload(projectId: string, userId: string, dto: any) {
    const buffer = Buffer.from(dto.base64Content, 'base64');
    if (buffer.length > MAX_FILE_SIZE) return Result.fail<any>('Fichier trop volumineux (max 10 Mo).');

    const ext = path.extname(dto.fileName).toLowerCase();
    const dir = path.join(UPLOAD_DIR, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storageName = `${crypto.randomUUID()}${ext}`;
    const storagePath = path.join(dir, storageName);
    fs.writeFileSync(storagePath, buffer);

    const attachment = await this.prisma.projectAttachment.create({
      data: {
        projectId,
        uploadedByUserId: userId,
        fileName: dto.fileName,
        fileExtension: ext,
        contentType: dto.contentType,
        fileSize: BigInt(buffer.length),
        storagePath,
        description: dto.description ?? null,
        category: dto.category ?? 'Document',
      },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });

    return Result.ok(this.toDto(attachment));
  }

  async updateMetadata(attachmentId: string, dto: any) {
    const a = await this.prisma.projectAttachment.findFirst({ where: { id: attachmentId, isDeleted: false } });
    if (!a) return Result.fail<any>('Pièce jointe non trouvée.');

    const updated = await this.prisma.projectAttachment.update({
      where: { id: attachmentId },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    });
    return Result.ok(this.toDto(updated));
  }

  async deleteAttachment(attachmentId: string) {
    const a = await this.prisma.projectAttachment.findFirst({ where: { id: attachmentId, isDeleted: false } });
    if (!a) return Result.fail('Pièce jointe non trouvée.');
    await this.prisma.projectAttachment.update({ where: { id: attachmentId }, data: { isDeleted: true } });
    return Result.ok();
  }

  async download(attachmentId: string) {
    const a = await this.prisma.projectAttachment.findFirst({ where: { id: attachmentId, isDeleted: false } });
    if (!a) return Result.fail<any>('Pièce jointe non trouvée.');
    if (!fs.existsSync(a.storagePath)) return Result.fail<any>('Fichier introuvable sur le disque.');

    return Result.ok({
      content: fs.readFileSync(a.storagePath),
      fileName: a.fileName,
      contentType: a.contentType,
    });
  }

  async getTotalStorage() {
    const result = await this.prisma.projectAttachment.aggregate({
      where: { isDeleted: false },
      _sum: { fileSize: true },
    });
    const bytes = Number(result._sum.fileSize ?? 0);
    return Result.ok({ bytes, formatted: this.formatBytes(bytes) });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  private toDto(a: any) {
    return {
      id: a.id,
      projectId: a.projectId,
      uploadedByUserId: a.uploadedByUserId,
      uploadedByUserName: a.uploadedBy ? `${a.uploadedBy.firstName} ${a.uploadedBy.lastName}` : '',
      fileName: a.fileName,
      fileExtension: a.fileExtension,
      contentType: a.contentType,
      fileSize: Number(a.fileSize),
      fileSizeFormatted: this.formatBytes(Number(a.fileSize)),
      description: a.description,
      category: a.category,
      uploadedAt: a.uploadedAt,
      downloadUrl: `/api/projects/${a.projectId}/attachments/${a.id}/download`,
    };
  }
}
