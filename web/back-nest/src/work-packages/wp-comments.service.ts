import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class WpCommentsService {
  private readonly logger = new Logger(WpCommentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(workPackageId: string) {
    try {
      const comments = await this.prisma.workPackageComment.findMany({
        where: { workPackageId, isDeleted: false },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return Result.ok(comments);
    } catch (e) {
      this.logger.error('wp-comment list failed', e);
      return Result.fail('Échec du chargement des commentaires.');
    }
  }

  async create(workPackageId: string, userId: string, content: string) {
    try {
      if (!content.trim()) return Result.fail('Contenu requis.');
      const c = await this.prisma.workPackageComment.create({
        data: { workPackageId, userId, content: content.trim() },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
      });
      return Result.ok(c);
    } catch (e) {
      this.logger.error('wp-comment create failed', e);
      return Result.fail('Échec de la création.');
    }
  }

  async update(id: string, userId: string, content: string) {
    try {
      const existing = await this.prisma.workPackageComment.findUnique({ where: { id } });
      if (!existing) return Result.fail('Commentaire introuvable.');
      if (existing.userId !== userId) return Result.fail('Accès refusé.');
      // updatedAt is auto-stamped via @updatedAt on the schema — no manual set.
      const c = await this.prisma.workPackageComment.update({
        where: { id },
        data: { content: content.trim() },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
      });
      return Result.ok(c);
    } catch (e) {
      this.logger.error('wp-comment update failed', e);
      return Result.fail('Échec de la mise à jour du commentaire.');
    }
  }

  async delete(id: string, userId: string) {
    try {
      const existing = await this.prisma.workPackageComment.findUnique({ where: { id } });
      if (!existing) return Result.fail<void>('Commentaire introuvable.');
      if (existing.userId !== userId) return Result.fail<void>('Accès refusé.');
      await this.prisma.workPackageComment.update({ where: { id }, data: { isDeleted: true } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('wp-comment delete failed', e);
      return Result.fail<void>('Échec de la suppression du commentaire.');
    }
  }
}
