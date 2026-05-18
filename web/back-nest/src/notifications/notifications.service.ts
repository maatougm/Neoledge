import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(NotificationsService.name);

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
   * Verify the target user is allowed to receive a project-scoped notification.
   * Membership = PM, ProjectMember row, or global Admin role.
   *
   * Fail-closed: if the check itself errors (DB blip, etc.) we return false so
   * the caller drops the notification rather than risk persisting a cross-
   * project leak. The notification is recoverable — the producer log line lets
   * ops detect it and the user will see it on the next legitimate event.
   */
  private async assertProjectMember(userId: string, projectId: string): Promise<boolean> {
    try {
      const [asPm, asProjectMember, dbUser] = await Promise.all([
        this.prisma.project.findFirst({
          where: { id: projectId, isDeleted: false, projectManagerId: userId },
          select: { id: true },
        }),
        this.prisma.projectMember.findFirst({
          where: { projectId, userId },
          select: { id: true },
        }),
        this.prisma.appUser.findUnique({
          where: { id: userId },
          select: { role: true },
        }),
      ]);
      return Boolean(asPm) || Boolean(asProjectMember) || dbUser?.role === 'Admin';
    } catch (e) {
      this.logger.error(`assertProjectMember: check failed for user=${userId} project=${projectId}`, e);
      return false;
    }
  }

  /**
   * Helper for internal use by other services — fire-and-forget style.
   * Creates the in-app notification, then attempts to send an email if the
   * user has `emailNotifications` enabled (default: true when key is absent).
   * Swallows ALL errors to never break the calling flow.
   *
   * When `actorId` equals `userId` the notification is skipped (self-notify).
   * When `projectId` is provided the target user must be a project member.
   */
  async notify(
    userId: string,
    type: string,
    title: string,
    message: string,
    projectId?: string,
    actorId?: string,
    options: { skipEmail?: boolean; skipScopeCheck?: boolean } = {},
  ): Promise<void> {
    // Skip self-notifications.
    if (actorId && actorId === userId) return;

    // Scope check: when a projectId is provided, verify the target user is
    // a member (PM, Admin, or in ProjectMember). Fail-closed on errors.
    // Callers that have already validated membership (e.g. iterating over
    // a `findMany({ role: 'Admin' })` result) can pass `skipScopeCheck`
    // to avoid the N×3 per-target queries that would otherwise fan out.
    if (projectId && !options.skipScopeCheck) {
      const allowed = await this.assertProjectMember(userId, projectId);
      if (!allowed) {
        this.logger.warn(`notify: user ${userId} not a member of project ${projectId} — skipping`);
        return;
      }
    }

    // 1. Persist in-app notification
    let created: NotificationPayload | null = null;
    try {
      created = await this.prisma.notification.create({
        data: { userId, type, title, message, projectId: projectId ?? null },
      }) as NotificationPayload;
    } catch (e) {
      this.logger.error('notify: failed to persist notification', e);
    }

    if (this.gateway && created) {
      this.gateway.emitToUser(userId, created);
    }

    // 2. Optionally send email — callers that send their own rich-template
    // email (deadlines, validation digests) pass `skipEmail: true` to avoid
    // a duplicate generic email landing in the user's inbox alongside theirs.
    if (!options.skipEmail) {
      await this.sendEmailIfWanted(userId, title, message, null);
    }
  }

  /**
   * Enhanced notify supporting Notifications 2.0 fields (reason, entityType, entityId, actorId, link).
   * Use for work package assignments, status changes, mentions, deadlines, etc.
   * Swallows errors so it never breaks business logic.
   *
   * When `actorId` equals `userId` the notification is skipped (self-notify).
   * When `projectId` is provided the target user must be a project member.
   */
  async notifyEnhanced(params: {
    userId: string;
    type: string;
    title: string;
    message: string;
    projectId?: string | null;
    /** Why the notification was generated. Reserved values include
     *  'Mention' | 'Assignee' | 'Watcher' | 'Deadline' | 'StatusChange'
     *  | 'Comment' | 'System' | 'AwaitingReview' | 'cahier_generated'
     *  | 'cahier_approved' | 'cahier_rejected' | 'cahier_validated'.
     *  Kept as string to allow domain-specific reason codes. */
    reason?: string;
    /** Reserved entity types include 'work_package' | 'project' | 'meeting'
     *  | 'comment' | 'version' | 'Project'. Kept as string for forward-compat. */
    entityType?: string | null;
    entityId?: string | null;
    actorId?: string | null;
    link?: string | null;
  }): Promise<void> {
    // Skip self-notifications.
    if (params.actorId && params.actorId === params.userId) return;

    // Scope check: when a projectId is provided, verify the target user is
    // a member (PM, Admin, or in ProjectMember). Fail-closed on errors.
    if (params.projectId) {
      const allowed = await this.assertProjectMember(params.userId, params.projectId);
      if (!allowed) {
        this.logger.warn(`notifyEnhanced: user ${params.userId} not a member of project ${params.projectId} — skipping`);
        return;
      }
    }

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
    } catch (e) {
      this.logger.error('notifyEnhanced: failed to persist notification', e);
      return;
    }
    if (this.gateway && created) this.gateway.emitToUser(params.userId, created);

    // Email delivery — was missing from notifyEnhanced before, so every
    // modern producer (WP assign, mentions, cahier feedback, bulk-assign)
    // silently skipped email. The user's emailNotifications preference
    // is now honored on this path too.
    await this.sendEmailIfWanted(params.userId, params.title, params.message, params.link);
  }

  /**
   * Best-effort email delivery shared by `notify()` and `notifyEnhanced()`.
   * Reads the user's `emailNotifications` preference (default true) and only
   * sends if enabled. Never throws — failures are logged and swallowed so
   * email outages don't break the in-app notification flow.
   */
  private async sendEmailIfWanted(
    userId: string,
    title: string,
    message: string,
    link: string | null | undefined,
  ): Promise<void> {
    try {
      const user = await this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { email: true, preferences: true, isActive: true },
      });
      if (!user || !user.isActive || !user.email) return;
      const prefs = parsePreferences(user.preferences);
      if (prefs.emailNotifications === false) return;
      const html = buildGenericHtml(title, message, link ?? null);
      await this.mail.send(user.email, title, html);
    } catch (e) {
      this.logger.warn(`notify email delivery failed for ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async getForUser(
    userId: string,
    options: { cursor?: string; take?: number } = {},
  ): Promise<Result<{ items: NotificationRecord[]; nextCursor: string | null }>> {
    try {
      const take = Math.min(options.take ?? 50, 100);
      // Cursor seek + composite order (isRead, createdAt) is incompatible:
      // cursor.id walks the id-ordered sequence but the result is sorted by
      // a different key, so page 2 skips or duplicates rows when isRead
      // changes between fetches. Order by createdAt only and let the UI
      // group unread vs read visually.
      const notifications = await this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const hasMore = notifications.length > take;
      const items = hasMore ? notifications.slice(0, take) : notifications;
      const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
      return Result.ok({ items, nextCursor });
    } catch {
      return Result.fail('Impossible de récupérer les notifications.');
    }
  }

  async markAsRead(id: string, userId: string): Promise<Result<void>> {
    try {
      // Single scoped updateMany — atomic, no read-before-write race,
      // and treating "already read" / "not yours" identically (0-count)
      // makes the endpoint idempotent.
      const { count } = await this.prisma.notification.updateMany({
        where: { id, userId, isRead: false },
        data: { isRead: true },
      });
      if (count === 0) {
        // Distinguish actual not-found from already-read by a follow-up scoped read.
        const exists = await this.prisma.notification.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (!exists) return Result.fail('Notification non trouvée.');
        // Already-read: idempotent success.
      }
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
      // Scoped deleteMany — atomic and resistant to refactors of the gate
      // forgetting to filter by userId.
      const { count } = await this.prisma.notification.deleteMany({
        where: { id, userId },
      });
      if (count === 0) return Result.fail('Notification non trouvée.');
      return Result.ok();
    } catch {
      return Result.fail('Impossible de supprimer la notification.');
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal HTML escaping for user-supplied strings inserted into email templates.
 * Prevents XSS via crafted rule names / WP titles delivered in notification emails.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function buildGenericHtml(title: string, message: string, link: string | null = null): string {
  const BRAND = '#0d9488';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  // Only build a CTA when the link is a path starting with "/" (defence
  // against open-redirect through a tampered notification row).
  const APP_URL = (process.env.APP_URL ?? 'https://neoleadge.pythagore-init.com').replace(/\/$/, '');
  const safeLink = link && link.startsWith('/') ? `${APP_URL}${link}` : null;
  const cta = safeLink
    ? `<p style="margin:18px 0 0 0;"><a href="${safeLink}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-size:14px;">Ouvrir dans NeoLeadge</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#fff;font-size:20px;font-weight:700;">NeoLeadge</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#111827;">${safeTitle}</h2>
          <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${safeMessage}</p>
          ${cta}
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
