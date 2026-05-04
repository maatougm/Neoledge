import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class WpCommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workPackageId: string) {
    try {
      const comments = await this.prisma.workPackageComment.findMany({
        where: { workPackageId, isDeleted: false },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return Result.ok(comments);
    } catch {
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
    } catch {
      return Result.fail('Échec de la création.');
    }
  }

  async update(id: string, userId: string, content: string) {
    try {
      const existing = await this.prisma.workPackageComment.findUnique({ where: { id } });
      if (!existing) return Result.fail('Commentaire introuvable.');
      if (existing.userId !== userId) return Result.fail('Accès refusé.');
      const c = await this.prisma.workPackageComment.update({
        where: { id },
        data: { content: content.trim(), updatedAt: new Date() },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
      });
      return Result.ok(c);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async delete(id: string, userId: string) {
    try {
      const existing = await this.prisma.workPackageComment.findUnique({ where: { id } });
      if (!existing) return Result.fail<void>('Commentaire introuvable.');
      if (existing.userId !== userId) return Result.fail<void>('Accès refusé.');
      await this.prisma.workPackageComment.update({ where: { id }, data: { isDeleted: true } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }
}
