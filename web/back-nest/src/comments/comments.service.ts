import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const mentions = this.extractMentions(content);
    const comment = await this.prisma.projectComment.create({
      data: {
        projectId,
        userId,
        content,
        parentCommentId: parentCommentId ?? null,
        mentions: mentions.length ? JSON.stringify(mentions) : null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarPath: true } } },
    });
    return Result.ok(this.toDto({ ...comment, replies: [] }));
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
      userName: `${c.user.firstName} ${c.user.lastName}`,
      userAvatarPath: c.user.avatarPath ?? null,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      parentCommentId: c.parentCommentId,
      replies: (c.replies ?? []).map((r: any) => this.toDto(r)),
      mentions: c.mentions ? JSON.parse(c.mentions) : [],
    };
  }
}
