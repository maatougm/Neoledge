import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MailService } from '../mail/mail.service.js';
import { deadlineWarningEmail } from '../mail/mail.templates.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  clientName: string;
  endDate: Date;
  projectManagerId: string | null;
}

interface RecipientRow {
  id: string;
  email: string;
}

interface AdminRow {
  id: string;
  email: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIPPED_STATUSES = ['Completed', 'Archived'] as const;
const DEADLINE_ALERT_TYPES = ['deadline_warning', 'deadline_critical'] as const;
const CRITICAL_DAYS = 2;
const WARNING_DAYS = 7;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DeadlinesService {
  private readonly logger = new Logger(DeadlinesService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /** Runs every day at 08:00. */
  @Cron('0 8 * * *', { name: 'deadline-check' })
  async checkDeadlines(): Promise<void> {
    // Re-entrance guard — skip if a previous run is still in progress.
    if (this.running) {
      this.logger.warn('Deadline check already running — skipping overlapping run');
      return;
    }
    this.running = true;

    try {
      this.logger.log('Deadline check started');

      const now = new Date();
      const todayStart = startOfDay(now);
      const windowEnd = addDays(todayStart, WARNING_DAYS);

      const [projects, admins] = await Promise.all([
        this.fetchUpcomingProjects(todayStart, windowEnd),
        this.fetchActiveAdmins(),
      ]);

      if (projects.length === 0) {
        this.logger.log('No upcoming deadlines found');
        return;
      }

      const alreadyAlerted = await this.fetchAlreadyAlertedProjectIds(
        projects.map((p) => p.id),
        todayStart,
      );

      let notified = 0;

      for (const project of projects) {
        if (alreadyAlerted.has(project.id)) {
          this.logger.debug(`Project ${project.id} already alerted today — skipping`);
          continue;
        }

        const daysUntilEnd = diffInDays(project.endDate, todayStart);
        const isCritical = daysUntilEnd < CRITICAL_DAYS;
        const type = isCritical ? 'deadline_critical' : 'deadline_warning';
        const { title, message } = buildMessage(project, daysUntilEnd, isCritical);

        const recipientIds = buildRecipients(project.projectManagerId, admins);

        // Use allSettled so a failure for one recipient does not abort the rest.
        await Promise.allSettled(
          recipientIds.map((userId) =>
            this.notifications.notify(userId, type, title, message, project.id),
          ),
        );

        // Send deadline emails directly with the rich template (fire-and-forget)
        const recipientsWithEmail = await this.fetchRecipientsWithEmail(recipientIds);
        const endDateStr = formatDate(project.endDate);
        const emailSubject = isCritical
          ? `Échéance critique — ${project.name}`
          : `Rappel d'échéance — ${project.name}`;
        const emailHtml = deadlineWarningEmail(project.name, daysUntilEnd, endDateStr);

        await Promise.allSettled(
          recipientsWithEmail.map((r) =>
            this.mail.send(r.email, emailSubject, emailHtml).catch(() => undefined),
          ),
        );

        notified += recipientIds.length;
      }

      this.logger.log(`Deadline check completed — ${notified} notification(s) sent`);
    } catch (err: unknown) {
      this.logger.error('Deadline check failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchUpcomingProjects(
    todayStart: Date,
    windowEnd: Date,
  ): Promise<ProjectRow[]> {
    return this.prisma.project.findMany({
      where: {
        isDeleted: false,
        status: { notIn: [...SKIPPED_STATUSES] },
        endDate: { gte: todayStart, lte: windowEnd },
      },
      select: {
        id: true,
        name: true,
        clientName: true,
        endDate: true,
        projectManagerId: true,
      },
    }) as Promise<ProjectRow[]>;
  }

  private async fetchActiveAdmins(): Promise<AdminRow[]> {
    return this.prisma.appUser.findMany({
      where: { isActive: true, role: 'Admin' },
      select: { id: true, email: true },
    }) as Promise<AdminRow[]>;
  }

  private async fetchRecipientsWithEmail(
    recipientIds: string[],
  ): Promise<RecipientRow[]> {
    return this.prisma.appUser.findMany({
      where: { id: { in: recipientIds }, isActive: true },
      select: { id: true, email: true },
    }) as Promise<RecipientRow[]>;
  }

  private async fetchAlreadyAlertedProjectIds(
    projectIds: string[],
    todayStart: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.notification.findMany({
      where: {
        projectId: { in: projectIds },
        type: { in: [...DEADLINE_ALERT_TYPES] },
        createdAt: { gte: todayStart },
      },
      select: { projectId: true },
    });

    return new Set(rows.map((r) => r.projectId).filter((id): id is string => id !== null));
  }
}

// ─── Pure helpers (no side effects) ──────────────────────────────────────────

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Returns the number of whole days from `from` (inclusive) to `to` (exclusive). */
function diffInDays(to: Date, from: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildMessage(
  project: ProjectRow,
  daysUntilEnd: number,
  isCritical: boolean,
): { title: string; message: string } {
  const dateStr = formatDate(project.endDate);

  if (isCritical) {
    return {
      title: 'Échéance critique',
      message: `Le projet ${project.name} (${project.clientName}) expire dans moins de 2 jours (${dateStr}).`,
    };
  }

  return {
    title: 'Rappel d\'échéance',
    message: `Le projet ${project.name} (${project.clientName}) expire dans ${daysUntilEnd} jours (${dateStr}).`,
  };
}

function buildRecipients(projectManagerId: string | null, admins: AdminRow[]): string[] {
  const adminIds = admins.map((a) => a.id);
  const recipientSet = new Set<string>(adminIds);

  if (projectManagerId !== null) {
    recipientSet.add(projectManagerId);
  }

  return [...recipientSet];
}
