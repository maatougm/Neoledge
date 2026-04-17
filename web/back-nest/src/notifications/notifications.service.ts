import { Injectable, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { Result } from '../common/result.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { NotificationsGateway, NotificationPayload } from './notifications.gateway.js';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: Date;
}

/** Minimal shape of the preferences JSON stored on AppUser. */
interface UserPreferences {
  emailNotifications?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Optional() @Inject(NotificationsGateway) private readonly gateway: NotificationsGateway | null,
  ) {}

  async create(userId: string, dto: CreateNotificationDto): Promise<Result<NotificationRecord>> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: dto.type,
          title: dto.title,
          message: dto.message,
          projectId: dto.projectId ?? null,
        },
      });
      return Result.ok(notification);
    } catch {
      return Result.fail('Impossible de créer la notification.');
    }
  }

  /**
   * Helper for internal use by other services — fire-and-forget style.
   * Creates the in-app notification, then attempts to send an email if the
   * user has `emailNotifications` enabled (default: true when key is absent).
   * Swallows ALL errors to never break the calling flow.
   */
  async notify(
    userId: string,
    type: string,
    title: string,
    message: string,
    projectId?: string,
  ): Promise<void> {
    // 1. Persist in-app notification
    let created: NotificationPayload | null = null;
    try {
      created = await this.prisma.notification.create({
        data: { userId, type, title, message, projectId: projectId ?? null },
      }) as NotificationPayload;
    } catch {
      // Intentionally swallowed — notification failure must never break business logic
    }

    if (this.gateway && created) {
      this.gateway.emitToUser(userId, created);
    }

    // 2. Optionally send email
    try {
      const user = await this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { email: true, preferences: true },
      });

      if (!user) return;

      const prefs = parsePreferences(user.preferences);
      // Default to true when key is absent
      const wantsEmail = prefs.emailNotifications !== false;

      if (wantsEmail) {
        // Build a simple plain HTML fallback — callers can override with rich templates
        const html = buildGenericHtml(title, message);
        await this.mail.send(user.email, title, html);
      }
    } catch {
      // Intentionally swallowed — email failure must never break business logic
    }
  }

  /**
   * Enhanced notify supporting Notifications 2.0 fields (reason, entityType, entityId, actorId, link).
   * Use for work package assignments, status changes, mentions, deadlines, etc.
   * Swallows errors so it never breaks business logic.
   */
  async notifyEnhanced(params: {
    userId: string;
    type: string;
    title: string;
    message: string;
    projectId?: string | null;
    reason?: 'Mention' | 'Assignee' | 'Watcher' | 'Deadline' | 'StatusChange' | 'Comment' | 'System';
    entityType?: 'work_package' | 'project' | 'meeting' | 'wiki_page' | 'comment' | 'version' | null;
    entityId?: string | null;
    actorId?: string | null;
    link?: string | null;
  }): Promise<void> {
    let created: NotificationPayload | null = null;
    try {
      created = await this.prisma.notification.create({
        data: {
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          projectId: params.projectId ?? null,
          reason: params.reason ?? 'System',
          entityType: params.entityType ?? null,
          entityId: params.entityId ?? null,
          actorId: params.actorId ?? null,
          link: params.link ?? null,
        },
      }) as NotificationPayload;
    } catch {
      return;
    }
    if (this.gateway && created) this.gateway.emitToUser(params.userId, created);
  }

  async getForUser(userId: string): Promise<Result<NotificationRecord[]>> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        take: 50,
      });
      return Result.ok(notifications);
    } catch {
      return Result.fail('Impossible de récupérer les notifications.');
    }
  }

  async markAsRead(id: string, userId: string): Promise<Result<void>> {
    try {
      const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
      if (!notification) return Result.fail('Notification non trouvée.');

      await this.prisma.notification.update({ where: { id }, data: { isRead: true } });
      return Result.ok();
    } catch {
      return Result.fail('Impossible de mettre à jour la notification.');
    }
  }

  async markAllAsRead(userId: string): Promise<Result<void>> {
    try {
      await this.prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });
      return Result.ok();
    } catch {
      return Result.fail('Impossible de mettre à jour les notifications.');
    }
  }

  async getUnreadCount(userId: string): Promise<Result<number>> {
    try {
      const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
      return Result.ok(count);
    } catch {
      return Result.fail('Impossible de compter les notifications non lues.');
    }
  }

  async delete(id: string, userId: string): Promise<Result<void>> {
    try {
      const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
      if (!notification) return Result.fail('Notification non trouvée.');

      await this.prisma.notification.delete({ where: { id } });
      return Result.ok();
    } catch {
      return Result.fail('Impossible de supprimer la notification.');
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function parsePreferences(raw: string | null | undefined): UserPreferences {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as UserPreferences;
    }
  } catch {
    // Malformed JSON — treat as empty preferences
  }
  return {};
}

function buildGenericHtml(title: string, message: string): string {
  const BRAND = '#0d9488';
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#fff;font-size:20px;font-weight:700;">NeoLeadge</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#111827;">${title}</h2>
          <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${message}</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">Email automatique — merci de ne pas y répondre.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
