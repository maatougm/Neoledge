import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class WpCommentsService {
  private readonly logger = new Logger(WpCommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

      // Fire-and-forget notifications: assignee + watchers (skip author).
      // Was previously a silent no-op — the WP author and watchers had no
      // way to know a comment landed without polling the panel.
      void this.notifyWatchersAndAssignee(workPackageId, userId, c.content).catch((e) =>
        this.logger.warn(`wp-comment notify fanout failed: ${e instanceof Error ? e.message : String(e)}`),
      );

      return Result.ok(c);
    } catch (e) {
      this.logger.error('wp-comment create failed', e);
      return Result.fail('Échec de la création.');
    }
  }

  private async notifyWatchersAndAssignee(
    workPackageId: string,
    actorId: string,
    content: string,
  ): Promise<void> {
    const wp = await this.prisma.workPackage.findFirst({
      where: { id: workPackageId, isDeleted: false },
      select: {
        id: true, title: true, projectId: true, assigneeId: true,
        watchers: { select: { userId: true } },
      },
    });
    if (!wp) return;

    const targets = new Set<string>();
    if (wp.assigneeId && wp.assigneeId !== actorId) targets.add(wp.assigneeId);
    for (const w of wp.watchers) {
      if (w.userId !== actorId) targets.add(w.userId);
    }
    if (targets.size === 0) return;

    const snippet = content.length > 120 ? content.slice(0, 120) + '…' : content;
    await Promise.allSettled(
      [...targets].map((userId) =>
        this.notifications.notifyEnhanced({
          userId,
          actorId,
          type: 'wp_comment_added',
          reason: 'Comment',
          title: 'Nouveau commentaire',
          message: `Sur « ${wp.title} » : ${snippet}`,
          projectId: wp.projectId,
          entityType: 'work_package',
          entityId: wp.id,
          link: `/app/pm/projects/${wp.projectId}/workpackages?wpId=${wp.id}`,
        }),
      ),
    );
  }

  async update(id: string, userId: string, content: string) {
    try {
      // findFirst + isDeleted:false — a soft-deleted comment must not be
      // editable (was findUnique, which served deleted rows).
      const existing = await this.prisma.workPackageComment.findFirst({ where: { id, isDeleted: false } });
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
      // findFirst + isDeleted:false — re-deleting an already-soft-deleted
      // comment should 404, not silently succeed.
      const existing = await this.prisma.workPackageComment.findFirst({ where: { id, isDeleted: false } });
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
