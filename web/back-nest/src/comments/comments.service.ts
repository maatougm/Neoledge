import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getProjectComments(projectId: string) {
    const comments = await this.prisma.projectComment.findMany({
      where: { projectId, isDeleted: false, parentCommentId: null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
        replies: {
          where: { isDeleted: false },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Result.ok(comments.map((c) => this.toDto(c)));
  }

  async getById(commentId: string) {
    const c = await this.prisma.projectComment.findFirst({
      where: { id: commentId, isDeleted: false },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
        replies: {
          where: { isDeleted: false },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } } },
        },
      },
    });
    if (!c) return Result.fail<any>('Commentaire non trouvé.');
    return Result.ok(this.toDto(c));
  }

  async create(projectId: string, userId: string, content: string, parentCommentId?: string) {
    if (!content?.trim()) return Result.fail<unknown>('Contenu requis.');
    if (content.length > 20_000) return Result.fail<unknown>('Commentaire trop long (max 20 000 caractères).');

    const mentions = this.extractMentions(content);
    const comment = await this.prisma.projectComment.create({
      data: {
        projectId,
        userId,
        content,
        parentCommentId: parentCommentId ?? null,
        mentions: mentions.length ? JSON.stringify(mentions.slice(0, 10)) : null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } } },
    });

    // Notify mentioned users who are active members of the project.
    void this.notifyMentions(projectId, userId, comment.id, mentions);

    // If this is a reply, also notify the parent comment's author — a reply
    // without an explicit @-mention used to silently drop on the floor.
    if (parentCommentId) {
      void this.notifyParentAuthor(projectId, userId, parentCommentId, comment.id, content)
        .catch((e) => this.logger.warn(`reply notification failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    // Project activity row so admin/activity feed + project activity tab update live
    void this.prisma.projectActivity
      .create({
        data: {
          projectId,
          userId,
          action: parentCommentId ? 'comment_replied' : 'comment_added',
          detail: content.length > 120 ? `${content.slice(0, 120)}…` : content,
        },
      })
      .catch(() => { /* non-fatal */ })

    return Result.ok(this.toDto({ ...comment, replies: [] }));
  }

  /**
   * Resolve @-mention usernames/ids against active project members and
   * send a 'mention' notification to each.  Fire-and-forget — never throws.
   */
  private async notifyMentions(
    projectId: string,
    actorId: string,
    commentId: string,
    rawMentions: string[],
  ): Promise<void> {
    if (rawMentions.length === 0) return;
    try {
      // Pull active users whose firstName, lastName, or id matches any mention token.
      const users = await this.prisma.appUser.findMany({
        where: {
          isActive: true,
          OR: rawMentions.map((m) => [
            { id: m },
            { firstName: { equals: m } },
            { lastName: { equals: m } },
          ]).flat(),
        },
        select: { id: true },
      });

      // Filter to project members only by checking notification delivery via notifyEnhanced
      // (which already does project-membership scoping internally).
      for (const user of users) {
        if (user.id === actorId) continue;
        void this.notifications.notifyEnhanced({
          userId: user.id,
          type: 'comment_mention',
          title: 'Vous avez été mentionné(e)',
          message: 'Vous avez été mentionné(e) dans un commentaire.',
          projectId,
          reason: 'Mention',
          entityType: 'comment',
          entityId: commentId,
          actorId,
          link: `/app/pm/projects/${projectId}/activity`,
        }).catch((e) => this.logger.error('mention notification failed', e));
      }
    } catch (e) {
      this.logger.error('notifyMentions failed', e);
    }
  }

  /**
   * Notify the author of a parent comment when someone replies to them.
   * The actor is excluded automatically (notifyEnhanced self-skip).
   */
  private async notifyParentAuthor(
    projectId: string,
    actorId: string,
    parentCommentId: string,
    replyCommentId: string,
    replyContent: string,
  ): Promise<void> {
    const parent = await this.prisma.projectComment.findUnique({
      where: { id: parentCommentId },
      select: { userId: true, isDeleted: true },
    });
    if (!parent || parent.isDeleted) return;
    if (parent.userId === actorId) return;
    const snippet = replyContent.length > 120 ? replyContent.slice(0, 120) + '…' : replyContent;
    await this.notifications.notifyEnhanced({
      userId: parent.userId,
      type: 'comment_reply',
      reason: 'Comment',
      title: 'Réponse à votre commentaire',
      message: snippet,
      projectId,
      entityType: 'comment',
      entityId: replyCommentId,
      actorId,
      link: `/app/pm/projects/${projectId}/activity`,
    });
  }

  async update(commentId: string, userId: string, isAdmin: boolean, content: string) {
    const c = await this.prisma.projectComment.findFirst({ where: { id: commentId, isDeleted: false } });
    if (!c) return Result.fail<any>('Commentaire non trouvé.');
    if (c.userId !== userId && !isAdmin) return Result.fail<any>('Non autorisé.');

    const updated = await this.prisma.projectComment.update({
      where: { id: commentId },
      data: { content, updatedAt: new Date(), mentions: JSON.stringify(this.extractMentions(content)) },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
        replies: {
          where: { isDeleted: false },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } } },
        },
      },
    });
    return Result.ok(this.toDto(updated));
  }

  async deleteComment(commentId: string, userId: string, isAdmin: boolean) {
    const c = await this.prisma.projectComment.findFirst({ where: { id: commentId, isDeleted: false } });
    if (!c) return Result.fail('Commentaire non trouvé.');
    if (c.userId !== userId && !isAdmin) return Result.fail('Non autorisé.');

    await this.prisma.projectComment.update({ where: { id: commentId }, data: { isDeleted: true } });
    return Result.ok();
  }

  private extractMentions(content: string): string[] {
    const matches = content.match(/@(\w+)/g);
    return matches ? matches.map((m) => m.slice(1)) : [];
  }

  private toDto(c: any): any {
    return {
      id: c.id,
      projectId: c.projectId,
      userId: c.userId,
      user: c.user
        ? { id: c.user.id, firstName: c.user.firstName, lastName: c.user.lastName, avatarPath: c.user.avatarPath ?? null }
        : null,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      parentCommentId: c.parentCommentId,
      replies: (c.replies ?? []).map((r: any) => this.toDto(r)),
      mentions: parseMentions(c.mentions),
    };
  }
}

function parseMentions(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
